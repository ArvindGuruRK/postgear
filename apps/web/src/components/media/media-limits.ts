/**
 * Upload limits, checked in the browser before a byte is sent.
 *
 * A courtesy, not a control: they mirror
 * `apps/api/src/modules/media/media.messages.ts`, and the API enforces the
 * real limits — on the file's actual bytes, which the browser's claimed type
 * says nothing reliable about. Checking here only spares someone a 200 MB
 * upload that was always going to be refused.
 */
import { formatBytes } from '@postgear/social-core/composer';
import type { MediaItem } from '@/types/media';

const MB = 1024 * 1024;

export const UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/quicktime';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

const MAX_IMAGE_BYTES = 20 * MB;
const MAX_GIF_BYTES = 15 * MB;
const MAX_VIDEO_BYTES = 250 * MB;

/** Why a file will be refused, or null when it is worth sending. */
export function preflightUpload(file: File): string | null {
  // HEIC reports as image/heic in some browsers and as nothing in others, so
  // the extension is checked too — this is advice, and the server decides.
  if (/\.hei[cf]$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif') {
    return `${file.name}: HEIC photos are not supported yet. Export it as JPEG and try again.`;
  }

  if (file.type === 'image/gif' && file.size > MAX_GIF_BYTES) {
    return `${file.name}: GIFs can be at most ${formatBytes(MAX_GIF_BYTES)}.`;
  }

  if (IMAGE_TYPES.has(file.type)) {
    return file.size > MAX_IMAGE_BYTES
      ? `${file.name}: images can be at most ${formatBytes(MAX_IMAGE_BYTES)}.`
      : null;
  }

  if (VIDEO_TYPES.has(file.type)) {
    return file.size > MAX_VIDEO_BYTES
      ? `${file.name}: videos can be at most ${formatBytes(MAX_VIDEO_BYTES)}.`
      : null;
  }

  // An empty type is common for perfectly good files on some systems; let the
  // server's content check decide rather than refusing on a missing label.
  return file.type === ''
    ? null
    : `${file.name}: upload a JPEG, PNG, GIF, WebP or AVIF image, or an MP4 or MOV video.`;
}

/** "JPEG · 708 KB · 2048×1536", for a tile or a tooltip. */
export function describeMedia(item: MediaItem): string {
  const format =
    item.mimeType?.split('/')[1]?.replace('quicktime', 'mov').toUpperCase() ??
    item.type.toUpperCase();
  const dimensions = item.width && item.height ? ` · ${item.width}×${item.height}` : '';

  return `${format} · ${formatBytes(item.fileSize)}${dimensions}`;
}
