/**
 * Snapping: dragged edges jump to the playhead, the clip's start and end,
 * the cuts between parts and every item's edges when they come within
 * `SNAP_PX` of one.
 *
 * The tolerance is a pixel constant, turned into time at the current zoom
 * (8 px is a quarter second at 32 px a second, and two frames zoomed right
 * in), so snapping feels the same at every zoom. `snapPoints` lists the
 * places, leaving out the dragged thing's own edges (an edge must not snap
 * to where it already is), and `resolveSnap` is the pure resolver: it says
 * where the time went and what it snapped to, so the editor can draw the
 * guide line there.
 *
 * All points are in output time (the clip's clock).
 */
import type { ClipDocument } from '../document/schema';
import { outputDuration, placeSegments } from '../time/time-map';

/** How close, in pixels, an edge must come to a point to snap to it. */
export const SNAP_PX = 8;

/** What a point is. The order is the tie-break: the playhead wins a tie. */
export const SNAP_KINDS = ['playhead', 'start', 'end', 'segment', 'item'] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];

export interface SnapPoint {
  ms: number;
  kind: SnapKind;
  /**
   * `segment`: the part that starts at this cut. `item`: the item whose
   * start or end this is. Absent on the playhead and the clip's ends.
   */
  id?: string;
}

export interface SnapPointOptions {
  /** Where the playhead is, in output time. Left out when not a finite number. */
  playheadMs?: number;
  /** Ids of the parts and items being dragged: their own edges are left out. */
  exclude?: readonly string[];
}

export interface SnapResult {
  ms: number;
  /** The point it snapped to, or null when none was close enough. */
  snappedTo: SnapPoint | null;
}

const KIND_RANK: Readonly<Record<SnapKind, number>> = Object.freeze({
  playhead: 0,
  start: 1,
  end: 2,
  segment: 3,
  item: 4,
});

/**
 * Every place an edge can snap to, in time order (ties in `SNAP_KINDS`
 * order): the playhead, the clip's start (0) and end, every cut between two
 * parts and both edges of every text, sticker and sound.
 *
 * Excluding a part drops the cuts at both its ends, and the clip's start or
 * end when it is the first or last part. Excluding an item drops both its
 * edges.
 */
export function snapPoints(doc: ClipDocument, options: SnapPointOptions = {}): SnapPoint[] {
  const exclude = new Set(options.exclude ?? []);
  const placed = placeSegments(doc);
  const points: SnapPoint[] = [];

  if (options.playheadMs !== undefined && Number.isFinite(options.playheadMs)) {
    points.push({ ms: options.playheadMs, kind: 'playhead' });
  }

  const first = placed[0];
  const last = placed[placed.length - 1];
  if (!first || !exclude.has(first.segment.id)) {
    points.push({ ms: 0, kind: 'start' });
  }
  if (!last || !exclude.has(last.segment.id)) {
    points.push({ ms: outputDuration(doc), kind: 'end' });
  }

  placed.forEach((entry, i) => {
    if (i === 0) {
      return;
    }
    const previous = placed[i - 1];
    if (exclude.has(entry.segment.id) || (previous && exclude.has(previous.segment.id))) {
      return;
    }
    points.push({ ms: entry.outStart, kind: 'segment', id: entry.segment.id });
  });

  for (const track of doc.tracks) {
    if (track.kind === 'captions') {
      continue;
    }
    for (const item of track.items) {
      if (exclude.has(item.id)) {
        continue;
      }
      points.push({ ms: item.start, kind: 'item', id: item.id });
      points.push({ ms: item.start + item.duration, kind: 'item', id: item.id });
    }
  }

  return points
    .map((point, order) => ({ point, order }))
    .sort(
      (a, b) =>
        a.point.ms - b.point.ms ||
        KIND_RANK[a.point.kind] - KIND_RANK[b.point.kind] ||
        a.order - b.order,
    )
    .map(({ point }) => point);
}

/**
 * Snaps `ms` to the nearest point within `tolerancePx` (turned into time at
 * `pxPerMs`). The nearest wins; on a tie the playhead wins, then the clip's
 * start and end, then cuts, then items. Outside the tolerance (or with no
 * usable scale) the time comes back as it was. A time that is not a finite
 * number reads as 0.
 */
export function resolveSnap(
  ms: number,
  points: readonly SnapPoint[],
  tolerancePx: number,
  pxPerMs: number,
): SnapResult {
  const time = Number.isFinite(ms) ? ms : 0;
  if (
    !Number.isFinite(pxPerMs) ||
    pxPerMs <= 0 ||
    !Number.isFinite(tolerancePx) ||
    tolerancePx < 0
  ) {
    return { ms: time, snappedTo: null };
  }
  const toleranceMs = tolerancePx / pxPerMs;
  let best: SnapPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.ms)) {
      continue;
    }
    const distance = Math.abs(point.ms - time);
    if (distance > toleranceMs) {
      continue;
    }
    if (
      best === null ||
      distance < bestDistance ||
      (distance === bestDistance && KIND_RANK[point.kind] < KIND_RANK[best.kind])
    ) {
      best = point;
      bestDistance = distance;
    }
  }
  return best ? { ms: best.ms, snappedTo: best } : { ms: time, snappedTo: null };
}
