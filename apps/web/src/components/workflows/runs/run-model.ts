/**
 * One run as the builder paints it (Module 08). A pure reducer: the run
 * detail from `GET /automation-runs/:runId`, then every `step` and `run`
 * event from the live stream, in any order and any number of times (a
 * reconnect replays the latest rows). The canvas, the run bar, the Runs tab
 * and the Output pane only read this model.
 *
 * Lines are derived, never streamed: a line is taken when its source fired
 * that port and its target started, skipped when its source finished
 * without firing it or its target was skipped, and active while its target
 * runs.
 */
import type { AutomationGraph } from '@postgear/automation';
import type {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStepStatus,
  RunDetail,
  RunEvent,
  RunStep,
} from '@/types/workflows';

export type StepPaintState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'dryRun'
  | 'handled'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface StepPaint {
  state: StepPaintState;
  attempt: number;
  attempts: number;
  durationMs: number | null;
  startedAt: string | null;
  dryRun: boolean;
  /** The error in one sentence. */
  error?: string;
  /** A Manual Review waiting for an answer. */
  waiting?: boolean;
}

export interface RunModel {
  runId: string;
  automationId: string;
  mode: AutomationRunMode;
  runStatus: AutomationRunStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** The graph the run executed (its version, or the test's draft snapshot). */
  graph: AutomationGraph | null;
  /** The latest attempt of each step, as the API sent it. */
  steps: Record<string, RunStep>;
  /** What each step's card shows. Steps not in it have not started. */
  paint: Record<string, StepPaint>;
  edgesTaken: ReadonlySet<string>;
  edgesSkipped: ReadonlySet<string>;
  /** Lines into a step that is running now (the flowing dashes). */
  edgesActive: ReadonlySet<string>;
}

/** A frame of `GET /automation-runs/:runId/events`, as `lib/sse.ts` delivers it. */
export type RunStreamEvent =
  | ({ type: 'step' } & RunStep)
  | ({ type: 'run' } & RunEvent)
  | { type: 'error'; message: string };

const TERMINAL: ReadonlySet<AutomationRunStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
]);

export function isTerminalRun(status: AutomationRunStatus): boolean {
  return TERMINAL.has(status);
}

const PAINT_STATE: Record<AutomationStepStatus, StepPaintState> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  SUCCEEDED: 'succeeded',
  DRY_RUN: 'dryRun',
  HANDLED_ERROR: 'handled',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

export function buildRunModel(detail: RunDetail): RunModel {
  const steps: Record<string, RunStep> = {};
  for (const step of detail.steps) steps[step.nodeKey] = step;
  return derive({
    runId: detail.id,
    automationId: detail.automationId,
    mode: detail.mode,
    runStatus: detail.status,
    error: detail.error,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    graph: detail.graph,
    steps,
  });
}

/**
 * Applies one stream event. An older row never replaces a newer one (a
 * replay after a reconnect), and a finished run never goes back to running.
 */
export function applyRunEvent(model: RunModel, event: RunStreamEvent): RunModel {
  if (event.type === 'error') return model;

  if (event.type === 'run') {
    if (event.id !== model.runId) return model;
    if (isTerminalRun(model.runStatus) && !isTerminalRun(event.status)) return model;
    return derive({
      ...model,
      runStatus: event.status,
      error: event.error,
      startedAt: event.startedAt,
      finishedAt: event.finishedAt,
    });
  }

  const { type: _type, ...step } = event;
  const current = model.steps[step.nodeKey];
  if (current && (isOlder(step, current) || isSameRow(step, current))) return model;
  return derive({ ...model, steps: { ...model.steps, [step.nodeKey]: step } });
}

function isOlder(next: RunStep, current: RunStep): boolean {
  if (next.attempt !== current.attempt) return next.attempt < current.attempt;
  return next.updatedAt < current.updatedAt;
}

/** A replay of the row the model already has: nothing to paint again. */
function isSameRow(next: RunStep, current: RunStep): boolean {
  return (
    next.attempt === current.attempt &&
    next.updatedAt === current.updatedAt &&
    next.status === current.status
  );
}

/** Statuses that hand data on: the line out of them can be taken. */
const HANDS_ON: ReadonlySet<AutomationStepStatus> = new Set([
  'SUCCEEDED',
  'DRY_RUN',
  'HANDLED_ERROR',
]);

/**
 * Whether a finished step fired `port`. Rows written before the API sent
 * `ports` (or a stream that leaves it out) have none: a line from a step
 * that handed data on is then taken when its target did more than skip.
 */
function fired(source: RunStep, port: string, target: RunStep | undefined): boolean {
  const ports = Array.isArray(source.ports) ? source.ports : [];
  if (ports.length > 0) return ports.includes(port);
  return (
    HANDS_ON.has(source.status) &&
    target !== undefined &&
    target.status !== 'SKIPPED' &&
    target.status !== 'CANCELLED'
  );
}

type ModelBase = Omit<RunModel, 'paint' | 'edgesTaken' | 'edgesSkipped' | 'edgesActive'>;

function derive(base: ModelBase): RunModel {
  const paint: Record<string, StepPaint> = {};
  for (const step of Object.values(base.steps)) paint[step.nodeKey] = toPaint(step);

  const edgesTaken = new Set<string>();
  const edgesSkipped = new Set<string>();
  const edgesActive = new Set<string>();
  for (const edge of base.graph?.edges ?? []) {
    const source = base.steps[edge.source];
    const target = base.steps[edge.target];
    const sourceDone = source !== undefined && isFinishedStep(source.status);
    const taken = sourceDone && fired(source, edge.sourcePort, target);

    if (target?.status === 'SKIPPED' || (sourceDone && !taken)) {
      edgesSkipped.add(edge.id);
    } else if (taken && target !== undefined) {
      edgesTaken.add(edge.id);
      if (target.status === 'RUNNING' || target.status === 'QUEUED') edgesActive.add(edge.id);
    }
  }

  return { ...base, paint, edgesTaken, edgesSkipped, edgesActive };
}

function isFinishedStep(status: AutomationStepStatus): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'DRY_RUN' ||
    status === 'HANDLED_ERROR' ||
    status === 'FAILED' ||
    status === 'SKIPPED'
  );
}

function toPaint(step: RunStep): StepPaint {
  const state = PAINT_STATE[step.status];
  return {
    state,
    attempt: step.attempt,
    attempts: step.attempts,
    durationMs: step.durationMs,
    startedAt: step.startedAt,
    dryRun: step.status === 'DRY_RUN',
    ...(step.error?.message ? { error: step.error.message } : {}),
    ...(state === 'waiting' ? { waiting: true } : {}),
  };
}
