/**
 * One list of clips from transcript moments and Sprint 12's signals
 * (Sprint 13, Module 05). Pure.
 *
 * - A transcript moment's score is its five parts, weighted by the genre and
 *   brought back to 0 to 100, plus a bonus when a signal highlight overlaps
 *   it (that highlight's reasons join its own). A moment that matches what
 *   the person asked for comes first.
 * - A strong signal highlight with no transcript moment is kept as its own
 *   clip, so a loud moment with no words is not lost.
 * - Near-duplicates go: a clip that overlaps a better one by more than a
 *   quarter of the shorter of the two is dropped.
 */
import type { HighlightRange } from '../signals/types';
import { type MomentCandidate, momentReasons, PART_MAX, SCORE_PARTS } from './candidates';
import type { GenreTuning } from './genre';

export const MAX_BLENDED_CLIPS = 20;
/** Two clips overlapping by more than this share of the shorter are the same moment. */
export const DUPLICATE_SHARE = 0.25;

export interface TitledCandidate extends MomentCandidate {
  title: string | null;
}

export interface BlendedClip {
  fromMs: number;
  toMs: number;
  /** 0 to 100. */
  score: number;
  /** Reason codes (`HIGHLIGHT_REASON_LABELS`), strongest first, at most 4. */
  reasons: string[];
  origin: 'AI_TRANSCRIPT' | 'AI_SIGNALS';
  title: string | null;
  matchesRequest: boolean;
}

function overlapMs(
  a: { fromMs: number; toMs: number },
  b: { fromMs: number; toMs: number },
): number {
  return Math.max(0, Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs));
}

function isDuplicate(
  a: { fromMs: number; toMs: number },
  b: { fromMs: number; toMs: number },
): boolean {
  const shorter = Math.min(a.toMs - a.fromMs, b.toMs - b.fromMs);
  return shorter > 0 && overlapMs(a, b) > shorter * DUPLICATE_SHARE;
}

/** The five parts weighted by the genre, as 0 to 100 (neutral weights give the plain sum). */
export function weightedScore(
  candidate: Pick<MomentCandidate, 'parts'>,
  tuning: GenreTuning,
): number {
  let weighted = 0;
  let total = 0;
  for (const part of SCORE_PARTS) {
    const weight = tuning.weights[part];
    weighted += candidate.parts[part] * weight;
    total += PART_MAX * weight;
  }
  return total > 0 ? Math.round((weighted / total) * 100) : 0;
}

/** Keeps the best of each group of near-duplicates, best first. */
export function dedupeByOverlap<T extends { fromMs: number; toMs: number; score: number }>(
  list: readonly T[],
  better: (a: T, b: T) => number = (a, b) => b.score - a.score,
): T[] {
  const kept: T[] = [];
  for (const item of [...list].sort(better)) {
    if (!kept.some((other) => isDuplicate(item, other))) kept.push(item);
  }
  return kept;
}

function byRank(a: BlendedClip, b: BlendedClip): number {
  if (a.matchesRequest !== b.matchesRequest) return a.matchesRequest ? -1 : 1;
  return b.score - a.score || a.fromMs - b.fromMs;
}

/** Transcript moments and signal highlights as one list, best first, at most `max`. */
export function blendWithSignals(
  candidates: readonly TitledCandidate[],
  signals: readonly HighlightRange[],
  tuning: GenreTuning,
  max: number = MAX_BLENDED_CLIPS,
): BlendedClip[] {
  const used = new Set<HighlightRange>();
  const clips: BlendedClip[] = candidates.map((candidate) => {
    const overlapping = signals.filter((signal) => isDuplicate(candidate, signal));
    const best = overlapping.reduce<HighlightRange | null>(
      (top, signal) => (top === null || signal.score > top.score ? signal : top),
      null,
    );
    for (const signal of overlapping) used.add(signal);
    const bonus = best ? Math.round((tuning.signalBonus * best.score) / 100) : 0;
    const reasons = [...momentReasons(candidate), ...(best?.reasons ?? [])];
    return {
      fromMs: candidate.fromMs,
      toMs: candidate.toMs,
      score: Math.min(100, weightedScore(candidate, tuning) + bonus),
      reasons: [...new Set(reasons)].slice(0, 4),
      origin: 'AI_TRANSCRIPT',
      title: candidate.title,
      matchesRequest: candidate.matchesRequest,
    };
  });
  for (const signal of signals) {
    if (used.has(signal) || signal.score < tuning.keepSignalFrom) continue;
    clips.push({
      fromMs: signal.fromMs,
      toMs: signal.toMs,
      score: signal.score,
      reasons: [...signal.reasons].slice(0, 4),
      origin: 'AI_SIGNALS',
      title: null,
      matchesRequest: false,
    });
  }
  return dedupeByOverlap(clips, byRank).slice(0, Math.max(0, max));
}
