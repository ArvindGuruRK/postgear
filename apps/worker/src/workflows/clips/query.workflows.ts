/**
 * The waiting-caller workflows on `postgear-media-quick` (Module 03): the API
 * starts one, waits at most `CLIP_WAIT_FOR_ANSWER_MS` for its answer, and
 * never writes a row for it.
 *
 * - `clipProbeWorkflow(link)`: what is behind a recognised link.
 * - `clipListChannelWorkflow(request)`: resolve a channel, or one page of it.
 *
 * One attempt each: the person is waiting, and the API caches the answer.
 * A failure is rethrown as the activity's own `ApplicationFailure` (not the
 * `ActivityFailure` wrapping it), so the API's `WorkflowFailedError.cause`
 * carries our code in `details[0].code`.
 */
import { CLIP_FAILURE_TYPES, CLIP_PROBE_TIMEOUT_MS } from '@postgear/scheduling';
import type {
  ClipListChannelAnswer,
  ClipListChannelRequest,
  LinkInfo,
  LinkRef,
} from '@postgear/video-engine';
import { ActivityFailure, ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';

const quick = proxyActivities<ClipActivities>({
  startToCloseTimeout: CLIP_PROBE_TIMEOUT_MS,
  scheduleToCloseTimeout: CLIP_PROBE_TIMEOUT_MS,
  retry: { maximumAttempts: 1 },
});

/** The failure the API reads: the activity's own, or a permanent `tool_failed` for a timeout. */
export function answerFailure(error: unknown): unknown {
  const cause = error instanceof ActivityFailure ? error.cause : null;
  if (cause instanceof ApplicationFailure) return cause;
  if (error instanceof ActivityFailure) {
    return ApplicationFailure.create({
      message: 'clip query did not answer',
      type: CLIP_FAILURE_TYPES.permanent,
      nonRetryable: true,
      details: [{ code: 'tool_failed' }],
    });
  }
  return error;
}

export async function clipProbeWorkflow(link: LinkRef): Promise<LinkInfo> {
  try {
    return await quick.clipProbeLink(link);
  } catch (error) {
    throw answerFailure(error);
  }
}

export async function clipListChannelWorkflow(
  request: ClipListChannelRequest,
): Promise<ClipListChannelAnswer> {
  try {
    return await quick.clipListChannel(request);
  } catch (error) {
    throw answerFailure(error);
  }
}
