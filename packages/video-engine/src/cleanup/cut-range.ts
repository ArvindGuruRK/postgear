/**
 * Cutting a stretch of the video out of a clip (Sprint 13, Module 04). Pure.
 *
 * Every cleanup tool ends here: deleting words in the Transcript pane,
 * Remove Silences and Remove Filler Words all hand over stretches of the
 * **video's** time, and the clip loses them wherever it plays them. A part
 * that overlaps a stretch is split and its middle dropped. Nothing new goes
 * into the document: the result is a longer segment list, so captions,
 * zooms, crops and items follow by Sprint 12's rules (`finishEdit`).
 *
 * Rules (research 06, section 5):
 * - Cut points are rounded to the canvas's frames, so thirty cuts do not
 *   drift from the frames the export draws.
 * - A kept piece shorter than `PIECE_MIN_MS` goes with the cut (no sliver
 *   of a word or a breath is left between two cuts).
 * - The clip keeps `CLIP_MIN_MS` and at most `MAX_SEGMENTS` parts; past
 *   either the whole cut is refused, never half done.
 *
 * Undo brings a cut back. Restore (`healSegments`) re-joins the two parts on
 * either side of a gap when nothing else about them changed.
 */
import { MAX_SEGMENTS } from '../document/limits';
import { type ClipDocument, type Segment, segmentOutputMs } from '../document/schema';
import { type EditResult, finishEdit, unusedId } from '../time/edits';
import type { MsRange } from '../transcript/types';

/** A kept piece shorter than this (in the clip's time) is removed with the cut. */
export const PIECE_MIN_MS = 250;

export type CutRefusalCode =
  | Extract<EditResult, { ok: false }>['code']
  /** The stretches are not in the clip (already cut, or outside it). */
  | 'nothing_to_cut'
  /** Restore could not re-join the parts: something else about them changed. */
  | 'cannot_restore';

export type CutResult = Extract<EditResult, { ok: true }> | { ok: false; code: CutRefusalCode };

export interface CutOptions {
  /** The canvas's frame rate: cut points are rounded to its frames. */
  fps?: number;
}

/** A time rounded to the nearest frame boundary of `fps`, in whole ms. */
export function alignToFrame(ms: number, fps: number): number {
  if (!(fps > 0)) return Math.round(ms);
  const frame = Math.round((ms * fps) / 1000);
  return Math.round((frame * 1000) / fps);
}

/** Sorted, merged, non-empty ranges (touching ranges join). */
export function mergeCuts(ranges: readonly MsRange[]): MsRange[] {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.fromMs) && Number.isFinite(range.toMs))
    .map((range) => ({ fromMs: Math.round(range.fromMs), toMs: Math.round(range.toMs) }))
    .filter((range) => range.toMs > range.fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);
  const out: MsRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, range.toMs);
    else out.push({ ...range });
  }
  return out;
}

/** What is left of `[fromMs, toMs)` once `cuts` (sorted, merged) are taken out. */
function keptPieces(fromMs: number, toMs: number, cuts: readonly MsRange[]): MsRange[] {
  const pieces: MsRange[] = [];
  let cursor = fromMs;
  for (const cut of cuts) {
    if (cut.toMs <= cursor) continue;
    if (cut.fromMs >= toMs) break;
    if (cut.fromMs > cursor) pieces.push({ fromMs: cursor, toMs: Math.min(cut.fromMs, toMs) });
    cursor = Math.max(cursor, cut.toMs);
    if (cursor >= toMs) break;
  }
  if (cursor < toMs) pieces.push({ fromMs: cursor, toMs });
  return pieces;
}

/**
 * The segment list with `cuts` (video time, of `sourceId`) taken out, before
 * any check. `changed` is false when no part played any of it.
 */
function cutSegments(
  doc: Pick<ClipDocument, 'segments'>,
  sourceId: string,
  cuts: readonly MsRange[],
): { segments: Segment[]; changed: boolean } {
  const segments: Segment[] = [];
  let changed = false;
  for (const segment of doc.segments) {
    if (segment.source !== sourceId) {
      segments.push(segment);
      continue;
    }
    const pieces = keptPieces(segment.sourceIn, segment.sourceOut, cuts);
    if (
      pieces.length === 1 &&
      pieces[0]?.fromMs === segment.sourceIn &&
      pieces[0]?.toMs === segment.sourceOut
    ) {
      segments.push(segment);
      continue;
    }
    changed = true;
    let first = true;
    for (const piece of pieces) {
      const candidate = { ...segment, sourceIn: piece.fromMs, sourceOut: piece.toMs };
      if (segmentOutputMs(candidate) < PIECE_MIN_MS) continue;
      if (first) {
        segments.push({ ...candidate, id: segment.id });
        first = false;
      } else {
        const id = unusedId({ segments: [...doc.segments, ...segments] }, 'seg');
        segments.push({ ...candidate, id });
      }
    }
  }
  return { segments, changed };
}

/**
 * Removes stretches of the video (`sourceId`, video time) from the clip,
 * wherever they play, as one edit. Refused with `nothing_to_cut` when the
 * clip plays none of them, `clip_too_short` under `CLIP_MIN_MS`, and
 * `too_many_segments` past `MAX_SEGMENTS`.
 */
export function removeSourceRanges(
  doc: ClipDocument,
  sourceId: string,
  ranges: readonly MsRange[],
  options: CutOptions = {},
): CutResult {
  const fps = options.fps ?? doc.canvas.fps;
  const cuts = mergeCuts(
    ranges.map((range) => ({
      fromMs: alignToFrame(range.fromMs, fps),
      toMs: alignToFrame(range.toMs, fps),
    })),
  );
  if (cuts.length === 0) return { ok: false, code: 'nothing_to_cut' };
  const { segments, changed } = cutSegments(doc, sourceId, cuts);
  if (!changed) return { ok: false, code: 'nothing_to_cut' };
  if (segments.length === 0) return { ok: false, code: 'clip_too_short' };
  if (segments.length > MAX_SEGMENTS) return { ok: false, code: 'too_many_segments' };
  return finishEdit(doc, segments);
}

/** One stretch: `removeSourceRanges` with a single range. */
export function removeSourceRange(
  doc: ClipDocument,
  sourceId: string,
  fromMs: number,
  toMs: number,
  options: CutOptions = {},
): CutResult {
  return removeSourceRanges(doc, sourceId, [{ fromMs, toMs }], options);
}

/**
 * Restore: puts back a stretch that a cut took out, by re-joining the part
 * that ends before it and the part that starts after it (next to each other
 * in play order, the same video, speed, volume and role, and nothing else in
 * the clip playing the gap). `fromMs` and `toMs` are the removed words' own
 * span; the gap may be a little wider (the air the cut took). Anything else
 * is `cannot_restore`: Undo brings it back instead.
 */
export function healSegments(
  doc: ClipDocument,
  sourceId: string,
  fromMs: number,
  toMs: number,
): CutResult {
  for (let k = 0; k + 1 < doc.segments.length; k += 1) {
    const a = doc.segments[k] as Segment;
    const b = doc.segments[k + 1] as Segment;
    if (a.source !== sourceId || b.source !== sourceId) continue;
    if (!(a.sourceOut <= fromMs && b.sourceIn >= toMs && a.sourceOut < b.sourceIn)) continue;
    const same = a.speed === b.speed && a.volume === b.volume && a.role === b.role;
    const gap = { fromMs: a.sourceOut, toMs: b.sourceIn };
    const playedElsewhere = doc.segments.some(
      (other, index) =>
        index !== k &&
        index !== k + 1 &&
        other.source === sourceId &&
        other.sourceIn < gap.toMs &&
        other.sourceOut > gap.fromMs,
    );
    if (!same || playedElsewhere) return { ok: false, code: 'cannot_restore' };
    const segments = doc.segments.slice();
    segments.splice(k, 2, { ...a, sourceOut: b.sourceOut });
    return finishEdit(doc, segments);
  }
  return { ok: false, code: 'cannot_restore' };
}
