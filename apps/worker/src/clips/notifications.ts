/**
 * The bell rows Clips writes from the worker (Module 04 section 4, Module 05).
 *
 * In-app only: `emailStatus` keeps its default (`NONE`), so the API's email
 * dispatcher never picks them up. Titles, links and the line under the title
 * come from `@postgear/scheduling`, which the API's notices use too, so a row
 * reads the same whichever side wrote it. The line is the video's title, or
 * the name plus one of our own error sentences (never a tool's text).
 * `clip_export_ready` is written by the API's finish-export route instead,
 * next to the Media row it describes.
 *
 * Sprint 13, Module 11: an export of an Export All batch (`input.batchId`)
 * rings no bell of its own, ready or failed. The API writes the batch's one
 * notice ("6 clips are ready, 2 could not be exported.") when the batch's
 * last job ends, from the `settled` call every job makes.
 */
import {
  CLIP_NOTIFICATION_TITLES,
  CLIP_NOTIFICATION_TYPES,
  clipExportPagePath,
  clipFailedLine,
  clipVideoPagePath,
  clipVideoReadyLine,
} from '@postgear/scheduling';

export { CLIP_NOTIFICATION_TITLES };

/**
 * Whether a finished export rings its own bell: not a Preview Export (it
 * answers in its dialog) and not an export of a batch (counted in the
 * batch's one notice). A row whose input did not parse still rings.
 */
export function ringsOwnBell(input: { proof?: boolean; batchId?: string } | null): boolean {
  if (!input) return true;
  return input.proof !== true && !input.batchId;
}

/** What a `Notifications` row is created with. */
export interface ClipNotificationRow {
  organizationId: string;
  type: string;
  title: string;
  content: string;
  link: string;
  meta: Record<string, string>;
}

export function videoReadyNotification(
  organizationId: string,
  video: { id: string; title: string },
): ClipNotificationRow {
  return {
    organizationId,
    type: CLIP_NOTIFICATION_TYPES.videoReady,
    title: CLIP_NOTIFICATION_TITLES.videoReady,
    content: clipVideoReadyLine(video.title),
    link: clipVideoPagePath(organizationId, video.id),
    meta: { videoId: video.id },
  };
}

export function videoFailedNotification(
  organizationId: string,
  video: { id: string; title: string },
  error: { code: string; message: string },
): ClipNotificationRow {
  return {
    organizationId,
    type: CLIP_NOTIFICATION_TYPES.videoFailed,
    title: CLIP_NOTIFICATION_TITLES.videoFailed,
    content: clipFailedLine(video.title, error.message, 'video'),
    link: clipVideoPagePath(organizationId, video.id),
    meta: { videoId: video.id, code: error.code },
  };
}

export function exportFailedNotification(
  organizationId: string,
  clip: { id: string; videoId: string; title: string },
  error: { code: string; message: string },
): ClipNotificationRow {
  return {
    organizationId,
    type: CLIP_NOTIFICATION_TYPES.exportFailed,
    title: CLIP_NOTIFICATION_TITLES.exportFailed,
    content: clipFailedLine(clip.title, error.message, 'clip'),
    link: clipExportPagePath(organizationId, clip.id),
    meta: { clipId: clip.id, videoId: clip.videoId, code: error.code },
  };
}
