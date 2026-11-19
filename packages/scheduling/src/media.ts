/**
 * Sprint 12, Module 19: posters and lengths for videos in the Media library.
 *
 * A video uploaded to Media is stored as it came, with no picture and no
 * length. `mediaVideoFactsWorkflow` fixes that on the media worker: the file
 * comes down to a scratch folder, ffprobe reads its facts, FFmpeg takes a
 * WebP poster one second in (the first frame for a shorter video), the
 * poster is stored beside the file, and the row gets `thumbnail`,
 * `durationMs`, `fps`, `width`, `height` and `factsCheckedAt`.
 *
 * Started twice over, both best effort: by the API right after an upload
 * (never awaited), and by the maintenance pass for older rows, at most
 * `MEDIA_VIDEO_FACTS_BATCH` a pass. One workflow per row at a time: the id
 * is derived from the row id, so the two starts can never run it twice at
 * once. `factsCheckedAt` is written even when the file cannot be read, so a
 * broken file is not tried on every pass.
 *
 * Pure, like the rest of this package: workflow code imports it.
 */
import { MEDIA_TASK_QUEUE } from './clips';
import type { RetryPolicyValues } from './retry-policy';

export const MEDIA_VIDEO_FACTS_WORKFLOW = 'mediaVideoFactsWorkflow';

/** The queue it runs on: video work never shares a queue with publishing. */
export const MEDIA_VIDEO_FACTS_TASK_QUEUE = MEDIA_TASK_QUEUE;

/** One run per Media row at a time. */
export function mediaVideoFactsWorkflowId(mediaId: string): string {
  return `media-video-facts:${mediaId}`;
}

export interface MediaVideoFactsInput {
  mediaId: string;
  organizationId: string;
}

/**
 * The whole workflow's limit. The activity waits for a slot on
 * `postgear-media` behind imports; past this the run ends and the next
 * maintenance pass starts it again.
 */
export const MEDIA_VIDEO_FACTS_TIMEOUT_MS = 60 * 60_000;

/** One attempt's limit: fetching a 250 MB upload, one ffprobe and one poster. */
export const MEDIA_VIDEO_FACTS_ATTEMPT_MS = 10 * 60_000;

/** Two attempts half a minute apart; a file we cannot read is an answer, not a retry. */
export const MEDIA_VIDEO_FACTS_RETRY_POLICY: RetryPolicyValues = {
  initialIntervalMs: 30_000,
  backoffCoefficient: 1,
  maximumIntervalMs: 30_000,
  maximumAttempts: 2,
};

/** Older rows handled per maintenance pass, until none are left. */
export const MEDIA_VIDEO_FACTS_BATCH = 20;

/** Where the poster is taken: one second in, or the first frame of a shorter video. */
export const MEDIA_POSTER_AT_MS = 1_000;

/** The poster's longest side, as the library's image thumbnails (never enlarged). */
export const MEDIA_POSTER_EDGE = 480;

/** The time the poster is taken at, for a video of this length (0 when unknown). */
export function mediaPosterTimeMs(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > MEDIA_POSTER_AT_MS ? MEDIA_POSTER_AT_MS : 0;
}
