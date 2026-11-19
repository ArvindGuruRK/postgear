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
 *
 * Module 19 adds the retention notices (three days before a video is
 * removed, and when it was), the rights request removal and the storage
 * notice. A removed video's notice leads to the Videos tab, since the video
 * page is gone.
 */
import {
  CLIP_NOTIFICATION_TITLES,
  CLIP_NOTIFICATION_TYPES,
  CLIP_VIDEO_RIGHTS_REMOVED_LINE,
  clipExportPagePath,
  clipExportReadyLine,
  clipFailedLine,
  clipStorageOverLine,
  clipVideoExpiredLine,
  clipVideoExpiringLine,
  clipVideoPagePath,
  clipVideosBySizePath,
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

/** Module 19: three days before a video is removed (once per expiry date). */
export function videoExpiringNotice(
  orgId: string,
  video: { id: string; title: string },
  expiresAt: Date,
): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.videoExpiring,
    title: CLIP_NOTIFICATION_TITLES.videoExpiring,
    content: clipVideoExpiringLine(video.title),
    link: clipVideoPagePath(orgId, video.id),
    meta: { videoId: video.id, expiresAt: expiresAt.toISOString() },
    email: false,
  };
}

/** Module 19: a video the sweep removed because nobody opened it for `days` days. */
export function videoExpiredNotice(
  orgId: string,
  video: { id: string; title: string },
  days: number,
): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.videoRemoved,
    title: CLIP_NOTIFICATION_TITLES.videoRemoved,
    content: clipVideoExpiredLine(video.title, days),
    link: `/${orgId}/clips?tab=videos`,
    meta: { videoId: video.id, reason: 'expired' },
    email: false,
  };
}

/** Module 19: an operator removed a video after a request from its owner. */
export function videoRightsRemovedNotice(orgId: string, videoId: string): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.videoRemoved,
    title: CLIP_NOTIFICATION_TITLES.videoRemoved,
    content: CLIP_VIDEO_RIGHTS_REMOVED_LINE,
    link: `/${orgId}/clips?tab=videos`,
    meta: { videoId, reason: 'rights_request' },
    email: false,
  };
}

/** Module 19: the workspace's videos use more space than its plan allows (sent once). */
export function storageOverLimitNotice(orgId: string, usedGb: number, limitGb: number): NotifyInput {
  return {
    organizationId: orgId,
    type: CLIP_NOTIFICATION_TYPES.storageOverLimit,
    title: CLIP_NOTIFICATION_TITLES.storageOverLimit,
    content: clipStorageOverLine(usedGb, limitGb),
    link: clipVideosBySizePath(orgId),
    meta: { usedGb, limitGb },
    email: false,
  };
}
