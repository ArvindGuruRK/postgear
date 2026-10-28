/**
 * The guardrail: an element moves inside its area and nowhere else.
 *
 * This is the single rule that makes Studio a template editor rather than a
 * small Canva. The user can nudge a headline to balance a slide; they cannot
 * drag it over the logo, out of the safe area, or into the footer. Because
 * the clamp is pure and lives here, the drag, the arrow keys and the schema
 * all get the same answer: the schema clamps every stored offset on the way
 * in, so a client that sends a nudge past the edge stores one at the edge.
 *
 * An offset is a percentage **of the region**, not of the canvas and not of
 * the slot, so an element that sits a third of the way across its region
 * stays a third of the way across it in every format.
 */
import type { Rect } from './types';

export interface Offset {
  x: number;
  y: number;
}

export const NO_OFFSET: Offset = { x: 0, y: 0 };

/** One arrow press, as a percentage of the region. Shift multiplies it. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 5;

/**
 * How far a slot may move from its laid-out position without leaving its
 * region, in percentages of the region, on each axis.
 *
 * `slot` is the slot's own rectangle in percentages of its region (what a
 * layout stores in `SlotDef.box`). A slot that fills its region's width can
 * only move vertically, and the maths says so rather than a special case.
 */
export function offsetBounds(slot: Rect): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: -slot.x,
    maxX: 100 - slot.w - slot.x,
    minY: -slot.y,
    maxY: 100 - slot.h - slot.y,
  };
}

/**
 * The nudge, clamped so the slot stays inside its region.
 *
 * A slot larger than its region (long text that grew its box, or a layout
 * written loosely) would give `max < min`; the clamp then pins it to the
 * region's own edge rather than returning a nonsense range, because an
 * element that cannot fit should still not be allowed to drift off.
 */
export function clampToRegion(slot: Rect, offset: Offset): Offset {
  const bounds = offsetBounds(slot);

  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  };
}

/** Which axes, if any, the offset was pulled back on. Drives the edge flash. */
export interface ClampReport {
  offset: Offset;
  /** True when the request wanted to go further left or right than allowed. */
  clampedX: boolean;
  clampedY: boolean;
  /** The edge it stopped at, for the highlight. Null when it did not stop. */
  edge: { x: 'start' | 'end' | null; y: 'start' | 'end' | null };
}

export function clampWithReport(slot: Rect, offset: Offset): ClampReport {
  const bounds = offsetBounds(slot);
  const x = clamp(offset.x, bounds.minX, bounds.maxX);
  const y = clamp(offset.y, bounds.minY, bounds.maxY);

  return {
    offset: { x, y },
    clampedX: !near(x, offset.x),
    clampedY: !near(y, offset.y),
    edge: { x: edgeOf(offset.x, x), y: edgeOf(offset.y, y) },
  };
}

/**
 * The edge a request was stopped at, read from which way it pushed: a slot
 * exactly as wide as its region has both edges in one place, and pushing it
 * right must flash the right one.
 */
function edgeOf(requested: number, allowed: number): 'start' | 'end' | null {
  if (Number.isNaN(requested) || near(requested, allowed)) return null;
  return requested < allowed ? 'start' : 'end';
}

/** The slot's rectangle after a nudge, still in percentages of its region. */
export function placeInRegion(slot: Rect, offset: Offset | undefined): Rect {
  const applied = offset ? clampToRegion(slot, offset) : NO_OFFSET;

  return {
    x: slot.x + applied.x,
    y: slot.y + applied.y,
    w: slot.w,
    h: slot.h,
  };
}

/**
 * A pointer movement in canvas percentages, turned into a nudge in region
 * percentages. The drag handler works in pixels, divides by the canvas size
 * and hands the result here; the region's own size is what a percentage means.
 */
export function dragToOffset(region: Rect, start: Offset, deltaCanvasPercent: Offset): Offset {
  return {
    x: start.x + (deltaCanvasPercent.x / region.w) * 100,
    y: start.y + (deltaCanvasPercent.y / region.h) * 100,
  };
}

function clamp(value: number, min: number, max: number): number {
  // A slot wider than its region inverts the range; pin it to the start edge.
  if (max < min) return min;
  // NaN has no direction to clamp in, so it becomes no nudge at all. An
  // infinity does have one, and lands on the edge like any other long drag.
  const safe = Number.isNaN(value) ? 0 : value;

  return Math.min(max, Math.max(min, safe));
}

/** Floating point: a clamp that changed nothing must not read as a clamp. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}
