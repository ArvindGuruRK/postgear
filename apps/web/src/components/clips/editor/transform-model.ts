/**
 * The handle maths of the clip's stage (Module 11 section 5), as pure
 * functions in **canvas pixels** (the document's 1080-wide canvas). The
 * layer divides every pointer position by the stage scale before it gets
 * here, so nothing below knows the size of the screen.
 *
 * - An item's **frame** is its centre, its size and its clockwise turn. A
 *   text's width is its wrapping box (`widthPx x scale`); its height is what
 *   the preview measured (one line until then). A sticker's frame is its
 *   box (Module 12).
 * - **Move** snaps the frame's edges and centre to the canvas edges and
 *   centre lines and to the other items' edges and centres, within 6 screen
 *   pixels, unless Alt is held. At least a quarter of the item stays on the
 *   clip.
 * - **Corner handles** scale about the opposite corner, keeping the shape;
 *   **side handles** change a text's box width about the opposite side.
 * - **The round handle** turns the item about its centre, snapping at 0, 90,
 *   180 and 270 degrees within 5.
 */
import {
  type ClipDocument,
  FONT_MANIFEST,
  type FontManifest,
  lineHeightEm,
  resolveTextFont,
  type StickerItem,
  TEXT_WIDTH_MAX,
  TEXT_WIDTH_MIN,
  type TextItem,
  textGeometry,
} from '@postgear/video-engine';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** An item on the canvas: centre, size and clockwise turn, canvas pixels and degrees. */
export interface ItemFrame {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** The items the stage can hold: texts now, stickers from Module 12. */
export type StageItem = TextItem | StickerItem;

/** How near, in screen pixels, a move snaps to a guide. */
export const SNAP_SCREEN_PX = 6;
/** How near, in degrees, a turn snaps to a quarter turn. */
export const ROTATE_SNAP_DEG = 5;
/** Arrow keys move this many canvas pixels; with Shift, the larger step. */
export const NUDGE_PX = 1;
export const NUDGE_BIG_PX = 10;
/** The scale a corner drag stays within (the schema allows up to 10). */
export const SCALE_MIN = 0.1;
export const SCALE_MAX = 10;
/** A text's handles: the corners scale, the two sides widen the box. */
export const TEXT_HANDLES = ['nw', 'ne', 'se', 'sw', 'e', 'w'] as const;
/** The handles for something with a fixed shape (a sticker). */
export const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'] as const;

export type CornerHandle = (typeof CORNER_HANDLES)[number];
export type SideHandle = 'e' | 'w';

const RAD = Math.PI / 180;

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

// ---------------------------------------------------------------------------
// What is on the stage
// ---------------------------------------------------------------------------

/**
 * The texts and stickers showing at `ms` (output time), in drawing order
 * (track order, then time): the same rule as `frameState`, so the handles
 * only ever offer what the picture shows.
 */
export function overlaysAt(doc: ClipDocument, ms: number): StageItem[] {
  const t = Math.round(Number.isFinite(ms) ? ms : 0);
  const shown: StageItem[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (t >= item.start && t < item.start + item.duration) shown.push(item);
    }
  }
  return shown;
}

/** One line of a text, canvas pixels: the height the handles use until the preview has measured it. */
export function estimatedTextHeight(
  item: TextItem,
  manifest: FontManifest = FONT_MANIFEST,
): number {
  const font = resolveTextFont(manifest, item.style.font, item.style.weight);
  return item.style.size * item.transform.scale * (font ? lineHeightEm(font) : 1.2);
}

/** A text's frame: its wrapping box, as tall as the preview measured it. */
export function textFrame(item: TextItem, canvas: Size, measuredHeight?: number): ItemFrame {
  const g = textGeometry(item, canvas);
  const height =
    measuredHeight !== undefined && measuredHeight > 0 ? measuredHeight : estimatedTextHeight(item);
  return {
    id: item.id,
    cx: g.cx,
    cy: g.cy,
    width: g.boxWidth,
    height,
    rotation: item.transform.rotation,
  };
}

/**
 * A sticker's frame: its box (`widthPx x scale` by `heightPx x scale`)
 * centred on the item, the same box the preview draws and the export scales
 * the picture to. A Follow Badge is the same: its box is its pill.
 */
export function stickerFrame(item: StickerItem, canvas: Size): ItemFrame {
  return {
    id: item.id,
    cx: item.transform.x * canvas.width,
    cy: item.transform.y * canvas.height,
    width: item.widthPx * item.transform.scale,
    height: item.heightPx * item.transform.scale,
    rotation: item.transform.rotation,
  };
}

/** Any stage item's frame (a text's height as measured, when known). */
export function itemFrame(item: StageItem, canvas: Size, measuredHeight?: number): ItemFrame {
  return item.type === 'text' ? textFrame(item, canvas, measuredHeight) : stickerFrame(item, canvas);
}

/**
 * The items on screen in the order they are drawn, bottom first: picture
 * stickers under every text (the export overlays them before its text
 * layer), then texts and Follow Badges in track order. The handles hit-test
 * topmost first, so a press picks what the eye sees on top.
 */
export function drawingOrder(items: readonly StageItem[]): StageItem[] {
  const isPicture = (item: StageItem) => item.type === 'sticker' && !('badge' in item.ref);
  return [...items.filter(isPicture), ...items.filter((item) => !isPicture(item))];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Turns a vector clockwise by `deg` (screen coordinates: y grows down). */
export function rotate(v: Point, deg: number): Point {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** A canvas point in the frame's own unturned coordinates, from its centre. */
export function toLocal(frame: ItemFrame, point: Point): Point {
  return rotate({ x: point.x - frame.cx, y: point.y - frame.cy }, -frame.rotation);
}

/** A point of the frame (its own coordinates, from the centre) on the canvas. */
export function toCanvas(frame: ItemFrame, local: Point): Point {
  const v = rotate(local, frame.rotation);
  return { x: frame.cx + v.x, y: frame.cy + v.y };
}

/** The topmost item under `point` (the last drawn wins), or null. `slop` widens every frame. */
export function hitTest(frames: readonly ItemFrame[], point: Point, slop = 0): string | null {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i] as ItemFrame;
    const local = toLocal(frame, point);
    if (
      Math.abs(local.x) <= frame.width / 2 + slop &&
      Math.abs(local.y) <= frame.height / 2 + slop
    ) {
      return frame.id;
    }
  }
  return null;
}

/** Half the width and height of the box the turned frame fills. */
export function halfExtents(frame: Pick<ItemFrame, 'width' | 'height' | 'rotation'>): {
  hw: number;
  hh: number;
} {
  const c = Math.abs(Math.cos(frame.rotation * RAD));
  const s = Math.abs(Math.sin(frame.rotation * RAD));
  return {
    hw: (frame.width * c + frame.height * s) / 2,
    hh: (frame.width * s + frame.height * c) / 2,
  };
}

/**
 * Keeps a centre where at least a quarter of the item's box is on the
 * canvas, and inside what the document allows (half a canvas past each edge).
 */
export function keepOnCanvas(
  cx: number,
  cy: number,
  frame: Pick<ItemFrame, 'width' | 'height' | 'rotation'>,
  canvas: Size,
): Point {
  const { hw, hh } = halfExtents(frame);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(
      cx,
      Math.max(-hw / 2, -canvas.width / 2),
      Math.min(canvas.width + hw / 2, canvas.width * 1.5),
    ),
    y: clamp(
      cy,
      Math.max(-hh / 2, -canvas.height / 2),
      Math.min(canvas.height + hh / 2, canvas.height * 1.5),
    ),
  };
}

// ---------------------------------------------------------------------------
// Move, with snapping
// ---------------------------------------------------------------------------

/** The lines a move snapped to, canvas pixels: upright lines at these x, level lines at these y. */
export interface Guides {
  x: number[];
  y: number[];
}

export const NO_GUIDES: Guides = Object.freeze({ x: [], y: [] }) as Guides;

export interface MoveResult {
  cx: number;
  cy: number;
  guides: Guides;
}

/** Where a moving item's edges and centre may snap to on one axis. */
function snapTargets(
  canvasLength: number,
  others: readonly ItemFrame[],
  axis: 'x' | 'y',
): number[] {
  const targets = [0, canvasLength / 2, canvasLength];
  for (const other of others) {
    const { hw, hh } = halfExtents(other);
    const c = axis === 'x' ? other.cx : other.cy;
    const h = axis === 'x' ? hw : hh;
    targets.push(c - h, c, c + h);
  }
  return targets;
}

/** The shift that puts the nearest of `offsets` (from `centre`) on a target, within `threshold`. */
function snapAxis(
  centre: number,
  half: number,
  targets: readonly number[],
  threshold: number,
): { shift: number; lines: number[] } {
  let best: number | null = null;
  for (const offset of [-half, 0, half]) {
    for (const target of targets) {
      const shift = target - (centre + offset);
      if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best))) {
        best = shift;
      }
    }
  }
  if (best === null) return { shift: 0, lines: [] };
  const moved = centre + best;
  const lines = new Set<number>();
  for (const offset of [-half, 0, half]) {
    for (const target of targets) {
      if (Math.abs(target - (moved + offset)) < 0.5) lines.add(round(target, 2));
    }
  }
  return { shift: best, lines: [...lines].sort((a, b) => a - b) };
}

/**
 * A frame moved by `delta` (canvas pixels), snapped unless `snap` is false.
 * `threshold` is in canvas pixels (the layer passes 6 screen pixels over the
 * stage scale). The quarter-on-canvas rule has the last word.
 */
export function moveFrame(
  frame: ItemFrame,
  delta: Point,
  canvas: Size,
  others: readonly ItemFrame[],
  options: { snap: boolean; threshold: number },
): MoveResult {
  let cx = frame.cx + delta.x;
  let cy = frame.cy + delta.y;
  let guides: Guides = NO_GUIDES;
  if (options.snap) {
    const { hw, hh } = halfExtents(frame);
    const sx = snapAxis(cx, hw, snapTargets(canvas.width, others, 'x'), options.threshold);
    const sy = snapAxis(cy, hh, snapTargets(canvas.height, others, 'y'), options.threshold);
    cx += sx.shift;
    cy += sy.shift;
    if (sx.lines.length > 0 || sy.lines.length > 0) guides = { x: sx.lines, y: sy.lines };
  }
  const kept = keepOnCanvas(cx, cy, frame, canvas);
  if (kept.x !== cx) guides = { ...guides, x: [] };
  if (kept.y !== cy) guides = { ...guides, y: [] };
  return { cx: kept.x, cy: kept.y, guides };
}

/** An arrow key's step: 1 canvas pixel, 10 with Shift, kept on the canvas. */
export function nudgeFrame(frame: ItemFrame, direction: Point, big: boolean, canvas: Size): Point {
  const step = big ? NUDGE_BIG_PX : NUDGE_PX;
  return keepOnCanvas(frame.cx + direction.x * step, frame.cy + direction.y * step, frame, canvas);
}

// ---------------------------------------------------------------------------
// Scale, widen, turn
// ---------------------------------------------------------------------------

const cornerSigns = (handle: CornerHandle): Point => ({
  x: handle.includes('e') ? 1 : -1,
  y: handle.includes('s') ? 1 : -1,
});

export interface ScaleResult {
  /** The item's new `transform.scale`. */
  scale: number;
  cx: number;
  cy: number;
}

/**
 * A corner dragged to `pointer`: the item grows or shrinks about the
 * opposite corner, keeping its shape. `startScale` is the item's scale when
 * the drag began (the frame is its size then).
 */
export function scaleFromCorner(
  frame: ItemFrame,
  handle: CornerHandle,
  pointer: Point,
  startScale: number,
): ScaleResult {
  const sign = cornerSigns(handle);
  const opposite = toCanvas(frame, {
    x: (-sign.x * frame.width) / 2,
    y: (-sign.y * frame.height) / 2,
  });
  const diag = { x: sign.x * frame.width, y: sign.y * frame.height };
  const reach = rotate({ x: pointer.x - opposite.x, y: pointer.y - opposite.y }, -frame.rotation);
  const length = diag.x * diag.x + diag.y * diag.y;
  const raw = length > 0 ? (reach.x * diag.x + reach.y * diag.y) / length : 1;
  const k = Math.min(SCALE_MAX / startScale, Math.max(SCALE_MIN / startScale, raw));
  const half = rotate({ x: (diag.x * k) / 2, y: (diag.y * k) / 2 }, frame.rotation);
  return {
    scale: round(startScale * k, 4),
    cx: opposite.x + half.x,
    cy: opposite.y + half.y,
  };
}

export interface WidenResult {
  /** The text's new `widthPx` (before its scale). */
  widthPx: number;
  cx: number;
  cy: number;
}

/** A side handle of a text dragged to `pointer`: the box widens about the opposite side. */
export function widenFromSide(
  frame: ItemFrame,
  handle: SideHandle,
  pointer: Point,
  scale: number,
): WidenResult {
  const sign = handle === 'e' ? 1 : -1;
  const opposite = toCanvas(frame, { x: (-sign * frame.width) / 2, y: 0 });
  const reach = rotate({ x: pointer.x - opposite.x, y: pointer.y - opposite.y }, -frame.rotation);
  const width = Math.min(TEXT_WIDTH_MAX * scale, Math.max(TEXT_WIDTH_MIN * scale, sign * reach.x));
  const half = rotate({ x: (sign * width) / 2, y: 0 }, frame.rotation);
  return {
    widthPx: Math.round(width / scale),
    cx: opposite.x + half.x,
    cy: opposite.y + half.y,
  };
}

/** An angle in degrees as -180 (exclusive) to 180. */
export function normaliseDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** A turn snapped to the nearest quarter turn when within `ROTATE_SNAP_DEG`. */
export function snapRotation(deg: number): number {
  const d = normaliseDegrees(deg);
  for (const quarter of [-180, -90, 0, 90, 180]) {
    if (Math.abs(d - quarter) <= ROTATE_SNAP_DEG) return quarter === -180 ? 180 : quarter;
  }
  return d;
}

/**
 * The turning handle dragged from `from` to `to` (canvas points): the item
 * turns about its centre by the angle swept, from `startRotation`.
 */
export function rotateAbout(
  centre: Point,
  startRotation: number,
  from: Point,
  to: Point,
  snap: boolean,
): number {
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
  const a1 = Math.atan2(to.y - centre.y, to.x - centre.x);
  const turned = normaliseDegrees(startRotation + (a1 - a0) / RAD);
  return round(snap ? snapRotation(turned) : turned, 1);
}

// ---------------------------------------------------------------------------
// Screen and document
// ---------------------------------------------------------------------------

/**
 * A pointer on screen as a canvas point: its offset from the stage's top
 * left, divided by the stage scale (how many screen pixels a canvas pixel
 * takes).
 */
export function screenToCanvas(client: Point, stageOrigin: Point, stageScale: number): Point {
  const scale = stageScale > 0 ? stageScale : 1;
  return { x: (client.x - stageOrigin.x) / scale, y: (client.y - stageOrigin.y) / scale };
}

/** A centre in canvas pixels as the document's fractions (kept to a hundredth of a pixel). */
export function centreToTransform(cx: number, cy: number, canvas: Size): { x: number; y: number } {
  return {
    x: round(cx / canvas.width, 6),
    y: round(cy / canvas.height, 6),
  };
}
