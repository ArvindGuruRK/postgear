/**
 * The track registry and the pure builders the producers use (Module 16
 * section 1). A producer (FFmpeg's `ebur128` and `scdet`, the chat pager, the
 * probe's heat map) only gathers timed numbers; turning them into a track on
 * the two-a-second grid happens here, so the producers and the tests agree on
 * exactly one way of binning.
 */
import type { ReplayedPoint } from '../links/types';
import { TUNING } from './tuning';
import {
  SIGNAL_TRACKS,
  type SignalTrack,
  type SignalTrackName,
  type TrackName,
  type TrackUnit,
} from './types';

/** Every Sprint 12 track is stored and scored at this rate. */
export const TRACK_RATE_HZ = TUNING.rateHz;

export interface TrackSpec {
  version: number;
  unit: TrackUnit;
}

/** The tracks this scorer knows, with the version it reads. A stored track of another version is measured again. */
export const TRACKS: Readonly<Record<SignalTrackName, Readonly<TrackSpec>>> = Object.freeze({
  /** Short-term loudness (FFmpeg `ebur128`, a 3 second window), the loudest in each half second. */
  loudness: Object.freeze({ version: 1, unit: 'lufs' }),
  /** FFmpeg `scdet` on keyframes, 0 to 100; held between keyframes. */
  scene: Object.freeze({ version: 1, unit: 'scene_score' }),
  /** Twitch chat replay: weighted messages a second. No name or text is ever kept. */
  chat: Object.freeze({ version: 1, unit: 'messages_per_second' }),
  /** YouTube's "most replayed" heat map, 0 to 1. */
  replayed: Object.freeze({ version: 1, unit: 'share' }),
} satisfies Record<SignalTrackName, TrackSpec>);

export function isSignalTrackName(name: unknown): name is SignalTrackName {
  return typeof name === 'string' && (SIGNAL_TRACKS as readonly string[]).includes(name);
}

/** True when the scorer can read this track as it is (a known name at the current version, on the grid). */
export function isCurrentTrack(track: Pick<SignalTrack, 'name' | 'version'>): boolean {
  return isSignalTrackName(track.name) && TRACKS[track.name].version === track.version;
}

/** Samples on the grid for a video of `durationMs`. */
export function trackSampleCount(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.ceil((durationMs / 1000) * TRACK_RATE_HZ);
}

/** The sample a moment falls in. */
export function sampleIndexAt(ms: number): number {
  return Math.floor((ms / 1000) * TRACK_RATE_HZ);
}

/** The start of sample `index`, in whole milliseconds. */
export function sampleStartMs(index: number): number {
  return Math.round((index * 1000) / TRACK_RATE_HZ);
}

function trackOf(name: SignalTrackName, values: Array<number | null>): SignalTrack {
  const spec = TRACKS[name];
  return {
    name,
    version: spec.version,
    sampleRateHz: TRACK_RATE_HZ,
    startSec: 0,
    unit: spec.unit,
    values,
  };
}

export interface TimedValue {
  /** Video time, in seconds. */
  sec: number;
  value: number;
}

export interface BinOptions {
  /** How the values that fall in one sample are combined. */
  combine: 'max' | 'sum';
  /**
   * What a sample with no value becomes: `null` (no data), `hold` (the last
   * value before it, `null` before the first) or `zero`.
   */
  empty: 'null' | 'hold' | 'zero';
}

/**
 * Bins timed values onto the grid of a video `durationMs` long. Values
 * outside the video, and values that are not finite, are dropped.
 */
export function binTrack(
  name: SignalTrackName,
  points: readonly TimedValue[],
  durationMs: number,
  options: BinOptions,
): SignalTrack {
  const count = trackSampleCount(durationMs);
  const bins: Array<number | null> = new Array(count).fill(null);
  for (const point of points) {
    if (!Number.isFinite(point.sec) || !Number.isFinite(point.value) || point.sec < 0) continue;
    const index = Math.floor(point.sec * TRACK_RATE_HZ);
    if (index >= count) continue;
    const current = bins[index];
    if (current === null || current === undefined) {
      bins[index] = point.value;
    } else {
      bins[index] =
        options.combine === 'max' ? Math.max(current, point.value) : current + point.value;
    }
  }

  let last: number | null = null;
  for (let i = 0; i < count; i += 1) {
    const value = bins[i];
    if (value !== null && value !== undefined) {
      last = value;
      continue;
    }
    bins[i] = options.empty === 'zero' ? 0 : options.empty === 'hold' ? last : null;
  }
  return trackOf(name, bins);
}

/** One chat message as the producer keeps it: when, and how much it counts. */
export interface ChatMessageWeight {
  /** Video time, in ms. */
  offsetMs: number;
  /** 1, or 1.5 when it holds a reaction word or an emote (research 06). */
  weight?: number;
}

/**
 * The chat track: weighted messages a second on the grid. It is built from
 * times and weights only, so no name or text can reach a stored file.
 */
export function chatTrack(messages: readonly ChatMessageWeight[], durationMs: number): SignalTrack {
  const points: TimedValue[] = [];
  for (const message of messages) {
    const weight = message.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    // A message counted in a half-second sample is `weight x 2` a second.
    points.push({ sec: message.offsetMs / 1000, value: weight * TRACK_RATE_HZ });
  }
  return binTrack('chat', points, durationMs, { combine: 'sum', empty: 'zero' });
}

/** Messages a chat track holds (weighted), from its rate. */
export function chatMessageTotal(track: Pick<SignalTrack, 'values' | 'sampleRateHz'>): number {
  let total = 0;
  for (const value of track.values) {
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return total / (track.sampleRateHz > 0 ? track.sampleRateHz : TRACK_RATE_HZ);
}

/**
 * The "most replayed" track from a probe's heat map: each sample takes the
 * value of the point covering it; stretches no point covers are no data.
 * Null when there is nothing to use.
 */
export function replayedTrack(
  points: readonly ReplayedPoint[] | null | undefined,
  durationMs: number,
): SignalTrack | null {
  const count = trackSampleCount(durationMs);
  if (!points || points.length === 0 || count === 0) return null;
  const sorted = points
    .filter(
      (point) =>
        Number.isFinite(point.startMs) &&
        Number.isFinite(point.endMs) &&
        Number.isFinite(point.value) &&
        point.endMs > point.startMs,
    )
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (sorted.length === 0) return null;

  const values: Array<number | null> = new Array(count).fill(null);
  let any = false;
  for (let i = 0; i < count; i += 1) {
    const mid = sampleStartMs(i) + 500 / TRACK_RATE_HZ;
    const point = sorted.find((candidate) => candidate.startMs <= mid && mid < candidate.endMs);
    if (point) {
      values[i] = Math.min(1, Math.max(0, point.value));
      any = true;
    }
  }
  return any ? trackOf('replayed', values) : null;
}

/**
 * A track's values on the grid of `count` samples, `NaN` for no data. A track
 * stored at another rate or start is read at each sample's middle, so the
 * scorer never sees two grids.
 */
export function onGrid(track: SignalTrack, count: number): Float64Array {
  const out = new Float64Array(count).fill(Number.NaN);
  const rate = track.sampleRateHz > 0 ? track.sampleRateHz : TRACK_RATE_HZ;
  const same = rate === TRACK_RATE_HZ && track.startSec === 0;
  for (let i = 0; i < count; i += 1) {
    let source = i;
    if (!same) {
      const midSec = (i + 0.5) / TRACK_RATE_HZ;
      source = Math.floor((midSec - track.startSec) * rate);
    }
    const value = source >= 0 && source < track.values.length ? track.values[source] : null;
    if (typeof value === 'number' && Number.isFinite(value)) out[i] = value;
  }
  return out;
}

/** The name a person reads for each track, in "How this was found". */
export const TRACK_WORDS: Readonly<Record<SignalTrackName, string>> = Object.freeze({
  loudness: 'sound',
  scene: 'picture',
  chat: 'chat',
  replayed: 'what viewers replayed',
});

/**
 * "Sound and picture", "Sound, picture and chat": the tracks a run used, in
 * the registry's order. Empty when it used none.
 */
export function tracksSentence(used: readonly TrackName[]): string {
  const words = SIGNAL_TRACKS.filter((name) => used.includes(name)).map(
    (name) => TRACK_WORDS[name],
  );
  if (words.length === 0) return '';
  const joined =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
}
