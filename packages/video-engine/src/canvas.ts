/**
 * The shapes a clip can be.
 *
 * The canvas is always stored at the 1080 short side: a document's pixel
 * numbers (a camera box's rounded corner, a text size) are in these units,
 * and a render multiplies them by the export quality's scale exactly once.
 */

export const RATIOS = ['9:16', '16:9', '1:1', '4:5'] as const;
export type Ratio = (typeof RATIOS)[number];

export interface CanvasSize {
  width: number;
  height: number;
}

export const CANVASES: Readonly<Record<Ratio, CanvasSize>> = Object.freeze({
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
});

/** What the shape dialog calls each ratio. */
export const RATIO_LABELS: Readonly<Record<Ratio, string>> = Object.freeze({
  '9:16': 'Vertical',
  '16:9': 'Horizontal',
  '1:1': 'Square',
  '4:5': 'Portrait',
});

export const CANVAS_FPS = [30, 60] as const;
export type CanvasFps = (typeof CANVAS_FPS)[number];

export function isRatio(value: unknown): value is Ratio {
  return typeof value === 'string' && (RATIOS as readonly string[]).includes(value);
}

/** Real width over height of a canvas shape. */
export function ratioAspect(ratio: Ratio): number {
  const { width, height } = CANVASES[ratio];
  return width / height;
}
