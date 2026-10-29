/**
 * Ending a run: the final status, the error sentence, open step rows
 * cancelled, and the workflow's "last run" columns. Shared by `finishRun`
 * and the maintenance reconcile (a run whose Temporal workflow vanished).
 *
 * One transaction, and only while the run is still QUEUED, RUNNING or
 * WAITING, so finishing twice (an activity retry, the reconcile racing the
 * workflow) changes nothing the second time and never counts a failure
 * twice.
 */
import { LIMITS } from '@postgear/automation';
import type { AutomationRunStatus } from '@postgear/db';
import type { AutomationRunOutcome } from '@postgear/scheduling';
import type { RunRef } from './activity-contract';
import { isOpenRun, OPEN_RUN_STATUSES } from './engine';
import type { AutomationRunSummary, RunStore, StepRecord } from './run-store';

export const OUTCOME_STATUS: Record<AutomationRunOutcome, AutomationRunStatus> = {
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};

export const INTERRUPTED_MESSAGE = 'This run was interrupted.';
export const EXPIRED_MESSAGE = `No one answered the review within ${LIMITS.reviewTimeoutDays} days.`;

/** The sentence of the first step that ended FAILED (its latest attempt), by finish time. */
export function firstFailure(steps: readonly StepRecord[]): string | null {
  const latest = new Map<string, StepRecord>();
  for (const step of steps) {
    const seen = latest.get(step.nodeKey);
    if (!seen || step.attempt > seen.attempt) latest.set(step.nodeKey, step);
  }
  const failed = [...latest.values()]
    .filter((step) => step.status === 'FAILED' && step.error?.message)
    .sort(
      (a, b) =>
        (a.finishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.finishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    );
  return failed[0]?.error?.message ?? null;
}

export async function finalizeRun(
  store: RunStore,
  ref: RunRef,
  input: { status: AutomationRunStatus; error?: string; stepCount?: number; finishedAt: Date },
): Promise<boolean> {
  return store.transaction(async (tx) => {
    const run = await tx.loadRun(ref);
    if (!run || !isOpenRun(run)) {
      return false;
    }

    let error: string | null = input.error ?? null;
    if (error === null && input.status === 'FAILED') {
      error = firstFailure(await tx.listSteps(ref));
    }
    if (error === null && input.status === 'EXPIRED') {
      error = EXPIRED_MESSAGE;
    }

    const moved = await tx.updateRun(ref, OPEN_RUN_STATUSES, {
      status: input.status,
      finishedAt: input.finishedAt,
      error,
      ...(input.stepCount === undefined ? {} : { stepCount: input.stepCount }),
    });
    if (!moved) {
      return false;
    }

    await tx.cancelOpenSteps(ref, input.finishedAt);

    const summary: AutomationRunSummary = {
      lastRunAt: input.finishedAt,
      lastRunStatus: input.status,
      lastRunError: error,
    };
    if (run.mode === 'LIVE' && input.status === 'FAILED') summary.consecutiveFailures = 'increment';
    if (run.mode === 'LIVE' && input.status === 'SUCCEEDED') summary.consecutiveFailures = 'reset';
    await tx.updateAutomation(ref.organizationId, run.automationId, summary);
    return true;
  });
}
