/**
 * The audio layer's arithmetic (Module 14), kept apart from Web Audio so it
 * is tested without a browser.
 *
 * - `soundStart`: where in its buffer a sound starts when the playhead is
 *   at a frame (music wraps, an effect stops at its file's end), and for
 *   how long an effect plays.
 * - `soundDriftMs`: how far a playing sound has slipped from the picture's
 *   clock. The `<video>` and the audio context are two clocks that drift by
 *   tens of milliseconds, so a sound that slipped more than
 *   `DRIFT_RESTART_MS` is started again in place.
 * - `gainRamp`: the next straight ramp of a gain node towards the gain this
 *   frame asks for (`soundGainAt` times the clip's fade). Ramping over a
 *   frame, not jumping, keeps fades free of clicks.
 * - `peakOf`: the level meter's reading, the loudest sample of a block.
 */

/** A playing sound further off the picture than this is started again in place. */
export const DRIFT_RESTART_MS = 60;
/** How long a gain ramp lasts: about two frames at 60 fps. */
export const GAIN_RAMP_MS = 30;
/** The meter warns from this sample level up (0 dBFS: the mix peaks). */
export const METER_WARN_LEVEL = 1;

export interface SoundStart {
  /** Where in the buffer to start, in seconds. */
  offsetS: number;
  /** How long to play, in seconds, or null for a loop (stopped when its item ends). */
  durationS: number | null;
}

/**
 * Where a sound starts in its buffer for `fileMs` (the frame state's
 * position before any wrap), or null when nothing plays there (an effect
 * past its file's end, or a buffer with no length).
 */
export function soundStart(fileMs: number, bufferS: number, loop: boolean): SoundStart | null {
  if (!(bufferS > 0) || !Number.isFinite(fileMs)) return null;
  const bufferMs = bufferS * 1000;
  const at = Math.max(0, fileMs);
  if (loop) return { offsetS: (at % bufferMs) / 1000, durationS: null };
  if (at >= bufferMs) return null;
  return { offsetS: at / 1000, durationS: (bufferMs - at) / 1000 };
}

/**
 * How far, in ms, a sound started at buffer offset `startOffsetS` at context
 * time `startedAtS` is from where the picture says it should be
 * (`expectedFileMs`), at context time `nowS`. Wraps for a loop.
 */
export function soundDriftMs(
  expectedFileMs: number,
  startOffsetS: number,
  startedAtS: number,
  nowS: number,
  bufferS: number,
  loop: boolean,
): number {
  const playedMs = (startOffsetS + Math.max(0, nowS - startedAtS)) * 1000;
  if (!loop || !(bufferS > 0)) return playedMs - expectedFileMs;
  const bufferMs = bufferS * 1000;
  const expected = ((expectedFileMs % bufferMs) + bufferMs) % bufferMs;
  const actual = ((playedMs % bufferMs) + bufferMs) % bufferMs;
  let diff = actual - expected;
  if (diff > bufferMs / 2) diff -= bufferMs;
  if (diff < -bufferMs / 2) diff += bufferMs;
  return diff;
}

export interface GainRamp {
  /** Hold the node at this value now... */
  fromValue: number;
  fromS: number;
  /** ...and ramp in a straight line to this one. */
  toValue: number;
  toS: number;
}

/** The ramp from the node's current value to the gain this frame asks for. */
export function gainRamp(currentValue: number, target: number, nowS: number): GainRamp {
  const safe = Number.isFinite(target) ? Math.max(0, target) : 0;
  return { fromValue: currentValue, fromS: nowS, toValue: safe, toS: nowS + GAIN_RAMP_MS / 1000 };
}

/** The loudest sample of a block (the meter reads 0 to about 2). */
export function peakOf(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let k = 0; k < samples.length; k += 1) {
    const value = Math.abs(samples[k] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}
