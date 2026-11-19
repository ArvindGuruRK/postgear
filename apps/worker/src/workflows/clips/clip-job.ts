/**
 * What every clip job workflow shares (import, sharp range, export).
 *
 * - **Work** runs in a cancellation scope. The API's cancel signal (the
 *   publishing `CANCEL_SIGNAL`) cancels that scope; the running activity
 *   hears it at its next heartbeat, aborts its tools, and the workflow waits
 *   for it to finish (`WAIT_CANCELLATION_COMPLETED`) so the cleanup never
 *   races a half-written upload.
 * - **Time**: the work's activities get what is left of the job's own limit
 *   (`CLIP_JOB_TIMEOUTS_MS`, the workflow's execution timeout) minus a
 *   reserve, both per attempt and across attempts, so a slow job always
 *   leaves room for its own bookkeeping instead of being cut off by Temporal.
 * - **Retry**: `CLIP_RETRY_POLICY` (two attempts a minute apart); a
 *   `ClipPermanent` failure is never retried.
 * - **Bookkeeping** happens here, once, after the work finally failed or was
 *   cancelled, in a non-cancellable scope: `clipJobFailed` with the code read
 *   off the failure, or `clipJobCancelled`. Then, whatever the outcome,
 *   `clipJobSettled`, so the workspace's next waiting job starts.
 *
 * Workflow code: deterministic, and activities are imported as types only.
 */
import {
  CANCEL_SIGNAL,
  CLIP_FAILURE_TYPES,
  CLIP_HEARTBEAT_MS,
  CLIP_JOB_TIMEOUTS_MS,
  CLIP_RETRY_POLICY,
  type ClipJobKindName,
  type ClipJobWorkflowInput,
} from '@postgear/scheduling';
import type { ClipPlatformId } from '@postgear/video-engine';
import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  TimeoutFailure,
  workflowInfo,
} from '@temporalio/workflow';
import type { ClipActivities, ClipWorkResult } from '../../clips/activities';

export const clipCancelSignal = defineSignal(CANCEL_SIGNAL);

/** Kept back from the job's limit for the failure or cancel bookkeeping and the settle call. */
export const CLEANUP_RESERVE_MS = 10 * 60_000;
/** The shortest budget a work activity is ever given. */
const MIN_BUDGET_MS = 60_000;

export type ClipJobOutcome = 'done' | 'closed' | 'failed' | 'cancelled';

/**
 * The code a failed work activity carried (`details[0].code`), or `tool_failed`.
 * Failures are told apart by `instanceof` or by their name, so the same code
 * reads them in the workflow sandbox and in a plain test (another realm).
 */
export function failureDetail(error: unknown): { code: string; platform?: string } {
  const cause = isFailure(error, ActivityFailure) ? (error as ActivityFailure).cause : error;
  if (isFailure(cause, ApplicationFailure)) {
    const detail = (cause as ApplicationFailure).details?.[0] as
      | { code?: unknown; platform?: unknown }
      | undefined;
    if (detail && typeof detail.code === 'string') {
      return typeof detail.platform === 'string'
        ? { code: detail.code, platform: detail.platform }
        : { code: detail.code };
    }
  }
  if (isFailure(cause, TimeoutFailure)) {
    // Module 19: the work ran past its time from the contract and was stopped
    // ("This took too long and was stopped."). A heartbeat timeout is a lost
    // worker, not a slow job, so it keeps the plain failure.
    return (cause as TimeoutFailure).timeoutType === 'HEARTBEAT'
      ? { code: 'tool_failed' }
      : { code: 'timed_out' };
  }
  return { code: 'tool_failed' };
}

function isFailure(value: unknown, kind: { name: string; prototype: object }): boolean {
  if (value instanceof (kind as unknown as new () => object)) return true;
  return value instanceof Error && value.name === kind.name;
}

/** Milliseconds the work may still take: the job's deadline, less the reserve. */
export function workBudgetMs(kind: ClipJobKindName): number {
  const info = workflowInfo();
  const deadline =
    info.executionExpirationTime?.getTime() ??
    info.startTime.getTime() + CLIP_JOB_TIMEOUTS_MS[kind];
  return Math.max(MIN_BUDGET_MS, deadline - Date.now() - CLEANUP_RESERVE_MS);
}

/** The heavy activities, with the time that is left. Call again after a wait. */
export function workActivities(kind: ClipJobKindName) {
  const budget = workBudgetMs(kind);
  return proxyActivities<ClipActivities>({
    startToCloseTimeout: budget,
    scheduleToCloseTimeout: budget,
    heartbeatTimeout: 2 * CLIP_HEARTBEAT_MS,
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      initialInterval: CLIP_RETRY_POLICY.initialIntervalMs,
      backoffCoefficient: CLIP_RETRY_POLICY.backoffCoefficient,
      maximumInterval: CLIP_RETRY_POLICY.maximumIntervalMs,
      maximumAttempts: CLIP_RETRY_POLICY.maximumAttempts,
      nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
    },
  });
}

/** Short database and API calls: a few tries, quickly. */
const bookkeeping = proxyActivities<ClipActivities>({
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '8 minutes',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 5,
    nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
  },
});

const settle = proxyActivities<ClipActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 2, initialInterval: '5 seconds' },
});

/**
 * Runs a clip job's work with cancel, failure bookkeeping and the settle
 * call around it. `work` answers `done` or `closed` (the job was closed by
 * someone else; nothing to clean).
 */
export async function runClipJob(
  input: ClipJobWorkflowInput,
  kind: ClipJobKindName,
  work: () => Promise<ClipWorkResult>,
): Promise<ClipJobOutcome> {
  let cancelRequested = false;
  const scope = new CancellationScope();
  setHandler(clipCancelSignal, () => {
    cancelRequested = true;
    scope.cancel();
  });

  let outcome: ClipJobOutcome;
  try {
    const result = await scope.run(work);
    outcome = result.status;
  } catch (error) {
    if (cancelRequested || isCancellation(error)) {
      outcome = 'cancelled';
      await CancellationScope.nonCancellable(() => bookkeeping.clipJobCancelled(input)).catch(
        (cleanupError: unknown) => {
          log.warn('clip cancel bookkeeping failed', {
            jobId: input.jobId,
            kind,
            error: String(cleanupError),
          });
        },
      );
    } else {
      outcome = 'failed';
      const detail = failureDetail(error);
      await CancellationScope.nonCancellable(() =>
        bookkeeping.clipJobFailed({
          ...input,
          code: detail.code,
          ...(detail.platform ? { platform: detail.platform as ClipPlatformId } : {}),
        }),
      ).catch((cleanupError: unknown) => {
        log.warn('clip failure bookkeeping failed', {
          jobId: input.jobId,
          kind,
          error: String(cleanupError),
        });
      });
    }
  }

  await CancellationScope.nonCancellable(() => settle.clipJobSettled(input)).catch(() => undefined);
  return outcome;
}
