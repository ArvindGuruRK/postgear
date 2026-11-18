/**
 * Stickers in the render plan (Module 12): every picture sticker as the
 * numbers its overlay needs, in **output pixels** (an overlay draws on the
 * output picture, after the layout and before the text). The Follow Badge
 * is not here: it is shapes and texts in the ASS file (`text-plan.ts`).
 *
 * - The picture is scaled to its box (`widthPx x scale`, in output pixels),
 *   to even sizes. A turned picture sits in a bigger even box, the size of
 *   its diagonal (`2 x ceil(hypot / 2)`), with transparent corners, which is
 *   what FFmpeg's `rotate` makes with `c=none`; the box's top left is placed
 *   so the picture's centre is the item's centre.
 * - Every number comes from `overlayState`, the same item state `frameState`
 *   gives the preview.
 * - A window that starts before 0 or ends after the clip is cut to the clip;
 *   one wholly outside it is left out.
 */
import { STICKER_FRAMES_MAX } from '../document/limits';
import type { ClipDocument, StickerItem } from '../document/schema';
import { stickerRefKey } from '../document/sticker';
import { RenderCompileError } from './errors';
import { overlayState } from './frame-state';
import { evenSize } from './specs';

/** The file the worker has for one sticker picture (keyed by `stickerRefKey`). */
export interface RenderStickerAsset {
  /** A plain relative name inside the scratch folder. */
  file: string;
  animated: boolean;
  /** The picture's pixel size. */
  width: number;
  height: number;
  /** A moving picture's constant frame rate and frame count (null for a still one). */
  fps: number | null;
  frames: number | null;
}

/** One picture sticker, ready for its overlay. */
export interface PlanSticker {
  id: string;
  /** The `-i` it reads. */
  inputIndex: number;
  file: string;
  animated: boolean;
  /** A moving picture loops (its frames repeated by `loop`) or plays once and holds its last frame. */
  loop: boolean;
  fps: number | null;
  frames: number | null;
  /** The picture's size on the output before turning, even pixels. */
  width: number;
  height: number;
  /** The box after turning (the picture's own size when not turned), even pixels. */
  boxWidth: number;
  boxHeight: number;
  /** The box's top left on the output, whole even pixels (may be negative, partly off the clip). */
  x: number;
  y: number;
  /** Degrees, clockwise positive (FFmpeg's `rotate`, like CSS). */
  rotationDeg: number;
  opacity: number;
  flipX: boolean;
  /** Output ms, `endMs` exclusive, inside the clip. */
  startMs: number;
  endMs: number;
}

/** The nearest even whole number, negatives allowed (a box may start off the clip). */
function evenAround(value: number): number {
  return 2 * Math.round(value / 2);
}

/** Whether a turn is a whole number of full turns (no `rotate` filter then). */
function isUpright(rotationDeg: number): boolean {
  return Math.abs(rotationDeg % 360) < 1e-9;
}

function checkAsset(item: StickerItem, key: string, asset: RenderStickerAsset): void {
  const bad = (what: string): never => {
    throw new RenderCompileError('invalid_context', `Sticker ${item.id}: ${what}`, {
      itemId: item.id,
      ref: key,
    });
  };
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(asset.file) || asset.file.length > 120) {
    bad('the file must be a plain relative name');
  }
  if (!(Number.isInteger(asset.width) && asset.width > 0 && Number.isInteger(asset.height) && asset.height > 0)) {
    bad('bad picture size');
  }
  if (asset.animated) {
    if (!(typeof asset.fps === 'number' && asset.fps > 0 && Number.isFinite(asset.fps))) bad('bad fps');
    const frames = asset.frames;
    if (!(typeof frames === 'number' && Number.isInteger(frames) && frames >= 1 && frames <= STICKER_FRAMES_MAX)) {
      bad('bad frame count');
    }
  }
}

/** One sticker file a clip uses, once each, in the order the clip first uses it. */
export type StickerFileRef =
  | { key: string; library: string }
  | { key: string; asset: string };

/** Every picture sticker's file the document uses (badges have none), each once. */
export function stickerFilesNeeded(doc: Pick<ClipDocument, 'tracks'>): StickerFileRef[] {
  const seen = new Map<string, StickerFileRef>();
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type !== 'sticker') continue;
      const key = stickerRefKey(item.ref);
      if (!key || seen.has(key)) continue;
      if ('library' in item.ref) seen.set(key, { key, library: item.ref.id });
      else if ('asset' in item.ref) seen.set(key, { key, asset: item.ref.asset });
    }
  }
  return [...seen.values()];
}

/** Whether the document has a picture sticker (not a badge) anywhere. */
export function hasPictureStickers(doc: Pick<ClipDocument, 'tracks'>): boolean {
  return doc.tracks.some(
    (track) =>
      track.kind === 'overlay' &&
      track.items.some((item) => item.type === 'sticker' && !('badge' in item.ref)),
  );
}

/**
 * Every picture sticker, bottom first, with its input index counted from
 * `firstInput`. Throws `sticker_missing` when the worker did not hand in a
 * file the clip uses (a sticker removed from the library, a deleted upload).
 */
export function planStickers(
  doc: ClipDocument,
  assets: Readonly<Record<string, RenderStickerAsset>>,
  output: { width: number; height: number; scale: number; durationMs: number },
  firstInput: number,
): PlanSticker[] {
  const stickers: PlanSticker[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type !== 'sticker' || 'badge' in item.ref) continue;
      const key = stickerRefKey(item.ref) as string;
      const asset = assets[key];
      if (!asset) {
        throw new RenderCompileError('sticker_missing', 'A sticker file the clip uses was not handed in', {
          itemId: item.id,
          ref: key,
        });
      }
      checkAsset(item, key, asset);
      const startMs = Math.max(0, item.start);
      const endMs = Math.min(output.durationMs, item.start + item.duration);
      if (endMs <= startMs) continue;

      const state = overlayState(item, track.id, item.start);
      const width = evenSize(item.widthPx * state.scale * output.scale);
      const height = evenSize(item.heightPx * state.scale * output.scale);
      const upright = isUpright(state.rotationDeg);
      const diagonal = 2 * Math.ceil(Math.hypot(width, height) / 2);
      const boxWidth = upright ? width : diagonal;
      const boxHeight = upright ? height : diagonal;
      const cx = state.centre.x * output.width;
      const cy = state.centre.y * output.height;
      stickers.push({
        id: item.id,
        inputIndex: firstInput + stickers.length,
        file: asset.file,
        animated: asset.animated,
        loop: item.loop,
        fps: asset.animated ? asset.fps : null,
        frames: asset.animated ? asset.frames : null,
        width,
        height,
        boxWidth,
        boxHeight,
        x: evenAround(cx - boxWidth / 2),
        y: evenAround(cy - boxHeight / 2),
        rotationDeg: upright ? 0 : state.rotationDeg,
        opacity: Math.max(0, Math.min(1, state.opacity)),
        flipX: state.flipX,
        startMs,
        endMs,
      });
    }
  }
  return stickers;
}

