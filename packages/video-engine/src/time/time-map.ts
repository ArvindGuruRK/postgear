/**
 * The time map: how the video's clock (source time) and the clip's clock
 * (output time) line up.
 *
 * A clip is its segments played in order. Segment `i` starts in the clip
 * where segment `i - 1` ends, and lasts `segmentOutputMs(segment)`, which is
 * `round((sourceOut - sourceIn) / speed)`. Everything here derives from that
 * one identity, so the editor, the preview and the compiler can never
 * disagree about where a moment lands.
 *
 * Ranges are half-open (`[start, end)`): a moment exactly on a cut belongs
 * to the segment that starts there. The clip's very end (`outputMs ===
 * outputDuration`) belongs to the last segment, so the playhead parked at the
 * end still has a picture.
 *
 * Rounding: at speeds below 1, one output millisecond spans less than one
 * source millisecond, so `toOutput(toSource(t))` can land up to
 * `ceil(1 / speed)` ms away from `t`. At speed 1 and above it is exact.
 */
import { type ClipDocument, type Segment, segmentOutputMs } from '../document/schema';

/** The only part of a document the time map reads, so half-built drafts work too. */
export type TimedDocument = Pick<ClipDocument, 'segments'>;

/** A segment with its place in the clip. */
export interface PlacedSegment {
  segment: Segment;
  index: number;
  /** Where it starts in the clip, in ms. */
  outStart: number;
  /** Where it ends in the clip, in ms (exclusive). */
  outEnd: number;
}

/** Where an output moment comes from in the video. */
export interface SourceMoment {
  segmentId: string;
  sourceId: string;
  sourceMs: number;
}

/** Every segment with its start and end in the clip, in play order. */
export function placeSegments(doc: TimedDocument): PlacedSegment[] {
  const placed: PlacedSegment[] = [];
  let cursor = 0;
  doc.segments.forEach((segment, index) => {
    const length = segmentOutputMs(segment);
    placed.push({ segment, index, outStart: cursor, outEnd: cursor + length });
    cursor += length;
  });
  return placed;
}

/** The clip's length in ms: the sum of its segments' output lengths. */
export function outputDuration(doc: TimedDocument): number {
  let total = 0;
  for (const segment of doc.segments) {
    total += segmentOutputMs(segment);
  }
  return total;
}

/**
 * The segment playing at `outputMs`, or null outside the clip. The clip's
 * end belongs to the last segment.
 */
export function segmentAt(doc: TimedDocument, outputMs: number): PlacedSegment | null {
  if (!Number.isFinite(outputMs) || outputMs < 0) {
    return null;
  }
  const placed = placeSegments(doc);
  const last = placed[placed.length - 1];
  if (!last || outputMs > last.outEnd) {
    return null;
  }
  for (const entry of placed) {
    if (outputMs >= entry.outStart && outputMs < entry.outEnd) {
      return entry;
    }
  }
  // Exactly the clip's end.
  return last;
}

/** The video moment shown at `outputMs`, or null outside the clip. */
export function toSource(doc: TimedDocument, outputMs: number): SourceMoment | null {
  const entry = segmentAt(doc, outputMs);
  if (!entry) {
    return null;
  }
  const { segment } = entry;
  const sourceMs = Math.min(
    segment.sourceOut,
    segment.sourceIn + Math.round((outputMs - entry.outStart) * segment.speed),
  );
  return { segmentId: segment.id, sourceId: segment.source, sourceMs };
}

/**
 * Where a video moment plays in the clip, or null when it was cut out.
 *
 * When the same moment is kept twice (a segment repeated), the first
 * occurrence wins, unless `preferSegmentId` names one that holds it. A
 * moment exactly on a segment's `sourceOut` maps to that segment's end only
 * when no segment holds it inside its range.
 */
export function toOutput(
  doc: TimedDocument,
  sourceId: string,
  sourceMs: number,
  preferSegmentId?: string,
): number | null {
  if (!Number.isFinite(sourceMs)) {
    return null;
  }
  const placed = placeSegments(doc);
  const map = (entry: PlacedSegment): number => {
    const { segment } = entry;
    const offset = Math.round((sourceMs - segment.sourceIn) / segment.speed);
    return Math.min(entry.outEnd, entry.outStart + Math.max(0, offset));
  };
  const holds = (entry: PlacedSegment): boolean =>
    entry.segment.source === sourceId &&
    sourceMs >= entry.segment.sourceIn &&
    sourceMs < entry.segment.sourceOut;

  if (preferSegmentId) {
    const preferred = placed.find((entry) => entry.segment.id === preferSegmentId);
    if (preferred && holds(preferred)) {
      return map(preferred);
    }
  }
  const inside = placed.find(holds);
  if (inside) {
    return map(inside);
  }
  const atEnd = placed.find(
    (entry) => entry.segment.source === sourceId && sourceMs === entry.segment.sourceOut,
  );
  return atEnd ? atEnd.outEnd : null;
}

/** The frame showing at `ms` (frames start at 0; a frame covers `[n, n + 1) / fps`). */
export function msToFrame(ms: number, fps: number): number {
  // The epsilon keeps 1000 / 30 * 3 = 100 from flooring to frame 2.
  return Math.floor((ms * fps) / 1000 + 1e-9);
}

/**
 * The first whole millisecond inside frame `frame`, so that
 * `msToFrame(frameToMs(n), fps) === n` for every frame (at 30 fps frame 1
 * starts at 33.3 ms, and 33 would still be frame 0).
 */
export function frameToMs(frame: number, fps: number): number {
  return Math.ceil((frame * 1000) / fps - 1e-9);
}
