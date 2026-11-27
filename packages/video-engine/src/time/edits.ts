/**
 * The edits that move video: trim, split, remove and speed.
 *
 * Each edit takes a document and returns a new one (the input is never
 * changed; untouched parts are shared, as immutable updates do), or a refusal
 * code the editor turns into a disabled button or a sentence. No edit ever
 * deletes a text, a sticker or a sound.
 *
 * Every successful edit ends with `replaceItems`, the `anchor` rule:
 *
 * - `moment` items (stickers, texts, sound effects by default) go back onto
 *   the video moment they started on. When that moment was cut out, they move
 *   to where the cut now is.
 * - `clip` items (music, anything shown for the whole clip) do not move.
 * - Anything that would now end past the clip's end is shortened (never below
 *   `ITEM_MIN_MS`), and moved back when even that does not fit. One that now
 *   starts at or past the end keeps its length and moves back to end with
 *   the clip.
 *
 * Crops and zooms are in source time, so none of these edits touches them.
 *
 * Rounding: a part's output length is `round((sourceOut - sourceIn) / speed)`
 * (`segmentOutputMs`). An edit rounds once, at the place it cuts, and checks
 * the identity afterwards, so a split's two halves add up to exactly the
 * length the part had.
 */
import { newId } from '../document/create';
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  ITEM_MIN_MS,
  MAX_SEGMENTS,
  SEGMENT_MIN_MS,
  SPEEDS,
  type Speed,
} from '../document/limits';
import {
  type ClipDocument,
  type Segment,
  segmentOutputMs,
  type TimedItem,
  type Track,
} from '../document/schema';
import { outputDuration, placeSegments, type SourceMoment, toOutput, toSource } from './time-map';

/** Why an edit was refused. */
export type EditRefusalCode =
  /** No part has that id. */
  | 'segment_not_found'
  /** A time that is not a finite number, or a video length that is not positive. */
  | 'invalid_time'
  /** The part would be shorter than `SEGMENT_MIN_MS`. */
  | 'segment_too_short'
  /** A split within `SEGMENT_MIN_MS` of a part's edge (or exactly on a cut). */
  | 'split_too_close_to_edge'
  /** A split before the clip's start or past its end. */
  | 'outside_clip'
  /** A clip keeps at least one part. */
  | 'last_segment'
  /** A speed that is not one of `SPEEDS`. */
  | 'speed_not_allowed'
  /** A split past `MAX_SEGMENTS`. */
  | 'too_many_segments'
  /** The clip would be shorter than `CLIP_MIN_MS`. */
  | 'clip_too_short'
  /** The clip would be longer than `CLIP_MAX_MS`. */
  | 'clip_too_long';

/** Video the clip now uses that we do not hold in sharp quality, in source time. */
export interface NeedsMoreVideo {
  fromMs: number;
  toMs: number;
}

export type EditResult =
  | { ok: true; doc: ClipDocument; needsMoreVideo?: NeedsMoreVideo }
  | { ok: false; code: EditRefusalCode };

export type SegmentEdge = 'start' | 'end';

/** The range of the video fetched in sharp quality for this clip, in source time. */
export interface HeldRange {
  fromMs: number;
  toMs: number;
}

export interface TrimInput {
  segmentId: string;
  edge: SegmentEdge;
  /** Where the edge should go, in the video's own time. Clamped, never refused for being far. */
  sourceMs: number;
  /** The whole video's length: a trim can bring back video up to its ends. */
  videoDurationMs: number;
  /** What we hold in sharp quality. When given, a trim past it reports `needsMoreVideo`. */
  held?: HeldRange;
}

function refuse(code: EditRefusalCode): EditResult {
  return { ok: false, code };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Whether a number is one of the allowed speeds. */
export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}

/**
 * Checks the result of an edit, then puts every item back in its place.
 * Exported for the other edits that move video (Sprint 13's cuts by words).
 */
export function finishEdit(
  before: ClipDocument,
  segments: Segment[],
  needsMoreVideo?: NeedsMoreVideo,
): EditResult {
  for (const segment of segments) {
    if (segment.sourceIn >= segment.sourceOut || segmentOutputMs(segment) < SEGMENT_MIN_MS) {
      return refuse('segment_too_short');
    }
  }
  const after: ClipDocument = { ...before, segments, ...keptJoinsAndParts(before, segments) };
  const total = outputDuration(after);
  if (total < CLIP_MIN_MS) {
    return refuse('clip_too_short');
  }
  if (total > CLIP_MAX_MS) {
    return refuse('clip_too_long');
  }
  const doc = replaceItems(before, after);
  return needsMoreVideo ? { ok: true, doc, needsMoreVideo } : { ok: true, doc };
}

/**
 * Module 11: a Fade join and a montage divider name the part that starts an
 * original clip. When an edit removes that part, both move to the part that
 * now follows the last surviving part before it (the clip's new first part);
 * a join that would land on the first part or on a part that already has one
 * is dropped, and a divider that would land on another divider's part stays
 * as it was (`montageParts` skips a part that is gone).
 */
function keptJoinsAndParts(
  before: ClipDocument,
  segments: readonly Segment[],
): Partial<Pick<ClipDocument, 'joins' | 'meta'>> {
  const joins = before.joins;
  const parts = before.meta?.montage?.parts;
  if ((!joins || joins.length === 0) && !parts) return {};
  const alive = new Set(segments.map((segment) => segment.id));
  const index = new Map(segments.map((segment, i) => [segment.id, i]));
  /** The part that now stands where `id` stood, or null. */
  const standIn = (id: string): string | null => {
    if (alive.has(id)) return id;
    const at = before.segments.findIndex((segment) => segment.id === id);
    if (at < 0) return null;
    let previous = -1;
    for (let i = at - 1; i >= 0; i -= 1) {
      const kept = index.get((before.segments[i] as Segment).id);
      if (kept !== undefined) {
        previous = kept;
        break;
      }
    }
    return segments[previous + 1]?.id ?? null;
  };

  const out: Partial<Pick<ClipDocument, 'joins' | 'meta'>> = {};
  if (joins) {
    const taken = new Set<string>();
    const moved = [];
    for (const join of joins) {
      const id = standIn(join.beforeSegment);
      if (id === null || id === segments[0]?.id || taken.has(id)) continue;
      taken.add(id);
      moved.push({ ...join, beforeSegment: id });
    }
    out.joins = moved;
  }
  if (parts && before.meta?.montage) {
    const firsts = new Set(parts.map((part) => part.firstSegment).filter((id) => alive.has(id)));
    out.meta = {
      ...before.meta,
      montage: {
        ...before.meta.montage,
        parts: parts.map((part) => {
          if (alive.has(part.firstSegment)) return part;
          const id = standIn(part.firstSegment);
          if (id === null || firsts.has(id)) return part;
          firsts.add(id);
          return { ...part, firstSegment: id };
        }),
      },
    };
  }
  return out;
}

/**
 * Moves one edge of a part to `sourceMs` (source time), clamped so that:
 * the part stays at least `SEGMENT_MIN_MS` long; it does not run into the
 * video its neighbour shows (when the neighbour is the next or previous
 * stretch of the same video); it stays inside the video; and the clip stays
 * between `CLIP_MIN_MS` and `CLIP_MAX_MS`. Trimming outward past the range we
 * hold is allowed and reported as `needsMoreVideo`.
 */
export function trimSegment(doc: ClipDocument, input: TrimInput): EditResult {
  if (
    !Number.isFinite(input.sourceMs) ||
    !Number.isFinite(input.videoDurationMs) ||
    input.videoDurationMs <= 0
  ) {
    return refuse('invalid_time');
  }
  const index = doc.segments.findIndex((s) => s.id === input.segmentId);
  const segment = doc.segments[index];
  if (index < 0 || !segment) {
    return refuse('segment_not_found');
  }

  const { speed } = segment;
  const videoEnd = Math.floor(input.videoDurationMs);
  const others = outputDuration(doc) - segmentOutputMs(segment);
  const segmentMinLength = Math.ceil(SEGMENT_MIN_MS * speed);
  // Source lengths whose rounded output keeps the clip in range: a length of
  // ceil(L x speed) plays at least L, floor(L x speed) at most L.
  const minLength = Math.max(segmentMinLength, Math.ceil((CLIP_MIN_MS - others) * speed));
  const maxLength = Math.floor((CLIP_MAX_MS - others) * speed);
  const wanted = Math.round(input.sourceMs);

  let sourceIn = segment.sourceIn;
  let sourceOut = segment.sourceOut;
  let low: number;
  let high: number;

  if (input.edge === 'end') {
    low = sourceIn + minLength;
    high = Math.min(videoEnd, sourceIn + maxLength);
    const next = doc.segments[index + 1];
    if (next && next.source === segment.source && next.sourceIn >= segment.sourceOut) {
      high = Math.min(high, next.sourceIn);
    }
  } else {
    high = sourceOut - minLength;
    low = Math.max(0, sourceOut - maxLength);
    const previous = doc.segments[index - 1];
    if (previous && previous.source === segment.source && previous.sourceOut <= segment.sourceIn) {
      low = Math.max(low, previous.sourceOut);
    }
  }

  if (low > high) {
    if (maxLength < minLength) {
      return refuse('clip_too_long');
    }
    return refuse(minLength > segmentMinLength ? 'clip_too_short' : 'segment_too_short');
  }

  if (input.edge === 'end') {
    sourceOut = clamp(wanted, low, high);
  } else {
    sourceIn = clamp(wanted, low, high);
  }

  const segments = doc.segments.slice();
  segments[index] = { ...segment, sourceIn, sourceOut };

  let needsMoreVideo: NeedsMoreVideo | undefined;
  const held = input.held;
  if (held && Number.isFinite(held.fromMs) && Number.isFinite(held.toMs)) {
    if (input.edge === 'end' && sourceOut > held.toMs) {
      needsMoreVideo = { fromMs: Math.max(held.toMs, sourceIn), toMs: sourceOut };
    } else if (input.edge === 'start' && sourceIn < held.fromMs) {
      needsMoreVideo = { fromMs: sourceIn, toMs: Math.min(held.fromMs, sourceOut) };
    }
  }

  return finishEdit(doc, segments, needsMoreVideo);
}

/**
 * The source moment to cut a part at so that its two halves add up to
 * exactly the part's output length. The rounding happens once (offset times
 * speed); at speeds above 1 that moment can be a millisecond off the identity,
 * so the nearest moment that keeps it is taken. One always exists within
 * `ceil(speed)` ms, where `offset / speed` is whole.
 */
function splitPoint(segment: Segment, offset: number, length: number): number | null {
  const base = segment.sourceIn + Math.round(offset * segment.speed);
  const reach = Math.ceil(segment.speed) + 1;
  for (let distance = 0; distance <= reach; distance += 1) {
    const candidates = distance === 0 ? [base] : [base - distance, base + distance];
    for (const cut of candidates) {
      if (cut <= segment.sourceIn || cut >= segment.sourceOut) {
        continue;
      }
      const first = segmentOutputMs({
        sourceIn: segment.sourceIn,
        sourceOut: cut,
        speed: segment.speed,
      });
      // The second half is derived by subtraction, then checked against the identity.
      const second = length - first;
      if (first < SEGMENT_MIN_MS || second < SEGMENT_MIN_MS) {
        continue;
      }
      if (
        segmentOutputMs({ sourceIn: cut, sourceOut: segment.sourceOut, speed: segment.speed }) ===
        second
      ) {
        return cut;
      }
    }
  }
  return null;
}

/** An id no part of `doc` has yet. */
export function unusedId(doc: Pick<ClipDocument, 'segments'>, prefix: string): string {
  const taken = new Set<string>(doc.segments.map((s) => s.id));
  let id = newId(prefix);
  while (taken.has(id)) {
    id = newId(prefix);
  }
  return id;
}

/**
 * Splits the part playing at `outputMs` in two. Refused within
 * `SEGMENT_MIN_MS` of either edge of the part (so no sliver is left), outside
 * the clip, and past `MAX_SEGMENTS`. The first half keeps the part's id; the
 * second gets a new one. The clip's length does not change.
 */
export function splitAt(doc: ClipDocument, outputMs: number): EditResult {
  if (!Number.isFinite(outputMs)) {
    return refuse('invalid_time');
  }
  const at = Math.round(outputMs);
  const total = outputDuration(doc);
  if (at <= 0 || at >= total) {
    return refuse(at < 0 || at > total ? 'outside_clip' : 'split_too_close_to_edge');
  }
  if (doc.segments.length >= MAX_SEGMENTS) {
    return refuse('too_many_segments');
  }
  const entry = placeSegments(doc).find((p) => at > p.outStart && at < p.outEnd);
  if (!entry) {
    // Exactly on a cut between two parts.
    return refuse('split_too_close_to_edge');
  }
  const offset = at - entry.outStart;
  const length = entry.outEnd - entry.outStart;
  if (offset < SEGMENT_MIN_MS || length - offset < SEGMENT_MIN_MS) {
    return refuse('split_too_close_to_edge');
  }
  const { segment } = entry;
  const cut = splitPoint(segment, offset, length);
  if (cut === null) {
    return refuse('split_too_close_to_edge');
  }

  const segments = doc.segments.slice();
  segments.splice(
    entry.index,
    1,
    { ...segment, sourceOut: cut },
    { ...segment, id: unusedId(doc, 'seg'), sourceIn: cut },
  );
  return finishEdit(doc, segments);
}

/** Removes one part; the rest close up. The last part cannot be removed. */
export function removeSegment(doc: ClipDocument, segmentId: string): EditResult {
  const index = doc.segments.findIndex((s) => s.id === segmentId);
  if (index < 0) {
    return refuse('segment_not_found');
  }
  if (doc.segments.length <= 1) {
    return refuse('last_segment');
  }
  return finishEdit(
    doc,
    doc.segments.filter((_, i) => i !== index),
  );
}

/** Plays one part at another of the `SPEEDS`; its length in the clip scales with it. */
export function setSpeed(doc: ClipDocument, segmentId: string, speed: number): EditResult {
  if (!isSpeed(speed)) {
    return refuse('speed_not_allowed');
  }
  const index = doc.segments.findIndex((s) => s.id === segmentId);
  const segment = doc.segments[index];
  if (index < 0 || !segment) {
    return refuse('segment_not_found');
  }
  const segments = doc.segments.slice();
  segments[index] = { ...segment, speed };
  return finishEdit(doc, segments);
}

// --- Putting items back --------------------------------------------------

/**
 * The first moment at or after `from` (and before `to`) of `sourceId` that
 * the edited clip still shows, or null.
 */
function firstKeptMoment(
  after: ClipDocument,
  sourceId: string,
  from: number,
  to: number,
): number | null {
  let best: number | null = null;
  for (const segment of after.segments) {
    if (segment.source !== sourceId) {
      continue;
    }
    const candidate = Math.max(from, segment.sourceIn);
    if (candidate < segment.sourceOut && candidate < to && (best === null || candidate < best)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Where a moment that was cut out now sits: the output position of the first
 * video the edited clip still shows after it, in the old play order. That is
 * the cut itself (the start of the part after a removed one, the start of a
 * part trimmed past the moment). The clip's end when nothing after it is kept.
 */
function cutPosition(before: ClipDocument, after: ClipDocument, moment: SourceMoment): number {
  const placed = placeSegments(before);
  const from = placed.findIndex((p) => p.segment.id === moment.segmentId);
  if (from >= 0) {
    for (let i = from; i < placed.length; i += 1) {
      const segment = (placed[i] as (typeof placed)[number]).segment;
      const start = i === from ? moment.sourceMs : segment.sourceIn;
      const kept = firstKeptMoment(after, segment.source, start, segment.sourceOut);
      if (kept !== null) {
        const out = toOutput(after, segment.source, kept);
        if (out !== null) {
          return out;
        }
      }
    }
  }
  return outputDuration(after);
}

/**
 * Where a `moment` item starts after the edit. Moved by how far its moment
 * moved, rather than mapped afresh, so the sub-millisecond offset an item has
 * inside a slow part is kept and repeated edits never drift it.
 */
function momentStart(before: ClipDocument, after: ClipDocument, start: number): number {
  const moment = toSource(before, start);
  if (!moment) {
    return start;
  }
  const was = toOutput(before, moment.sourceId, moment.sourceMs, moment.segmentId);
  const now = toOutput(after, moment.sourceId, moment.sourceMs, moment.segmentId);
  if (was !== null && now !== null) {
    return Math.max(0, start + (now - was));
  }
  return cutPosition(before, after, moment);
}

/**
 * Keeps an item inside the clip. One that runs past the end is shortened to
 * it; when that would leave less than `ITEM_MIN_MS`, it keeps `ITEM_MIN_MS`
 * and its start moves back. One that starts at or past the end keeps its
 * length and moves back so it ends with the clip (shortening it to nothing
 * would lose it in all but name).
 */
function fitInside<T extends TimedItem>(item: T, start: number, total: number): T {
  let from = Math.max(0, start);
  let duration = Math.min(item.duration, total);
  if (from >= total) {
    from = total - duration;
  } else if (from + duration > total) {
    duration = total - from;
    if (duration < ITEM_MIN_MS) {
      duration = ITEM_MIN_MS;
      from = total - ITEM_MIN_MS;
    }
  }
  if (from === item.start && duration === item.duration) {
    return item;
  }
  return { ...item, start: from, duration };
}

/** A text made by Add Hook Title: adding or removing a hook clip never moves it. */
function isHookTitle(item: TimedItem): boolean {
  return item.type === 'text' && item.hookTitle === true;
}

function placeItem<T extends TimedItem>(
  item: T,
  before: ClipDocument,
  after: ClipDocument,
  total: number,
  clipShiftMs: number,
): T {
  // Whole Clip: an item on the clip's clock that covered the clip still does.
  if (item.anchor === 'clip' && item.start === 0 && item.duration === outputDuration(before)) {
    return item.duration === total ? item : ({ ...item, duration: total } as T);
  }
  let start = item.start;
  if (clipShiftMs !== 0 && isHookTitle(item)) start = item.start;
  else if (item.anchor === 'moment') start = momentStart(before, after, item.start);
  else start = item.start + clipShiftMs;
  return fitInside(item, start, total);
}

export interface ReplaceItemsOptions {
  /**
   * Moves every `clip` item by this much (a hook clip added, or removed:
   * Module 09), except Whole Clip ones, which stay whole. Hook titles (texts
   * made by Add Hook Title, either anchor) do not move at all when this is
   * set: they stay over the hook. 0 by default: `clip` items stay.
   */
  clipShiftMs?: number;
}

/**
 * The `anchor` rule, run at the end of every edit that moves video:
 * `moment` items go back onto the video moment they started on (or to the
 * cut, when it was removed), `clip` items stay, and anything past the new end
 * is shortened or moved back. Items are never deleted, and lengths are kept
 * unless the end forces them shorter. Returns `after` with its tracks
 * re-placed; captions tracks are left as they are.
 */
export function replaceItems(
  before: ClipDocument,
  after: ClipDocument,
  options: ReplaceItemsOptions = {},
): ClipDocument {
  const total = outputDuration(after);
  const shift = options.clipShiftMs ?? 0;
  const tracks = after.tracks.map((track): Track => {
    if (track.kind === 'overlay') {
      return {
        ...track,
        items: track.items.map((item) => placeItem(item, before, after, total, shift)),
      };
    }
    if (track.kind === 'audio') {
      return {
        ...track,
        items: track.items.map((item) => placeItem(item, before, after, total, shift)),
      };
    }
    return track;
  });
  return { ...after, tracks };
}
