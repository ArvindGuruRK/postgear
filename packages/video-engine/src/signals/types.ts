/**
 * Highlight signals (Sprint 12, Module 16): tracks of numbers along a video
 * that the scorer (`score.ts`) turns into proposed clips. Sprint 13 adds
 * `speech`, `faces` and `motion` as more tracks into the same scorer, so
 * nothing here knows which tracks exist beyond the registry in `tracks.ts`.
 */

/** Built in Sprint 12. */
export const SIGNAL_TRACKS = ['loudness', 'scene', 'chat', 'replayed'] as const;
/** Reserved for Sprint 13. */
export const RESERVED_SIGNAL_TRACKS = ['speech', 'faces', 'motion'] as const;

/** A track this sprint produces and scores. */
export type SignalTrackName = (typeof SIGNAL_TRACKS)[number];

export type TrackName = SignalTrackName | (typeof RESERVED_SIGNAL_TRACKS)[number];

/** What a track's numbers measure. */
export const TRACK_UNITS = ['lufs', 'scene_score', 'messages_per_second', 'share'] as const;
export type TrackUnit = (typeof TRACK_UNITS)[number];

export interface SignalTrack {
  name: TrackName;
  /** Bumped when a producer changes how it measures, so old files are not mixed with new. */
  version: number;
  /** Samples per second of video time. */
  sampleRateHz: number;
  /** Video time of the first sample, in seconds. */
  startSec: number;
  unit: TrackUnit;
  /**
   * One value per sample. `null` is "no data": a stretch nothing measured
   * (a muted part, a moment before the first keyframe). It never scores.
   */
  values: Array<number | null>;
}

/**
 * Why a clip was picked, stored on `Clip.reasons` as these codes; the words
 * are `HIGHLIGHT_REASON_LABELS`, so the copy can change without a migration.
 */
export const HIGHLIGHT_REASONS = [
  'chat_burst',
  'chat_rise',
  'loud',
  'louder',
  'silence_then_noise',
  'fast_cuts',
  'replayed',
  // Sprint 13, Module 05: what the transcript moment picker saw.
  'matches_request',
  'strong_opening',
  'complete_thought',
  'clear_payoff',
  'funny_exchange',
] as const;
export type HighlightReason = (typeof HIGHLIGHT_REASONS)[number];

/** The words a person reads for each reason (sentence case). */
export const HIGHLIGHT_REASON_LABELS: Readonly<Record<HighlightReason, string>> = Object.freeze({
  chat_burst: 'Chat exploded',
  chat_rise: 'Chat picked up',
  loud: 'Loud reaction',
  louder: 'Louder than usual',
  silence_then_noise: 'Sudden silence then noise',
  fast_cuts: 'Fast cuts',
  replayed: 'Viewers replayed this',
  matches_request: 'Matches what you asked for',
  strong_opening: 'Strong opening line',
  complete_thought: 'Complete thought',
  clear_payoff: 'Clear payoff',
  funny_exchange: 'Funny exchange',
});

export function isHighlightReason(value: unknown): value is HighlightReason {
  return typeof value === 'string' && (HIGHLIGHT_REASONS as readonly string[]).includes(value);
}

/** The words for stored reason codes, in their order; anything unknown is left out. */
export function highlightReasonLabels(codes: readonly string[]): string[] {
  return codes.filter(isHighlightReason).map((code) => HIGHLIGHT_REASON_LABELS[code]);
}

/** A stretch the scorer proposes as a clip. Video time, whole milliseconds. */
export interface HighlightRange {
  fromMs: number;
  toMs: number;
  /** The strongest moment inside it. */
  peakMs: number;
  /** 0 to 100, against this video's own range. */
  score: number;
  /** Up to three, strongest first. */
  reasons: HighlightReason[];
}

/** Why a track took no part in a run. */
export type TrackSkipReason =
  /** The run had no such track (no chat on uploads, the switch off, the fetch failed). */
  | 'missing'
  /** The track is not one this scorer knows, or its version is old. */
  | 'unknown_version'
  /** Nothing moved: every value within the track's floor of each other, or no data at all. */
  | 'flat'
  /** Chat with fewer messages an hour than the floor (spam and silence look alike there). */
  | 'too_few_messages';
