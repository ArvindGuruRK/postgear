/**
 * The data a step reads during a run, and the checks made on it before the
 * step acts. Pure: the activities pass rows in.
 *
 * A step's tokens read one `RunScope` (Module 02):
 *
 * - `trigger`: the run's trigger data (a step test: the seeded trigger output);
 * - `nodes.<key>.output`: each earlier step's latest output (SUCCEEDED,
 *   DRY_RUN or HANDLED_ERROR), or the seeded outputs of a step test; a
 *   Retry From Here run reads its seeded steps from `seedOutputs` too;
 * - `run`: `{ id, startedAt, mode }`; `workspace`: `{ name }`.
 */
import {
  type AutomationGraph,
  fallbackLabel,
  type GraphNode,
  humanise,
  isEmptyValue,
  isTriggerType,
  isValidTimeZone,
  type NodeDefinition,
  type ResolvedConfig,
  type RunScope,
  tokenLabeler,
  tokenSource,
  tokensIn,
} from '@postgear/automation';
import type {
  AutomationRetryOptions,
  AutomationRunOptions,
  AutomationRunScope,
} from '@postgear/scheduling';
import { permanent, type StepFailure } from './failures';
import type { PriorOutput, RunRecord } from './run-store';

const TRIGGER_DATA = ['last', 'sample', 'pinned'] as const;

/** Retry From Here (Module 08), read leniently: anything malformed means no retry. */
function readRetry(raw: unknown): AutomationRetryOptions | undefined {
  const record = asRecord(raw);
  if (!record || typeof record.of !== 'string' || typeof record.fromNodeKey !== 'string') {
    return undefined;
  }
  const ports: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(asRecord(record.ports) ?? {})) {
    if (key === record.fromNodeKey || !Array.isArray(value)) continue;
    ports[key] = value.filter((port): port is string => typeof port === 'string');
  }
  return { of: record.of, fromNodeKey: record.fromNodeKey, ports };
}

/** `AutomationRun.options` read leniently: a live run has none. */
export function readRunOptions(raw: unknown): AutomationRunOptions {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawScope = record.scope as { kind?: unknown; nodeKey?: unknown } | undefined;
  const scope: AutomationRunScope =
    rawScope?.kind === 'step' && typeof rawScope.nodeKey === 'string'
      ? { kind: 'step', nodeKey: rawScope.nodeKey }
      : { kind: 'run' };
  const sendForReal = Array.isArray(record.sendForReal)
    ? record.sendForReal.filter((key): key is string => typeof key === 'string')
    : [];
  const triggerData = TRIGGER_DATA.find((value) => value === record.triggerData) ?? 'sample';
  // A retry runs the whole workflow from one step; a step test has no use for it.
  const retry = scope.kind === 'run' ? readRetry(record.retry) : undefined;
  return { scope, sendForReal, triggerData, ...(retry ? { retry } : {}) };
}

export function runMode(run: Pick<RunRecord, 'mode'>): 'test' | 'live' {
  return run.mode === 'LIVE' ? 'live' : 'test';
}

export function triggerOf(graph: AutomationGraph): GraphNode | undefined {
  return graph.nodes.find((node) => isTriggerType(node.type));
}

/**
 * The zone dates are read and written in: the Schedule trigger's own zone
 * when the workflow has one (README decision log, Module 02), else UTC.
 */
export function runTimeZone(graph: AutomationGraph): string {
  const trigger = triggerOf(graph);
  const zone = trigger?.type === 'trigger.schedule' ? trigger.config.timeZone : undefined;
  return typeof zone === 'string' && isValidTimeZone(zone) ? zone : 'UTC';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Earlier steps' outputs: from the database for a whole run, from the
 * seeded outputs (pinned data, the last test, or samples) for a step test.
 *
 * A Retry From Here run (Module 08) reads both: its seeded steps' outputs
 * come from `seedOutputs` (the API also copies their rows into the run,
 * whose status says whether the step handled an error), and every step it
 * runs again comes from its own rows.
 */
export function priorOutputs(
  run: Pick<RunRecord, 'seedOutputs'>,
  options: AutomationRunOptions,
  stored: Record<string, PriorOutput>,
): Record<string, PriorOutput> {
  const seeds = asRecord(run.seedOutputs) ?? {};
  if (options.scope.kind === 'step') {
    return Object.fromEntries(
      Object.entries(seeds).map(([key, output]) => [key, { output, status: 'SUCCEEDED' as const }]),
    );
  }
  if (!options.retry) {
    return stored;
  }
  const merged: Record<string, PriorOutput> = { ...stored };
  for (const [key, output] of Object.entries(seeds)) {
    if (key === options.retry.fromNodeKey) continue;
    merged[key] = { output, status: stored[key]?.status ?? 'SUCCEEDED' };
  }
  return merged;
}

/** The trigger's data: the run's payload, or a step test's seeded trigger output. */
export function triggerData(
  run: Pick<RunRecord, 'triggerPayload' | 'seedOutputs'>,
  graph: AutomationGraph,
  options: AutomationRunOptions,
): unknown {
  if (options.scope.kind === 'step') {
    const trigger = triggerOf(graph);
    const seeds = asRecord(run.seedOutputs);
    if (trigger && seeds && Object.hasOwn(seeds, trigger.key)) {
      return seeds[trigger.key];
    }
  }
  return run.triggerPayload ?? {};
}

export function buildScope(input: {
  run: Pick<
    RunRecord,
    'id' | 'triggerPayload' | 'seedOutputs' | 'startedAt' | 'createdAt' | 'workspaceName' | 'mode'
  >;
  graph: AutomationGraph;
  options: AutomationRunOptions;
  priors: Record<string, PriorOutput>;
}): RunScope {
  const { run, graph, options, priors } = input;
  return {
    trigger: triggerData(run, graph, options),
    nodes: Object.fromEntries(
      Object.entries(priors).map(([key, prior]) => [key, { output: prior.output }]),
    ),
    run: {
      id: run.id,
      startedAt: (run.startedAt ?? run.createdAt).toISOString(),
      mode: runMode(run),
    },
    workspace: { name: run.workspaceName },
  };
}

/** The value at a dotted path (`fields.0.value`), or undefined. */
export function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else {
      const record = asRecord(current);
      if (!record || !Object.hasOwn(record, part)) return undefined;
      current = record[part];
    }
  }
  return current;
}

function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  const record = asRecord(value);
  return record ? Object.values(record).flatMap(textsIn) : [];
}

/** "Title" for `title`, "Value" for `fields.0.value`. */
function fieldLabel(path: string): string {
  const parts = path.split('.').filter((part) => !/^\d+$/.test(part));
  return humanise(parts[parts.length - 1] ?? path);
}

/** Who a token reads from, in words: the step's name, "the run", "the workspace". */
function sourceName(path: string, graph: AutomationGraph): string {
  const source = tokenSource(path);
  if (source.root === 'trigger') return triggerOf(graph)?.name ?? 'the trigger';
  if (source.root === 'nodes') {
    return graph.nodes.find((node) => node.key === source.nodeKey)?.name ?? 'an earlier step';
  }
  if (source.root === 'run') return 'the run';
  if (source.root === 'workspace') return 'the workspace';
  return 'an earlier step';
}

/**
 * The first required field that came out empty, as a permanent
 * `missing_data` failure with Module 02's sentence:
 * "'Title' was empty because Get Post had no 'Post Link'."
 * A field that holds no data at all (left blank) gets the definition's own
 * sentence ("Write a title for the notification.").
 */
export function missingRequired(input: {
  definition: Pick<NodeDefinition, 'required'>;
  /** The step's config as saved (tokens unresolved), parsed by its schema. */
  config: Record<string, unknown>;
  resolved: ResolvedConfig;
  graph: AutomationGraph;
}): StepFailure | null {
  const { definition, config, resolved, graph } = input;
  for (const required of definition.required ?? []) {
    if (required.when && !required.when(config)) continue;
    if (!isEmptyValue(valueAt(resolved.value, required.path))) continue;

    const inField = (field: string) =>
      field === required.path || field.startsWith(`${required.path}.`);
    const missing = resolved.missing.find((entry) => inField(entry.field))?.path;
    const token =
      missing ?? textsIn(valueAt(config, required.path)).flatMap(tokensIn)[0]?.path ?? undefined;

    if (!token) {
      return permanent(required.message, 'missing_data', { field: required.path });
    }

    const label = tokenLabeler(graph)(token) ?? fallbackLabel(token);
    return permanent(
      `'${fieldLabel(required.path)}' was empty because ${sourceName(token, graph)} had no '${label}'.`,
      'missing_data',
      { field: required.path, token },
    );
  }
  return null;
}
