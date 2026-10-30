/**
 * The activities behind `automationRunWorkflow` (Sprint 10, Module 07).
 *
 * The workflow is a deterministic interpreter that keeps only small state;
 * everything that reads or writes a row happens here. The contract is
 * `AutomationActivities` (automation/activity-contract.ts); the step engine
 * itself is automation/engine.ts, and every row goes through a `RunStore`
 * (the database in production, memory in tests).
 *
 * Every bookkeeping write is conditional on the status it expects, so an
 * activity that runs late (a retry after a lost reply, a cancelled run)
 * never overwrites a newer state.
 */
import {
  type GraphNode,
  getDefinition,
  isPortId,
  LIMITS,
  type PortId,
  redact,
  toEpoch,
  toText,
  upgradeGraph,
} from '@postgear/automation';
import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_NOTIFICATION_TYPES,
  type AutomationSkipReason,
  type AutomationStepError,
  scheduleTriggerEventId,
} from '@postgear/scheduling';
import { Context } from '@temporalio/activity';
import type {
  AutomationActivities,
  FinishRunInput,
  NodeRunResult,
  RunPlan,
  RunRef,
  SeededStep,
  SettleFailureInput,
  StartScheduledRunInput,
  StartScheduledRunResult,
  StepRef,
} from '../automation/activity-contract';
import {
  type EngineEnv,
  executeNode,
  findNode,
  isOpenRun,
  type LoadedRun,
  loadRunGraph,
  RUN_UNREADABLE_MESSAGE,
  recordFailure,
  resolveStep,
  STEP_TYPE_GONE_MESSAGE,
  stepRow,
} from '../automation/engine';
import { EXECUTORS } from '../automation/executors';
import { reviewLink } from '../automation/executors/in-app';
import type { ExecLog, ExecutorRegistry } from '../automation/executors/types';
import {
  codeOfType,
  permanent,
  StepFailure,
  TIMEOUT_MESSAGE,
  toApplicationFailure,
} from '../automation/failures';
import { finalizeRun, OUTCOME_STATUS } from '../automation/finish';
import { PrismaRunStore } from '../automation/prisma-run-store';
import type { RunStore, StepRecord } from '../automation/run-store';
import {
  missingRequired,
  readRunOptions,
  runMode,
  runTimeZone,
  triggerOf,
} from '../automation/scope';
import { deleteAutomationSchedule } from '../lib/automation-schedules';
import type { ActivityDeps } from './deps';

const DAY_MS = 24 * 60 * 60_000;
const UNIT_MS = { minutes: 60_000, hours: 60 * 60_000, days: DAY_MS } as const;

/** What tests swap: the store, the executors, the clock and the attempt number. */
export interface AutomationActivityOptions {
  store?: RunStore;
  executors?: ExecutorRegistry;
  now?: () => Date;
  attempt?: () => number;
}

function activityContext(): Context | null {
  try {
    return Context.current();
  } catch {
    // Called outside an activity (a unit test).
    return null;
  }
}

const NEVER_ABORTED = new AbortController().signal;

const log: ExecLog = {
  info: (message, meta) => {
    const context = activityContext();
    if (context) context.log.info(message, meta);
    else console.log(message, meta ?? {});
  },
  warn: (message, meta) => {
    const context = activityContext();
    if (context) context.log.warn(message, meta);
    else console.warn(message, meta ?? {});
  },
};

/** Final failures of bookkeeping (a run that is gone) reach the workflow typed, not retried. */
async function typed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StepFailure) {
      throw toApplicationFailure(error.kind, error.toStepError());
    }
    throw error;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function latestOf(rows: readonly StepRecord[]): StepRecord | undefined {
  return rows.reduce<StepRecord | undefined>(
    (latest, row) => (!latest || row.attempt > latest.attempt ? row : latest),
    undefined,
  );
}

function since(startedAt: Date | null, at: Date): number | null {
  return startedAt ? Math.max(0, at.getTime() - startedAt.getTime()) : null;
}

function preview(value: unknown, max = 120): string {
  const text = toText(value).trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** The step to run as a blocking step (Delay, Manual Review), or a permanent failure. */
function blockingStep(loaded: LoadedRun, nodeKey: string, kind: 'delay' | 'review') {
  const node = findNode(loaded.graph, nodeKey);
  const definition = getDefinition(node.type, node.typeVersion);
  if (!definition) {
    throw permanent(STEP_TYPE_GONE_MESSAGE, 'unknown_step');
  }
  if (definition.blocking !== kind) {
    throw permanent(`${node.name} is not a ${kind === 'delay' ? 'Delay' : 'Manual Review'} step.`);
  }
  return { node, definition };
}

/** When a Delay ends, in epoch milliseconds. */
function delayEnd(config: Record<string, unknown>, at: Date): number {
  if (config.mode === 'until') {
    const until = toEpoch(typeof config.until === 'string' ? config.until.trim() : config.until);
    if (until === undefined) {
      throw permanent(
        `This step could not read "${preview(config.until, 60)}" as a date and time.`,
        'bad_data',
        { field: 'until' },
      );
    }
    return until;
  }
  const unit = UNIT_MS[config.unit as keyof typeof UNIT_MS] ?? UNIT_MS.hours;
  const amount = typeof config.amount === 'number' ? config.amount : 1;
  return at.getTime() + amount * unit;
}

/**
 * Retry From Here (Module 08): the steps a retry starts with as finished.
 * `handled` when the row the API copied in is HANDLED_ERROR, so `planNext`
 * reads it the way the first run did.
 */
async function seededSteps(
  store: RunStore,
  ref: RunRef,
  ports: Record<string, string[]>,
  nodes: readonly GraphNode[],
): Promise<Record<string, SeededStep>> {
  const keys = new Set(nodes.map((node) => node.key));
  const rows = await store.listSteps(ref);
  const seeded: Record<string, SeededStep> = {};
  for (const [nodeKey, fired] of Object.entries(ports)) {
    if (!keys.has(nodeKey)) continue;
    const latest = latestOf(rows.filter((row) => row.nodeKey === nodeKey));
    seeded[nodeKey] = {
      status: latest?.status === 'HANDLED_ERROR' ? 'handled' : 'succeeded',
      ports: fired.filter(isPortId),
    };
  }
  return seeded;
}

export function createAutomationActivities(
  deps: ActivityDeps,
  options: AutomationActivityOptions = {},
) {
  const store = options.store ?? new PrismaRunStore();
  const now = options.now ?? (() => new Date());
  const env: EngineEnv = {
    store,
    executors: options.executors ?? EXECUTORS,
    simulation: deps.env.AUTOMATION_SIMULATION === 'true',
    now,
    attempt: options.attempt ?? (() => activityContext()?.info.attempt ?? 1),
    signal: () => activityContext()?.cancellationSignal ?? NEVER_ABORTED,
    heartbeat: () => activityContext()?.heartbeat(),
    log,
  };

  return {
    async startScheduledRun(input: StartScheduledRunInput): Promise<StartScheduledRunResult> {
      const automation = await store.loadAutomation(input.organizationId, input.automationId);
      if (
        !automation ||
        automation.deleted ||
        automation.status !== 'ACTIVE' ||
        automation.activeVersionId !== input.versionId
      ) {
        return { skip: true, reason: 'notActive' };
      }

      let graph: ReturnType<typeof upgradeGraph>;
      try {
        graph = upgradeGraph(
          await store.loadVersionGraph(input.organizationId, input.automationId, input.versionId),
        );
      } catch {
        return { skip: true, reason: 'notSchedule' };
      }
      if (triggerOf(graph)?.type !== 'trigger.schedule') {
        return { skip: true, reason: 'notSchedule' };
      }

      const row = await store.createLiveRun({
        organizationId: input.organizationId,
        automationId: input.automationId,
        versionId: input.versionId,
        triggerType: 'trigger.schedule',
        triggerEventId: scheduleTriggerEventId(input.automationId, input.scheduledAt),
        // The Schedule trigger's output shape: `scheduledFor`, `timeZone`.
        triggerPayload: { scheduledFor: input.scheduledAt, timeZone: runTimeZone(graph) },
        temporalWorkflowId: input.workflowId,
      });
      // Another workflow already runs this scheduled time: never run it twice.
      if (row.temporalWorkflowId && row.temporalWorkflowId !== input.workflowId) {
        return { skip: true, reason: 'otherWorkflow' };
      }
      return { runId: row.id };
    },

    async loadRunPlan(input: RunRef): Promise<RunPlan> {
      let run = await store.loadRun(input);
      if (!run) return { skip: true, reason: 'gone' };
      if (!isOpenRun(run)) return { skip: true, reason: 'finished' };

      let graph: ReturnType<typeof upgradeGraph>;
      try {
        graph = upgradeGraph(run.graph);
      } catch {
        await finalizeRun(store, input, {
          status: 'FAILED',
          error: RUN_UNREADABLE_MESSAGE,
          stepCount: 0,
          finishedAt: now(),
        });
        return { skip: true, reason: 'finished' };
      }

      if (run.status === 'QUEUED') {
        const started = await store.updateRun(input, ['QUEUED'], {
          status: 'RUNNING',
          startedAt: now(),
        });
        if (!started) {
          // Cancelled or started by someone else meanwhile: read it again.
          run = await store.loadRun(input);
          if (!run) return { skip: true, reason: 'gone' };
          if (!isOpenRun(run)) return { skip: true, reason: 'finished' };
        }
      }

      const runOptions = readRunOptions(run.options);
      const seeded = runOptions.retry
        ? await seededSteps(store, input, runOptions.retry.ports, graph.nodes)
        : undefined;
      return {
        skip: false,
        graph,
        mode: runMode(run),
        scope: runOptions.scope,
        // Only test runs hold anything back; a live run sends everything.
        sendForReal: runOptions.sendForReal,
        ...(seeded ? { seeded } : {}),
      };
    },

    async claimRunSlot(input: RunRef): Promise<boolean> {
      const run = await store.loadRun(input);
      if (run?.mode !== 'LIVE') return true;
      const ahead = await store.countLiveRunsAhead({
        id: run.id,
        organizationId: run.organizationId,
        startedAt: run.startedAt ?? run.createdAt,
      });
      return ahead < LIMITS.maxConcurrentRunsPerWorkspace;
    },

    async recordSkipped(
      input: RunRef & { steps: { nodeKey: string; reason: AutomationSkipReason }[] },
    ): Promise<void> {
      if (input.steps.length === 0) return;
      const run = await store.loadRun(input);
      if (!run || !isOpenRun(run)) return;
      let nodes: GraphNode[] = [];
      try {
        nodes = upgradeGraph(run.graph).nodes;
      } catch {
        // Names fall back to the key; the rows are still written.
      }
      const at = now();
      for (const step of input.steps) {
        const node = nodes.find((candidate) => candidate.key === step.nodeKey);
        await store.writeStep(input, {
          runId: input.runId,
          nodeKey: step.nodeKey,
          nodeType: node?.type ?? 'unknown',
          nodeName: node?.name ?? step.nodeKey,
          status: 'SKIPPED',
          attempt: 1,
          input: null,
          output: { skipped: step.reason },
          truncated: false,
          error: null,
          startedAt: null,
          finishedAt: at,
          durationMs: null,
          ports: [],
        });
      }
    },

    async executeNodeActivity(input: StepRef): Promise<NodeRunResult> {
      return executeNode(env, input);
    },

    async settleStepFailure(input: SettleFailureInput): Promise<{ attempts: number }> {
      const at = now();
      let rows = await store.listSteps(input, input.nodeKey);
      let latest = latestOf(rows);

      // The last attempt timed out or crashed before it could write its result.
      if (!latest || latest.status === 'RUNNING') {
        const error: AutomationStepError = {
          message: input.timedOut ? TIMEOUT_MESSAGE : input.message,
          code: codeOfType(input.failureType, input.timedOut),
          retryable: input.timedOut || input.failureType === AUTOMATION_FAILURE_TYPES.retryable,
        };
        if (latest) {
          await store.moveStep(
            input,
            { runId: input.runId, nodeKey: input.nodeKey, attempt: latest.attempt },
            ['RUNNING'],
            { status: 'FAILED', error, finishedAt: at, durationMs: since(latest.startedAt, at) },
          );
        } else {
          const run = await store.loadRun(input);
          let node: GraphNode | undefined;
          try {
            node = run
              ? upgradeGraph(run.graph).nodes.find((n) => n.key === input.nodeKey)
              : undefined;
          } catch {
            node = undefined;
          }
          await store.writeStep(input, {
            runId: input.runId,
            nodeKey: input.nodeKey,
            nodeType: node?.type ?? 'unknown',
            nodeName: node?.name ?? input.nodeKey,
            status: 'FAILED',
            attempt: 1,
            input: null,
            output: null,
            truncated: false,
            error,
            startedAt: null,
            finishedAt: at,
            durationMs: null,
            ports: [],
          });
        }
        rows = await store.listSteps(input, input.nodeKey);
        latest = latestOf(rows);
      }

      if (input.mode !== 'stop' && latest?.status === 'FAILED') {
        const message = latest.error?.message ?? input.message;
        const code = latest.error?.code ?? codeOfType(input.failureType, input.timedOut);
        await store.moveStep(
          input,
          { runId: input.runId, nodeKey: input.nodeKey, attempt: latest.attempt },
          ['FAILED'],
          {
            status: 'HANDLED_ERROR',
            output: { error: { message, code } },
            ports: [input.mode === 'branch' ? 'error' : 'out'],
          },
        );
      }

      return { attempts: Math.max(1, ...rows.map((row) => row.attempt)) };
    },

    async prepareDelay(input: StepRef): Promise<{ waitMs: number }> {
      return typed(async () => {
        const loaded = await loadRunGraph(store, input);
        const { node, definition } = blockingStep(loaded, input.nodeKey, 'delay');
        const attempt = env.attempt();
        const at = now();

        // A retry after the row was written keeps the first deadline.
        const rows = await store.listSteps(input, input.nodeKey);
        const waiting = rows.find((row) => row.status === 'WAITING');
        if (waiting) {
          const until = toEpoch(record(waiting.output).waitedUntil);
          return { waitMs: until === undefined ? 0 : Math.max(0, until - at.getTime()) };
        }
        if (rows.some((row) => row.status === 'SUCCEEDED')) return { waitMs: 0 };

        let stepInput: { value: unknown; truncated: boolean } | undefined;
        try {
          const { rawConfig, resolved } = await resolveStep(store, input, loaded, node, definition);
          const safe = redact(resolved.value, { capBytes: LIMITS.stepIoCapBytes });
          stepInput = { value: safe.value, truncated: safe.truncated };
          const missing = missingRequired({
            definition,
            config: rawConfig,
            resolved,
            graph: loaded.graph,
          });
          if (missing) throw missing;

          const end = delayEnd(resolved.value as Record<string, unknown>, at);
          const started = loaded.run.startedAt ?? loaded.run.createdAt;
          const left = LIMITS.runTimeoutDays * DAY_MS - (at.getTime() - started.getTime());
          const waitMs = Math.max(0, Math.min(end - at.getTime(), left));
          const until = new Date(at.getTime() + waitMs).toISOString();

          if (loaded.options.scope.kind === 'step') {
            await store.writeStep(
              input,
              stepRow(input.runId, node, attempt, {
                status: 'SUCCEEDED',
                input: stepInput.value,
                truncated: stepInput.truncated,
                output: { waitMs, until },
                startedAt: at,
                finishedAt: at,
                durationMs: 0,
                ports: ['out'],
              }),
            );
            return { waitMs: 0 };
          }

          await store.writeStep(
            input,
            stepRow(input.runId, node, attempt, {
              status: 'WAITING',
              input: stepInput.value,
              truncated: stepInput.truncated,
              output: { waitedUntil: until },
              startedAt: at,
            }),
          );
          return { waitMs };
        } catch (error) {
          throw await recordFailure({
            env,
            ref: input,
            node,
            attempt,
            rowWritten: false,
            startedAt: at,
            error,
            secrets: [],
            stepInput,
          });
        }
      });
    },

    async openReview(input: StepRef): Promise<{ waiting: boolean }> {
      return typed(async () => {
        const loaded = await loadRunGraph(store, input);
        const { node, definition } = blockingStep(loaded, input.nodeKey, 'review');
        const { run, mode } = loaded;
        const attempt = env.attempt();
        const at = now();

        // A retry after the row was written must not notify twice.
        const rows = await store.listSteps(input, input.nodeKey);
        if (rows.some((row) => row.status === 'WAITING')) return { waiting: true };

        let stepInput: { value: unknown; truncated: boolean } | undefined;
        try {
          const { rawConfig, resolved } = await resolveStep(store, input, loaded, node, definition);
          const safe = redact(resolved.value, { capBytes: LIMITS.stepIoCapBytes });
          stepInput = { value: safe.value, truncated: safe.truncated };
          const missing = missingRequired({
            definition,
            config: rawConfig,
            resolved,
            graph: loaded.graph,
          });
          if (missing) throw missing;

          if (loaded.options.scope.kind === 'step') {
            const text = preview(record(stepInput.value).text);
            await store.writeStep(
              input,
              stepRow(input.runId, node, attempt, {
                status: 'DRY_RUN',
                input: stepInput.value,
                truncated: stepInput.truncated,
                output: {
                  dryRun: true,
                  wouldSend: text
                    ? `A review request to everyone in the workspace: "${text}"`
                    : 'A review request to everyone in the workspace.',
                },
                startedAt: at,
                finishedAt: at,
                durationMs: 0,
                ports: ['approved'],
              }),
            );
            return { waiting: false };
          }

          const { value, truncated } = stepInput;
          await store.transaction(async (tx) => {
            const created = await tx.writeStep(
              input,
              stepRow(input.runId, node, attempt, {
                status: 'WAITING',
                input: value,
                truncated,
                startedAt: at,
              }),
            );
            if (!created) return;
            await tx.updateRun(input, ['RUNNING'], { status: 'WAITING' });
            await tx.createNotification({
              organizationId: run.organizationId,
              type: AUTOMATION_NOTIFICATION_TYPES.review,
              title: mode === 'test' ? 'Review needed (Test)' : 'Review needed',
              content: `Your ${run.automationName} is ready for review.`,
              link: reviewLink(run.organizationId, run.automationId, run.id),
              meta: {
                automationId: run.automationId,
                automationName: run.automationName,
                runId: run.id,
                nodeKey: node.key,
                mode,
              },
            });
          });
          return { waiting: true };
        } catch (error) {
          throw await recordFailure({
            env,
            ref: input,
            node,
            attempt,
            rowWritten: false,
            startedAt: at,
            error,
            secrets: [],
            stepInput,
          });
        }
      });
    },

    async closeReview(
      input: StepRef & { decision: 'approved' | 'rejected' },
    ): Promise<{ ports: PortId[] }> {
      const ports: PortId[] = [input.decision === 'rejected' ? 'rejected' : 'approved'];
      const at = now();
      const rows = await store.listSteps(input, input.nodeKey);
      const waiting = latestOf(rows.filter((row) => row.status === 'WAITING'));
      if (!waiting) return { ports };

      // The API wrote the decision (who, when, an edited text) before it
      // signalled; the step's output adds what later steps read.
      const answered = record(waiting.output);
      const asked = record(waiting.input);
      const editedText =
        typeof answered.editedText === 'string' && answered.editedText.trim()
          ? answered.editedText
          : undefined;
      const output = {
        ...answered,
        decision:
          answered.decision === 'approved' || answered.decision === 'rejected'
            ? answered.decision
            : input.decision,
        text: answered.text ?? editedText ?? asked.text ?? '',
        image: answered.image ?? asked.image ?? '',
      };

      await store.transaction(async (tx) => {
        await tx.moveStep(
          input,
          { runId: input.runId, nodeKey: input.nodeKey, attempt: waiting.attempt },
          ['WAITING'],
          {
            status: 'SUCCEEDED',
            output,
            finishedAt: at,
            durationMs: since(waiting.startedAt, at),
            ports: [...ports],
          },
        );
        // The run waits on as long as another Manual Review is still open.
        const open = (await tx.listSteps(input)).some(
          (row) => row.status === 'WAITING' && row.nodeType === 'logic.manualReview',
        );
        if (!open) await tx.updateRun(input, ['WAITING'], { status: 'RUNNING' });
      });
      return { ports };
    },

    async completeStep(input: StepRef): Promise<void> {
      const at = now();
      const rows = await store.listSteps(input, input.nodeKey);
      const waiting = latestOf(rows.filter((row) => row.status === 'WAITING'));
      if (!waiting) return;
      await store.moveStep(
        input,
        { runId: input.runId, nodeKey: input.nodeKey, attempt: waiting.attempt },
        ['WAITING'],
        {
          status: 'SUCCEEDED',
          finishedAt: at,
          durationMs: since(waiting.startedAt, at),
          ports: ['out'],
        },
      );
    },

    async finishRun(input: FinishRunInput): Promise<void> {
      const result = await finalizeRun(store, input, {
        status: OUTCOME_STATUS[input.outcome],
        stepCount: input.stepCount,
        finishedAt: now(),
        ...(input.error ? { error: input.error } : {}),
      });
      // Auto-paused (Module 09): no more scheduled runs. Best effort: the
      // maintenance reconcile deletes a schedule whose workflow is not active.
      if (result.finished && result.paused) {
        try {
          await deleteAutomationSchedule(await deps.temporalClient(), result.automationId);
        } catch (error) {
          log.warn('automation.schedule_delete_failed', {
            automationId: result.automationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  } satisfies AutomationActivities;
}

export type AutomationActivityFunctions = ReturnType<typeof createAutomationActivities>;
