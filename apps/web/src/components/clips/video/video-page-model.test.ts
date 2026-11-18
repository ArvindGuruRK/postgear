import { CLIP_MAX_MS, CLIP_MIN_MS } from '@postgear/video-engine';
import {
  CLIP_TOO_LONG,
  CLIP_TOO_SHORT,
  checkRange,
  clipLengthLabel,
  dragMarkEdge,
  JUMP_MS,
  LARGE_STEP_MS,
  MARK_FIRST,
  markIn,
  markOut,
  moveMark,
  NO_MARK,
  playerTimeText,
  STEP_MS,
  stepMs,
} from './video-page-model';

const DURATION = 180_000;

describe('marking with I and O', () => {
  it('marks a start, then an end after it', () => {
    const started = markIn(NO_MARK, 10_000, DURATION);
    expect(started).toEqual({ inMs: 10_000, outMs: null });
    expect(markOut(started, 40_000, DURATION)).toEqual({ inMs: 10_000, outMs: 40_000 });
  });

  it('lets go of an end that a new start passes, and never swaps them', () => {
    const range = { inMs: 10_000, outMs: 40_000 };
    expect(markIn(range, 50_000, DURATION)).toEqual({ inMs: 50_000, outMs: null });
    expect(markIn(range, 40_000, DURATION)).toEqual({ inMs: 40_000, outMs: null });
    expect(markIn(range, 20_000, DURATION)).toEqual({ inMs: 20_000, outMs: 40_000 });
  });

  it('lets go of a start that a new end comes before', () => {
    const range = { inMs: 10_000, outMs: 40_000 };
    expect(markOut(range, 5_000, DURATION)).toEqual({ inMs: null, outMs: 5_000 });
    expect(markOut(range, 10_000, DURATION)).toEqual({ inMs: null, outMs: 10_000 });
    expect(markOut(range, 60_000, DURATION)).toEqual({ inMs: 10_000, outMs: 60_000 });
  });

  it('keeps marks inside the video, in whole milliseconds', () => {
    expect(markIn(NO_MARK, -500, DURATION).inMs).toBe(0);
    expect(markOut(NO_MARK, DURATION + 9_000, DURATION).outMs).toBe(DURATION);
    expect(markIn(NO_MARK, 1_234.6, DURATION).inMs).toBe(1_235);
    expect(markIn(NO_MARK, Number.NaN, DURATION).inMs).toBe(0);
    expect(markOut(NO_MARK, Number.POSITIVE_INFINITY, DURATION).outMs).toBe(0);
  });
});

describe('dragging and moving the band', () => {
  const range = { inMs: 10_000, outMs: 40_000 };

  it('drags an end without crossing the other, stopping the shortest clip short of it', () => {
    expect(dragMarkEdge(range, 'in', 20_000, DURATION)).toEqual({ inMs: 20_000, outMs: 40_000 });
    expect(dragMarkEdge(range, 'in', 39_000, DURATION)).toEqual({
      inMs: 40_000 - CLIP_MIN_MS,
      outMs: 40_000,
    });
    expect(dragMarkEdge(range, 'out', 11_000, DURATION)).toEqual({
      inMs: 10_000,
      outMs: 10_000 + CLIP_MIN_MS,
    });
    expect(dragMarkEdge(range, 'out', 90_000, DURATION)).toEqual({ inMs: 10_000, outMs: 90_000 });
  });

  it('keeps a dragged end inside the video', () => {
    expect(dragMarkEdge(range, 'in', -5_000, DURATION).inMs).toBe(0);
    expect(dragMarkEdge(range, 'out', DURATION + 5_000, DURATION).outMs).toBe(DURATION);
  });

  it('does nothing to a half-marked band', () => {
    const half = { inMs: 10_000, outMs: null };
    expect(dragMarkEdge(half, 'in', 20_000, DURATION)).toBe(half);
    expect(moveMark(half, 5_000, DURATION)).toBe(half);
  });

  it('moves the whole band keeping its length, inside the video', () => {
    expect(moveMark(range, 5_000, DURATION)).toEqual({ inMs: 15_000, outMs: 45_000 });
    expect(moveMark(range, -50_000, DURATION)).toEqual({ inMs: 0, outMs: 30_000 });
    expect(moveMark(range, 500_000, DURATION)).toEqual({
      inMs: DURATION - 30_000,
      outMs: DURATION,
    });
  });
});

describe('checkRange', () => {
  it('asks for marks first', () => {
    expect(checkRange(NO_MARK)).toEqual({ ok: false, reason: MARK_FIRST, lengthMs: null });
    expect(checkRange({ inMs: 1_000, outMs: null })).toEqual({
      ok: false,
      reason: MARK_FIRST,
      lengthMs: null,
    });
  });

  it('refuses a clip shorter than 3 seconds or longer than 30 minutes', () => {
    expect(checkRange({ inMs: 0, outMs: CLIP_MIN_MS - 1 })).toEqual({
      ok: false,
      reason: CLIP_TOO_SHORT,
      lengthMs: CLIP_MIN_MS - 1,
    });
    expect(checkRange({ inMs: 0, outMs: CLIP_MAX_MS + 1 })).toEqual({
      ok: false,
      reason: CLIP_TOO_LONG,
      lengthMs: CLIP_MAX_MS + 1,
    });
  });

  it('takes the shortest and the longest clip', () => {
    expect(checkRange({ inMs: 1_000, outMs: 1_000 + CLIP_MIN_MS })).toEqual({
      ok: true,
      fromMs: 1_000,
      toMs: 1_000 + CLIP_MIN_MS,
      lengthMs: CLIP_MIN_MS,
    });
    expect(checkRange({ inMs: 0, outMs: CLIP_MAX_MS })).toMatchObject({ ok: true });
  });

  it('says the limits in plain words', () => {
    expect(CLIP_TOO_SHORT).toBe('A clip needs at least 3 seconds.');
    expect(CLIP_TOO_LONG).toBe('A clip can be up to 30 minutes.');
    expect(MARK_FIRST).toBe('Mark a start with I and an end with O.');
  });
});

describe('the player bar', () => {
  it('reads the time and the length', () => {
    expect(playerTimeText(0, 180_000)).toBe('0:00 / 3:00');
    expect(playerTimeText(724_500, 13_330_000)).toBe('12:04 / 3:42:10');
  });

  it('steps the playhead inside the video', () => {
    expect([STEP_MS, LARGE_STEP_MS, JUMP_MS]).toEqual([1_000, 5_000, 5_000]);
    expect(stepMs(10_000, STEP_MS, DURATION)).toBe(11_000);
    expect(stepMs(2_000, -LARGE_STEP_MS, DURATION)).toBe(0);
    expect(stepMs(DURATION - 1_000, JUMP_MS, DURATION)).toBe(DURATION);
  });

  it('names the band length only when there is one', () => {
    expect(clipLengthLabel(null)).toBeNull();
    expect(clipLengthLabel(0)).toBeNull();
    expect(clipLengthLabel(-4)).toBeNull();
    expect(clipLengthLabel(30_000)).toBe('0:30');
    expect(clipLengthLabel(3_723_000)).toBe('1:02:03');
  });
});
