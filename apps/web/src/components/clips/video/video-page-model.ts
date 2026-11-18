/**
 * The video page in words and rules (Module 07, section 3), as pure
 * functions so they are tested once: marking a range with I and O, why
 * Create Clip is off, the player's time line, and stepping the playhead.
 *
 * Every time here is the video's own time in whole milliseconds.
 */
import { CLIP_MAX_MS, CLIP_MIN_MS, formatClipLength } from '@postgear/video-engine';

export const CLIP_TOO_SHORT = 'A clip needs at least 3 seconds.';
export const CLIP_TOO_LONG = 'A clip can be up to 30 minutes.';
export const MARK_FIRST = 'Mark a start with I and an end with O.';
export const FIND_CLIPS_LATER = 'Arrives in a later step of this sprint.';

/** Seconds the arrows move the playhead: one, or five with Shift. */
export const STEP_MS = 1000;
export const LARGE_STEP_MS = 5000;
/** The player bar's back and forward buttons, and J and L. */
export const JUMP_MS = 5000;

export interface MarkedRange {
  inMs: number | null;
  outMs: number | null;
}

export const NO_MARK: MarkedRange = Object.freeze({ inMs: null, outMs: null });

const whole = (ms: number, durationMs: number) =>
  Math.min(Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)), Math.max(0, durationMs));

/** I: the start at the playhead. An end before it is let go, never swapped. */
export function markIn(range: MarkedRange, atMs: number, durationMs: number): MarkedRange {
  const inMs = whole(atMs, durationMs);
  return { inMs, outMs: range.outMs !== null && range.outMs > inMs ? range.outMs : null };
}

/** O: the end at the playhead. A start after it is let go, never swapped. */
export function markOut(range: MarkedRange, atMs: number, durationMs: number): MarkedRange {
  const outMs = whole(atMs, durationMs);
  return { inMs: range.inMs !== null && range.inMs < outMs ? range.inMs : null, outMs };
}

/**
 * Dragging one end of the band: it never crosses the other end (it stops
 * `CLIP_MIN_MS` short of it) and never leaves the video.
 */
export function dragMarkEdge(
  range: MarkedRange,
  edge: 'in' | 'out',
  atMs: number,
  durationMs: number,
): MarkedRange {
  if (range.inMs === null || range.outMs === null) return range;
  const at = whole(atMs, durationMs);
  if (edge === 'in') {
    return { inMs: Math.min(at, Math.max(0, range.outMs - CLIP_MIN_MS)), outMs: range.outMs };
  }
  return { inMs: range.inMs, outMs: Math.max(at, Math.min(durationMs, range.inMs + CLIP_MIN_MS)) };
}

/** Moving the whole band by its body: its length stays, and it stays inside the video. */
export function moveMark(range: MarkedRange, deltaMs: number, durationMs: number): MarkedRange {
  if (range.inMs === null || range.outMs === null) return range;
  const length = range.outMs - range.inMs;
  const inMs = Math.min(
    Math.max(0, Math.round(range.inMs + deltaMs)),
    Math.max(0, durationMs - length),
  );
  return { inMs, outMs: inMs + length };
}

export type RangeCheck =
  | { ok: true; fromMs: number; toMs: number; lengthMs: number }
  | { ok: false; reason: string; lengthMs: number | null };

/** Whether Create Clip can make this range, and the sentence when it cannot. */
export function checkRange(range: MarkedRange): RangeCheck {
  if (range.inMs === null || range.outMs === null)
    return { ok: false, reason: MARK_FIRST, lengthMs: null };
  const lengthMs = range.outMs - range.inMs;
  if (lengthMs < CLIP_MIN_MS) return { ok: false, reason: CLIP_TOO_SHORT, lengthMs };
  if (lengthMs > CLIP_MAX_MS) return { ok: false, reason: CLIP_TOO_LONG, lengthMs };
  return { ok: true, fromMs: range.inMs, toMs: range.outMs, lengthMs };
}

/** "12:04 / 3:42:10" for the player bar. */
export function playerTimeText(currentMs: number, durationMs: number): string {
  return `${formatClipLength(currentMs)} / ${formatClipLength(durationMs)}`;
}

/** The playhead moved by `deltaMs`, kept inside the video. */
export function stepMs(currentMs: number, deltaMs: number, durationMs: number): number {
  return whole(currentMs + deltaMs, durationMs);
}

/** "0:30" on the marked band, or null while nothing is marked. */
export function clipLengthLabel(lengthMs: number | null): string | null {
  return lengthMs === null || lengthMs <= 0 ? null : formatClipLength(lengthMs);
}
