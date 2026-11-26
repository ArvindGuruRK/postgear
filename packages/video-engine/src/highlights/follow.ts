/**
 * Follow The Speaker's server parts (Sprint 13, Module 08). Pure.
 *
 * - Which shapes can follow: a tall or square canvas (a wide clip already
 *   shows the whole picture, there is nothing to follow inside it).
 * - The scene cuts of a stretch, read from the video's `scene` track with
 *   the same rule Sprint 12's scorer and Module 06's motion mask use: a
 *   sample at or above `cutScore` (scdet's own default, 10) is a cut, and a
 *   held value repeating across samples is one cut, where it first appears.
 *   The time is the sample's start (the track is two samples a second, so
 *   a cut is placed within half a second at or before where it happened).
 * - The stretches where someone talks, from the spoken transcript's words:
 *   ranges only, never words; gaps under `SPEECH_JOIN_GAP_MS` joined; null when nothing
 *   in the stretch was listened to (then the reframe falls back to the
 *   largest face).
 * - The clips of a run that get faces at once: the best three by score.
 */
import type { Ratio } from '../canvas';
import { SPEECH_JOIN_GAP_MS } from '../reframe/tuning';
import { TUNING } from '../signals/tuning';
import type { SignalTrack } from '../signals/types';
import { clipRanges } from '../transcript/covered';
import type { MsRange, Transcript } from '../transcript/types';

/** The shapes Follow The Speaker works on: Vertical, Portrait and Square. */
export const FOLLOW_RATIOS: readonly Ratio[] = Object.freeze(['9:16', '4:5', '1:1']);

/** True when a clip of this shape can follow the speaker (never a wide one). */
export function canFollow(ratio: Ratio): boolean {
  return FOLLOW_RATIOS.includes(ratio);
}

/** How many of a run's clips get faces while the run finishes (the rest on first open). */
export const FOLLOW_FACES_TOP = 3;

/** One stretch of speech, video ms. */
export interface SpeechSpan {
  from: number;
  to: number;
}

/**
 * The scene cuts inside `fromMs..toMs`, video ms, sorted. [] without a scene
 * track. The track is read on its own rate and start.
 */
export function sceneCutsMs(scene: SignalTrack | null, fromMs: number, toMs: number): number[] {
  if (scene?.name !== 'scene' || !(toMs > fromMs)) return [];
  const rate = scene.sampleRateHz > 0 ? scene.sampleRateHz : TUNING.rateHz;
  const out: number[] = [];
  let previous = Number.NaN;
  for (let i = 0; i < scene.values.length; i += 1) {
    const raw = scene.values[i];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN;
    // A held value repeats across samples; the cut is where it first appears.
    if (value >= TUNING.cutScore && value !== previous) {
      const at = Math.round(scene.startSec * 1000 + (i * 1000) / rate);
      if (at >= toMs) break;
      if (at >= fromMs) out.push(at);
    }
    previous = value;
  }
  return out;
}

/**
 * Where someone talks inside `fromMs..toMs`, video ms, sorted and merged
 * (gaps under `gapMs` joined), clipped to the stretch. Null when no part of
 * the stretch was listened to; [] when it was and nobody spoke.
 */
export function speechSpansIn(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  fromMs: number,
  toMs: number,
  gapMs: number = SPEECH_JOIN_GAP_MS,
): SpeechSpan[] | null {
  const window: MsRange = { fromMs, toMs };
  if (clipRanges(transcript.covered, window).length === 0) return null;
  const words = transcript.words
    .filter((word) => word.end > word.start && word.end > fromMs && word.start < toMs)
    .map((word) => ({ from: Math.max(fromMs, word.start), to: Math.min(toMs, word.end) }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: SpeechSpan[] = [];
  for (const word of words) {
    const last = out[out.length - 1];
    if (last && word.from - last.to < gapMs) last.to = Math.max(last.to, word.to);
    else out.push({ ...word });
  }
  return out;
}

/** The ids of the clips to find faces for at once: the best `top` by score (no score last). */
export function followFacesClipIds(
  clips: ReadonlyArray<{ id: string; score: number | null }>,
  top: number = FOLLOW_FACES_TOP,
): string[] {
  return (
    [...clips]
      // Scores are 0 to 100; a clip with none goes last.
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, Math.max(0, top))
      .map((clip) => clip.id)
  );
}
