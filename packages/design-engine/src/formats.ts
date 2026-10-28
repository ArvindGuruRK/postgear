/**
 * The four shapes a design can be, and the geometry every other file measures
 * against.
 *
 * The export sizes are the ones the platforms actually serve: 1080 on the
 * short edge for a feed post, 1080 x 1920 for a story, 1920 x 1080 for a
 * landscape image. Each is inside the composer's Instagram rule (4:5 to
 * 1.91:1) except Story, which Instagram takes as a story rather than a feed
 * post; the hint says where each one fits, and the composer has the final word.
 *
 * `safeArea` is the margin the content keeps from the edge, per axis. It is
 * not symmetric on purpose: 9% of a 1920px-tall story is 173px, which would
 * be a reasonable side margin and a wasteful top one, so the tall formats
 * take a smaller vertical percentage and end up with a similar real margin in
 * pixels.
 */
import type { FormatId, FormatSpec, Rect } from './types';

export const FORMATS: Record<FormatId, FormatSpec> = {
  square: {
    id: 'square',
    label: 'Square',
    ratio: '1:1',
    width: 1080,
    height: 1080,
    hint: 'Instagram, Facebook, LinkedIn and X feed posts',
    safeArea: { x: 8, y: 8 },
  },
  portrait: {
    id: 'portrait',
    label: 'Portrait',
    ratio: '4:5',
    width: 1080,
    height: 1350,
    hint: 'Instagram and Facebook portrait feed posts',
    safeArea: { x: 8, y: 6.5 },
  },
  story: {
    id: 'story',
    label: 'Story',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    hint: 'Stories, Reels and Shorts covers',
    safeArea: { x: 8, y: 9 },
  },
  landscape: {
    id: 'landscape',
    label: 'Landscape',
    ratio: '16:9',
    width: 1920,
    height: 1080,
    hint: 'X and LinkedIn link-style images, YouTube thumbnails',
    safeArea: { x: 6, y: 8 },
  },
};

/** Built from `FORMATS`, so a new format cannot be left out of the list. */
export const FORMAT_IDS = Object.keys(FORMATS) as [FormatId, ...FormatId[]];

/**
 * `Object.hasOwn`, not `in`: `'toString' in FORMATS` is true, and a lookup
 * guard that accepts the prototype's names is not a guard.
 */
export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && Object.hasOwn(FORMATS, value);
}

export function formatSpec(format: FormatId): FormatSpec {
  return FORMATS[format];
}

/**
 * The content box: the canvas minus the safe area, in percentages of the
 * canvas. Every region rectangle is relative to this, so a layout written
 * once sits correctly in all four shapes.
 */
export function contentBox(format: FormatId): Rect {
  const { safeArea } = FORMATS[format];
  return {
    x: safeArea.x,
    y: safeArea.y,
    w: 100 - safeArea.x * 2,
    h: 100 - safeArea.y * 2,
  };
}

/** Turns a rectangle in percentages of `parent` into percentages of the canvas. */
export function nest(parent: Rect, child: Rect): Rect {
  return {
    x: parent.x + (child.x / 100) * parent.w,
    y: parent.y + (child.y / 100) * parent.h,
    w: (child.w / 100) * parent.w,
    h: (child.h / 100) * parent.h,
  };
}

/** Percentages carry floating-point noise; a hundredth of a percent is below a pixel. */
const RECT_EPSILON = 0.01;

/** Whether `outer` covers all of `inner`. */
export function coversRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - RECT_EPSILON &&
    inner.y >= outer.y - RECT_EPSILON &&
    inner.x + inner.w <= outer.x + outer.w + RECT_EPSILON &&
    inner.y + inner.h <= outer.y + outer.h + RECT_EPSILON
  );
}

/** Whether two rectangles share any area. Edges that only touch do not count. */
export function overlapsRect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - RECT_EPSILON &&
    b.x < a.x + a.w - RECT_EPSILON &&
    a.y < b.y + b.h - RECT_EPSILON &&
    b.y < a.y + a.h - RECT_EPSILON
  );
}

/**
 * The short edge in pixels: what `TypeStyle.size` is a percentage of, so a
 * headline is the same physical size in a square and in a story rather than
 * doubling with the taller canvas.
 */
export function shortEdge(format: FormatId): number {
  const { width, height } = FORMATS[format];
  return Math.min(width, height);
}

/** "1080 x 1350", for the format card and the export message. */
export function exportSizeLabel(format: FormatId): string {
  const { width, height } = FORMATS[format];
  return `${width} x ${height}`;
}
