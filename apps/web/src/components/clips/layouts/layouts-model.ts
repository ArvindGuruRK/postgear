/**
 * The Layouts tab's pure parts (Sprint 12, Module 10): the shapes and
 * layouts it offers, the words it uses, the four area colours, and the crop
 * box gestures on the Video pane (move, resize keeping the shape, snapping,
 * the arrow keys).
 *
 * Crops are fractions of the video (0 to 1 on each side), as the document
 * stores them. A gesture is always worked out from the crop it began on and
 * the pointer's whole movement since, so a long drag never drifts, and
 * pointer pixels are turned into fractions by the size the video is drawn
 * at on the pane (the rule Module 11's handles follow).
 *
 * Pure: no React, no DOM.
 */
import {
  CANVASES,
  type ClipDocument,
  type ClipLayout,
  type FitCrop,
  FULL_RECT,
  fitRect,
  type LayoutArea,
  type LayoutBase,
  type LayoutKind,
  layoutBase,
  layoutsFor,
  MAX_AREAS,
  PRESET_LABELS,
  type PresetKind,
  presetFor,
  RATIO_LABELS,
  type Ratio,
  type Rect,
} from '@postgear/video-engine';

// ---------------------------------------------------------------------------
// Shapes and layouts
// ---------------------------------------------------------------------------

/** The shapes the tab offers, in its order. */
export const LAYOUT_SHAPES = ['9:16', '16:9', '1:1', '4:5'] as const satisfies readonly Ratio[];

/** A shape's name: Vertical, Horizontal, Square, Portrait. */
export function layoutShapeName(ratio: Ratio): string {
  return RATIO_LABELS[ratio];
}

/** The line under the shape switch, naming the shape in full and what it is for. */
export const SHAPE_READBACK: Readonly<Record<Ratio, string>> = Object.freeze({
  '9:16': 'Vertical 9:16, for TikTok, Shorts and Reels.',
  '16:9': 'Horizontal 16:9, for YouTube.',
  '1:1': 'Square 1:1, for feeds.',
  '4:5': 'Portrait 4:5, for Instagram and Facebook feeds.',
});

/** The layouts a shape offers, with their names: seven, or two for Horizontal. */
export function layoutChoices(ratio: Ratio): Array<{ kind: PresetKind; label: string }> {
  return layoutsFor(ratio).map((kind) => ({ kind, label: PRESET_LABELS[kind] }));
}

/** The Blurred layout's Crop Ratio choices. */
export const FIT_CROP_CHOICES: ReadonlyArray<{ value: FitCrop; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
];

/** The line under the tiles once the crops no longer follow a preset. */
export const CUSTOM_SENTENCE = 'Custom layout, arranged by hand. Pick a layout to start again.';
/** Add Crop's reason when the layout is full. */
export const CROP_LIMIT_SENTENCE = `A layout can have at most ${MAX_AREAS} crops.`;
/** Remove's reason on the last crop. */
export const LAST_CROP_SENTENCE = 'A layout needs at least one crop.';
/** The Video pane without a video to show. */
export const NO_VIDEO_SENTENCE = 'The video cannot be shown, but the crops still work.';

/** The tile marked as chosen: the layout's kind, or none for Custom. */
export function chosenLayout(kind: LayoutKind): PresetKind | null {
  return kind === 'custom' ? null : kind;
}

// ---------------------------------------------------------------------------
// Drawings of a layout (the tiles and saved layouts)
// ---------------------------------------------------------------------------

/** One box of a layout's drawing, in fractions of the canvas. */
export interface DrawingBox {
  rect: Rect;
  /** Rounded corners in canvas pixels (the 1080 short side); 0 for none. */
  radius: number;
}

export interface LayoutDrawingModel {
  /** The canvas size the boxes are fractions of (its shape is the drawing's). */
  width: number;
  height: number;
  base: LayoutBase;
  boxes: DrawingBox[];
}

/** What a typical stream looks like, for drawing a contain area (the video sits in the middle). */
const DRAWING_VIDEO_ASPECT = 16 / 9;

function drawingOf(
  ratio: Ratio,
  base: LayoutBase,
  areas: ReadonlyArray<Pick<LayoutArea, 'frame' | 'fit' | 'radius'>>,
): LayoutDrawingModel {
  const { width, height } = CANVASES[ratio];
  return {
    width,
    height,
    base,
    boxes: areas.map((area) => ({
      // A contain area shows the whole video inside its frame, not the frame itself.
      rect:
        area.fit === 'contain'
          ? fitRect(DRAWING_VIDEO_ASPECT, area.frame, width / height)
          : { ...area.frame },
      radius: area.radius ?? 0,
    })),
  };
}

/** The drawing of a preset at a shape, or null when the shape does not offer it. */
export function presetDrawing(kind: PresetKind, ratio: Ratio): LayoutDrawingModel | null {
  const preset = presetFor(kind, ratio);
  return preset ? drawingOf(ratio, preset.base, preset.areas) : null;
}

/** The drawing of a saved layout (or the clip's own). */
export function layoutDrawing(ratio: Ratio, layout: ClipLayout): LayoutDrawingModel {
  return drawingOf(ratio, layoutBase(layout), layout.areas);
}

// ---------------------------------------------------------------------------
// Area colours
// ---------------------------------------------------------------------------

export type AreaTone = 'primary' | 'success' | 'accent' | 'warning';

/** Four fixed theme colours, by the area's place (violet is Find Clips' alone, red reads as a fault). */
export const AREA_TONES: readonly AreaTone[] = ['primary', 'success', 'accent', 'warning'];

export const AREA_TONE_CLASSES: Readonly<
  Record<AreaTone, { border: string; fill: string; on: string; tint: string; ring: string }>
> = Object.freeze({
  primary: {
    border: 'border-actionPrimary',
    fill: 'bg-actionPrimary',
    on: 'text-onActionPrimary',
    tint: 'bg-actionPrimary/15',
    ring: 'outline-actionPrimary',
  },
  success: {
    border: 'border-actionSuccess',
    fill: 'bg-actionSuccess',
    on: 'text-onActionLight',
    tint: 'bg-actionSuccess/15',
    ring: 'outline-actionSuccess',
  },
  accent: {
    border: 'border-actionAccent',
    fill: 'bg-actionAccent',
    on: 'text-onActionLight',
    tint: 'bg-actionAccent/15',
    ring: 'outline-actionAccent',
  },
  warning: {
    border: 'border-actionSecondary',
    fill: 'bg-actionSecondary',
    on: 'text-onActionLight',
    tint: 'bg-actionSecondary/15',
    ring: 'outline-actionSecondary',
  },
});

export function areaTone(index: number): AreaTone {
  return AREA_TONES[((index % AREA_TONES.length) + AREA_TONES.length) % AREA_TONES.length];
}

/**
 * A crop box's spoken name: "Camera Crop". A name that already says crop as
 * a word ("Crop 3", "Face Crop", "crop") is kept as it is, never "Face Crop
 * Crop".
 */
export function cropName(area: Pick<LayoutArea, 'name'>): string {
  const name = area.name.trim();
  return /(^|\s)crop(\s|$)/i.test(name) ? name : `${name} Crop`;
}

/**
 * The name Add Crop gives: "Crop 3" for the third, or the next number no
 * crop already uses (any case), so two crops never share a tag.
 */
export function nextCropName(areas: readonly Pick<LayoutArea, 'name'>[]): string {
  const taken = new Set(areas.map((area) => area.name.trim().toLowerCase()));
  for (let n = areas.length + 1; ; n += 1) {
    const name = `Crop ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// ---------------------------------------------------------------------------
// Crop gestures
// ---------------------------------------------------------------------------

/** The smallest a crop gets on its shorter side, as a fraction of the video. */
export const MIN_CROP_SIDE = 0.05;
/** How close, in screen pixels, an edge has to come to a line to snap to it. */
export const CROP_SNAP_PX = 8;
/** The crop boxes' own snapping switch, kept in this browser apart from the timeline's. */
export const CROP_SNAP_STORAGE_KEY = 'postgear.clips.cropSnapping';
/** An arrow key moves the selected crop this much of the video; with Shift, `CROP_NUDGE_BIG`. */
export const CROP_NUDGE = 0.01;
export const CROP_NUDGE_BIG = 0.05;

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The pane's drawn video size in screen pixels, for turning pixels into fractions. */
export interface PaneSize {
  width: number;
  height: number;
}

/** Lines the crop snapped to, as fractions of the video (vertical lines at `x`, horizontal at `y`). */
export interface CropGuides {
  x: number[];
  y: number[];
}

export const NO_GUIDES: CropGuides = Object.freeze({ x: [], y: [] }) as CropGuides;

export interface CropResult {
  rect: Rect;
  guides: CropGuides;
}

/** The lines a crop can snap to: the video's edges and centre lines, and the other crops' edges. */
export interface SnapLines {
  x: number[];
  y: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** The snap lines for dragging one crop, given the others. */
export function cropSnapLines(others: readonly Rect[]): SnapLines {
  const x = [0, 0.5, 1];
  const y = [0, 0.5, 1];
  for (const rect of others) {
    x.push(rect.x, rect.x + rect.w);
    y.push(rect.y, rect.y + rect.h);
  }
  return { x, y };
}

/** The nearest line to any of `values` within `limit` (fractions), as the shift to it. */
function nearest(
  values: readonly number[],
  lines: readonly number[],
  limit: number,
): { shift: number; line: number } | null {
  let best: { shift: number; line: number } | null = null;
  for (const value of values) {
    for (const line of lines) {
      const shift = line - value;
      if (Math.abs(shift) <= limit && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, line };
      }
    }
  }
  return best;
}

/** Fractions `px` screen pixels make on a side of `sidePx`; nothing snaps on a pane not laid out. */
function snapLimit(sidePx: number): number {
  return sidePx > 0 ? CROP_SNAP_PX / sidePx : -1;
}

/**
 * The crop moved by `dx`, `dy` (fractions of the video), kept whole inside
 * the video: it slides along an edge rather than shrinking. With `snap`, its
 * edges and centre snap to the nearest line within `CROP_SNAP_PX`.
 */
export function moveCrop(
  start: Rect,
  dx: number,
  dy: number,
  snap?: { lines: SnapLines; pane: PaneSize },
): CropResult {
  let x = clamp(start.x + finite(dx), 0, 1 - start.w);
  let y = clamp(start.y + finite(dy), 0, 1 - start.h);
  const guides: CropGuides = { x: [], y: [] };
  if (snap) {
    const sx = nearest([x, x + start.w / 2, x + start.w], snap.lines.x, snapLimit(snap.pane.width));
    if (sx) {
      const snapped = x + sx.shift;
      if (snapped >= -1e-9 && snapped + start.w <= 1 + 1e-9) {
        x = clamp(snapped, 0, 1 - start.w);
        guides.x.push(sx.line);
      }
    }
    const sy = nearest(
      [y, y + start.h / 2, y + start.h],
      snap.lines.y,
      snapLimit(snap.pane.height),
    );
    if (sy) {
      const snapped = y + sy.shift;
      if (snapped >= -1e-9 && snapped + start.h <= 1 + 1e-9) {
        y = clamp(snapped, 0, 1 - start.h);
        guides.y.push(sy.line);
      }
    }
  }
  return { rect: { x, y, w: start.w, h: start.h }, guides };
}

interface HandleSides {
  /** 1 when the handle moves the right edge, -1 the left, 0 neither. */
  sx: -1 | 0 | 1;
  /** 1 when it moves the bottom edge, -1 the top, 0 neither. */
  sy: -1 | 0 | 1;
}

function sidesOf(handle: CropHandle): HandleSides {
  return {
    sx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    sy: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  };
}

/**
 * The crop at width `w` (fractions), keeping its shape and the edge (or
 * corner) opposite the handle where it is; a side handle keeps the middle
 * of the other direction, sliding it to stay inside. The width is held
 * between the smallest crop and the largest that fits.
 */
function cropAtWidth(start: Rect, handle: CropHandle, wanted: number): Rect {
  const { sx, sy } = sidesOf(handle);
  const k = start.h > 0 ? start.w / start.h : 1;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const roomX = sx === 1 ? 1 - start.x : sx === -1 ? right : 1;
  const roomY = sy === 1 ? 1 - start.y : sy === -1 ? bottom : 1;
  const maxW = Math.max(0, Math.min(roomX, roomY * k));
  const minW = Math.min(maxW, Math.max(MIN_CROP_SIDE, MIN_CROP_SIDE * k));
  const w = clamp(finite(wanted), minW, maxW);
  const h = w / k;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const x = sx === 1 ? start.x : sx === -1 ? right - w : clamp(cx - w / 2, 0, 1 - w);
  const y = sy === 1 ? start.y : sy === -1 ? bottom - h : clamp(cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/**
 * The crop resized from `handle` by `dx`, `dy` (fractions of the video).
 * The shape never changes: a corner follows whichever of the two directions
 * changes the box more (so it shrinks as readily as it grows); a side handle scales the whole box around
 * its opposite edge. It never leaves the video and never gets smaller than
 * `MIN_CROP_SIDE`. With `snap`, the moving edge snaps to the nearest line.
 */
export function resizeCrop(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  snap?: { lines: SnapLines; pane: PaneSize },
): CropResult {
  const { sx, sy } = sidesOf(handle);
  const k = start.h > 0 ? start.w / start.h : 1;
  const fromX = start.w + sx * finite(dx);
  const fromY = (start.h + sy * finite(dy)) * k;
  // A corner follows the direction the pointer moved the box more in, growing or shrinking.
  const wanted =
    sx !== 0 && sy !== 0
      ? Math.abs(fromX - start.w) >= Math.abs(fromY - start.w)
        ? fromX
        : fromY
      : sx !== 0
        ? fromX
        : fromY;
  const rect = cropAtWidth(start, handle, wanted);
  if (!snap) return { rect, guides: NO_GUIDES };

  // The edges this handle moves, and the width that would put each on a line.
  const options: Array<{ px: number; w: number; guides: CropGuides }> = [];
  if (sx !== 0) {
    const edge = sx === 1 ? rect.x + rect.w : rect.x;
    const hit = nearest([edge], snap.lines.x, snapLimit(snap.pane.width));
    if (hit) {
      const w = rect.w + sx * hit.shift;
      options.push({
        px: Math.abs(hit.shift) * snap.pane.width,
        w,
        guides: { x: [hit.line], y: [] },
      });
    }
  }
  if (sy !== 0) {
    const edge = sy === 1 ? rect.y + rect.h : rect.y;
    const hit = nearest([edge], snap.lines.y, snapLimit(snap.pane.height));
    if (hit) {
      const h = rect.h + sy * hit.shift;
      options.push({
        px: Math.abs(hit.shift) * snap.pane.height,
        w: h * k,
        guides: { x: [], y: [hit.line] },
      });
    }
  }
  options.sort((a, b) => a.px - b.px);
  for (const option of options) {
    const snapped = cropAtWidth(start, handle, option.w);
    // Only when the limits left the box where the snap put it.
    if (Math.abs(snapped.w - option.w) < 1e-9) {
      return { rect: snapped, guides: option.guides };
    }
  }
  return { rect, guides: NO_GUIDES };
}

/** The crop an arrow key moves it to, or null for any other key. */
export function nudgeCrop(start: Rect, key: string, big: boolean): Rect | null {
  const step = big ? CROP_NUDGE_BIG : CROP_NUDGE;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[key];
  return move ? moveCrop(start, move[0], move[1]).rect : null;
}

/** Whether two crops are the same box (a drag let go where it began is no undo step). */
export function sameCrop(a: Rect, b: Rect): boolean {
  const close = (p: number, q: number) => Math.abs(p - q) < 1e-6;
  return close(a.x, b.x) && close(a.y, b.y) && close(a.w, b.w) && close(a.h, b.h);
}

/** An area's crop as Sprint 12 stores it: its first keyframe, the whole video when it has none. */
export function firstCropOf(area: Pick<LayoutArea, 'crop'>): Rect {
  return { ...(area.crop[0]?.rect ?? FULL_RECT) };
}

/** Whether any area's crop changes over time (Sprint 13's Follow The Speaker writes several). */
export function cropsMove(doc: Pick<ClipDocument, 'layout'>): boolean {
  return doc.layout.areas.some((area) => area.crop.length > 1);
}

/**
 * The corner radius a crop box shows on the pane, in screen pixels: the
 * area's rounded corner on the clip, at the size this crop is drawn on the
 * video. Contain areas and square corners give 0.
 */
export function cropBoxRadius(
  area: Pick<LayoutArea, 'radius' | 'fit' | 'frame'>,
  crop: Rect,
  pane: PaneSize,
  canvasWidth: number,
): number {
  if (!area.radius || area.fit !== 'cover' || area.frame.w <= 0 || canvasWidth <= 0) return 0;
  const onPane = crop.w * pane.width;
  const onCanvas = area.frame.w * canvasWidth;
  return Math.max(0, (area.radius * onPane) / onCanvas);
}

// ---------------------------------------------------------------------------
// Saved layouts
// ---------------------------------------------------------------------------

export const MAX_SAVED_LAYOUT_NAME = 60;
export const SAVED_LAYOUTS_FAILED =
  'Your saved layouts did not load. Check your connection and try again.';
export const SAVE_UNREACHABLE = 'That did not go through. Check your connection and try again.';

/** The line in My Layouts with nothing saved for this shape yet. */
export function noSavedLayoutsSentence(ratio: Ratio): string {
  return `No saved layouts for ${layoutShapeName(ratio)} clips yet. Arrange the crops, then save the layout to use it on other clips.`;
}

/** Whether a character is a control character (the API strips them too). */
function isControl(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code < 32 || code === 127;
}

/**
 * A layout name as typed, ready to send: control characters out, white
 * space made single and trimmed, as the API cleans it; empty is null.
 */
export function cleanLayoutName(draft: string): string | null {
  const visible = Array.from(draft, (ch) =>
    isControl(ch) && ch !== '\t' && ch !== '\n' ? '' : ch,
  );
  const cleaned = visible.join('').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, MAX_SAVED_LAYOUT_NAME).trim();
}

/** The confirm sentence for deleting a saved layout. */
export function deleteLayoutSentence(name: string): string {
  return `Delete "${name}" for everyone in this workspace? Clips that use it keep their crops.`;
}
