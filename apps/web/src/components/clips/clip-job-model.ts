/**
 * How one clip job's view is kept current from its stream and its polls
 * (Module 02). Pure, so the rules are tested without a browser:
 *
 * - A finished job (done, failed, cancelled) is never taken back to running
 *   by a late or replayed event.
 * - Within one step, progress never goes backwards on screen.
 * - A view of another job is ignored.
 */
import type { ClipJobStatus, ClipJobView } from '@/types/clips';

const TERMINAL: ReadonlySet<ClipJobStatus> = new Set<ClipJobStatus>([
  'DONE',
  'FAILED',
  'CANCELLED',
]);

export function isTerminalJob(status: ClipJobStatus): boolean {
  return TERMINAL.has(status);
}

/** The view to show after `next` arrived, given what is shown now. */
export function mergeJobView(current: ClipJobView | null, next: ClipJobView): ClipJobView {
  if (!current) return next;
  if (current.id !== next.id) return current;
  if (isTerminalJob(current.status)) {
    // The first final answer stands; only a fuller copy of the same end replaces it.
    return isTerminalJob(next.status) && next.status === current.status ? next : current;
  }
  if (
    !isTerminalJob(next.status) &&
    next.stage === current.stage &&
    next.progress < current.progress
  ) {
    return { ...next, progress: current.progress };
  }
  return next;
}

/** Whole minutes left, rounded up, or null under 30 seconds or when unknown ("about 4 minutes left"). */
export function minutesLeft(etaSeconds: number | null): number | null {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 30) return null;
  return Math.max(1, Math.ceil(etaSeconds / 60));
}
