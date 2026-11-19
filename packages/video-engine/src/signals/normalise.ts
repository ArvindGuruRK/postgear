/**
 * "How unusual is this moment for this video" (Module 16 section 1).
 *
 * Each track becomes a robust z-score: the value minus a rolling median,
 * over a rolling spread (the median absolute deviation, scaled), with a
 * floor under the spread so a calm stretch does not make everything look
 * loud. Rolling, because a stream's level drifts as the game, the music and
 * the audience change; worked out every 10 seconds and joined by straight
 * lines, so six hours costs well under a second. Only rises count: the
 * result is clamped to 0 to `zMax`. No data stays `NaN` and never scores.
 */
import { TUNING } from './tuning';
import type { SignalTrackName } from './types';

/** The median of finite values (sorts a copy). NaN for none. */
export function median(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return Number.NaN;
  const mid = finite.length >> 1;
  return finite.length % 2 === 1
    ? (finite[mid] as number)
    : ((finite[mid - 1] as number) + (finite[mid] as number)) / 2;
}

interface Baseline {
  median: number;
  mad: number;
}

function baselineOf(values: readonly number[]): Baseline | null {
  const m = median(values);
  if (!Number.isFinite(m)) return null;
  const deviations: number[] = [];
  for (const value of values) {
    if (Number.isFinite(value)) deviations.push(Math.abs(value - m));
  }
  return { median: m, mad: median(deviations) };
}

/**
 * The rolling median and MAD at every sample. Shorter videos (and a window
 * with no data in it) use the whole file's.
 */
export function rollingBaseline(values: Float64Array): { median: Float64Array; mad: Float64Array } {
  const count = values.length;
  const medianOut = new Float64Array(count).fill(Number.NaN);
  const madOut = new Float64Array(count).fill(Number.NaN);
  const whole = baselineOf(Array.from(values));
  if (!whole) return { median: medianOut, mad: madOut };

  const rate = TUNING.rateHz;
  if (count < TUNING.wholeFileBelowSec * rate) {
    medianOut.fill(whole.median);
    madOut.fill(whole.mad);
    return { median: medianOut, mad: madOut };
  }

  const every = Math.max(1, Math.round(TUNING.baselineEverySec * rate));
  const half = Math.round(TUNING.baselineHalfWindowSec * rate);
  const anchors: number[] = [];
  for (let at = 0; at < count; at += every) anchors.push(at);
  if (anchors[anchors.length - 1] !== count - 1) anchors.push(count - 1);

  const at = anchors.map((index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(count, index + half + 1);
    return baselineOf(Array.from(values.subarray(from, to))) ?? whole;
  });

  for (let a = 0; a < anchors.length; a += 1) {
    const start = anchors[a] as number;
    const here = at[a] as Baseline;
    const nextIndex = a + 1 < anchors.length ? (anchors[a + 1] as number) : start;
    const next = a + 1 < anchors.length ? (at[a + 1] as Baseline) : here;
    const span = Math.max(1, nextIndex - start);
    const end = a + 1 < anchors.length ? nextIndex : start + 1;
    for (let i = start; i < end && i < count; i += 1) {
      const t = (i - start) / span;
      medianOut[i] = here.median + (next.median - here.median) * t;
      madOut[i] = here.mad + (next.mad - here.mad) * t;
    }
  }
  return { median: medianOut, mad: madOut };
}

/**
 * Loudness, ready to compare: clamped at the floor, and runs of silence at
 * least `silenceGapSec` long turned into no data (a muted Twitch stretch must
 * neither score nor drag the baseline down).
 */
export function prepareLoudness(values: Float64Array): Float64Array {
  const floor = TUNING.loudnessFloorLufs;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    out[i] = Number.isFinite(value) ? Math.max(floor, value) : Number.NaN;
  }
  const minRun = Math.round(TUNING.silenceGapSec * TUNING.rateHz);
  let runStart = -1;
  for (let i = 0; i <= out.length; i += 1) {
    const silent = i < out.length && (out[i] as number) <= floor;
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      if (i - runStart >= minRun) out.fill(Number.NaN, runStart, i);
      runStart = -1;
    }
  }
  return out;
}

/** A centred moving average over `seconds`, ignoring no data; no data stays no data. */
export function smooth(values: Float64Array, seconds: number): Float64Array {
  const half = Math.max(0, Math.round((seconds * TUNING.rateHz) / 2));
  const out = new Float64Array(values.length).fill(Number.NaN);
  if (half === 0) {
    out.set(values);
    return out;
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i] as number)) continue;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      const value = values[j] as number;
      if (Number.isFinite(value)) {
        sum += value;
        n += 1;
      }
    }
    out[i] = n > 0 ? sum / n : Number.NaN;
  }
  return out;
}

/** Moves a track `seconds` earlier: sample `i` takes what was at `i + shift`. */
export function shiftEarlier(values: Float64Array, seconds: number): Float64Array {
  const shift = Math.round(seconds * TUNING.rateHz);
  const out = new Float64Array(values.length).fill(Number.NaN);
  for (let i = 0; i + shift < values.length; i += 1) out[i] = values[i + shift] as number;
  return out;
}

/** True when nothing moves: no data at all, or every value within the track's floor of each other. */
export function isFlat(values: Float64Array, name: SignalTrackName): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Number.POSITIVE_INFINITY) return true;
  return max - min < TUNING.zFloors[name];
}

export interface Normalised {
  /** 0 to `zMax`; NaN for no data. */
  z: Float64Array;
  /** The rolling median, in the track's own unit (the "usual" level). */
  median: Float64Array;
}

/** The robust z-score of a prepared track against its own rolling baseline. */
export function normalise(values: Float64Array, name: SignalTrackName): Normalised {
  const { median: med, mad } = rollingBaseline(values);
  const floor = TUNING.zFloors[name];
  const z = new Float64Array(values.length).fill(Number.NaN);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    const m = med[i] as number;
    if (!Number.isFinite(value) || !Number.isFinite(m)) continue;
    const spread = TUNING.madScale * (mad[i] as number) + floor;
    const score = (value - m) / spread;
    z[i] = Math.min(TUNING.zMax, Math.max(0, score));
  }
  return { z, median: med };
}
