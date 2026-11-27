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
 * Joins (Module 11): a Fade join overlaps a part with the one before it by
 * `joinOverlaps(doc)[i]` ms, so part `i` starts that much before part
 * `i - 1` ends and the clip is that much shorter. Inside an overlap both
 * parts are on screen (the compiler mixes them with `xfade`); `segmentAt`
 * answers the outgoing part until the overlap's middle, then the incoming
 * one. With no joins every number below is what it always was.
 *
 * Rounding: at speeds below 1, one output millisecond spans less than one
 * source millisecond, so `toOutput(toSource(t))` can land up to
 * `ceil(1 / speed)` ms away from `t`. At speed 1 and above it is exact.
 */
import { type ClipDocument, joinOverlaps, type Segment, segmentOutputMs } from '../document/schema';

/** The only part of a document the time map reads, so half-built drafts work too. */
export type TimedDocument = Pick<ClipDocument, 'segments'> & Partial<Pick<ClipDocument, 'joins'>>;

/** A segment with its place in the clip. */
export interface PlacedSegment {
  segment: Segment;
  index: number;
  /** Where it starts in the clip, in ms. */
  outStart: number;
  /** Where it ends in the clip, in ms (exclusive). */
  outEnd: number;
  /** Module 11: how long it overlaps the part before it (a Fade join), 0 for a cut. */
  overlapMs: number;
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
  const overlaps = joinOverlaps(doc);
  let cursor = 0;
  doc.segments.forEach((segment, index) => {
    const length = segmentOutputMs(segment);
    const overlapMs = overlaps[index] ?? 0;
    const outStart = cursor - overlapMs;
    placed.push({ segment, index, outStart, outEnd: outStart + length, overlapMs });
    cursor = outStart + length;
  });
  return placed;
}

/** The clip's length in ms: the sum of its segments' output lengths, less each Fade join's overlap. */
export function outputDuration(doc: TimedDocument): number {
  let total = 0;
  for (const segment of doc.segments) {
    total += segmentOutputMs(segment);
  }
  for (const overlap of joinOverlaps(doc)) {
    total -= overlap;
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
  for (let i = 0; i < placed.length; i += 1) {
    const entry = placed[i] as PlacedSegment;
    if (outputMs >= entry.outStart && outputMs < entry.outEnd) {
      // Inside a fade the outgoing part answers until the overlap's middle.
      const next = placed[i + 1];
      if (next && next.overlapMs > 0 && outputMs >= next.outStart + next.overlapMs / 2) {
        return next;
      }
      return entry;
    }
  }
  // Exactly the clip's end.
  return last;
}

/** A Fade join being played: the two parts on screen and how far the mix is. */
export interface JoinNow {
  /** The outgoing part (the one before the join). */
  fromSegment: string;
  /** The incoming part (the join's `beforeSegment`). */
  toSegment: string;
  fromIndex: number;
  toIndex: number;
  /** 0 at the overlap's start (all outgoing) to 1 at its end (all incoming). */
  progress: number;
}

/**
 * The Fade join playing at `outputMs` (Module 11), or null on a cut or away
 * from any join. Inside an overlap `[incoming.outStart, outgoing.outEnd)`
 * both parts are on screen; `progress` is linear in output time, as
 * FFmpeg's `xfade=transition=fade` mixes. `outputMs` may be fractional.
 */
export function joinAt(doc: TimedDocument, outputMs: number): JoinNow | null {
  if (!Number.isFinite(outputMs) || !doc.joins || doc.joins.length === 0) {
    return null;
  }
  const placed = placeSegments(doc);
  for (let i = 1; i < placed.length; i += 1) {
    const entry = placed[i] as PlacedSegment;
    if (entry.overlapMs <= 0) continue;
    const end = entry.outStart + entry.overlapMs;
    if (outputMs >= entry.outStart && outputMs < end) {
      const previous = placed[i - 1] as PlacedSegment;
      return {
        fromSegment: previous.segment.id,
        toSegment: entry.segment.id,
        fromIndex: previous.index,
        toIndex: entry.index,
        progress: Math.min(1, Math.max(0, (outputMs - entry.outStart) / entry.overlapMs)),
      };
    }
  }
  return null;
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
