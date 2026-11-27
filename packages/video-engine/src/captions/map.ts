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
 *
 * A brand kit's intro and outro parts (Module 10) are other videos and get
 * no captions, whatever video the transcript is of.
 *
 * A word under a bleep (Module 09) is shown masked, its first letter and
 * stars ("f***"), so the ASS writer and the preview, which both read these
 * words, never draw it. The transcript is not changed.
 */
import { bleepCoversWord, maskBleepedWord } from '../cleanup/bleeps';
import type { CaptionsTrack, ClipDocument, Segment } from '../document/schema';
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
  /** Set when a bleep covers the word: `text` is then masked ("f***"). */
  bleeped?: true;
}

/** A brand kit's intro or outro part (Module 10): another video, played around the clip. */
function isBrandPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
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
 * than the transcript's own video never gets its words: `options.sourceId`,
 * else the track's own `source` (Module 11: a montage has one captions track
 * per video, each naming it). A word that bleeps of its part's video cover is
 * masked. Pass the whole document (or keep its `joins`): a Fade join moves
 * every later word earlier. Inside a fade each side keeps its words only up
 * to the overlap's middle (the `segmentAt` rule), so two pages never draw
 * over each other.
 */
export function captionWords(
  doc: Pick<ClipDocument, 'segments'> & Partial<Pick<ClipDocument, 'bleeps' | 'joins'>>,
  track: Pick<CaptionsTrack, 'edits'> & Partial<Pick<CaptionsTrack, 'source'>>,
  transcript: Pick<Transcript, 'words'>,
  options: { sourceId?: string } = {},
): CaptionWord[] {
  const out: CaptionWord[] = [];
  const { words } = transcript;
  const bleeps = doc.bleeps ?? [];
  const sourceId = options.sourceId ?? track.source;
  const placedAll = placeSegments(doc);
  // Module 11: where the picture hands over inside a Fade (`segmentAt`'s middle, in whole ms).
  const handover = (entry: { outStart: number; overlapMs: number } | undefined): number | null =>
    entry && entry.overlapMs > 0 ? Math.ceil(entry.outStart + entry.overlapMs / 2) : null;
  for (const placed of placedAll) {
    const { segment } = placed;
    const shownFrom = handover(placed) ?? placed.outStart;
    const shownTo = handover(placedAll[placed.index + 1]) ?? placed.outEnd;
    if (sourceId !== undefined && segment.source !== sourceId) continue;
    // A brand intro or outro (Module 10) is another video: never captioned, whatever its source.
    if (isBrandPart(segment)) continue;
    for (let at = firstEndingAfter(words, segment.sourceIn); at < words.length; at += 1) {
      const word = words[at] as TranscriptWord;
      if (word.start >= segment.sourceOut) break;
      const inside = Math.min(word.end, segment.sourceOut) - Math.max(word.start, segment.sourceIn);
      // More than half of the word must play in this part.
      if (inside * 2 <= word.end - word.start) continue;

      const edit = Object.hasOwn(track.edits, String(word.i))
        ? track.edits[String(word.i)]
        : undefined;
      if (edit?.hidden) continue;
      const text = (edit?.text ?? word.text).trim();
      if (text.length === 0) continue;

      const from = Math.max(word.start, segment.sourceIn);
      const to = Math.min(word.end, segment.sourceOut);
      const start = Math.max(
        shownFrom,
        placed.outStart + Math.round((from - segment.sourceIn) / segment.speed),
      );
      const end = Math.min(
        shownTo,
        Math.max(start + 1, placed.outStart + Math.round((to - segment.sourceIn) / segment.speed)),
      );
      if (start >= shownTo || end <= start) continue;
      const bleeped = bleeps.length > 0 && bleepCoversWord(bleeps, segment.source, word);
      out.push({
        i: word.i,
        start,
        end,
        text: bleeped ? maskBleepedWord(text) : text,
        sure: edit?.text !== undefined ? 1 : word.sure,
        segmentId: segment.id,
        segmentIndex: placed.index,
        sourceStart: word.start,
        ...(bleeped ? { bleeped: true as const } : {}),
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
    .filter((segment) => !isBrandPart(segment))
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

/**
 * The captions track of a document, or null: its first one. A clip has at
 * most one, except a montage (Module 11), which has one per video; read
 * those with `captionsTracksOf`. The first is the one whose style, size and
 * place every track of a montage is drawn with.
 */
export function captionsTrackOf(doc: Pick<ClipDocument, 'tracks'>): CaptionsTrack | null {
  for (const track of doc.tracks) {
    if (track.kind === 'captions') return track;
  }
  return null;
}

/**
 * Every captions track of a document, in track order (Module 11). One for an
 * ordinary clip (or none); a montage of clips from several videos has one
 * per video, each naming its `source`, so `captionWords` shows each
 * transcript only on its own video's parts.
 */
export function captionsTracksOf(doc: Pick<ClipDocument, 'tracks'>): CaptionsTrack[] {
  const out: CaptionsTrack[] = [];
  for (const track of doc.tracks) {
    if (track.kind === 'captions') out.push(track);
  }
  return out;
}

/**
 * The look every captions track of a montage is drawn with: the first
 * track's style, size, place, words a page, case and mark colour on `track`
 * (its transcript, language, source and word edits kept). The first track
 * itself comes back unchanged.
 */
export function inFirstCaptionsLook(
  doc: Pick<ClipDocument, 'tracks'>,
  track: CaptionsTrack,
): CaptionsTrack {
  const first = captionsTrackOf(doc);
  if (!first || first === track) return track;
  const next: CaptionsTrack = {
    ...track,
    styleId: first.styleId,
    position: { ...first.position },
    sizePx: first.sizePx,
    maxWords: first.maxWords,
  };
  if (first.letterCase !== undefined) next.letterCase = first.letterCase;
  else delete next.letterCase;
  if (first.markColour !== undefined) next.markColour = first.markColour;
  else delete next.markColour;
  return next;
}

/**
 * Places a cue of a captions file made for the CLIP (its clock starts where
 * the clip starts) in the video: through the part playing at the cue's start,
 * at that part's speed, and never past that part's end. A cue that starts
 * after the clip ends belongs nowhere.
 */
export function clipClockPlacer(
  doc: Pick<ClipDocument, 'segments'> & Partial<Pick<ClipDocument, 'joins'>>,
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
