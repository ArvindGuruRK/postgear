/**
 * `mediaVideoFactsWorkflow({ mediaId, organizationId })` (Sprint 12, Module
 * 19), on `postgear-media`, id `media-video-facts:<mediaId>`: a video in the
 * Media library gets its poster and its length.
 *
 * Started by the API after an upload and by the maintenance pass for older
 * rows; neither waits for it. Rowless: the Media row is the state, and the
 * activity skips a row that is already checked, so a second start is
 * harmless. One `mediaVideoFacts` activity with the contract's two
 * attempts; if both fail, `mediaVideoFactsGaveUp` marks the row checked so
 * the next pass moves on to other rows instead of trying this one for ever.
 */
import {
  CLIP_FAILURE_TYPES,
  CLIP_HEARTBEAT_MS,
  MEDIA_VIDEO_FACTS_ATTEMPT_MS,
  MEDIA_VIDEO_FACTS_RETRY_POLICY,
  type MediaVideoFactsInput,
} from '@postgear/scheduling';
import { log, proxyActivities } from '@temporalio/workflow';
import type { ClipActivities, MediaVideoFactsOutcome } from '../clips/activities';

const work = proxyActivities<ClipActivities>({
  startToCloseTimeout: MEDIA_VIDEO_FACTS_ATTEMPT_MS,
  heartbeatTimeout: 2 * CLIP_HEARTBEAT_MS,
  retry: {
    initialInterval: MEDIA_VIDEO_FACTS_RETRY_POLICY.initialIntervalMs,
    backoffCoefficient: MEDIA_VIDEO_FACTS_RETRY_POLICY.backoffCoefficient,
    maximumInterval: MEDIA_VIDEO_FACTS_RETRY_POLICY.maximumIntervalMs,
    maximumAttempts: MEDIA_VIDEO_FACTS_RETRY_POLICY.maximumAttempts,
    nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
  },
});

const bookkeeping = proxyActivities<ClipActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 4 },
});

/** What the run ended with: the activity's answer, or `gave_up` after the last attempt failed. */
export type MediaVideoFactsResult = MediaVideoFactsOutcome['status'] | 'gave_up';

export async function mediaVideoFactsWorkflow(
  input: MediaVideoFactsInput,
): Promise<MediaVideoFactsResult> {
  try {
    const outcome = await work.mediaVideoFacts(input);
    return outcome.status;
  } catch (error) {
    log.warn('media video facts failed', { mediaId: input.mediaId, error: String(error) });
    await bookkeeping.mediaVideoFactsGaveUp(input).catch((markError: unknown) => {
      // Unchecked, so the next maintenance pass simply tries it again.
      log.warn('media video facts could not mark the row', {
        mediaId: input.mediaId,
        error: String(markError),
      });
    });
    return 'gave_up';
  }
}
