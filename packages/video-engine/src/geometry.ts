/**
 * Rectangles and points as fractions.
 *
 * Every position in a clip document is a fraction of something: a crop is a
 * fraction of the video's picture, an area's frame a fraction of the canvas,
 * a sticker's centre a fraction of the canvas. Fractions survive a change of
 * export size and a video whose sharp copy is taller than its light copy, so
 * pixels are worked out exactly once, when a render plan is built.
 */

/** `x`, `y` is the top left corner; `w`, `h` the size. All 0 to 1. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The whole picture. */
export const FULL_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/** Smallest side a crop or a frame may have, so a box can never collapse to nothing. */
export const MIN_RECT_SIDE = 0.02;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Keeps a rectangle inside the unit square with at least `MIN_RECT_SIDE` on
 * each side. The size is clamped first and the position second, so a box
 * dragged past an edge slides along it instead of shrinking.
 */
export function clampRect(rect: Rect): Rect {
  const w = Math.min(1, Math.max(MIN_RECT_SIDE, Number.isFinite(rect.w) ? rect.w : 1));
  const h = Math.min(1, Math.max(MIN_RECT_SIDE, Number.isFinite(rect.h) ? rect.h : 1));
  const x = Math.min(1 - w, clamp01(rect.x));
  const y = Math.min(1 - h, clamp01(rect.y));
  return { x, y, w, h };
}

/** Width over height of a fractional rectangle drawn on a surface of `surfaceAspect`. */
export function rectAspect(rect: Rect, surfaceAspect = 1): number {
  return (rect.w * surfaceAspect) / rect.h;
}

/**
 * The largest rectangle of `aspect` (width over height, in real proportions)
 * that fits inside `into`, centred. `surfaceAspect` is the real width over
 * height of the surface the fractions are measured on (a 1920 by 1080 video
 * is 16/9), because a fraction of a wide picture is not a fraction of a tall
 * one.
 */
export function fitRect(aspect: number, into: Rect = FULL_RECT, surfaceAspect = 1): Rect {
  if (!(aspect > 0) || !(surfaceAspect > 0)) {
    return { ...into };
  }

  const intoAspect = rectAspect(into, surfaceAspect);

  if (intoAspect > aspect) {
    // `into` is wider than wanted: keep the height, narrow the width.
    const w = (into.h * aspect) / surfaceAspect;
    return { x: into.x + (into.w - w) / 2, y: into.y, w, h: into.h };
  }

  const h = (into.w * surfaceAspect) / aspect;
  return { x: into.x, y: into.y + (into.h - h) / 2, w: into.w, h };
}

/** The centre of a rectangle. */
export function rectCentre(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Whether two rectangles are equal to within `epsilon`. */
export function rectsEqual(a: Rect, b: Rect, epsilon = 1e-9): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon &&
    Math.abs(a.h - b.h) <= epsilon
  );
}
