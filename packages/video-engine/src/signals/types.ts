/**
 * Highlight signals (Module 16 builds the producers and the scorer). A track
 * is one number per step of source time; the scorer reads any subset.
 */

/** Built in Sprint 12. */
export const SIGNAL_TRACKS = ['loudness', 'scene', 'chat', 'replayed'] as const;
/** Reserved for Sprint 13. */
export const RESERVED_SIGNAL_TRACKS = ['speech', 'faces', 'motion'] as const;

export type TrackName =
  | (typeof SIGNAL_TRACKS)[number]
  | (typeof RESERVED_SIGNAL_TRACKS)[number];

export interface SignalTrack {
  name: TrackName;
  /** Bumped when a producer changes how it measures, so old files are not mixed with new. */
  version: number;
  /** Values per second of source time. */
  sampleRateHz: number;
  values: number[];
}

/** A stretch the scorer proposes as a clip. Source time. */
export interface HighlightRange {
  fromMs: number;
  toMs: number;
  /** 0 to 100. */
  score: number;
  /** Plain words: "Loud reaction", "Chat exploded". */
  reasons: string[];
}
