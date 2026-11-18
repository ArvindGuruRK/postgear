/**
 * The clip's parts as the player sees them: where each one sits in the clip,
 * where it comes from in the video, and whether it simply plays on from the
 * part before it.
 *
 * Built on the engine's time map (`placeSegments`), so the preview and the
 * export place every part identically. The only things added here are the
 * unrounded mappings the clock needs (a frame's media time is fractional)
 * and the hand-over rule:
 *
 * - A part **continues** the one before it when both come from the same
 *   video and it starts exactly where the other ended (a split with nothing
 *   removed). The same `<video>` keeps playing through such a join; only its
 *   speed may change, which needs no seek.
 * - Any other join is a **hand-over**: the second `<video>` has already
 *   sought to the next part's start and takes over.
 *
 * Pure: numbers in, numbers out.
 */
import { placeSegments, type TimedDocument } from '@postgear/video-engine';

export interface PreviewPart {
  index: number;
  /** The segment's id. */
  id: string;
  sourceId: string;
  /** The video moments it plays, in ms (`sourceOut` exclusive). */
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume: number;
  /** Where it sits in the clip, in ms (`outEnd` exclusive). */
  outStart: number;
  outEnd: number;
  /** Plays on from the part before it on the same element (same video, no gap). */
  continuesPrevious: boolean;
  /**
   * Names the part's video range and speed. A part whose key is unchanged
   * after an edit still maps media time to the same moments.
   */
  key: string;
}

/** Every part of the clip in play order. */
export function previewParts(doc: TimedDocument): PreviewPart[] {
  const placed = placeSegments(doc);
  return placed.map((entry, index) => {
    const { segment } = entry;
    const previous = index > 0 ? placed[index - 1]?.segment : undefined;
    return {
      index,
      id: segment.id,
      sourceId: segment.source,
      sourceIn: segment.sourceIn,
      sourceOut: segment.sourceOut,
      speed: segment.speed,
      volume: segment.volume,
      outStart: entry.outStart,
      outEnd: entry.outEnd,
      continuesPrevious:
        previous !== undefined &&
        previous.source === segment.source &&
        previous.sourceOut === segment.sourceIn,
      key: `${segment.id}|${segment.source}|${segment.sourceIn}|${segment.sourceOut}|${segment.speed}`,
    };
  });
}

/** The part playing at `outputMs`; the clip's very end belongs to the last part. */
export function partAt(parts: readonly PreviewPart[], outputMs: number): PreviewPart | null {
  const last = parts[parts.length - 1];
  if (!last || !Number.isFinite(outputMs)) {
    return null;
  }
  if (outputMs <= 0) {
    return parts[0] ?? null;
  }
  for (const part of parts) {
    if (outputMs < part.outEnd) {
      return part;
    }
  }
  return last;
}

/** The video moment at `outputMs` inside `part`, unrounded, held inside the part. */
export function sourceAt(part: PreviewPart, outputMs: number): number {
  const ms = part.sourceIn + (outputMs - part.outStart) * part.speed;
  return Math.min(part.sourceOut, Math.max(part.sourceIn, ms));
}

/** The clip moment a video moment of `part` plays at, unrounded, held inside the part. */
export function outputAt(part: PreviewPart, sourceMs: number): number {
  const ms = part.outStart + (sourceMs - part.sourceIn) / part.speed;
  return Math.min(part.outEnd, Math.max(part.outStart, ms));
}

/**
 * Where to seek the video to show the clip at `outputMs`: the moment itself,
 * kept one millisecond short of the part's end so the frame shown is the
 * part's last one and not the first frame after it (the clip parked at its
 * end shows its last frame).
 */
export function seekTargetAt(part: PreviewPart, outputMs: number): number {
  const ms = sourceAt(part, outputMs);
  return Math.max(part.sourceIn, Math.min(ms, part.sourceOut - 1));
}

/** The last part of the run that plays on one element from `index` (itself when the next is a hand-over). */
export function runEnd(parts: readonly PreviewPart[], index: number): number {
  let end = index;
  while (parts[end + 1]?.continuesPrevious) {
    end += 1;
  }
  return end;
}

/** The part the second element should wait on while `index` plays, or null at the last run. */
export function nextHandover(parts: readonly PreviewPart[], index: number): number | null {
  const next = runEnd(parts, index) + 1;
  return next < parts.length ? next : null;
}
