/**
 * Small rules for one run's detail in the Runs tab (Module 08, blueprint
 * 7.3): the step list in run order, each step state as a sticker, and the
 * steps the view jumps to (the waiting review, the failed step). Pure, so
 * it is unit tested.
 */
import { topologicalOrder } from '@postgear/automation';
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
