/**
 * Running one step of a run (`executeNodeActivity`), and what the other
 * run activities share: loading a run's graph and options.
 *
 * Order of one attempt:
 *
 * 1. Load the run (scoped by workspace), its graph and the step.
 * 2. A step with an outside or PostGear effect that already SUCCEEDED or
 *    ran DRY in any attempt returns that result without acting again (a
 *    retried or replayed activity can never post twice).
 * 3. Parse the settings, gather earlier outputs (or a step test's seeded
 *    ones), build the scope and resolve every data token.
 * 4. Write the attempt's RUNNING row with the resolved settings as input,
 *    redacted with the connection's own values.
 * 5. Check the connection (not for a dry run) and the required fields.
 * 6. Run the executor; write SUCCEEDED, DRY_RUN or HANDLED_ERROR with the
 *    redacted output, or FAILED with the error, and throw the typed
 *    `ApplicationFailure` the workflow's retry policy reads.
 */
import {
  type AutomationGraph,
  type GraphNode,
  getDefinition,
  LIMITS,
  type NodeDefinition,
  redact,
  resolveConfig,
  upgradeGraph,
} from '@postgear/automation';
import type { AutomationStepStatus } from '@postgear/db';
import type { AutomationRunOptions, AutomationStepError } from '@postgear/scheduling';
import type { NodeRunResult, RunRef, StepRef } from './activity-contract';
import { connectionIdOf, connectionProblem, connectionValues } from './connection';
import type { ExecLog, ExecutorRegistry } from './executors/types';
import { permanent, TIMEOUT_MESSAGE, toApplicationFailure, toStepFailure } from './failures';
import type { RunRecord, RunStore, StepRecord, StoredConnection } from './run-store';
import {
  buildScope,
  missingRequired,
  priorOutputs,
  readRunOptions,
  runMode,
  runTimeZone,
} from './scope';

/** Everything the engine reads from outside, so tests can pass their own. */
export interface EngineEnv {
  store: RunStore;
  executors: ExecutorRegistry;
  /** AUTOMATION_SIMULATION. */
  simulation: boolean;
  now(): Date;
  /** Temporal's attempt number of the running activity. */
  attempt(): number;
  /** Aborted when the activity is cancelled. */
  signal(): AbortSignal;
  heartbeat(): void;
  log: ExecLog;
}

export const OPEN_RUN_STATUSES = ['QUEUED', 'RUNNING', 'WAITING'] as const;
export const OPEN_STEP_STATUSES: AutomationStepStatus[] = ['QUEUED', 'RUNNING', 'WAITING'];

export const RUN_GONE_MESSAGE = 'This run no longer exists.';
export const RUN_UNREADABLE_MESSAGE =
  'This workflow could not be read. Open it, save it again and start a new run.';
export const RUN_FINISHED_MESSAGE = 'This run has already finished.';
export const STEP_GONE_MESSAGE = 'This step is no longer in the workflow.';
export const STEP_TYPE_GONE_MESSAGE = 'This step type is not available any more.';

export interface LoadedRun {
  run: RunRecord;
  graph: AutomationGraph;
  options: AutomationRunOptions;
  mode: 'test' | 'live';
}

/** The run with its graph parsed; throws a permanent `StepFailure` when either is missing. */
export async function loadRunGraph(store: RunStore, ref: RunRef): Promise<LoadedRun> {
  const run = await store.loadRun(ref);
  if (!run) {
    throw permanent(RUN_GONE_MESSAGE, 'run_gone');
  }
  let graph: AutomationGraph;
  try {
    graph = upgradeGraph(run.graph);
  } catch {
    throw permanent(RUN_UNREADABLE_MESSAGE, 'graph_unreadable');
  }
  return { run, graph, options: readRunOptions(run.options), mode: runMode(run) };
}

export function isOpenRun(run: Pick<RunRecord, 'status'>): boolean {
  return (OPEN_RUN_STATUSES as readonly string[]).includes(run.status);
}

export function findNode(graph: AutomationGraph, nodeKey: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.key === nodeKey);
  if (!node) {
    throw permanent(STEP_GONE_MESSAGE, 'step_gone');
  }
  return node;
}

/** A step's settings parsed by its type's schema; a permanent failure when they do not parse. */
export function parsedConfig(node: GraphNode, definition: NodeDefinition): Record<string, unknown> {
  const parsed = definition.configSchema.safeParse(node.config);
  if (!parsed.success) {
    throw permanent(
      `${node.name} is not set up correctly. Open it and check its settings.`,
      'config_invalid',
      {
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    );
  }
  return parsed.data as Record<string, unknown>;
}

/** Resolves a step's settings against the run's data (Delay and Manual Review use it too). */
export async function resolveStep(
  store: RunStore,
  ref: RunRef,
  loaded: LoadedRun,
  node: GraphNode,
  definition: NodeDefinition,
) {
  const rawConfig = parsedConfig(node, definition);
  const priors = priorOutputs(loaded.run, loaded.options, await store.stepOutputs(ref));
  const scope = buildScope({
    run: loaded.run,
    graph: loaded.graph,
    options: loaded.options,
    priors,
  });
  const timeZone = runTimeZone(loaded.graph);
  const resolved = resolveConfig(rawConfig, scope, { timeZone });
  return { rawConfig, priors, scope, timeZone, resolved };
}

/** The base of a new step row. */
export function stepRow(
  runId: string,
  node: GraphNode,
  attempt: number,
  change: Partial<StepRecord>,
): StepRecord {
  return {
    runId,
    nodeKey: node.key,
    nodeType: node.type,
    nodeName: node.name,
    status: 'RUNNING',
    attempt,
    input: null,
    output: null,
    truncated: false,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    ...change,
  };
}

/**
 * Earlier attempts of this step still RUNNING (their worker died or they
 * timed out) are failed, so readers never see two attempts running.
 */
async function failStaleAttempts(
  env: EngineEnv,
  ref: StepRef,
  attempt: number,
  finishedAt: Date,
): Promise<void> {
  const rows = await env.store.listSteps(ref, ref.nodeKey);
  for (const row of rows) {
    if (row.attempt >= attempt || row.status !== 'RUNNING') continue;
    await env.store.moveStep(
      ref,
      { runId: ref.runId, nodeKey: ref.nodeKey, attempt: row.attempt },
      ['RUNNING'],
      {
        status: 'FAILED',
        error: { message: TIMEOUT_MESSAGE, code: 'timeout', retryable: true },
        finishedAt,
      },
    );
  }
}

const FINAL_STATUS: Record<NodeRunResult['status'], AutomationStepStatus> = {
  succeeded: 'SUCCEEDED',
  dryRun: 'DRY_RUN',
  handledError: 'HANDLED_ERROR',
};

/** Writes the FAILED row (or moves the RUNNING one) and returns what to throw. */
export async function recordFailure(input: {
  env: EngineEnv;
  ref: StepRef;
  node: GraphNode;
  attempt: number;
  rowWritten: boolean;
  startedAt: Date;
  error: unknown;
  secrets: readonly string[];
  stepInput?: { value: unknown; truncated: boolean };
}): Promise<Error> {
  const { env, ref, node, attempt, rowWritten, startedAt, secrets } = input;
  const finishedAt = env.now();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const key = { runId: ref.runId, nodeKey: ref.nodeKey, attempt };

  if (env.signal().aborted) {
    // Cancelled with the run: the row says so, and the cancellation goes on up.
    if (rowWritten) {
      await env.store.moveStep(ref, key, ['RUNNING'], {
        status: 'CANCELLED',
        finishedAt,
        durationMs,
      });
    }
    return input.error instanceof Error ? input.error : new Error(String(input.error));
  }

  const failure = toStepFailure(input.error);
  const stepError = redact(failure.toStepError(), { connectionValues: secrets })
    .value as AutomationStepError;
  if (failure.code === 'unexpected') {
    env.log.warn('automation.step_unexpected_error', {
      runId: ref.runId,
      nodeKey: ref.nodeKey,
      details: stepError.details,
    });
  }

  const change = { status: 'FAILED' as const, error: stepError, finishedAt, durationMs };
  if (rowWritten) {
    await env.store.moveStep(ref, key, ['RUNNING'], change);
  } else {
    await env.store.writeStep(
      ref,
      stepRow(ref.runId, node, attempt, {
        ...change,
        startedAt,
        input: input.stepInput?.value ?? null,
        truncated: input.stepInput?.truncated ?? false,
      }),
    );
  }
  return toApplicationFailure(failure.kind, stepError);
}

export async function executeNode(env: EngineEnv, ref: StepRef): Promise<NodeRunResult> {
  const attempt = env.attempt();

  // Before the step is known there is no row to write: the failure goes
  // straight to the workflow.
  let loaded: LoadedRun;
  let node: GraphNode;
  try {
    loaded = await loadRunGraph(env.store, ref);
    if (!isOpenRun(loaded.run)) {
      throw permanent(RUN_FINISHED_MESSAGE, 'run_finished');
    }
    node = findNode(loaded.graph, ref.nodeKey);
  } catch (error) {
    const failure = toStepFailure(error);
    throw toApplicationFailure(failure.kind, failure.toStepError());
  }

  const { store } = env;
  const { run, graph, options, mode } = loaded;
  const startedAt = env.now();
  const key = { runId: ref.runId, nodeKey: ref.nodeKey, attempt };
  let secrets: string[] = [];
  let stepInput: { value: unknown; truncated: boolean } | undefined;
  let rowWritten = false;

  try {
    const definition = getDefinition(node.type, node.typeVersion);
    if (!definition) {
      throw permanent(STEP_TYPE_GONE_MESSAGE, 'unknown_step');
    }
    const executor = definition.blocking ? undefined : env.executors.get(node.type);
    if (!executor) {
      throw permanent(
        `${definition.title} cannot run yet in this version of PostGear.`,
        'not_runnable',
      );
    }

    // Idempotency: an effect that already happened is never repeated.
    if (definition.sideEffect !== 'none') {
      const done = await store.findSucceededStep(ref, ref.nodeKey);
      if (done) {
        return {
          status: done.status === 'DRY_RUN' ? 'dryRun' : 'succeeded',
          ports: ['out'],
          attempt: done.attempt,
        };
      }
    }

    const { rawConfig, priors, scope, timeZone, resolved } = await resolveStep(
      store,
      ref,
      loaded,
      node,
      definition,
    );

    const dryRun =
      mode === 'test' &&
      (definition.sideEffect === 'external' || definition.publishes === true) &&
      !options.sendForReal.includes(ref.nodeKey);

    let connection: StoredConnection | null = null;
    if (definition.connection) {
      const connectionId = connectionIdOf(node, definition.connection);
      if (connectionId) {
        connection = await store.loadConnection(ref.organizationId, connectionId);
      }
      secrets = connectionValues(connection?.credentials);
    }

    const safeInput = redact(resolved.value, {
      connectionValues: secrets,
      capBytes: LIMITS.stepIoCapBytes,
    });
    stepInput = { value: safeInput.value, truncated: safeInput.truncated };

    await failStaleAttempts(env, ref, attempt, startedAt);
    const created = await store.writeStep(
      ref,
      stepRow(ref.runId, node, attempt, {
        status: 'RUNNING',
        input: stepInput.value,
        truncated: stepInput.truncated,
        startedAt,
      }),
    );
    if (!created) {
      const existing = (await store.listSteps(ref, ref.nodeKey)).find(
        (row) => row.attempt === attempt,
      );
      if (existing?.status !== 'RUNNING') {
        throw permanent(RUN_FINISHED_MESSAGE, 'run_finished');
      }
    }
    rowWritten = true;

    // A dry run never uses the connection, so a missing one does not stop a test.
    if (definition.connection && !dryRun) {
      const problem = connectionProblem(node, definition.connection, connection);
      if (problem) throw problem;
    }

    const missing = missingRequired({ definition, config: rawConfig, resolved, graph });
    if (missing) throw missing;

    const result = await executor.run({
      run: {
        id: run.id,
        organizationId: run.organizationId,
        automationId: run.automationId,
        automationName: run.automationName,
        mode,
        startedAt: (run.startedAt ?? run.createdAt).toISOString(),
      },
      graph,
      node,
      definition,
      config: resolved.value as Record<string, unknown>,
      rawConfig,
      scope,
      priors,
      timeZone,
      dryRun,
      simulation: env.simulation,
      idempotencyKey: `${ref.runId}:${ref.nodeKey}`,
      connection,
      attempt,
      signal: env.signal(),
      heartbeat: env.heartbeat,
      deps: { store, now: env.now },
      log: env.log,
    });

    const status = result.status ?? 'succeeded';
    const safeOutput = redact(result.output ?? null, {
      connectionValues: secrets,
      capBytes: LIMITS.stepIoCapBytes,
    });
    const finishedAt = env.now();
    await store.moveStep(ref, key, ['RUNNING'], {
      status: FINAL_STATUS[status],
      output: safeOutput.value,
      truncated: stepInput.truncated || safeOutput.truncated,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    });

    return { status, ports: result.ports ?? ['out'], attempt };
  } catch (error) {
    throw await recordFailure({
      env,
      ref,
      node,
      attempt,
      rowWritten,
      startedAt,
      error,
      secrets,
      stepInput,
    });
  }
}
