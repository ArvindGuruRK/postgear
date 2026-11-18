/**
 * The in-app notices Clips writes from the API (Sprint 12, Modules 04 and
 * 05): an export that reached Media, and the failures the reconcile decides
 * when a job's workflow is gone. The worker writes the video ready and
 * failed rows itself. A Preview Export writes no notice at all.
 *
 * Titles, links and the line under the title come from
 * `@postgear/scheduling`, which the worker uses too, so a row reads the same
 * whichever side wrote it. A video notice opens the video's page, an export
 * notice the clip's editor on its Export tab (Module 15). The line is the name and, for a failure, the
 * engine's sentence. Never a tool's text.
 */
import {
  CLIP_NOTIFICATION_TITLES,
  CLIP_NOTIFICATION_TYPES,
  clipExportPagePath,
  clipExportReadyLine,
  clipFailedLine,
  clipVideoPagePath,
} from '@postgear/scheduling';
import { clipErrorMessage } from '@postgear/video-engine';
import type { NotifyInput } from '../../notifications/notifications.service';

export function exportReadyNotice(
  orgId: string,
  clip: { id: string; title: string },
  mediaId: string,
): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.exportReady,
    title: CLIP_NOTIFICATION_TITLES.exportReady,
    content: clipExportReadyLine(clip.title),
    link: clipExportPagePath(orgId, clip.id),
    meta: { clipId: clip.id, mediaId },
    email: false,
  };
}

export function exportFailedNotice(
  orgId: string,
  clip: { id: string; title: string },
): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.exportFailed,
    title: CLIP_NOTIFICATION_TITLES.exportFailed,
    content: clipFailedLine(clip.title, clipErrorMessage('export_failed'), 'clip'),
    link: clipExportPagePath(orgId, clip.id),
    meta: { clipId: clip.id, code: 'export_failed' },
    email: false,
  };
}

export function videoFailedNotice(
  orgId: string,
  video: { id: string; title: string },
): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.videoFailed,
    title: CLIP_NOTIFICATION_TITLES.videoFailed,
    content: clipFailedLine(video.title, clipErrorMessage('import_failed'), 'video'),
    link: clipVideoPagePath(orgId, video.id),
    meta: { videoId: video.id, code: 'import_failed' },
    email: false,
  };
}
