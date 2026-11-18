/**
 * Drags on the timeline, as pure reducers.
 *
 * Each reducer takes the document as it was when the drag BEGAN plus where
 * the pointer is now (output time), and returns the document the drag gives.
 * Never the previous frame's document: working from the start every time is
 * what keeps a long drag exact (no rounding piles up, and dragging back to
 * where it began gives back the very same numbers). The editor shows the
 * result while dragging and commits the last one as one undo step.
 *
 * - Parts of the video: `dragTrimStart` and `dragTrimEnd` turn the pointer's
 *   distance from the edge into a source-time edge (times the part's speed)
 *   and hand it to `trimSegment`, which clamps it (`SEGMENT_MIN_MS`, the
 *   neighbour, the video's own 0 to its length, `CLIP_MIN_MS` to
 *   `CLIP_MAX_MS`), reports `needsMoreVideo` past what we hold, and ends with
 *   `replaceItems` (the `anchor` rule). The clip closes up: trimming a start
 *   inward shortens the clip, it does not leave a gap.
 * - Texts, stickers and sounds: `dragMoveItem`, `dragResizeItemStart` and
 *   `dragResizeItemEnd` keep the item inside the clip (0 to its end) and at
 *   least `ITEM_MIN_MS` long. No video moves, so no other item does either.
 *
 * Snapping is optional: pass `snap` (the points from `snapPoints`, excluding
 * the dragged thing, and the current scale) and the dragged edge snaps
 * first; the result says what it snapped to so the guide line can be drawn.
 * Hold Alt: leave `snap` out.
 *
 * Rounding happens once, on the final edge. A result is always a valid
 * document: when nothing valid can be made (an unknown id, a time that is not
 * a number), the start document comes back unchanged with `refused` set.
 */
import { ITEM_MIN_MS } from '../document/limits';
import type { ClipDocument, TimedItem } from '../document/schema';
import {
  type EditRefusalCode,
  type HeldRange,
  type NeedsMoreVideo,
  trimSegment,
} from '../time/edits';
import { findItem, type ItemRefusalCode, replaceItem } from '../time/items';
import { outputDuration, placeSegments } from '../time/time-map';
import { resolveSnap, SNAP_PX, type SnapPoint } from './snap';

/** Snapping for one drag. */
export interface GestureSnap {
  points: readonly SnapPoint[];
  pxPerMs: number;
  /** Defaults to `SNAP_PX`. */
  tolerancePx?: number;
}

export interface GestureResult {
  /** The document the drag gives (the start document when refused). */
  doc: ClipDocument;
  /** Video the part now uses that we do not hold in sharp quality, in source time. */
  needsMoreVideo?: NeedsMoreVideo;
  /** True when the edge or item stopped short of the pointer (a limit, a neighbour, the clip's end). */
  clamped: boolean;
  /** The point the dragged edge snapped to, or null. Null when a clamp moved it off the point. */
  snappedTo: SnapPoint | null;
  /** Set when nothing could be done; `doc` is then the start document. */
  refused?: EditRefusalCode | ItemRefusalCode;
}

export interface TrimDrag {
  segmentId: string;
  /** The pointer, in output time, measured on the start document. */
  pointerMs: number;
  /** The length of the part's video, so a trim can bring video back up to its ends. */
  videoDurationMs: number;
  /** What we hold in sharp quality; past it the result carries `needsMoreVideo`. */
  held?: HeldRange;
  snap?: GestureSnap;
}

export interface ItemMoveDrag {
  itemId: string;
  /** Where the pointer went down, in output time. */
  grabMs: number;
  /** Where the pointer is now, in output time. */
  pointerMs: number;
  snap?: GestureSnap;
}

export interface ItemResizeDrag {
  itemId: string;
  /** Where the dragged edge should go, in output time. */
  pointerMs: number;
  snap?: GestureSnap;
}

function refused(doc: ClipDocument, code: EditRefusalCode | ItemRefusalCode): GestureResult {
  return { doc, clamped: true, snappedTo: null, refused: code };
}

/** Snaps a time when snapping is on; the time unchanged otherwise. */
function snapTime(ms: number, snap: GestureSnap | undefined): { ms: number; to: SnapPoint | null } {
  if (!snap) {
    return { ms, to: null };
  }
  const result = resolveSnap(ms, snap.points, snap.tolerancePx ?? SNAP_PX, snap.pxPerMs);
  return { ms: result.ms, to: result.snappedTo };
}

function trimEdge(doc: ClipDocument, drag: TrimDrag, edge: 'start' | 'end'): GestureResult {
  if (!Number.isFinite(drag.pointerMs)) {
    return refused(doc, 'invalid_time');
  }
  const entry = placeSegments(doc).find((p) => p.segment.id === drag.segmentId);
  if (!entry) {
    return refused(doc, 'segment_not_found');
  }
  const { segment } = entry;
  const snapped = snapTime(drag.pointerMs, drag.snap);
  // The edge's distance from where it was, in output time, turned into source time.
  const edgeOut = edge === 'start' ? entry.outStart : entry.outEnd;
  const fromSource = edge === 'start' ? segment.sourceIn : segment.sourceOut;
  const wanted = fromSource + (snapped.ms - edgeOut) * segment.speed;

  const result = trimSegment(doc, {
    segmentId: segment.id,
    edge,
    sourceMs: wanted,
    videoDurationMs: drag.videoDurationMs,
    held: drag.held,
  });
  if (!result.ok) {
    return refused(doc, result.code);
  }

  const after = result.doc.segments[entry.index];
  const reached = edge === 'start' ? after?.sourceIn : after?.sourceOut;
  const clamped = reached !== Math.round(wanted);
  const base = { doc: result.doc, clamped, snappedTo: clamped ? null : snapped.to };
  return result.needsMoreVideo ? { ...base, needsMoreVideo: result.needsMoreVideo } : base;
}

/** Drags a part's start edge to the pointer (output time on the start document). */
export function dragTrimStart(startDoc: ClipDocument, drag: TrimDrag): GestureResult {
  return trimEdge(startDoc, drag, 'start');
}

/** Drags a part's end edge to the pointer (output time on the start document). */
export function dragTrimEnd(startDoc: ClipDocument, drag: TrimDrag): GestureResult {
  return trimEdge(startDoc, drag, 'end');
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The item with a new start and length, or the same object when nothing changed. */
function placed(item: TimedItem, start: number, duration: number): TimedItem {
  if (item.start === start && item.duration === duration) {
    return item;
  }
  return { ...item, start, duration } as TimedItem;
}

/**
 * Moves an item by how far the pointer went since it went down, keeping its
 * length. With snapping, whichever of its two edges is nearer a point snaps
 * (the start wins a tie). Kept inside the clip.
 */
export function dragMoveItem(startDoc: ClipDocument, drag: ItemMoveDrag): GestureResult {
  if (!Number.isFinite(drag.pointerMs) || !Number.isFinite(drag.grabMs)) {
    return refused(startDoc, 'invalid_time');
  }
  const found = findItem(startDoc, drag.itemId);
  if (!found) {
    return refused(startDoc, 'item_not_found');
  }
  const { item } = found;
  const total = outputDuration(startDoc);
  const duration = clamp(item.duration, Math.min(ITEM_MIN_MS, total), total);
  let start = item.start + (drag.pointerMs - drag.grabMs);
  let snappedTo: SnapPoint | null = null;

  if (drag.snap) {
    const head = snapTime(start, drag.snap);
    const tail = snapTime(start + duration, drag.snap);
    const headMove = head.to ? Math.abs(head.ms - start) : Number.POSITIVE_INFINITY;
    const tailMove = tail.to ? Math.abs(tail.ms - (start + duration)) : Number.POSITIVE_INFINITY;
    if (head.to && headMove <= tailMove) {
      start = head.ms;
      snappedTo = head.to;
    } else if (tail.to) {
      start = tail.ms - duration;
      snappedTo = tail.to;
    }
  }

  const wanted = Math.round(start);
  const final = clamp(wanted, 0, Math.max(0, total - duration));
  const clamped = final !== wanted;
  const next = placed(item, final, duration);
  return {
    doc: next === item ? startDoc : replaceItem(startDoc, found, next),
    clamped,
    snappedTo: clamped ? null : snappedTo,
  };
}

/**
 * Drags an item's start edge: the end stays, the length changes. Kept at or
 * after 0 and at least `ITEM_MIN_MS` before the end.
 */
export function dragResizeItemStart(startDoc: ClipDocument, drag: ItemResizeDrag): GestureResult {
  if (!Number.isFinite(drag.pointerMs)) {
    return refused(startDoc, 'invalid_time');
  }
  const found = findItem(startDoc, drag.itemId);
  if (!found) {
    return refused(startDoc, 'item_not_found');
  }
  const { item } = found;
  const total = outputDuration(startDoc);
  const end = clamp(item.start + item.duration, Math.min(ITEM_MIN_MS, total), total);
  const snapped = snapTime(drag.pointerMs, drag.snap);
  const wanted = Math.round(snapped.ms);
  const start = clamp(wanted, 0, Math.max(0, end - ITEM_MIN_MS));
  const clamped = start !== wanted;
  const next = placed(item, start, end - start);
  return {
    doc: next === item ? startDoc : replaceItem(startDoc, found, next),
    clamped,
    snappedTo: clamped ? null : snapped.to,
  };
}

/**
 * Drags an item's end edge: the start stays, the length changes. Kept at
 * least `ITEM_MIN_MS` after the start and at or before the clip's end.
 */
export function dragResizeItemEnd(startDoc: ClipDocument, drag: ItemResizeDrag): GestureResult {
  if (!Number.isFinite(drag.pointerMs)) {
    return refused(startDoc, 'invalid_time');
  }
  const found = findItem(startDoc, drag.itemId);
  if (!found) {
    return refused(startDoc, 'item_not_found');
  }
  const { item } = found;
  const total = outputDuration(startDoc);
  const start = clamp(item.start, 0, Math.max(0, total - ITEM_MIN_MS));
  const snapped = snapTime(drag.pointerMs, drag.snap);
  const wanted = Math.round(snapped.ms);
  const end = clamp(wanted, start + ITEM_MIN_MS, Math.max(start + ITEM_MIN_MS, total));
  const clamped = end !== wanted;
  const next = placed(item, start, end - start);
  return {
    doc: next === item ? startDoc : replaceItem(startDoc, found, next),
    clamped,
    snappedTo: clamped ? null : snapped.to,
  };
}
