/**
 * `clipStickerCheckWorkflow({ organizationId, assetId })` (Module 12), on
 * `postgear-media-quick`, id `clip-sticker-check:<assetId>`: a workspace's
 * uploaded sticker made a PNG or APNG, or marked failed with its reason.
 *
 * Rowless like the probe: the asset row carries the state, and the API waits
 * for the answer up to `CLIP_WAIT_FOR_ANSWER_MS`. A tool fault gets one more
 * attempt; a picture we cannot use is an answer, not a failure.
 */
import { CLIP_FAILURE_TYPES, CLIP_STICKER_CHECK_TIMEOUT_MS } from '@postgear/scheduling';
import { proxyActivities } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';
import type { StickerCheckAnswer, StickerCheckInput } from '../../clips/stickers/check';
import { answerFailure } from './query.workflows';

const check = proxyActivities<ClipActivities>({
  startToCloseTimeout: CLIP_STICKER_CHECK_TIMEOUT_MS / 2,
  scheduleToCloseTimeout: CLIP_STICKER_CHECK_TIMEOUT_MS,
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 1,
    maximumAttempts: 2,
    nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
  },
});

export async function clipStickerCheckWorkflow(input: StickerCheckInput): Promise<StickerCheckAnswer> {
  try {
    return await check.clipCheckSticker(input);
  } catch (error) {
    throw answerFailure(error);
  }
}
