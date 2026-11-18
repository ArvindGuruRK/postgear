/**
 * `clipSoundCheckWorkflow({ organizationId, assetId })` (Module 14), on
 * `postgear-media-quick`, id `clip-sound-check:<assetId>`: a workspace's
 * uploaded sound made the editor's AAC `.m4a` with its peaks, or marked
 * failed with its reason.
 *
 * Rowless like the sticker check: the asset row carries the state, and the
 * API waits for the answer up to `CLIP_WAIT_FOR_ANSWER_MS`. A tool fault
 * gets one more attempt; a file we cannot use is an answer, not a failure.
 */
import { CLIP_FAILURE_TYPES, CLIP_SOUND_CHECK_TIMEOUT_MS } from '@postgear/scheduling';
import { proxyActivities } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';
import type { SoundCheckAnswer, SoundCheckInput } from '../../clips/sounds/check';
import { answerFailure } from './query.workflows';

const check = proxyActivities<ClipActivities>({
  startToCloseTimeout: CLIP_SOUND_CHECK_TIMEOUT_MS / 2,
  scheduleToCloseTimeout: CLIP_SOUND_CHECK_TIMEOUT_MS,
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 1,
    maximumAttempts: 2,
    nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
  },
});

export async function clipSoundCheckWorkflow(input: SoundCheckInput): Promise<SoundCheckAnswer> {
  try {
    return await check.clipCheckSound(input);
  } catch (error) {
    throw answerFailure(error);
  }
}
