/**
 * Small rules for one run's detail in the Runs tab (Module 08, blueprint
 * 7.3): the step list in run order, each step state as a sticker, and the
 * steps the view jumps to (the waiting review, the failed step). Pure, so
 * it is unit tested.
 */
import { type GraphNode, getDefinition, topologicalOrder } from '@postgear/automation';
import type { RunStep } from '@/types/workflows';
import { isReviewStep } from './review-words';
import type { BadgeVariant } from './run-list-model';
import type { RunModel, StepPaintState } from './run-model';

/** A handled error is amber, never green; Skipped and Cancelled are neutral. */
export const STEP_BADGE: Record<StepPaintState, BadgeVariant> = {
  queued: 'outline',
  running: 'primary',
  waiting: 'secondary',
  succeeded: 'success',
  dryRun: 'success',
  handled: 'accent',
  failed: 'danger',
  skipped: 'outline',
  cancelled: 'outline',
};

export const DRY_RUN_NOTE = 'Dry run: this is what would have been sent.';
export const CUT_NOTE = 'This data was cut to 64 KB.';

/**
 * The step rows in the order they ran: by start time, then (for steps that
 * never started, such as skipped ones) by their place in the graph.
 */
export function orderedSteps(model: Pick<RunModel, 'steps' | 'graph'>): RunStep[] {
  const place = new Map<string, number>();
  if (model.graph) {
    try {
      topologicalOrder(model.graph).forEach((key, index) => {
        place.set(key, index);
      });
    } catch {
      // A graph the planner cannot order still lists its steps by time.
    }
  }
  const rank = (step: RunStep) => place.get(step.nodeKey) ?? Number.MAX_SAFE_INTEGER;
  return Object.values(model.steps).sort((a, b) => {
    const aStart = a.startedAt ? new Date(a.startedAt).getTime() : null;
    const bStart = b.startedAt ? new Date(b.startedAt).getTime() : null;
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if (aStart !== null && bStart === null) return -1;
    if (aStart === null && bStart !== null) return 1;
    return rank(a) - rank(b);
  });
}

/** A positive whole number of credits a step's output reports, if any. */
function reportedCredits(output: unknown): number | null {
  if (typeof output !== 'object' || output === null) return null;
  const record = output as Record<string, unknown>;
  for (const key of ['credits', 'creditsUsed']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return null;
}

/**
 * The AI credits beside a step in a run (Module 11): "5 Credits" when the
 * step's output says what it was charged, else "About 5 Credits" from the
 * step's own estimate, for an AI step that finished in a run that used
 * credits at all. Step rows carry no credit column (the run's total is
 * `creditsUsed`), so a step that was pinned or refunded never claims more
 * than the run says. Nothing for steps that cost nothing.
 */
export function stepCreditsText(
  step: Pick<RunStep, 'status' | 'output' | 'nodeType'>,
  node: Pick<GraphNode, 'type' | 'typeVersion' | 'config'> | undefined,
  runCredits: number,
): string | null {
  if (!(runCredits > 0)) return null;
  if (step.status !== 'SUCCEEDED' && step.status !== 'HANDLED_ERROR') return null;
  const reported = reportedCredits(step.output);
  if (reported !== null) return reported === 1 ? '1 Credit' : `${reported} Credits`;
  const def = getDefinition(node?.type ?? step.nodeType, node?.typeVersion);
  if (step.status !== 'SUCCEEDED' || !def?.credits) return null;
  let estimate = 0;
  try {
    estimate = def.credits((node?.config ?? def.defaultConfig) as never);
  } catch {
    return null;
  }
  if (!(estimate > 0)) return null;
  const amount = Math.min(estimate, runCredits);
  return amount === 1 ? 'About 1 Credit' : `About ${amount} Credits`;
}

/** The Manual Review waiting for an answer, if any. */
export function waitingReviewKey(model: Pick<RunModel, 'steps' | 'graph'>): string | null {
  const step = orderedSteps(model).find(
    (candidate) => candidate.status === 'WAITING' && isReviewStep(candidate),
  );
  return step?.nodeKey ?? null;
}

/** The step a failed run stopped at. */
export function failedStepKey(model: Pick<RunModel, 'steps' | 'graph'>): string | null {
  return orderedSteps(model).find((step) => step.status === 'FAILED')?.nodeKey ?? null;
}
