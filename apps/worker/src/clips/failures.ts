/**
 * Every way a clip activity can fail, as one Temporal failure carrying our
 * code (never a tool's text).
 *
 * Activities throw `clipFailure(error)`: an `ApplicationFailure` whose `type`
 * is `ClipRetryable` or `ClipPermanent` (the contract's `CLIP_FAILURE_TYPES`)
 * and whose first detail is `{ code, platform? }`. A permanent failure is
 * `nonRetryable`, so Temporal does not spend the second attempt on a private
 * link or a file that is not a video. Workflows read the code back with
 * `failureCode` and store the sentence for it.
 *
 * Unknown errors are `tool_failed` and retryable: the second attempt is
 * worth it for a hiccup, and the policy caps it at two.
 */
import {
  ChannelListerError,
  DiskSpaceError,
  DownloaderError,
  FfmpegError,
  ProbeError,
  RenderError,
  StickerError,
  ToolError,
  ToolMissingError,
} from '@postgear/media-tools';
import { CLIP_FAILURE_TYPES, CLIP_NON_RETRYABLE } from '@postgear/scheduling';
import { type ClipPlatformId, isRenderCompileError, jobErrorCodeFor } from '@postgear/video-engine';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';

export interface ClipFailureDetail {
  code: string;
  platform?: ClipPlatformId;
}

/** An activity's own refusal, with our code: thrown inside activities, mapped by `clipFailure`. */
export class ClipStepError extends Error {
  constructor(
    readonly code: string,
    readonly options: { retryable?: boolean; platform?: ClipPlatformId; cause?: unknown } = {},
  ) {
    super(`clip step failed: ${code}`);
    this.name = 'ClipStepError';
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }

  get retryable(): boolean {
    return this.options.retryable ?? !CLIP_NON_RETRYABLE.includes(this.code);
  }
}

/** The code and retryability of any error an activity can meet. */
export function classifyClipError(error: unknown): {
  code: string;
  retryable: boolean;
  platform?: ClipPlatformId;
} {
  if (error instanceof ClipStepError) {
    return { code: error.code, retryable: error.retryable, platform: error.options.platform };
  }
  if (error instanceof CancelledFailure) return { code: 'cancelled', retryable: false };
  if (isRenderCompileError(error)) {
    // The same document fails the same way every time: never retried.
    return { code: jobErrorCodeFor(error.code), retryable: false };
  }
  if (error instanceof DownloaderError) {
    return {
      code: error.code,
      retryable: error.retryable && !CLIP_NON_RETRYABLE.includes(error.code),
    };
  }
  if (error instanceof ChannelListerError) return { code: error.code, retryable: error.retryable };
  if (error instanceof ProbeError || error instanceof FfmpegError || error instanceof RenderError) {
    return { code: error.code, retryable: !CLIP_NON_RETRYABLE.includes(error.code) };
  }
  // A picture that is not usable is the same next time; only a tool fault is retried.
  if (error instanceof StickerError) return { code: error.code, retryable: error.code === 'tool_failed' };
  // Out of disk here: another worker (or this one, a minute later) may have room.
  if (error instanceof DiskSpaceError) return { code: 'clips_busy', retryable: true };
  if (error instanceof ToolMissingError) return { code: 'tools_offline', retryable: true };
  if (error instanceof ToolError) {
    return error.aborted
      ? { code: 'cancelled', retryable: false }
      : { code: 'tool_failed', retryable: true };
  }
  if (isAbortError(error)) return { code: 'cancelled', retryable: false };
  return { code: 'tool_failed', retryable: true };
}

/** The failure an activity throws. Logs the real cause (never stored, never shown). */
export function clipFailure(
  error: unknown,
  context: { activity: string; jobId?: string },
): ApplicationFailure {
  if (error instanceof ApplicationFailure) return error;
  const { code, retryable, platform } = classifyClipError(error);
  if (code === 'tool_failed' || code === 'tools_offline' || code === 'clips_busy') {
    console.warn(
      JSON.stringify({
        event: 'clips.activity.failed',
        activity: context.activity,
        jobId: context.jobId,
        code,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stderrTail:
          error instanceof ToolError || error instanceof RenderError ? error.stderrTail : undefined,
      }),
    );
  }
  const detail: ClipFailureDetail = platform ? { code, platform } : { code };
  return ApplicationFailure.create({
    message: `clip ${context.activity} failed: ${code}`,
    type: retryable ? CLIP_FAILURE_TYPES.retryable : CLIP_FAILURE_TYPES.permanent,
    nonRetryable: !retryable,
    details: [detail],
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
