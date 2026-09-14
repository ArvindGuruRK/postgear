/**
 * User-facing strings for the media library.
 *
 * Specific on purpose, for the same reason `channels.messages.ts` gives: the
 * caller is an authenticated member acting on their own workspace's files, so
 * there is no enumeration concern to trade clarity against. "Upload an MP4 or
 * MOV" is something a user can act on; "Invalid input" is not.
 */
import { formatBytes } from '@postgear/social-core';

/** Largest image accepted *before* compression. What is stored is far smaller. */
export const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

/** GIFs are stored as uploaded, so their cap is the strictest platform's: X, at 15 MB. */
export const MAX_GIF_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Largest video accepted. Also the multipart limit, so an oversized upload is
 * cut off while streaming rather than after it has filled the disk.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 250 * 1024 * 1024;

export const MEDIA_MESSAGES = {
  NO_FILE: 'Choose a file to upload.',
  UNSUPPORTED:
    'That file type is not supported. Upload a JPEG, PNG, GIF, WebP or AVIF image, or an MP4 or MOV video.',
  HEIC: 'HEIC photos are not supported yet. Export the photo as JPEG — on an iPhone, Settings › Camera › Formats › Most Compatible — and try again.',
  WEBM: 'WebM video is not supported, because several platforms reject it. Convert the video to MP4 and try again.',
  UNREADABLE:
    'That image could not be read. It may be damaged, or not the kind of file its name says.',
  IMAGE_TOO_LARGE: `Images can be at most ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)}.`,
  GIF_TOO_LARGE: `GIFs can be at most ${formatBytes(MAX_GIF_UPLOAD_BYTES)}.`,
  VIDEO_TOO_LARGE: `Videos can be at most ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}.`,
  NOT_FOUND: 'Media not found',
  DELETED: 'Media deleted',
} as const;
