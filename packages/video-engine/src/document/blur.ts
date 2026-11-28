/**
 * Blur A Region (Sprint 13, Module 17 item 18). Pure.
 *
 * A box over part of one video, blurred for the whole clip: a bystander, a
 * screen with private details. It is a fraction of that video's picture, so
 * it stays on the same spot whatever the crop, the layout or the zoom; the
 * export blurs the video before it is cropped (`blurChain`), and the
 * preview draws the same box blurred into each area it shows (`blurInto`).
 *
 * A face is blurred by placing a box over it: the box does not follow a
 * face that moves (no tracking), which the panel says.
 */
import { newId } from './create';
import { BLUR_MIN_SIZE, MAX_BLURS } from './limits';
import type { Blur, ClipDocument } from './schema';

export type BlurEditResult =
  | { ok: true; doc: ClipDocument; blurId?: string }
  | { ok: false; code: 'too_many_blurs' | 'blur_not_found' | 'source_not_found' };

export type BlurRect = Pick<Blur, 'x' | 'y' | 'w' | 'h'>;

/** A new box: a fifth of the picture, in its middle. */
export const BLUR_DEFAULT: BlurRect = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A box kept inside the picture and at least `BLUR_MIN_SIZE` each way. */
export function fitBlur(rect: BlurRect): BlurRect {
  const w = round(clamp(rect.w, BLUR_MIN_SIZE, 1));
  const h = round(clamp(rect.h, BLUR_MIN_SIZE, 1));
  return { x: round(clamp(rect.x, 0, 1 - w)), y: round(clamp(rect.y, 0, 1 - h)), w, h };
}

/** The boxes on one source. */
export function blursOf(doc: Pick<ClipDocument, 'blurs'>, sourceId: string): Blur[] {
  return (doc.blurs ?? []).filter((blur) => blur.source === sourceId);
}

export function addBlur(
  doc: ClipDocument,
  sourceId: string,
  rect: BlurRect = BLUR_DEFAULT,
): BlurEditResult {
  if (!doc.sources.some((source) => source.id === sourceId)) {
    return { ok: false, code: 'source_not_found' };
  }
  const blurs = doc.blurs ?? [];
  if (blurs.length >= MAX_BLURS) return { ok: false, code: 'too_many_blurs' };
  const blur: Blur = { id: newId('bl'), source: sourceId, ...fitBlur(rect) };
  return { ok: true, doc: { ...doc, blurs: [...blurs, blur] }, blurId: blur.id };
}

export function updateBlur(doc: ClipDocument, id: string, rect: Partial<BlurRect>): BlurEditResult {
  const blurs = doc.blurs ?? [];
  const at = blurs.findIndex((blur) => blur.id === id);
  const current = blurs[at];
  if (!current) return { ok: false, code: 'blur_not_found' };
  const next = { ...current, ...fitBlur({ ...current, ...rect }) };
  if (
    next.x === current.x &&
    next.y === current.y &&
    next.w === current.w &&
    next.h === current.h
  ) {
    return { ok: true, doc };
  }
  return { ok: true, doc: { ...doc, blurs: blurs.map((blur, k) => (k === at ? next : blur)) } };
}

export function removeBlur(doc: ClipDocument, id: string): BlurEditResult {
  const blurs = doc.blurs ?? [];
  if (!blurs.some((blur) => blur.id === id)) return { ok: false, code: 'blur_not_found' };
  const rest = blurs.filter((blur) => blur.id !== id);
  const { blurs: _gone, ...without } = doc;
  return { ok: true, doc: rest.length > 0 ? { ...doc, blurs: rest } : without };
}

/**
 * Where a box lands inside an area that shows `crop` of the video: a fraction
 * of the area, or null when the box is outside what it shows.
 */
export function blurInto(
  blur: BlurRect,
  crop: { x: number; y: number; w: number; h: number },
): BlurRect | null {
  const left = Math.max(blur.x, crop.x);
  const top = Math.max(blur.y, crop.y);
  const right = Math.min(blur.x + blur.w, crop.x + crop.w);
  const bottom = Math.min(blur.y + blur.h, crop.y + crop.h);
  if (right <= left || bottom <= top || crop.w <= 0 || crop.h <= 0) return null;
  return {
    x: (left - crop.x) / crop.w,
    y: (top - crop.y) / crop.h,
    w: (right - left) / crop.w,
    h: (bottom - top) / crop.h,
  };
}
