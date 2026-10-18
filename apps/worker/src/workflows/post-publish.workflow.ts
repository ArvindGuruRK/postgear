/**
 * Publishes one channel's chain of a post at its scheduled time.
 *
 * ## Why this is a workflow and not a job
 *
 * A post scheduled three weeks out must survive every restart, deploy and
 * outage between now and then. Temporal keeps the timer in its own store: the
 * worker can be killed and restarted mid-wait and the sleep resumes where it
 * was, with nothing lost and nothing doubled. A Redis-backed queue cannot
 * promise that for a job weeks away (see `complete_codebase_and_architecture_
 * analysis.md` §7, and the sprint document's Reference Study Guide).
 *
 * ## The database is the source of truth; signals only wake it
 *
 * The workflow never trusts its own memory of when to publish. It reads the
 * row, waits until that time (or until a signal arrives), then reads the row
 * **again** before acting. So a reschedule, a move back to drafts, a delete or
 * a disconnect need the API to do nothing more than write the row and send
 * `wake`: and even a missed signal only delays the correction to the next
 * wake-up, it never publishes stale intent. "Post now" is the one signal that
 * carries meaning of its own: it says publish regardless of the stored time.
 *
 * The same holds *during* the publish: a wake that arrives while the activity
 * is backing off between attempts re-reads the row, and if the post has been
 * moved or unqueued the attempt is cancelled and the wait starts over. An
 * attempt already talking to the platform is allowed to finish: cancelling a
 * call half-way is how a post goes out twice.
 *
 * ## Error branching
 *
 * `publishPost` throws typed failures (see `publish.activities.ts`):
 * transient ones are retried by the policy in `@postgear/scheduling`, with
 * each attempt recorded for the queue to show; a dead token diverts to a
 * refresh and one more try; everything else fails the post with a reason the
 * queue can explain.
 *
 * ## Versioning
 *
 * There is one version of this workflow. When publish logic changes in a way
 * that would confuse a run already asleep, ship it as a new named function
 * (the reference keeps `postWorkflowV101` … `V105` for this reason) rather than
 * editing this one; runs in flight keep executing the code they started with.
 */

import {
  CANCEL_SIGNAL,
  NON_RETRYABLE_PUBLISH_FAILURES,
  type PostPublishInput,
  type PostPublishOutcome,
  PUBLISH_FAILURE_TYPES,
  PUBLISH_NOW_SIGNAL,
  PUBLISH_RETRY_POLICY,
  type PublishFailureReason,
  type PublishSkipReason,
  WAKE_SIGNAL,
} from '@postgear/scheduling';
import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { Activities, PublishResult } from '../activities';

export const wakeSignal = defineSignal(WAKE_SIGNAL);
export const publishNowSignal = defineSignal(PUBLISH_NOW_SIGNAL);
export const cancelSignal = defineSignal(CANCEL_SIGNAL);

/**
 * Database reads and writes: retried generously, because a blip in Postgres
 * must never fail a post that the platform would have accepted.
 */
const { loadPublishJob, recordPublished, markPublishFailed, refreshChannelToken } =
  proxyActivities<Activities>({
    startToCloseTimeout: '2 minutes',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '1 minute',
      maximumAttempts: 20,
    },
  });

/**
 * The publish itself: the sprint's retry policy, with the failures that mean
 * "do not try this again" named so Temporal returns them to us at once.
 *
 * The heartbeat timeout is what lets a dead worker be noticed in a minute
 * rather than at the ten-minute limit; the activity heartbeats every fifteen
 * seconds while it talks to the platform. Cancellation waits for a running
 * attempt to finish (see the header), so the workflow learns the real outcome.
 */
const { publishPost } = proxyActivities<Activities>({
  // Long enough for a video upload to a slow platform.
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '1 minute',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: PUBLISH_RETRY_POLICY.initialIntervalMs,
    backoffCoefficient: PUBLISH_RETRY_POLICY.backoffCoefficient,
    maximumInterval: PUBLISH_RETRY_POLICY.maximumIntervalMs,
    maximumAttempts: PUBLISH_RETRY_POLICY.maximumAttempts,
    nonRetryableErrorTypes: NON_RETRYABLE_PUBLISH_FAILURES,
  },
});

export async function postPublishWorkflow(input: PostPublishInput): Promise<PostPublishOutcome> {
  // Counted rather than flagged: a wake that arrives while the row is being
  // read must still interrupt the wait that follows, and a wake that arrived
  // before the read changes nothing, since the read already saw its effect.
  let wakes = 0;
  let publishNow = false;
  let cancelled = false;

  setHandler(wakeSignal, () => {
    wakes += 1;
  });
  setHandler(publishNowSignal, () => {
    publishNow = true;
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
  });

  let integrationId = '';

  /** Reads the row and says whether it should be published right now. */
  async function due(): Promise<
    | { status: 'due' }
    | { status: 'wait'; delay: number }
    | { status: 'done'; outcome: PostPublishOutcome }
  > {
    if (cancelled) {
      return { status: 'done', outcome: { outcome: 'cancelled' } };
    }

    const job = await loadPublishJob(input);

    if (job.status === 'skip') {
      // A channel removed while the post waited is a failure the person should
      // see, not a silent end: the row would otherwise sit "publishing" forever.
      if (job.reason === 'channel_gone') {
        await markPublishFailed({
          ...input,
          reason: 'channel_unavailable',
          message: 'The channel was disconnected. Connect it again, or remove it from the post.',
          attempts: 0,
        });
        return { status: 'done', outcome: { outcome: 'failed', reason: 'channel_unavailable' } };
      }

      return { status: 'done', outcome: { outcome: 'skipped', reason: job.reason } };
    }

    integrationId = job.integrationId;

    if (publishNow) {
      return { status: 'due' };
    }

    const delay = new Date(job.publishAt).getTime() - Date.now();
    return delay <= 0 ? { status: 'due' } : { status: 'wait', delay };
  }

  for (;;) {
    // Wait for the scheduled time, re-reading the row after every wake-up.
    for (;;) {
      const wakesBeforeRead = wakes;
      const next = await due();

      if (next.status === 'done') {
        return next.outcome;
      }
      if (next.status === 'due') {
        break;
      }

      await condition(() => wakes !== wakesBeforeRead || publishNow || cancelled, next.delay);
      // Whatever ended the wait (the timer, a wake, both in the same instant)
      // the loop re-reads the row and lets it decide. One extra read per publish
      // is the price of never acting on a time the row no longer holds.
    }

    const outcome = await publishWatched();

    if (outcome !== 'restart') {
      return outcome;
    }
    // The post was moved or unqueued while the publish was backing off; the
    // attempt was cancelled and the row decides again.
  }

  /**
   * Runs the publish, with one refresh-and-retry when the credentials turn out
   * dead, while watching for a wake or cancel. A signal mid-publish re-reads the
   * row; if the post is no longer due, the attempt is cancelled (cleanly, during
   * a backoff; after the call completes, if one is in flight) and the caller
   * goes back to waiting.
   */
  async function publishWatched(): Promise<PostPublishOutcome | 'restart'> {
    let refreshed = false;

    for (;;) {
      const scope = new CancellationScope();
      let settled = false;
      const attempt = scope
        .run(() => publishPost(input))
        .then(
          (result): { ok: true; result: PublishResult } => ({ ok: true, result }),
          (error: unknown): { ok: false; error: unknown } => ({ ok: false, error }),
        )
        .finally(() => {
          settled = true;
        });

      // Watch for signals until the attempt settles.
      while (!settled) {
        const seen = wakes;
        await Promise.race([attempt, condition(() => settled || wakes !== seen || cancelled)]);

        if (settled) {
          break;
        }

        const next = await due();

        if (next.status !== 'due') {
          log.info('publish interrupted by a change to the post', { postId: input.postId });
          scope.cancel();
          break;
        }
      }

      const settledAttempt = await attempt;

      if (settledAttempt.ok) {
        if (!settledAttempt.result.recorded) {
          await recordPublished({ ...input, results: settledAttempt.result.results });
        }

        return { outcome: 'published', releaseURL: settledAttempt.result.releaseURL };
      }

      if (isCancellation(settledAttempt.error)) {
        return 'restart';
      }

      const failure = classify(settledAttempt.error);

      if (failure.type === PUBLISH_FAILURE_TYPES.skipped) {
        return { outcome: 'skipped', reason: failure.skipReason };
      }

      if (failure.type === PUBLISH_FAILURE_TYPES.refreshToken && !refreshed) {
        refreshed = true;
        log.info('publish hit dead credentials; refreshing', { postId: input.postId });

        let renewed = false;

        try {
          renewed = await refreshChannelToken({
            integrationId,
            organizationId: input.organizationId,
          });
        } catch {
          // The platform could not be reached for the whole retry policy. Not
          // a dead token: reported as unexpected, without flagging the channel.
          await markPublishFailed({
            ...input,
            reason: 'unexpected',
            message:
              'The channel token could not be refreshed because the platform did not answer. Retry later.',
            attempts: failure.attempts,
          });
          return { outcome: 'failed', reason: 'unexpected' };
        }

        if (renewed) {
          continue;
        }
      }

      const reason = reasonFor(failure.type);
      await markPublishFailed({
        ...input,
        reason,
        message: failure.message,
        attempts: failure.attempts,
      });

      return { outcome: 'failed', reason };
    }
  }
}

interface ClassifiedFailure {
  type: string;
  message: string;
  attempts: number;
  skipReason: PublishSkipReason;
}

/**
 * Unwraps what Temporal hands back: an `ActivityFailure` whose cause is the
 * `ApplicationFailure` the activity threw. Anything else (a timeout, a bug)
 * is reported as unexpected with whatever message it has.
 */
function classify(error: unknown): ClassifiedFailure {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    const cause = error.cause;
    const detail = cause.details?.[0];

    return {
      type: cause.type ?? 'unknown',
      message: cause.message || 'The platform returned an unexpected error.',
      attempts:
        error.retryState === 'MAXIMUM_ATTEMPTS_REACHED' ? PUBLISH_RETRY_POLICY.maximumAttempts : 1,
      skipReason: isSkipReason(detail) ? detail : 'not_queued',
    };
  }

  return {
    type: 'unknown',
    message: error instanceof Error ? error.message : 'An unexpected error stopped the publish.',
    attempts: 1,
    skipReason: 'not_queued',
  };
}

function reasonFor(type: string): PublishFailureReason {
  switch (type) {
    case PUBLISH_FAILURE_TYPES.refreshToken:
      return 'needs_reconnect';
    case PUBLISH_FAILURE_TYPES.notEnoughScopes:
      return 'needs_permissions';
    case PUBLISH_FAILURE_TYPES.badBody:
      return 'rejected';
    case PUBLISH_FAILURE_TYPES.channelUnavailable:
      return 'channel_unavailable';
    case PUBLISH_FAILURE_TYPES.interrupted:
      return 'interrupted';
    case PUBLISH_FAILURE_TYPES.retryable:
      return 'retries_exhausted';
    default:
      return 'unexpected';
  }
}

function isSkipReason(value: unknown): value is PublishSkipReason {
  return (
    value === 'deleted' ||
    value === 'not_queued' ||
    value === 'not_root' ||
    value === 'channel_gone'
  );
}
