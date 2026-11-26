/**
 * A model's pick as a stretch of the video, its score and its reasons
 * (Sprint 13, Module 05). Pure.
 *
 * - The model answers row numbers. A pick that names a row that does not
 *   exist, or ends before it starts, is dropped, never trusted.
 * - The score is the sum of five parts the model gives from 0 to 20 each
 *   (hook, stands alone, payoff, clarity, shareable). We add them; the model
 *   never reports a total.
 */
import type { TranscriptRow } from './rows';

export const SCORE_PARTS = ['hook', 'standsAlone', 'payoff', 'clarity', 'shareable'] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];
export type ScoreParts = Record<ScorePart, number>;

/** The most one part is worth; five parts make 100. */
export const PART_MAX = 20;

/** A pick as the moment picker answers it, row numbers only. */
export interface MomentPick {
  fromRow: number;
  toRow: number;
  parts: ScoreParts;
  /** The picker found it funny (a reason of its own). */
  funny: boolean;
  /** It matches what the person asked for. */
  matchesRequest: boolean;
}

/** A pick turned into a stretch of the video. */
export interface MomentCandidate {
  fromRow: number;
  toRow: number;
  fromMs: number;
  toMs: number;
  parts: ScoreParts;
  /** 0 to 100: the five parts added. */
  score: number;
  funny: boolean;
  matchesRequest: boolean;
}

function clampPart(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PART_MAX, Math.max(0, Math.round(value)));
}

/** The five parts held to 0 to 20 each, whole numbers. */
export function cleanParts(parts: Partial<Record<ScorePart, number>>): ScoreParts {
  return {
    hook: clampPart(parts.hook ?? 0),
    standsAlone: clampPart(parts.standsAlone ?? 0),
    payoff: clampPart(parts.payoff ?? 0),
    clarity: clampPart(parts.clarity ?? 0),
    shareable: clampPart(parts.shareable ?? 0),
  };
}

/** The score: the five parts added (0 to 100). */
export function momentScore(parts: ScoreParts): number {
  return SCORE_PARTS.reduce((sum, part) => sum + clampPart(parts[part]), 0);
}

/** The pick as a stretch of the video, or null when its rows do not exist or run backwards. */
export function toCandidate(
  rows: readonly TranscriptRow[],
  pick: MomentPick,
): MomentCandidate | null {
  if (!Number.isInteger(pick.fromRow) || !Number.isInteger(pick.toRow)) return null;
  if (pick.toRow < pick.fromRow) return null;
  const first = rows.find((row) => row.n === pick.fromRow);
  const last = rows.find((row) => row.n === pick.toRow);
  if (!first || !last || last.to <= first.from) return null;
  const parts = cleanParts(pick.parts);
  return {
    fromRow: first.n,
    toRow: last.n,
    fromMs: first.from,
    toMs: last.to,
    parts,
    score: momentScore(parts),
    funny: pick.funny === true,
    matchesRequest: pick.matchesRequest === true,
  };
}

/** A part this high gives its reason. */
const REASON_PART = 15;

/** The reasons a person reads for a transcript moment, as codes (`HIGHLIGHT_REASON_LABELS`). */
export function momentReasons(
  candidate: Pick<MomentCandidate, 'parts' | 'funny' | 'matchesRequest'>,
): string[] {
  const reasons: string[] = [];
  if (candidate.matchesRequest) reasons.push('matches_request');
  if (candidate.parts.hook >= REASON_PART) reasons.push('strong_opening');
  if (candidate.parts.standsAlone >= REASON_PART) reasons.push('complete_thought');
  if (candidate.parts.payoff >= REASON_PART) reasons.push('clear_payoff');
  if (candidate.funny) reasons.push('funny_exchange');
  return reasons.slice(0, 4);
}
