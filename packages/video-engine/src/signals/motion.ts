/**
 * Look For Action (Sprint 13, Module 06): sudden bursts of movement in the
 * picture, from the `motion` track. Pure.
 *
 * The motion track is the mean absolute difference between neighbouring grey
 * pictures, two a second (the Python service measures it). A hard cut is a
 * spike in that measure too, so moments the `scene` track calls a cut are
 * taken out before anything else: a spike that coincides with a cut is a
 * cut, not action. What is left is compared with the video's own movement
 * nearby (a rolling median and spread), so a busy game and a calm webcam are
 * each judged against themselves.
 *
 * A burst counts for more when the sound rises with it or just after it (a
 * crash with a shout); alone it is weaker. It never knows what happened: the
 * optional check on stills (`still-checker` in the AI engine) is what puts a
 * sentence to it, and the setup says so plainly.
 *
 * The motion track sits beside Sprint 12's tracks in the SIGNALS file but is
 * not one of the scorer's tracks (`findHighlights` never reads it), so Quick
 * Find is unchanged.
 */
import { onGrid, sampleStartMs, TRACK_RATE_HZ, trackSampleCount } from './tracks';
import { TUNING } from './tuning';
import type { SignalTrack } from './types';

/** The motion track's version: bumped when the Python measure changes how it measures. */
export const MOTION_TRACK_VERSION = 1;

/** The tuning set's name, kept on the run beside Sprint 12's. */
export const MOTION_TUNING_NAME = 'motion-v1';

export const MOTION_TUNING = Object.freeze({
  /** The rolling median and spread look this far each side. */
  baselineHalfWindowSec: 30,
  /** The smallest spread, in grey levels: a still picture does not make every flicker a burst. */
  spreadFloor: 2,
  madScale: 1.4826,
  zMax: 12,
  /** A sample at least this unusual is part of a burst ... */
  burstZ: 3,
  /** ... and a burst lasts at least this long. */
  minBurstSec: 1,
  /** Moments this close to a cut are left out (the cut's own picture change). */
  cutMarginSec: 0.5,
  /** Sound rising this much (LU) above its level just before ... */
  soundRiseLu: 6,
  /** ... within this long after the burst starts (or while it lasts) makes it a burst with sound. */
  soundAfterSec: 1.5,
  /** How far back "just before" looks. */
  soundBeforeSec: 8,
  /** A burst with sound counts this much more. */
  soundBonus: 1.4,
  /** score = 100 x (1 - exp(-strength / scoreScale)). */
  scoreScale: 5,
  /** Two bursts are at least this far apart (research 06 section 9). */
  minGapSec: 20,
  /** The most bursts one run looks at. */
  maxBursts: 20,
  /** The most bursts shown to the still checker in one run. */
  maxChecked: 12,
  /** A clip made from a burst alone: this much before it starts ... */
  leadInSec: 8,
  /** ... and this much after it ends. */
  tailSec: 6,
  /** Without the still checker a burst counts this much (it is only movement). */
  unseenWeight: 0.8,
  /** A burst alone becomes its own clip from this score up. */
  keepFrom: 40,
  /** The still checker must be at least this sure, or the burst is dropped. */
  minSure: 0.6,
});

/** A burst of movement: video time, whole milliseconds. */
export interface MotionBurst {
  fromMs: number;
  toMs: number;
  /** The strongest moment. */
  peakMs: number;
  /** How unusual it was (capped), with the sound bonus when it applies. */
  strength: number;
  /** The sound rose with it or just after it. */
  withSound: boolean;
  /** 0 to 100. */
  score: number;
}

/** The motion track from a stored motion file's values (two a second from the start). */
export function motionTrack(values: ReadonlyArray<number | null>): SignalTrack {
  return {
    name: 'motion',
    version: MOTION_TRACK_VERSION,
    sampleRateHz: TRACK_RATE_HZ,
    startSec: 0,
    unit: 'grey_levels',
    values: [...values],
  };
}

/** True when this is a motion track the bursts can read as it is. */
export function isCurrentMotionTrack(track: Pick<SignalTrack, 'name' | 'version'> | null): boolean {
  return track?.name === 'motion' && track.version === MOTION_TRACK_VERSION;
}

/**
 * The new values laid over the old ones: a measured sample replaces, a gap
 * keeps what was there. An old track of another version is dropped.
 */
export function mergeMotion(
  stored: SignalTrack | null,
  values: ReadonlyArray<number | null>,
  durationMs: number,
): SignalTrack {
  const count = trackSampleCount(durationMs);
  const old = stored && isCurrentMotionTrack(stored) ? onGrid(stored, count) : null;
  const out: Array<number | null> = new Array(count).fill(null);
  for (let i = 0; i < count; i += 1) {
    const next = values[i];
    if (typeof next === 'number' && Number.isFinite(next)) out[i] = next;
    else if (old && Number.isFinite(old[i])) out[i] = old[i] as number;
  }
  return motionTrack(out);
}

/**
 * The parts of `range` the stored motion track has not measured yet, as
 * whole-sample stretches. Empty when it is all there.
 */
export function unmeasuredMotion(
  stored: SignalTrack | null,
  range: { fromMs: number; toMs: number },
  durationMs: number,
): Array<{ fromMs: number; toMs: number }> {
  const count = trackSampleCount(durationMs);
  const grid = stored && isCurrentMotionTrack(stored) ? onGrid(stored, count) : null;
  const first = Math.max(0, Math.floor((range.fromMs / 1000) * TRACK_RATE_HZ));
  const last = Math.min(
    count,
    Math.ceil((Math.min(range.toMs, durationMs) / 1000) * TRACK_RATE_HZ),
  );
  const out: Array<{ fromMs: number; toMs: number }> = [];
  let start: number | null = null;
  for (let i = first; i <= last; i += 1) {
    const missing = i < last && (!grid || !Number.isFinite(grid[i]));
    if (missing && start === null) start = i;
    if (!missing && start !== null) {
      out.push({ fromMs: sampleStartMs(start), toMs: Math.min(durationMs, sampleStartMs(i)) });
      start = null;
    }
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Samples a cut covers (the scene track at or above a cut's score), with a margin each side. */
function cutMask(scene: Float64Array, count: number): Uint8Array {
  const mask = new Uint8Array(count);
  const margin = Math.round(MOTION_TUNING.cutMarginSec * TRACK_RATE_HZ);
  for (let i = 0; i < count; i += 1) {
    if (!(scene[i] !== undefined && (scene[i] as number) >= TUNING.cutScore)) continue;
    for (let j = Math.max(0, i - margin); j <= Math.min(count - 1, i + margin); j += 1) mask[j] = 1;
  }
  return mask;
}

/** How unusual each sample's movement is against its own neighbourhood (0 where masked or unknown). */
function unusualness(motion: Float64Array, mask: Uint8Array, count: number): Float64Array {
  const z = new Float64Array(count);
  const half = Math.round(MOTION_TUNING.baselineHalfWindowSec * TRACK_RATE_HZ);
  for (let i = 0; i < count; i += 1) {
    const value = motion[i] as number;
    if (mask[i] || !Number.isFinite(value)) continue;
    const window: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(count - 1, i + half); j += 1) {
      const other = motion[j] as number;
      if (!mask[j] && Number.isFinite(other)) window.push(other);
    }
    const middle = median(window);
    const spread = Math.max(
      MOTION_TUNING.spreadFloor,
      median(window.map((v) => Math.abs(v - middle))) * MOTION_TUNING.madScale,
    );
    z[i] = Math.min(MOTION_TUNING.zMax, Math.max(0, (value - middle) / spread));
  }
  return z;
}

/** True when the sound rises enough with the burst or just after it. */
function soundRises(loudness: Float64Array | null, fromIndex: number, toIndex: number): boolean {
  if (!loudness) return false;
  const before: number[] = [];
  const back = Math.round(MOTION_TUNING.soundBeforeSec * TRACK_RATE_HZ);
  for (let i = Math.max(0, fromIndex - back); i < fromIndex; i += 1) {
    const value = loudness[i] as number;
    if (Number.isFinite(value) && value > TUNING.loudnessFloorLufs) before.push(value);
  }
  const after = Math.round(MOTION_TUNING.soundAfterSec * TRACK_RATE_HZ);
  let peak = Number.NEGATIVE_INFINITY;
  for (let i = fromIndex; i <= Math.min(loudness.length - 1, toIndex + after); i += 1) {
    const value = loudness[i] as number;
    if (Number.isFinite(value)) peak = Math.max(peak, value);
  }
  if (!Number.isFinite(peak)) return false;
  const base = before.length > 0 ? median(before) : TUNING.loudnessFloorLufs;
  return peak - base >= MOTION_TUNING.soundRiseLu;
}

export interface MotionBurstOptions {
  durationMs: number;
  /** Only bursts whose peak is inside this stretch count. */
  range?: { fromMs: number; toMs: number };
}

/**
 * The bursts of movement, strongest first, at least `minGapSec` apart.
 * `scene` takes cuts out; `loudness`, when there, says which bursts the sound
 * agrees with. Empty without a motion track.
 */
export function motionBursts(
  motion: SignalTrack | null,
  scene: SignalTrack | null,
  loudness: SignalTrack | null,
  options: MotionBurstOptions,
): MotionBurst[] {
  if (!motion || !isCurrentMotionTrack(motion)) return [];
  const count = trackSampleCount(options.durationMs);
  if (count === 0) return [];
  const m = onGrid(motion, count);
  const mask = scene ? cutMask(onGrid(scene, count), count) : new Uint8Array(count);
  const z = unusualness(m, mask, count);
  const loud = loudness ? onGrid(loudness, count) : null;
  const minSamples = Math.max(1, Math.round(MOTION_TUNING.minBurstSec * TRACK_RATE_HZ));

  const found: MotionBurst[] = [];
  let i = 0;
  while (i < count) {
    if ((z[i] as number) < MOTION_TUNING.burstZ) {
      i += 1;
      continue;
    }
    const start = i;
    let peak = i;
    while (i < count && (z[i] as number) >= MOTION_TUNING.burstZ) {
      if ((z[i] as number) > (z[peak] as number)) peak = i;
      i += 1;
    }
    const end = i;
    if (end - start < minSamples) continue;
    const withSound = soundRises(loud, start, end - 1);
    const strength = (z[peak] as number) * (withSound ? MOTION_TUNING.soundBonus : 1);
    found.push({
      fromMs: sampleStartMs(start),
      toMs: Math.min(options.durationMs, sampleStartMs(end)),
      peakMs: sampleStartMs(peak),
      strength: Math.round(strength * 100) / 100,
      withSound,
      score: Math.round(100 * (1 - Math.exp(-strength / MOTION_TUNING.scoreScale))),
    });
  }

  const inside = options.range
    ? found.filter(
        (b) => b.peakMs >= (options.range?.fromMs ?? 0) && b.peakMs < (options.range?.toMs ?? 0),
      )
    : found;
  const kept: MotionBurst[] = [];
  const gap = MOTION_TUNING.minGapSec * 1000;
  for (const burst of [...inside].sort((a, b) => b.strength - a.strength || a.peakMs - b.peakMs)) {
    if (kept.some((other) => Math.abs(other.peakMs - burst.peakMs) < gap)) continue;
    kept.push(burst);
    if (kept.length >= MOTION_TUNING.maxBursts) break;
  }
  return kept;
}

/**
 * The four moments the still checker sees for a burst: just before, at the
 * peak, just after, and two seconds after (held inside the video).
 */
export function burstStillMoments(burst: MotionBurst, durationMs: number): number[] {
  const last = Math.max(0, durationMs - 1);
  const clamp = (ms: number) => Math.min(last, Math.max(0, Math.round(ms)));
  return [
    clamp(burst.fromMs - 500),
    clamp(burst.peakMs),
    clamp(burst.toMs + 500),
    clamp(burst.toMs + 2000),
  ];
}

/**
 * The clip a burst alone becomes: a lead-in so the build-up is included, a
 * tail for the reaction, grown to `minMs` and cut to `maxMs`, inside `range`.
 */
export function actionWindow(
  burst: MotionBurst,
  bounds: { minMs: number; maxMs: number },
  range: { fromMs: number; toMs: number },
): { fromMs: number; toMs: number } {
  const lo = Math.max(0, range.fromMs);
  const hi = Math.max(lo, range.toMs);
  let fromMs = Math.max(lo, burst.fromMs - MOTION_TUNING.leadInSec * 1000);
  let toMs = Math.min(hi, burst.toMs + MOTION_TUNING.tailSec * 1000);
  if (toMs - fromMs < bounds.minMs) {
    // Grow the tail first (the reaction), then the lead-in.
    toMs = Math.min(hi, fromMs + bounds.minMs);
    fromMs = Math.max(lo, toMs - bounds.minMs);
  }
  if (toMs - fromMs > bounds.maxMs) {
    // Keep the peak, and the lead-in before it.
    fromMs = Math.max(lo, fromMs, burst.peakMs - MOTION_TUNING.leadInSec * 1000);
    toMs = Math.min(hi, fromMs + bounds.maxMs);
  }
  return { fromMs: Math.round(fromMs), toMs: Math.round(toMs) };
}
