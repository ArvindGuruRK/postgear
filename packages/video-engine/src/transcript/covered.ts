/**
 * Which stretches of a video have been listened to, and what is left.
 *
 * "A stretch of video is listened to once": every request goes through
 * `missingRanges`, so asking again for a covered stretch starts nothing and
 * costs nothing, and a wider request listens only to the new part.
 *
 * Requests are rounded outward to whole 30 second blocks first
 * (`roundOutward`), so a clip nudged by half a second never starts a tiny
 * job with a two minute minimum price.
 */
import type { MsRange } from './types';

/** Requests are rounded outward to blocks of this length. */
export const LISTEN_BLOCK_MS = 30_000;

function valid(range: MsRange): boolean {
  return Number.isFinite(range.fromMs) && Number.isFinite(range.toMs) && range.toMs > range.fromMs;
}

/** Sorted, with touching and overlapping ranges joined. Empty and backwards ranges are dropped. */
export function mergeRanges(ranges: readonly MsRange[]): MsRange[] {
  const sorted = ranges
    .filter(valid)
    .map((range) => ({ fromMs: Math.round(range.fromMs), toMs: Math.round(range.toMs) }))
    .sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  const out: MsRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, range.toMs);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

/** The parts of `wanted` that `covered` does not hold, in order. */
export function missingRanges(covered: readonly MsRange[], wanted: MsRange): MsRange[] {
  if (!valid(wanted)) return [];
  const out: MsRange[] = [];
  let cursor = Math.round(wanted.fromMs);
  const end = Math.round(wanted.toMs);
  for (const range of mergeRanges(covered)) {
    if (range.toMs <= cursor) continue;
    if (range.fromMs >= end) break;
    if (range.fromMs > cursor) out.push({ fromMs: cursor, toMs: Math.min(range.fromMs, end) });
    cursor = Math.max(cursor, range.toMs);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ fromMs: cursor, toMs: end });
  return out;
}

/** True when every millisecond of `wanted` has been listened to. */
export function isCovered(covered: readonly MsRange[], wanted: MsRange): boolean {
  return valid(wanted) && missingRanges(covered, wanted).length === 0;
}

/** The total length of the ranges, overlaps counted once. */
export function rangesMs(ranges: readonly MsRange[]): number {
  return mergeRanges(ranges).reduce((sum, range) => sum + (range.toMs - range.fromMs), 0);
}

/** The parts of `ranges` inside `window`. */
export function clipRanges(ranges: readonly MsRange[], window: MsRange): MsRange[] {
  if (!valid(window)) return [];
  return mergeRanges(ranges)
    .map((range) => ({
      fromMs: Math.max(range.fromMs, window.fromMs),
      toMs: Math.min(range.toMs, window.toMs),
    }))
    .filter(valid);
}

/**
 * A request rounded outward to whole blocks and held inside the video. The
 * last block may be short: a video rarely ends on a block.
 */
export function roundOutward(
  wanted: MsRange,
  durationMs: number,
  blockMs: number = LISTEN_BLOCK_MS,
): MsRange | null {
  const duration = Math.max(0, Math.floor(durationMs));
  const from = Math.max(0, Math.min(Math.round(wanted.fromMs), duration));
  const to = Math.max(0, Math.min(Math.round(wanted.toMs), duration));
  if (to <= from) return null;
  return {
    fromMs: Math.floor(from / blockMs) * blockMs,
    toMs: Math.min(duration, Math.ceil(to / blockMs) * blockMs),
  };
}

/**
 * What a request still has to listen to: rounded outward, then with the
 * covered parts taken out. Empty means "answer at once, charge nothing".
 */
export function rangesToListen(
  covered: readonly MsRange[],
  wanted: MsRange,
  durationMs: number,
): MsRange[] {
  const rounded = roundOutward(wanted, durationMs);
  return rounded ? missingRanges(covered, rounded) : [];
}
