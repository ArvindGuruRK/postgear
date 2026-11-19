/**
 * The highlight scorer (Module 16 section 2): tracks in, proposed clips out.
 *
 * A pure function: no FFmpeg, no network, no clock and no randomness, so the
 * same tracks always give the same clips (which is what makes the simulation
 * and the tests exact). The steps, each its own small function below:
 *
 * 1. Put every usable track on the two-a-second grid and normalise it
 *    (`normalise.ts`); a track that is flat, of an unknown version, or chat
 *    under the message floor is skipped and the run says so.
 * 2. Move chat earlier by its lag, so the reaction meets the moment.
 * 3. Combine: a weighted sum over the tracks present at each moment, the
 *    weights re-scaled to add to one, times a bonus when two or more tracks
 *    are unusual together; then smoothed.
 * 4. Pick peaks strongest first, at least `peakMinGapSec` apart, up to the cap.
 * 5. Build a window around each: a lead-in, a tail that grows while the
 *    moment lasts, ends snapped to nearby scene cuts, 15 to 60 seconds.
 *    Overlapping windows merge.
 * 6. Score each 0 to 100 and give up to three reasons from the tracks that
 *    drove it. Anything under the floor is dropped: nothing rather than weak picks.
 *
 * Works with any subset of tracks; a video with no usable track returns no
 * ranges. Sprint 13 adds tracks to the registry, not steps to this file.
 */
import { isFlat, normalise, prepareLoudness, shiftEarlier, smooth } from './normalise';
import {
  chatMessageTotal,
  isCurrentTrack,
  onGrid,
  sampleStartMs,
  trackSampleCount,
} from './tracks';
import { SIGNALS_ENGINE_VERSION, SIGNALS_TUNING, TUNING } from './tuning';
import {
  type HighlightRange,
  type HighlightReason,
  SIGNAL_TRACKS,
  type SignalTrack,
  type SignalTrackName,
  type TrackName,
  type TrackSkipReason,
} from './types';

export interface FindHighlightsOptions {
  /** The video's length. */
  durationMs: number;
  /** At most this many clips (and never more than the tuning's cap). */
  maxClips?: number;
}

export interface HighlightResult {
  engineVersion: number;
  tuning: string;
  /** Best first. */
  ranges: HighlightRange[];
  /** The tracks that took part, in the registry's order. */
  used: SignalTrackName[];
  /** The tracks given that took no part, and why. */
  skipped: Array<{ name: TrackName; reason: TrackSkipReason }>;
}

interface Prepared {
  name: SignalTrackName;
  /** The prepared values in the track's unit (loudness clamped, chat smoothed). */
  values: Float64Array;
  /** 0 to `zMax`, NaN for no data; chat already moved earlier. */
  z: Float64Array;
  median: Float64Array;
}

/** The number of samples in `seconds`. */
function samples(seconds: number): number {
  return Math.round(seconds * TUNING.rateHz);
}

// ---- 1. Prepare -------------------------------------------------------------------

function prepareTracks(
  tracks: readonly SignalTrack[],
  count: number,
  durationMs: number,
): { prepared: Prepared[]; skipped: HighlightResult['skipped'] } {
  const skipped: HighlightResult['skipped'] = [];
  const byName = new Map<SignalTrackName, SignalTrack>();
  for (const track of tracks) {
    if (!isCurrentTrack(track)) {
      skipped.push({ name: track.name, reason: 'unknown_version' });
      continue;
    }
    // The first of a name wins; a second copy is ignored.
    if (!byName.has(track.name as SignalTrackName))
      byName.set(track.name as SignalTrackName, track);
  }

  const prepared: Prepared[] = [];
  for (const name of SIGNAL_TRACKS) {
    const track = byName.get(name);
    if (!track) continue;
    let values = onGrid(track, count);
    if (name === 'loudness') values = prepareLoudness(values);
    if (name === 'chat') {
      const hours = durationMs / 3_600_000;
      if (hours <= 0 || chatMessageTotal(track) / hours < TUNING.chatMinPerHour) {
        skipped.push({ name, reason: 'too_few_messages' });
        continue;
      }
      values = smooth(values, TUNING.chatSmoothSec);
    }
    if (isFlat(values, name)) {
      skipped.push({ name, reason: 'flat' });
      continue;
    }
    const normalised = normalise(values, name);
    const z = name === 'chat' ? shiftEarlier(normalised.z, TUNING.chatLagSec) : normalised.z;
    const median =
      name === 'chat' ? shiftEarlier(normalised.median, TUNING.chatLagSec) : normalised.median;
    prepared.push({
      name,
      values: name === 'chat' ? shiftEarlier(values, TUNING.chatLagSec) : values,
      z,
      median,
    });
  }
  return { prepared, skipped };
}

// ---- 3. Combine ---------------------------------------------------------------------

/** The highest value within `half` samples each side, for every sample (NaN treated as nothing). */
function windowMax(values: Float64Array, half: number): Float64Array {
  const out = new Float64Array(values.length).fill(Number.NaN);
  for (let i = 0; i < values.length; i += 1) {
    let best = Number.NaN;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      const value = values[j] as number;
      if (Number.isFinite(value) && !(value <= best)) best = value;
    }
    out[i] = best;
  }
  return out;
}

/** The combined strength at every sample, with the agreement bonus, then smoothed. */
function combine(prepared: readonly Prepared[], count: number): Float64Array {
  const strength = new Float64Array(count).fill(Number.NaN);
  const near = samples(TUNING.agreementWithinSec);
  const nearMax = prepared.map((track) => windowMax(track.z, near));
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let weights = 0;
    let agreeing = 0;
    prepared.forEach((track, t) => {
      const z = track.z[i] as number;
      if (Number.isFinite(z)) {
        const weight = TUNING.weights[track.name];
        sum += weight * z;
        weights += weight;
      }
      if (((nearMax[t] as Float64Array)[i] as number) >= TUNING.agreementZ) agreeing += 1;
    });
    if (weights <= 0) continue;
    const value = sum / weights;
    strength[i] = agreeing >= 2 ? value * TUNING.agreementBonus : value;
  }
  return smooth(strength, TUNING.smoothSec);
}

// ---- 4. Peaks ----------------------------------------------------------------------

/** How many clips a video of `durationMs` may get. */
export function clipCap(durationMs: number, maxClips: number = TUNING.maxClips): number {
  const byLength = Math.floor(durationMs / 1000 / TUNING.secondsPerClip);
  const cap = Math.min(TUNING.maxClips, Math.max(TUNING.minClipsCap, byLength));
  return Math.max(0, Math.min(cap, Math.floor(maxClips)));
}

/** Peak samples, strongest first (ties: the earlier one), at least the gap apart. */
function pickPeaks(strength: Float64Array, cap: number): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < strength.length; i += 1) {
    if ((strength[i] as number) >= TUNING.peakMin) candidates.push(i);
  }
  candidates.sort((a, b) => (strength[b] as number) - (strength[a] as number) || a - b);
  const gap = samples(TUNING.peakMinGapSec);
  const picked: number[] = [];
  for (const index of candidates) {
    if (picked.length >= cap) break;
    if (picked.every((other) => Math.abs(other - index) >= gap)) picked.push(index);
  }
  return picked;
}

// ---- 6. Reasons ----------------------------------------------------------------------

interface ReasonCandidate {
  code: HighlightReason;
  strength: number;
}

/** A fixed order for ties, so equal strengths always list the same way. */
const REASON_ORDER: readonly HighlightReason[] = [
  'chat_burst',
  'loud',
  'silence_then_noise',
  'replayed',
  'fast_cuts',
  'chat_rise',
  'louder',
];

function maxNear(values: Float64Array, at: number, half: number): number {
  let best = Number.NaN;
  for (let j = Math.max(0, at - half); j <= Math.min(values.length - 1, at + half); j += 1) {
    const value = values[j] as number;
    if (Number.isFinite(value) && !(value <= best)) best = value;
  }
  return best;
}

/** "Sudden silence then noise": a stretch well under the usual level just before a loud moment. */
function silenceBefore(loudness: Prepared, peak: number): boolean {
  const from = Math.max(0, peak - samples(TUNING.silenceBeforeSec));
  for (let j = from; j < peak; j += 1) {
    const value = loudness.values[j] as number;
    const usual = loudness.median[j] as number;
    if (!Number.isFinite(value)) return true;
    if (Number.isFinite(usual) && value <= usual - TUNING.silenceDropLu) return true;
  }
  return false;
}

function reasonsAt(prepared: readonly Prepared[], peak: number): ReasonCandidate[] {
  const half = samples(TUNING.reasonWithinSec);
  const out: ReasonCandidate[] = [];
  for (const track of prepared) {
    const z = maxNear(track.z, peak, half);
    if (!Number.isFinite(z) || z < TUNING.reasonZ) continue;
    const strong = z >= TUNING.reasonStrongZ;
    switch (track.name) {
      case 'chat':
        out.push({ code: strong ? 'chat_burst' : 'chat_rise', strength: z });
        break;
      case 'loudness':
        if (silenceBefore(track, peak)) out.push({ code: 'silence_then_noise', strength: z });
        out.push({ code: strong ? 'loud' : 'louder', strength: z });
        break;
      case 'scene':
        out.push({ code: 'fast_cuts', strength: z });
        break;
      case 'replayed':
        out.push({ code: 'replayed', strength: z });
        break;
    }
  }
  return out.sort(
    (a, b) =>
      b.strength - a.strength || REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code),
  );
}

// ---- 5. Windows ------------------------------------------------------------------------

interface Window {
  from: number;
  to: number;
  peak: number;
  strength: number;
  reasons: HighlightReason[];
}

/** Scene cuts: samples whose raw scene score reaches the cut level. */
function cutsOf(prepared: readonly Prepared[]): Set<number> {
  const scene = prepared.find((track) => track.name === 'scene');
  const cuts = new Set<number>();
  if (!scene) return cuts;
  for (let i = 0; i < scene.values.length; i += 1) {
    const value = scene.values[i] as number;
    const previous = i > 0 ? (scene.values[i - 1] as number) : Number.NaN;
    // A held value repeats across samples; the cut is where it first appears.
    if (value >= TUNING.cutScore && value !== previous) cuts.add(i);
  }
  return cuts;
}

/** The nearest cut at or before `at` (back to `within`), else `at`. */
function snapBack(at: number, cuts: Set<number>, within: number): number {
  for (let i = at; i >= Math.max(0, at - within); i -= 1) if (cuts.has(i)) return i;
  return at;
}

/** The nearest cut at or after `at` (up to `within`), else `at`. */
function snapForward(at: number, cuts: Set<number>, within: number, last: number): number {
  for (let i = at; i <= Math.min(last, at + within); i += 1) if (cuts.has(i)) return i;
  return at;
}

/** Clamps [from, to) to `min` to `max` samples and to the video, growing backwards first. */
function clampLength(
  window: { from: number; to: number; peak: number },
  count: number,
): { from: number; to: number } {
  const min = samples(TUNING.minClipSec);
  const max = samples(TUNING.maxClipSec);
  let { from, to } = window;
  if (to - from > max) {
    // Keep the moment: the window around the peak, context first.
    from = Math.max(from, window.peak - Math.floor(max / 2));
    to = from + max;
  }
  if (to - from < min) {
    from = to - min;
  }
  if (from < 0) {
    to -= from;
    from = 0;
  }
  if (to > count) {
    from -= to - count;
    to = count;
  }
  return { from: Math.max(0, from), to: Math.min(count, to) };
}

function windowAround(
  peak: number,
  strength: Float64Array,
  prepared: readonly Prepared[],
  cuts: Set<number>,
): Window {
  const count = strength.length;
  const reasons = reasonsAt(prepared, peak);
  const chatLeads = reasons[0]?.code === 'chat_burst' || reasons[0]?.code === 'chat_rise';
  let from = peak - samples(chatLeads ? TUNING.chatLeadInSec : TUNING.leadInSec);
  let to = peak + samples(TUNING.tailSec);
  const longest = from + samples(TUNING.maxClipSec);
  while (to < count && to < longest && (strength[to] as number) > TUNING.extendAbove) to += 1;

  const snap = samples(TUNING.snapCutWithinSec);
  from = snapBack(Math.max(0, from), cuts, snap);
  to = snapForward(Math.min(count, to), cuts, snap, count);

  const clamped = clampLength({ from, to, peak }, count);
  return {
    ...clamped,
    peak,
    strength: strength[peak] as number,
    reasons: dedupeReasons(reasons).slice(0, TUNING.maxReasons),
  };
}

/** One reason per family: "Loud reaction" wins over "Louder than usual", and so on. */
function dedupeReasons(reasons: readonly ReasonCandidate[]): HighlightReason[] {
  const out: HighlightReason[] = [];
  for (const reason of reasons) {
    if (!out.includes(reason.code)) out.push(reason.code);
  }
  return out;
}

/** Merges overlapping windows; the stronger one's peak, score and reasons are kept. */
function mergeWindows(windows: readonly Window[], count: number): Window[] {
  const sorted = windows.slice().sort((a, b) => a.from - b.from || a.peak - b.peak);
  const merged: Window[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.from < last.to) {
      const stronger =
        window.strength > last.strength ||
        (window.strength === last.strength && window.peak < last.peak)
          ? window
          : last;
      const union = { from: Math.min(last.from, window.from), to: Math.max(last.to, window.to) };
      const clamped = clampLength({ ...union, peak: stronger.peak }, count);
      merged[merged.length - 1] = { ...stronger, ...clamped };
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** score = 100 x (1 - exp(-strength / scale)), whole. */
export function highlightScore(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  return Math.round(100 * (1 - Math.exp(-strength / TUNING.scoreScale)));
}

/** The weakest score a clip can have (the peak floor's). */
export const MIN_HIGHLIGHT_SCORE = highlightScore(TUNING.peakMin);

// ---- The whole run ---------------------------------------------------------------------

export function findHighlights(
  tracks: readonly SignalTrack[],
  options: FindHighlightsOptions,
): HighlightResult {
  const count = trackSampleCount(options.durationMs);
  const result: HighlightResult = {
    engineVersion: SIGNALS_ENGINE_VERSION,
    tuning: SIGNALS_TUNING,
    ranges: [],
    used: [],
    skipped: [],
  };

  const given = new Set(tracks.map((track) => track.name));
  const { prepared, skipped } = prepareTracks(tracks, count, options.durationMs);
  result.skipped = skipped;
  for (const name of SIGNAL_TRACKS) {
    if (!given.has(name)) result.skipped.push({ name, reason: 'missing' });
  }
  result.used = prepared.map((track) => track.name);
  if (prepared.length === 0 || count < samples(TUNING.minClipSec)) return result;

  const strength = combine(prepared, count);
  const peaks = pickPeaks(strength, clipCap(options.durationMs, options.maxClips));
  const cuts = cutsOf(prepared);
  const windows = mergeWindows(
    peaks.map((peak) => windowAround(peak, strength, prepared, cuts)),
    count,
  );

  result.ranges = windows
    .map((window) => ({
      fromMs: sampleStartMs(window.from),
      toMs: Math.min(options.durationMs, sampleStartMs(window.to)),
      peakMs: sampleStartMs(window.peak),
      score: highlightScore(window.strength),
      reasons: window.reasons,
    }))
    .filter((range) => range.score >= MIN_HIGHLIGHT_SCORE && range.toMs > range.fromMs)
    .sort((a, b) => b.score - a.score || a.fromMs - b.fromMs);
  return result;
}
