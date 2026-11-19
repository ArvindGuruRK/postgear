/**
 * The composer's Select A Clip tab (Module 17 section 5), its rules kept pure
 * so they are tested without a browser.
 *
 * A clip is picked for its exported file: what posts is that `Media` row, so
 * a clip changed since is still listed (with a note) and attaches the old
 * file, and a clip whose file left Media cannot be picked at all.
 */
import { formatClipLength } from '@postgear/video-engine';
import type { ClipListItem } from '@/types/clips';

export const CLIP_PICKER_TITLE = 'Select A Clip';
export const CLIP_PICKER_EMPTY =
  'No exported clips yet. Export a clip in Clips and it will appear here.';
export const CLIP_PICKER_NO_MATCH = 'No exported clip has that name. Try other words.';
export const CLIP_PICKER_CHANGED = 'Changed since the last export. The old version will be used.';
export const CLIP_PICKER_PICTURES_ONLY = 'This post part takes pictures only.';
export const CLIP_PICKER_FILE_GONE =
  'Its exported file was deleted from Media. Export it again in Clips.';
export const CLIP_PICKER_ATTACH_FAILED =
  'We could not add that clip. Check your connection and try again.';

/** Why a clip cannot be picked here; null when it can. */
export type ClipPickBlock = 'pictures_only' | 'file_gone' | 'attached' | null;

/** "0:42, 9:16": the clip's length and shape. */
export function clipFactsLine(clip: Pick<ClipListItem, 'durationMs' | 'ratio'>): string {
  return `${formatClipLength(clip.durationMs)}, ${clip.ratio}`;
}

/** "Exported 5 Nov 2026": when its file was made; empty when unknown. */
export function exportedLine(exportedAt: string | null | undefined): string {
  if (!exportedAt) return '';
  const at = new Date(exportedAt);
  if (Number.isNaN(at.getTime())) return '';
  return `Exported ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** The badge: Scheduled while a post with it waits, Exported otherwise. */
export function clipPickBadge(clip: Pick<ClipListItem, 'state'>): 'Scheduled' | 'Exported' {
  return clip.state === 'scheduled' ? 'Scheduled' : 'Exported';
}

/** The clip changed since its file was made (the old file is what posts). */
export function changedSinceExport(
  clip: Pick<ClipListItem, 'exported' | 'exportedMediaId'>,
): boolean {
  return clip.exportedMediaId !== null && !clip.exported;
}

/** Whether the clip can be picked, and if not, why. */
export function clipPickBlock(
  clip: Pick<ClipListItem, 'exportedMediaId' | 'exportedAt'>,
  { imagesOnly, attached }: { imagesOnly: boolean; attached: readonly string[] },
): ClipPickBlock {
  if (imagesOnly) return 'pictures_only';
  if (!clip.exportedMediaId || !clip.exportedAt) return 'file_gone';
  if (attached.includes(clip.exportedMediaId)) return 'attached';
  return null;
}

/** How many pages a list of `total` clips takes at `pageSize` a page (at least one). */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
