/**
 * Captions on the clip's clock (Sprint 13, Module 03).
 *
 * A captions track stores no times. The words live in the transcript, in the
 * **video's** time; this maps them onto the **clip** through the segment
 * list. The loop is over segments, in play order, not over words: a stretch
 * of the video that plays twice (a hook clip, a montage) shows its captions
 * twice, and a stretch that was cut out shows none. Speed scales a word's
 * length with its part.
 *
 * A word cut by a part's edge is kept only when more than half of it is
 * inside, so a trim never leaves a sliver of a word on screen.
 */
import type { CaptionsTrack, ClipDocument } from '../document/schema';
import { placeSegments } from '../time/time-map';
import type { Transcript, TranscriptWord } from '../transcript/types';

export interface CaptionWord {
  /** The transcript word's stable index. */
  i: number;
  /** Clip time, whole milliseconds, `end` exclusive. */
  start: number;
  end: number;
  /** What is shown: the heard word, a video-wide fix, or this clip's own edit. */
  text: string;
  /** 0 to 1. A word this clip edited is sure. */
  sure: number;
  /** The part it plays in, and that part's place in the clip. */
  segmentId: string;
  segmentIndex: number;
  /** The word's own start in the video, for jumping and for fixes. */
  sourceStart: number;
}

/** The first word whose end is after `ms` (words are sorted by start, and do not overlap much). */
function firstEndingAfter(words: readonly TranscriptWord[], ms: number): number {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((words[mid] as TranscriptWord).end <= ms) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The clip's captions as words on the clip's clock, in play order. `transcript`
 * is read with the video's word fixes already applied (`applyFixes`); the
 * track's own `edits` go on top. A hidden word is left out. A source other
 * than the transcript's own video never gets its words (`sourceId`).
 */
export function captionWords(
  doc: Pick<ClipDocument, 'segments'>,
  track: Pick<CaptionsTrack, 'edits'>,
  transcript: Pick<Transcript, 'words'>,
  options: { sourceId?: string } = {},
): CaptionWord[] {
  const out: CaptionWord[] = [];
  const { words } = transcript;
  for (const placed of placeSegments(doc)) {
    const { segment } = placed;
    if (options.sourceId !== undefined && segment.source !== options.sourceId) continue;
    for (let at = firstEndingAfter(words, segment.sourceIn); at < words.length; at += 1) {
      const word = words[at] as TranscriptWord;
      if (word.start >= segment.sourceOut) break;
      const inside = Math.min(word.end, segment.sourceOut) - Math.max(word.start, segment.sourceIn);
      // More than half of the word must play in this part.
      if (inside * 2 <= word.end - word.start) continue;

      const edit = Object.hasOwn(track.edits, String(word.i)) ? track.edits[String(word.i)] : undefined;
      if (edit?.hidden) continue;
      const text = (edit?.text ?? word.text).trim();
      if (text.length === 0) continue;

      const from = Math.max(word.start, segment.sourceIn);
      const to = Math.min(word.end, segment.sourceOut);
      const start = placed.outStart + Math.round((from - segment.sourceIn) / segment.speed);
      const end = Math.min(
        placed.outEnd,
        Math.max(start + 1, placed.outStart + Math.round((to - segment.sourceIn) / segment.speed)),
      );
      if (start >= placed.outEnd) continue;
      out.push({
        i: word.i,
        start,
        end,
        text,
        sure: edit?.text !== undefined ? 1 : word.sure,
        segmentId: segment.id,
        segmentIndex: placed.index,
        sourceStart: word.start,
      });
    }
  }
  return out;
}

/** The video stretches a clip plays, merged per source: what a captions request must have listened to. */
export function clipSourceRanges(
  doc: Pick<ClipDocument, 'segments'>,
  sourceId?: string,
): Array<{ fromMs: number; toMs: number }> {
  const ranges = doc.segments
    .filter((segment) => sourceId === undefined || segment.source === sourceId)
    .map((segment) => ({ fromMs: segment.sourceIn, toMs: segment.sourceOut }))
    .sort((a, b) => a.fromMs - b.fromMs);
  const merged: Array<{ fromMs: number; toMs: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, range.toMs);
    else merged.push({ ...range });
  }
  return merged;
}

/** The captions track of a document, or null. A clip has at most one. */
export function captionsTrackOf(doc: Pick<ClipDocument, 'tracks'>): CaptionsTrack | null {
  for (const track of doc.tracks) {
    if (track.kind === 'captions') return track;
  }
  return null;
}

/**
 * Places a cue of a captions file made for the CLIP (its clock starts where
 * the clip starts) in the video: through the part playing at the cue's start,
 * at that part's speed, and never past that part's end. A cue that starts
 * after the clip ends belongs nowhere.
 */
export function clipClockPlacer(
  doc: Pick<ClipDocument, 'segments'>,
): (cue: { start: number; end: number }) => { start: number; end: number } | null {
  const placed = placeSegments(doc);
  return (cue) => {
    const part = placed.find((entry) => cue.start >= entry.outStart && cue.start < entry.outEnd);
    if (!part) return null;
    const { segment } = part;
    const at = (outputMs: number) =>
      segment.sourceIn + Math.round((outputMs - part.outStart) * segment.speed);
    return { start: at(cue.start), end: Math.min(segment.sourceOut, at(cue.end)) };
  };
}
