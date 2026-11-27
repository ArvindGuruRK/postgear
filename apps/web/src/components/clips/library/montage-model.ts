/**
 * Create Montage's words and pure helpers (Module 11, section 4): the
 * limits and their sentences (the engine's own), the total length with each
 * Fade join taking 0.3 s off, whether the shapes differ, and moving a clip
 * in the list.
 */
import {
  CARD_TEXT_MAX,
  CLIP_ERROR_MESSAGES,
  JOIN_FADE_MS,
  MONTAGE_MAX_CLIPS,
  MONTAGE_MAX_MS,
  MONTAGE_MIN_CLIPS,
  type Ratio,
} from '@postgear/video-engine';
import type { ClipListItem } from '@/types/clips';
import type { MontageTransition } from '@/types/clips-batch';

export const MONTAGE_TOO_FEW = CLIP_ERROR_MESSAGES.montage_too_few;
export const MONTAGE_TOO_MANY = CLIP_ERROR_MESSAGES.montage_too_many;
export const MONTAGE_TOO_LONG = CLIP_ERROR_MESSAGES.montage_too_long;
export const MONTAGE_PICK_SHAPE = CLIP_ERROR_MESSAGES.montage_shapes_differ;
export const MONTAGE_SNAPSHOT_LINE =
  'Changes you make to these clips later will not change the montage.';
export const MONTAGE_UNREACHABLE =
  'We could not make the montage. Check your connection and try again.';
/** The opening title card's line, at most a card's line. */
export const MONTAGE_TITLE_MAX = CARD_TEXT_MAX;

/** The montage's length: every clip's, less 0.3 s for each Fade join. */
export function montageTotalMs(
  clips: ReadonlyArray<Pick<ClipListItem, 'durationMs'>>,
  transition: MontageTransition,
): number {
  const sum = clips.reduce((total, clip) => total + Math.max(0, clip.durationMs), 0);
  const joins = Math.max(0, clips.length - 1);
  return transition === 'fade' ? Math.max(0, sum - joins * JOIN_FADE_MS) : sum;
}

/** The different shapes among the clips, in the order they first appear. */
export function montageShapes(clips: ReadonlyArray<Pick<ClipListItem, 'ratio'>>): string[] {
  return [...new Set(clips.map((clip) => clip.ratio))];
}

/** Why Create is off right now, or null. */
export function montageProblem(input: {
  clips: ReadonlyArray<Pick<ClipListItem, 'durationMs'>>;
  transition: MontageTransition;
  needsShape: boolean;
  shape: Ratio | null;
}): string | null {
  if (input.clips.length < MONTAGE_MIN_CLIPS) return MONTAGE_TOO_FEW;
  if (input.clips.length > MONTAGE_MAX_CLIPS) return MONTAGE_TOO_MANY;
  if (montageTotalMs(input.clips, input.transition) > MONTAGE_MAX_MS) return MONTAGE_TOO_LONG;
  if (input.needsShape && input.shape === null) return MONTAGE_PICK_SHAPE;
  return null;
}

/** The list with the clip at `from` moved to `to` (out of range: unchanged). */
export function moveClip<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving as T);
  return next;
}

/** The title card's line as sent: trimmed, single spaced, null when empty. */
export function cleanTitleCard(draft: string): string | null {
  const clean = draft.replace(/\s+/g, ' ').trim().slice(0, MONTAGE_TITLE_MAX);
  return clean === '' ? null : clean;
}
