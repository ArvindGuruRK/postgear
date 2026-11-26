/**
 * The Python media service, as a workflow sees it (Sprint 13, Module 01).
 *
 * Workflows import these functions and nothing else knows Python exists. Each
 * one is a `proxyActivities` stub routed to `postgear-media-py` by its
 * `taskQueue`; the Node worker registers no function under these names (the
 * Python worker does, with `@activity.defn(name=...)`).
 *
 * The names and shapes come from `@postgear/media-contract`, the timeouts and
 * attempts from `MEDIA_PY_TIMINGS` in `@postgear/scheduling`, so the stub, the
 * Python side and the tests read one table each. Only the contract's `names`
 * file is imported at runtime: the workflow sandbox never loads Zod for it.
 *
 * Workflow code only: `proxyActivities` must run inside a workflow.
 */
import type { MediaPyActivities } from '@postgear/media-contract';
import { MEDIA_NON_RETRYABLE_ERRORS } from '@postgear/media-contract/names';
import { MEDIA_PY_TASK_QUEUE, MEDIA_PY_TIMINGS, type MediaPyTiming } from '@postgear/scheduling';
import {
  ActivityCancellationType,
  type ActivityOptions,
  proxyActivities,
} from '@temporalio/workflow';

/** The activity options for one Python activity, from its timing row. */
export function mediaPyOptions(timing: MediaPyTiming): ActivityOptions {
  return {
    taskQueue: MEDIA_PY_TASK_QUEUE,
    startToCloseTimeout: timing.startToCloseMs,
    scheduleToCloseTimeout: timing.scheduleToCloseMs,
    ...(timing.heartbeatMs === null ? {} : { heartbeatTimeout: timing.heartbeatMs }),
    // A cancelled step waits for Python to stop at its next heartbeat, so its
    // scratch folder is gone before the workflow says "cancelled".
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      maximumAttempts: timing.maximumAttempts,
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '1 minute',
      nonRetryableErrorTypes: [...MEDIA_NON_RETRYABLE_ERRORS],
    },
  };
}

/** `mediaPyHealth`: versions and bindings; fails fast when no Python worker polls. */
export const { mediaPyHealth } = proxyActivities<Pick<MediaPyActivities, 'mediaPyHealth'>>(
  mediaPyOptions(MEDIA_PY_TIMINGS.mediaPyHealth),
);

/**
 * A long Python activity called from inside a clip job (`mediaPyTranscribe`
 * and later ones): its timing row, held inside `budgetMs`, what is left of
 * the job's own limit less the bookkeeping reserve (`workBudgetMs`). So a
 * slow listen is stopped by its own timeout while the workflow still has time
 * to book the failure and give the AI minutes back, never cut off by Temporal.
 * Call it when the step starts, not at load time.
 */
export function mediaPyWork<K extends keyof MediaPyActivities>(
  name: K,
  timing: MediaPyTiming,
  budgetMs: number,
): MediaPyActivities[K] {
  const options = mediaPyOptions({
    ...timing,
    startToCloseMs: Math.min(timing.startToCloseMs, budgetMs),
    scheduleToCloseMs: Math.min(timing.scheduleToCloseMs, budgetMs),
  });
  // One proxy for every Python activity; only the named one is handed back.
  const all = proxyActivities<MediaPyActivities>(options) as unknown as MediaPyActivities;
  return all[name];
}
