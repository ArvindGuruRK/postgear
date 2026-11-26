/**
 * Remove Silences (Sprint 13, Module 04). Pure.
 *
 * A pause is a stretch of a listened part where no word is spoken, at least
 * `minMs` long. The speech curve Module 02 keeps is worked out from these
 * same words (`speechValues`), so "the speech track is low and no word is
 * spoken" is the gap between words. When the caller knows the sound's
 * loudness (`isLoud`), a gap that is loud (laughter, music, a game) is kept.
 *
 * Each pause is shortened by `keepMs` at both ends so speech never sounds
 * clipped, and what is left must be at least `SILENCE_REMOVE_MIN_MS`
 * (research 06, section 5: keep 0.15 s on each side, no removal under 0.3 s).
 */

import { silencesIn } from '../transcript/asset';
import { mergeRanges } from '../transcript/covered';
import type { MsRange, Transcript } from '../transcript/types';

/** The slider's range and start, in ms. */
export const SILENCE_MIN_MS = 500;
export const SILENCE_MAX_MS = 2_000;
export const SILENCE_DEFAULT_MS = 800;
/** Air kept on each side of a removed pause. */
export const SILENCE_KEEP_MS = 150;
/** A removal shorter than this is not worth a cut. */
export const SILENCE_REMOVE_MIN_MS = 300;

export interface SilenceOptions {
  /** The shortest pause to remove, ms (clamped to the slider's range). */
  minMs?: number;
  keepMs?: number;
  /** True when the video's sound is loud across `range` (not a pause, whatever the words say). */
  isLoud?: (range: MsRange) => boolean;
}

export interface SilencesFound {
  /** The stretches to cut, video time, sorted. */
  cuts: MsRange[];
  /** Their total length in the video's time. */
  totalMs: number;
  /** Pauses long enough that were kept because sound plays under them (music, laughter, a game). */
  loudKept: number;
}

/**
 * The pauses inside `windows` (the stretches of the video the clip plays,
 * video time) worth removing.
 */
export function findSilences(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  windows: readonly MsRange[],
  options: SilenceOptions = {},
): SilencesFound {
  const minMs = Math.min(
    SILENCE_MAX_MS,
    Math.max(SILENCE_MIN_MS, Math.round(options.minMs ?? SILENCE_DEFAULT_MS)),
  );
  const keepMs = Math.max(0, options.keepMs ?? SILENCE_KEEP_MS);
  const cuts: MsRange[] = [];
  let loudKept = 0;
  for (const window of mergeRanges([...windows])) {
    for (const gap of silencesIn(transcript, window, minMs)) {
      const cut = { fromMs: gap.fromMs + keepMs, toMs: gap.toMs - keepMs };
      if (cut.toMs - cut.fromMs < SILENCE_REMOVE_MIN_MS) continue;
      if (options.isLoud?.(cut)) {
        loudKept += 1;
        continue;
      }
      cuts.push(cut);
    }
  }
  cuts.sort((a, b) => a.fromMs - b.fromMs);
  return {
    cuts,
    totalMs: cuts.reduce((sum, cut) => sum + (cut.toMs - cut.fromMs), 0),
    loudKept,
  };
}

/** A peak at or above this (0 to 1 of full scale, about -24 dBFS) is sound, not a pause. */
export const QUIET_PEAK = 0.06;
/** A stretch is loud when more than this share of its peaks are sound. */
export const LOUD_SHARE = 0.25;

/**
 * The `isLoud` test from a video's waveform (Sprint 12's peaks: `perSecond`
 * bytes a second from the video's start, each the loudest sample as 0 to
 * 255). Laughter, music and a game's own sound stay; a quiet room is a
 * pause. A stretch past the end of the peaks counts as quiet.
 */
export function loudFromPeaks(
  peaks: ArrayLike<number>,
  perSecond: number,
): (range: MsRange) => boolean {
  const threshold = QUIET_PEAK * 255;
  return (range) => {
    if (!(perSecond > 0)) return false;
    const first = Math.max(0, Math.floor((range.fromMs / 1000) * perSecond));
    const last = Math.min(peaks.length, Math.ceil((range.toMs / 1000) * perSecond));
    if (last <= first) return false;
    let loud = 0;
    for (let k = first; k < last; k += 1) {
      if ((peaks[k] ?? 0) >= threshold) loud += 1;
    }
    return loud / (last - first) > LOUD_SHARE;
  };
}
