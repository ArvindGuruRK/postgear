/**
 * Find Clips run again (Module 16): AI clips somebody opened, hid, exported
 * or sent are kept, so a new pick over the same moment would only be a twin
 * of one of them. A pick is left out when a kept AI clip covers at least half
 * of it; the run still counts it as found (the "nothing found" note is about
 * the video, not about what was added). Pure, so the database binding and the
 * in-memory fake apply the same rule.
 */
import { documentRange, type SourceRange } from '@postgear/video-engine';

/** How much of a pick a kept clip must cover for the pick to be left out. */
export const KEPT_COVER_SHARE = 0.5;

/** A stored document's range, or null when it does not read (it then covers nothing). */
export function storedRange(document: unknown): SourceRange | null {
  const segments = (document as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return null;
  const valid = segments.filter(
    (segment): segment is { source: string; sourceIn: number; sourceOut: number } =>
      typeof segment === 'object' &&
      segment !== null &&
      Number.isFinite((segment as { sourceIn?: unknown }).sourceIn) &&
      Number.isFinite((segment as { sourceOut?: unknown }).sourceOut),
  );
  return valid.length > 0 ? documentRange({ segments: valid as never }) : null;
}

function overlapMs(a: SourceRange, b: SourceRange): number {
  return Math.max(0, Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs));
}

/** The picks no kept clip already covers, in their order. */
export function withoutKept<T extends { range: SourceRange }>(
  picks: readonly T[],
  kept: readonly (SourceRange | null)[],
): T[] {
  const ranges = kept.filter((range): range is SourceRange => range !== null);
  return picks.filter((pick) => {
    const length = pick.range.toMs - pick.range.fromMs;
    if (length <= 0) return true;
    return !ranges.some((range) => overlapMs(pick.range, range) >= length * KEPT_COVER_SHARE);
  });
}
