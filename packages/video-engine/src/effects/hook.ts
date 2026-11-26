/**
 * Add Hook Clip and Add Hook Title (Sprint 13, Module 09). Pure.
 *
 * A hook clip plays a chosen 1 to 5 seconds of the clip first, then the clip
 * from its start. It is no new structure: the chosen stretch is copied as new
 * first segments with `role: 'hook'` (the same video read twice; a stretch
 * over a cut is copied piece by piece). The time map, the captions (their
 * loop is over segments, so the hook shows its captions) and the compiler
 * treat it as any other part.
 *
 * Items when a hook is added (and back when it is removed):
 * - `moment` items follow their video moment, on its main play, so they
 *   move later by the hook's length;
 * - `clip` items move later by the hook's length too, so they keep their
 *   place over the main clip; a Whole Clip one stays whole;
 * - a hook title (`hookTitle: true`) does not move: it stays over the hook.
 *
 * `removeHook(setHook(doc, range))` gives back `doc` exactly.
 */
import { stripEmoji } from '../document/emoji';
import { CLIP_MAX_MS, MAX_SEGMENTS, SEGMENT_MIN_MS, TEXT_MAX } from '../document/limits';
import {
  type ClipDocument,
  type Segment,
  segmentOutputMs,
  type TextItem,
} from '../document/schema';
import { copyTextStyle, type HookStyleId, textStylePreset } from '../document/text';
import { replaceItems } from '../time/edits';
import { addItem, updateItem, usedIds } from '../time/items';
import { outputDuration, placeSegments, toOutput } from '../time/time-map';

/** A hook is 1 to 5 seconds. */
export const HOOK_MIN_MS = 1_000;
export const HOOK_MAX_MS = 5_000;
/** How long the suggested hook is. */
export const HOOK_SUGGEST_MS = 2_500;
/** A hook title shows for the first 3 seconds. */
export const HOOK_TITLE_MS = 3_000;
/** A hook title's centre, a fraction of the canvas height (the top third). */
export const HOOK_TITLE_Y = 0.18;
/** A hook title's box is this share of the canvas width. */
export const HOOK_TITLE_WIDTH_SHARE = 0.86;

/** A stretch of the clip, in ms on the clip's clock **without** its hook. */
export interface HookRange {
  fromOutputMs: number;
  toOutputMs: number;
}

export type HookRefusalCode =
  /** A time that is not a finite number, or a range that ends before it starts. */
  | 'invalid_time'
  /** Shorter than `HOOK_MIN_MS` (also when the range is mostly outside the clip). */
  | 'hook_too_short'
  /** Longer than `HOOK_MAX_MS`. */
  | 'hook_too_long'
  /** The hook would take the clip past `MAX_SEGMENTS` parts. */
  | 'too_many_segments'
  /** The hook would take the clip past `CLIP_MAX_MS`. */
  | 'clip_too_long';

export interface HookInfo {
  /** The hook's parts, in play order. */
  segmentIds: string[];
  /** How long the hook plays, ms. */
  durationMs: number;
  /** Where the hooked stretch is in the clip without the hook, or null when it is no longer there. */
  range: HookRange | null;
}

function isHook(segment: Segment): boolean {
  return segment.role === 'hook';
}

/** The clip without its hook (the same object when it has none). */
function withoutHook(doc: ClipDocument): ClipDocument {
  if (!doc.segments.some(isHook)) return doc;
  return { ...doc, segments: doc.segments.filter((segment) => !isHook(segment)) };
}

/** The clip's hook, or null. A clip has at most one. */
export function hookOf(doc: ClipDocument): HookInfo | null {
  const parts = doc.segments.filter(isHook);
  const first = parts[0];
  if (!first) return null;
  const durationMs = parts.reduce((sum, segment) => sum + segmentOutputMs(segment), 0);
  const from = toOutput(withoutHook(doc), first.source, first.sourceIn);
  return {
    segmentIds: parts.map((segment) => segment.id),
    durationMs,
    range: from === null ? null : { fromOutputMs: from, toOutputMs: from + durationMs },
  };
}

/** A part id nothing in the document uses: `hook_<n>` when free. */
function hookIds(doc: ClipDocument, count: number): string[] {
  const taken = usedIds(doc);
  for (const bleep of doc.bleeps) taken.add(bleep.id);
  const ids: string[] = [];
  for (let n = 0; ids.length < count; n += 1) {
    const id = `hook_${n}`;
    if (!taken.has(id)) ids.push(id);
  }
  return ids;
}

type Pieces =
  | { ok: true; pieces: Omit<Segment, 'id'>[]; durationMs: number }
  | { ok: false; code: HookRefusalCode };

/** The stretch `range` of `main` (a clip with no hook) as parts, one per part it crosses. */
function hookPieces(main: ClipDocument, range: HookRange): Pieces {
  const from = Math.round(range.fromOutputMs);
  const to = Math.round(range.toOutputMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return { ok: false, code: 'invalid_time' };
  }
  if (to - from < HOOK_MIN_MS) return { ok: false, code: 'hook_too_short' };
  if (to - from > HOOK_MAX_MS) return { ok: false, code: 'hook_too_long' };

  const pieces: Omit<Segment, 'id'>[] = [];
  let durationMs = 0;
  for (const placed of placeSegments(main)) {
    const a = Math.max(from, placed.outStart);
    const b = Math.min(to, placed.outEnd);
    if (b <= a) continue;
    const { segment } = placed;
    const sourceIn = Math.min(
      segment.sourceOut,
      segment.sourceIn + Math.round((a - placed.outStart) * segment.speed),
    );
    const sourceOut = Math.min(
      segment.sourceOut,
      segment.sourceIn + Math.round((b - placed.outStart) * segment.speed),
    );
    if (sourceOut <= sourceIn) continue;
    const length = segmentOutputMs({ sourceIn, sourceOut, speed: segment.speed });
    // A sliver of a part at the range's edge is left out rather than played as a flash.
    if (length < SEGMENT_MIN_MS) continue;
    pieces.push({
      source: segment.source,
      sourceIn,
      sourceOut,
      speed: segment.speed,
      volume: segment.volume,
      role: 'hook',
    });
    durationMs += length;
  }
  if (durationMs < HOOK_MIN_MS) return { ok: false, code: 'hook_too_short' };
  return { ok: true, pieces, durationMs };
}

/**
 * Why `setHook(doc, range)` would be refused, or null when it can be added.
 * `range` is on the clip's clock without its hook.
 */
export function canSetHook(doc: ClipDocument, range: HookRange): HookRefusalCode | null {
  const main = withoutHook(doc);
  const found = hookPieces(main, range);
  if (!found.ok) return found.code;
  if (main.segments.length + found.pieces.length > MAX_SEGMENTS) return 'too_many_segments';
  if (outputDuration(main) + found.durationMs > CLIP_MAX_MS) return 'clip_too_long';
  return null;
}

/**
 * Plays `range` (1 to 5 s of the clip, on its clock without the hook) first,
 * as new first parts with `role: 'hook'`; one undo step. A hook the clip had
 * is replaced. Items move as the file comment says. Returns the same document
 * when the range is refused (`canSetHook` says why).
 */
export function setHook(doc: ClipDocument, range: HookRange): ClipDocument {
  if (canSetHook(doc, range) !== null) return doc;
  const base = removeHook(doc);
  const found = hookPieces(base, range);
  if (!found.ok) return doc;
  const ids = hookIds(base, found.pieces.length);
  const hook: Segment[] = found.pieces.map((piece, k) => ({ id: ids[k] as string, ...piece }));
  const after: ClipDocument = { ...base, segments: [...hook, ...base.segments] };
  return replaceItems(base, after, { clipShiftMs: found.durationMs });
}

/**
 * Drops the hook; every item goes back where it was. The same document when
 * there is none, or when the hook is all the clip has left (a clip needs a part).
 */
export function removeHook(doc: ClipDocument): ClipDocument {
  const hook = hookOf(doc);
  if (!hook) return doc;
  const main = withoutHook(doc);
  if (main.segments.length === 0) return doc;
  return replaceItems(doc, main, { clipShiftMs: -hook.durationMs });
}

// --- The suggestion ------------------------------------------------------------

/** A moment of a signal: `at` in the video's own time (ms), `value` how strong (any scale). */
export interface HookPeak {
  at: number;
  value: number;
}

/** A word's time in the video, ms. */
export interface HookWord {
  start: number;
  end: number;
}

/**
 * The suggested hook: `HOOK_SUGGEST_MS` around the strongest peak the clip
 * plays (the earliest of equal ones), kept inside the clip, its edges moved
 * out to the start and end of the words they cut through when there is a
 * transcript (and the result is still 1 to 5 s). Null without a peak inside
 * the clip. Times are on the clip's clock without its hook.
 */
export function suggestHook(
  doc: ClipDocument,
  signals: { peaks: readonly HookPeak[] } | null,
  words: readonly HookWord[] | null,
): HookRange | null {
  if (!signals) return null;
  const main = withoutHook(doc);
  const placed = placeSegments(main);
  const total = outputDuration(main);
  let best: { at: number; value: number; out: number } | null = null;
  for (const peak of signals.peaks) {
    if (!Number.isFinite(peak.at) || !Number.isFinite(peak.value)) continue;
    const holder = placed.find(
      (entry) => peak.at >= entry.segment.sourceIn && peak.at < entry.segment.sourceOut,
    );
    if (!holder) continue;
    if (best && (peak.value < best.value || (peak.value === best.value && peak.at >= best.at))) {
      continue;
    }
    const out = toOutput(main, holder.segment.source, peak.at, holder.segment.id);
    if (out !== null) best = { at: peak.at, value: peak.value, out };
  }
  if (!best) return null;

  const length = Math.min(HOOK_SUGGEST_MS, total);
  const from = Math.min(Math.max(0, Math.round(best.out - length / 2)), total - length);
  const plain: HookRange = { fromOutputMs: from, toOutputMs: from + length };
  if (!words || words.length === 0) return plain;

  // The words on the clip's clock (a word cut by a part edge is left out).
  const shown: Array<{ start: number; end: number }> = [];
  for (const entry of placed) {
    const { segment } = entry;
    for (const word of words) {
      if (word.start < segment.sourceIn || word.end > segment.sourceOut) continue;
      shown.push({
        start: entry.outStart + Math.round((word.start - segment.sourceIn) / segment.speed),
        end: entry.outStart + Math.round((word.end - segment.sourceIn) / segment.speed),
      });
    }
  }
  const startAt = shown.find(
    (word) => plain.fromOutputMs > word.start && plain.fromOutputMs < word.end,
  );
  const endAt = shown.find((word) => plain.toOutputMs > word.start && plain.toOutputMs < word.end);
  const snapped: HookRange = {
    fromOutputMs: startAt ? startAt.start : plain.fromOutputMs,
    toOutputMs: endAt ? Math.min(total, endAt.end) : plain.toOutputMs,
  };
  const span = snapped.toOutputMs - snapped.fromOutputMs;
  return span >= HOOK_MIN_MS && span <= HOOK_MAX_MS && snapped.fromOutputMs >= 0 ? snapped : plain;
}

/**
 * The editor's peaks from a video's waveform (Sprint 12's: `perSecond`
 * bytes a second from the video's start, each the loudest sample as 0 to
 * 255), smoothed over one second so the strongest is a loud second, not one
 * loud sample. `range` (video ms) keeps only that stretch.
 */
export function peaksFromWaveform(
  peaks: ArrayLike<number>,
  perSecond: number,
  range?: { fromMs: number; toMs: number },
): HookPeak[] {
  if (!(perSecond > 0) || peaks.length === 0) return [];
  const window = Math.max(1, Math.round(perSecond));
  const first = range ? Math.max(0, Math.floor((range.fromMs / 1000) * perSecond)) : 0;
  const last = range
    ? Math.min(peaks.length, Math.ceil((range.toMs / 1000) * perSecond))
    : peaks.length;
  const out: HookPeak[] = [];
  for (let k = first; k < last; k += 1) {
    const lo = Math.max(0, k - Math.floor(window / 2));
    const hi = Math.min(peaks.length, lo + window);
    let sum = 0;
    for (let j = lo; j < hi; j += 1) sum += peaks[j] ?? 0;
    out.push({ at: Math.round((k * 1000) / perSecond), value: sum / (hi - lo) });
  }
  return out;
}

// --- The hook title --------------------------------------------------------------

/**
 * Add Hook Title: `text` in a hook look at 0 for `HOOK_TITLE_MS` (shorter
 * when the clip is), on the clip's clock, in the top third, marked
 * `hookTitle`; one undo step. A clip keeps one: choosing again changes the
 * existing title's words and look and leaves where it is alone. Emoji are
 * taken out (they are stickers). Returns the same document when the text is
 * empty or the clip has no room for another item.
 */
export function addHookTitle(doc: ClipDocument, text: string, styleId: HookStyleId): ClipDocument {
  const words = stripEmoji(text).replace(/\s+/gu, ' ').trim().slice(0, TEXT_MAX).trim();
  if (words.length === 0) return doc;
  const style = copyTextStyle(textStylePreset(styleId).style);

  const existing = hookTitleOf(doc);
  if (existing) {
    const result = updateItem<TextItem>(doc, existing.id, (item) =>
      item.text === words && JSON.stringify(item.style) === JSON.stringify(style)
        ? item
        : { ...item, text: words, style },
    );
    return result.ok ? result.doc : doc;
  }

  const total = outputDuration(doc);
  const item: TextItem = {
    id: 'txt_new',
    type: 'text',
    start: 0,
    duration: Math.min(HOOK_TITLE_MS, total),
    anchor: 'clip',
    text: words,
    style,
    transform: { x: 0.5, y: HOOK_TITLE_Y, scale: 1, rotation: 0, opacity: 1 },
    widthPx: Math.round(doc.canvas.width * HOOK_TITLE_WIDTH_SHARE),
    fadeInMs: 0,
    fadeOutMs: 0,
    hookTitle: true,
  };
  const result = addItem(doc, item);
  return result.ok ? result.doc : doc;
}

/** The clip's hook title, or null. */
export function hookTitleOf(doc: ClipDocument): TextItem | null {
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type === 'text' && item.hookTitle === true) return item;
    }
  }
  return null;
}
