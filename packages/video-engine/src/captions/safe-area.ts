/**
 * The Safe Area Guide: where TikTok, Reels and Shorts draw their own buttons
 * and text over a vertical video, so captions can be kept clear of them.
 *
 * Two guides, as fractions of the canvas: the everyday one (the union of what
 * the three apps cover in normal use) and a strict one (the worst case, with
 * long captions and promoted buttons). The figures are reported in research
 * 06 section 2.4, not measured by us, so the guide is an aid in the editor
 * only: it is never drawn in an export and never refuses a position.
 */
import type { Ratio } from '../canvas';
import type { Rect } from '../geometry';

export interface SafeAreaGuide {
  /** Where captions are safe. */
  safe: Rect;
  /** The covered strips, for drawing the guide. */
  covered: Rect[];
}

const VERTICAL = {
  everyday: { top: 0.1, bottom: 0.2, left: 0.04, right: 0.14 },
  strict: { top: 0.14, bottom: 0.3, left: 0.06, right: 0.17 },
} as const;

export type SafeAreaLevel = keyof typeof VERTICAL;

/** The guide for a shape, or null when the shape has none (only a vertical clip is covered by app chrome). */
export function safeAreaGuide(ratio: Ratio, level: SafeAreaLevel = 'everyday'): SafeAreaGuide | null {
  if (ratio !== '9:16') return null;
  const inset = VERTICAL[level];
  const safe: Rect = {
    x: inset.left,
    y: inset.top,
    w: 1 - inset.left - inset.right,
    h: 1 - inset.top - inset.bottom,
  };
  return {
    safe,
    covered: [
      { x: 0, y: 0, w: 1, h: inset.top },
      { x: 0, y: 1 - inset.bottom, w: 1, h: inset.bottom },
      { x: 1 - inset.right, y: inset.top, w: inset.right, h: 1 - inset.top - inset.bottom },
    ],
  };
}

/** True when a box (fractions of the canvas) sits wholly inside the safe area. */
export function insideSafeArea(box: Rect, guide: SafeAreaGuide): boolean {
  const { safe } = guide;
  const epsilon = 1e-6;
  return (
    box.x >= safe.x - epsilon &&
    box.y >= safe.y - epsilon &&
    box.x + box.w <= safe.x + safe.w + epsilon &&
    box.y + box.h <= safe.y + safe.h + epsilon
  );
}
