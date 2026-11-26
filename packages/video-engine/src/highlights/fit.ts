/**
 * Fitting a moment to the asked length (Sprint 13, Module 05). Pure.
 *
 * A clip always starts at a row's start and ends at a row's end, with a
 * little air, so it begins and ends on a sentence. Too short: rows are added
 * after it (the payoff usually follows), then before it. Too long: rows are
 * dropped from the end, never the first (that is the hook).
 */
import { CLIP_MIN_MS } from '../document/limits';
import type { MomentCandidate } from './candidates';
import type { TranscriptRow } from './rows';

export const CLIP_LENGTHS = ['auto', 'under30', '30to60', '60to90'] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number];

export const CLIP_LENGTH_LABELS: Readonly<Record<ClipLength, string>> = Object.freeze({
  auto: 'Auto',
  under30: 'Under 30 Seconds',
  '30to60': '30 To 60 Seconds',
  '60to90': '60 To 90 Seconds',
});

/** The lengths each choice aims between, in ms. */
export const CLIP_LENGTH_BOUNDS: Readonly<Record<ClipLength, { minMs: number; maxMs: number }>> =
  Object.freeze({
    auto: { minMs: 20_000, maxMs: 75_000 },
    under30: { minMs: 8_000, maxMs: 30_000 },
    '30to60': { minMs: 30_000, maxMs: 60_000 },
    '60to90': { minMs: 60_000, maxMs: 90_000 },
  });

/** Air kept before the first word and after the last. */
export const CLIP_AIR_MS = 200;

export interface FitOptions {
  /** The video's length: air never runs past it. */
  durationMs: number;
  /** The stretch the person chose: a clip never leaves it. */
  range: { fromMs: number; toMs: number };
}

/**
 * The candidate grown or shrunk by whole rows to the asked length, or null
 * when even its own rows are shorter than a clip may be. A moment that
 * cannot reach the shortest length (the end of the talking) keeps what it has.
 */
export function fitToLength(
  candidate: MomentCandidate,
  rows: readonly TranscriptRow[],
  length: ClipLength,
  options: FitOptions,
): MomentCandidate | null {
  const { minMs, maxMs } = CLIP_LENGTH_BOUNDS[length];
  const inRange = rows.filter(
    (row) => row.from >= options.range.fromMs && row.to <= options.range.toMs,
  );
  let first = inRange.findIndex((row) => row.n === candidate.fromRow);
  let last = inRange.findIndex((row) => row.n === candidate.toRow);
  if (first < 0 || last < 0 || last < first) return null;
  const span = () => (inRange[last] as TranscriptRow).to - (inRange[first] as TranscriptRow).from;

  while (span() > maxMs && last > first) last -= 1;
  while (span() < minMs) {
    const after = inRange[last + 1];
    const before = inRange[first - 1];
    if (after && after.to - (inRange[first] as TranscriptRow).from <= maxMs) last += 1;
    else if (before && (inRange[last] as TranscriptRow).to - before.from <= maxMs) first -= 1;
    else break;
  }

  const head = inRange[first] as TranscriptRow;
  const tail = inRange[last] as TranscriptRow;
  const fromMs = Math.max(0, options.range.fromMs, head.from - CLIP_AIR_MS);
  const toMs = Math.min(options.durationMs, options.range.toMs, tail.to + CLIP_AIR_MS);
  if (toMs - fromMs < CLIP_MIN_MS) return null;
  return { ...candidate, fromRow: head.n, toRow: tail.n, fromMs, toMs };
}
