/**
 * `planNext`: given what has happened so far in a run, what happens next.
 *
 * The run workflow (Module 07) calls it in a loop: start the `ready` steps,
 * record the `skipped` and `bypassed` ones, feed the results back in, and
 * stop when `finished`. It is pure and deterministic, so it can run inside
 * Temporal's workflow sandbox and replay the same way every time.
 *
 * ## How a step's fate is decided
 *
 * Each line into a step is, at any moment, one of:
 *
 * - **live**: its source finished and left through this line's port;
 * - **dead**: its source finished through another port (If / Else took the
 *   other side, a Filter did not pass), or the source was skipped because
 *   its own branch was not taken;
 * - **blocked**: its source failed (On Error stop), or was skipped because
 *   something before it failed;
 * - **pending**: its source has not finished yet.
 *
 * A step whose lines include a blocked one is skipped (a failure stops
 * everything that depends on it, Merges included). Otherwise it waits while
 * any line is pending, runs once at least one is live, and is skipped when
 * all are dead. Merge needs no special case: it waits for every branch that
 * will run, and runs with the ones that did. Skipping is worked out from
 * the graph and the finished steps on every call, so the state only has to
 * carry what actually ran.
 */
import type { PortId } from '../graph/schema';
import { edgesFrom, type GraphIndex, type GraphInput, toIndex } from './build-index';

/**
 * What the run workflow knows about one step.
 *
 * - `running`: started and not done (Delay and Manual Review waits too).
 * - `succeeded`: done; `ports` says which output it left through. Omitted
 *   ports mean `['out']`; a Filter that did not pass reports `[]`.
 * - `handled`: failed, but On Error is `continue` (`ports: ['out']`) or
 *   `branch` (`ports: ['error']`).
 * - `failed`: failed with On Error `stop`; its branch ends.
 * - `skipped`: recorded as skipped (from an earlier `planNext` answer).
 * - `off`: turned off and passed through (from `bypassed`).
 */
export type PlanStepStatus = 'running' | 'succeeded' | 'handled' | 'failed' | 'skipped' | 'off';

export interface PlanStepState {
  status: PlanStepStatus;
  ports?: readonly PortId[];
}

/** Step key to what is known about it. Steps not in it have not started. */
export type RunPlanState = Readonly<Record<string, PlanStepState>>;

export type SkipReason = 'branchNotTaken' | 'upstreamFailed';

export interface SkippedStep {
  key: string;
  /** `branchNotTaken`: the other side ran. `upstreamFailed`: a step before it failed. */
  reason: SkipReason;
}

/** How a finished run ends. Cancel and Review Expired are the workflow's own. */
export type PlanOutcome = 'succeeded' | 'failed' | 'rejected';

export interface PlanResult {
  /** Start these now, in run order. */
  ready: string[];
  /** Record these as skipped; they will never run. */
  skipped: SkippedStep[];
  /** Turned-off steps whose turn came: record them as off; they pass their input through `out`. */
  bypassed: string[];
  /** Nothing is running and nothing more can start. */
  finished: boolean;
  /**
   * Set when `finished`. `failed` when any step failed (On Error stop);
   * otherwise `rejected` when a Manual Review was rejected with nothing
   * connected to Rejected; otherwise `succeeded`. A Filter that stops a
   * branch, or a handled error, is not a failure.
   */
  outcome?: PlanOutcome;
}

type Resolution =
  | { kind: 'pending' }
  | { kind: 'ran'; ports: readonly PortId[] }
  | { kind: 'failed' }
  | { kind: 'skipped'; reason: SkipReason };

type LineState = 'live' | 'dead' | 'blocked' | 'pending';

const PENDING: Resolution = { kind: 'pending' };

function lineState(source: Resolution | undefined, port: PortId): LineState {
  if (!source || source.kind === 'pending') return 'pending';
  if (source.kind === 'failed') return 'blocked';
  if (source.kind === 'skipped') return source.reason === 'upstreamFailed' ? 'blocked' : 'dead';
  return source.ports.includes(port) ? 'live' : 'dead';
}

function fromRecorded(state: PlanStepState, computed: Resolution): Resolution {
  switch (state.status) {
    case 'running':
      return PENDING;
    case 'failed':
      return { kind: 'failed' };
    case 'skipped':
      return computed.kind === 'skipped' ? computed : { kind: 'skipped', reason: 'branchNotTaken' };
    default:
      // succeeded, handled and off all continue through their ports.
      return { kind: 'ran', ports: state.ports ?? ['out'] };
  }
}

export function planNext(input: GraphInput, state: RunPlanState): PlanResult {
  const index = toIndex(input);
  const trigger = index.triggers.find((node) => index.order.includes(node.key));
  const resolved = new Map<string, Resolution>();
  const ready: string[] = [];
  const skipped: SkippedStep[] = [];
  const bypassed: string[] = [];

  for (const key of index.order) {
    const node = index.nodes.get(key);
    if (!node) continue;

    let computed: Resolution | 'ready';
    if (key === trigger?.key) {
      computed = 'ready';
    } else {
      const lines = (index.incoming.get(key) ?? []).map((edge) =>
        lineState(resolved.get(edge.source), edge.sourcePort),
      );
      if (lines.includes('blocked')) computed = { kind: 'skipped', reason: 'upstreamFailed' };
      else if (lines.includes('pending')) computed = PENDING;
      else if (lines.includes('live')) computed = 'ready';
      else computed = { kind: 'skipped', reason: 'branchNotTaken' };
    }

    const recorded = state[key];
    if (recorded) {
      resolved.set(key, fromRecorded(recorded, computed === 'ready' ? PENDING : computed));
      continue;
    }

    if (computed === 'ready') {
      if (node.disabled && key !== trigger?.key) {
        bypassed.push(key);
        resolved.set(key, { kind: 'ran', ports: ['out'] });
      } else {
        ready.push(key);
        resolved.set(key, PENDING);
      }
    } else {
      if (computed.kind === 'skipped') skipped.push({ key, reason: computed.reason });
      resolved.set(key, computed);
    }
  }

  // Steps in a loop can never start; `validateGraph` refuses such graphs,
  // but the planner must still end.
  for (const key of index.cyclic) {
    if (!state[key]) skipped.push({ key, reason: 'branchNotTaken' });
  }

  const running = [...index.nodes.keys()].some((key) => state[key]?.status === 'running');
  const finished = ready.length === 0 && !running;
  if (!finished) return { ready, skipped, bypassed, finished };

  return { ready, skipped, bypassed, finished, outcome: outcomeOf(index, resolved, state) };
}

function outcomeOf(
  index: GraphIndex,
  resolved: ReadonlyMap<string, Resolution>,
  state: RunPlanState,
): PlanOutcome {
  if ([...index.nodes.keys()].some((key) => state[key]?.status === 'failed')) return 'failed';
  for (const [key, resolution] of resolved) {
    if (
      resolution.kind === 'ran' &&
      resolution.ports.includes('rejected') &&
      edgesFrom(index, key, 'rejected').length === 0
    ) {
      return 'rejected';
    }
  }
  return 'succeeded';
}
