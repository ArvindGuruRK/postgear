/**
 * What the Media page says about a file (2026-10-23 revamp): the short line
 * under a tile, the sticker on its corner, and the viewer's details list.
 * Pure, so the wording is tested without React.
 */
import { formatBytes } from '@postgear/social-core/composer';
import { formatClipLength } from '@postgear/video-engine';
import type { MediaItem } from '@/types/media';

/** "JPEG", "GIF", "MP4", "MOV": from the stored type, the kind as a fallback. */
export function formatOf(item: Pick<MediaItem, 'mimeType' | 'type'>): string {
  const subtype = item.mimeType?.split('/')[1];
  if (!subtype) return item.type === 'video' ? 'Video' : 'Image';
  return subtype.replace('quicktime', 'mov').replace('jpg', 'jpeg').toUpperCase();
}

/** "JPEG, 776 KB": a tile's one line under the name. */
export function tileLine(item: MediaItem): string {
  return `${formatOf(item)}, ${formatBytes(item.fileSize)}`;
}

/**
 * The corner sticker, for the files that do not look like what they are in
 * a still: a video shows its poster or first frame, a GIF its first frame. A plain
 * image needs none.
 */
export function stickerOf(item: Pick<MediaItem, 'mimeType' | 'type'>): 'Video' | 'GIF' | null {
  if (item.type === 'video') return 'Video';
  return item.mimeType === 'image/gif' ? 'GIF' : null;
}

/**
 * A video's length as a clock: "0:42", "12:05", "1:02:05" (Module 19). Null
 * for an image, or a video whose length is not known yet (the media worker
 * has not read it, or could not). Under a second reads "0:01", never "0:00".
 */
export function lengthOf(item: Pick<MediaItem, 'type' | 'durationMs'>): string | null {
  const ms = item.durationMs;
  if (item.type !== 'video' || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return formatClipLength(Math.max(1_000, ms));
}

/** "Thu 22 Oct 2026": the day it was uploaded, in the viewer's locale. */
export function uploadedOn(item: Pick<MediaItem, 'createdAt'>): string {
  return new Date(item.createdAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The viewer's details, in reading order. Dimensions and a video's length only when they are known. */
export function detailsOf(item: MediaItem): { label: string; value: string }[] {
  const length = lengthOf(item);
  return [
    { label: 'Format', value: formatOf(item) },
    { label: 'Size', value: formatBytes(item.fileSize) },
    ...(item.width && item.height
      ? [{ label: 'Dimensions', value: `${item.width} × ${item.height}` }]
      : []),
    ...(length ? [{ label: 'Length', value: length }] : []),
    { label: 'Uploaded', value: uploadedOn(item) },
  ];
}

/** "Used in 2 unpublished posts", for the viewer, once the count is known. */
export function usageLine(posts: number): string {
  if (posts === 0) return 'Not used in any draft or queued post';
  return `Used in ${posts} unpublished ${posts === 1 ? 'post' : 'posts'}`;
}
