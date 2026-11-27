/**
 * The Transcript pane's arithmetic (Sprint 13, Module 04), kept apart from
 * React so it is tested on its own.
 *
 * - The pane loads the clip's words once and derives everything else from
 *   the document: where each word stands (`wordPlaces`), the paragraphs and
 *   their times on the clip, and the word being said at the playhead.
 * - A cut is the engine's (`cutForWords`, `removeSourceRanges`); this file
 *   only turns its refusals and results into sentences.
 */
import type { TranscriptTextParagraph, TranscriptWordState } from '@postgear/ui';
import {
  type ClipDocument,
  type ClipDocumentMeta,
  type CutRefusalCode,
  type CutResult,
  formatClipLength,
  MAX_SEGMENTS,
  type MsRange,
  type TranscriptWord,
  toOutput,
  toSource,
  UNSURE_BELOW,
  type WordPlace,
} from '@postgear/video-engine';

/** A pause this long between two words starts a new paragraph. */
export const PARAGRAPH_PAUSE_MS = 1_200;
/** A paragraph ends at the first sentence end past this many words. */
export const PARAGRAPH_SOFT_WORDS = 40;
/** And at this many words whatever the punctuation. */
export const PARAGRAPH_MAX_WORDS = 80;
/** A word stays marked this long after it ends, so the mark does not flicker between words. */
export const SPOKEN_HOLD_MS = 300;

/** The note at the top when at least this share of the clip's words were hard to hear. */
const UNSURE_SHARE = 0.1;
const UNSURE_MIN_WORDS = 3;

export const UNSURE_NOTE = 'Some words were hard to hear. Check the underlined ones.';
export const NO_WORDS_NOTE = 'No words were heard in this clip.';
export const RESTORE_UNDO_SENTENCE = 'Use Undo to bring this back.';
export const PARTLY_HEARD_NOTE = 'Part of this clip has not been listened to yet.';
export const LISTEN_HELP = 'Listen to this clip to see what is said and edit it by its words.';

/** Listening reaches this far past the clip's ends, so a small trim outward needs no new listen. */
export const LISTEN_HANDLE_MS = 30_000;

/**
 * The clip's stretch of its main video (its first part's source), from its
 * earliest to its latest moment, or null for a clip with no part of it.
 */
export function clipSpan(
  doc: Pick<ClipDocument, 'segments'>,
  sourceId: string | null,
): { fromMs: number; toMs: number } | null {
  const parts = doc.segments.filter((segment) => segment.source === sourceId);
  if (parts.length === 0) return null;
  return {
    fromMs: Math.min(...parts.map((part) => part.sourceIn)),
    toMs: Math.max(...parts.map((part) => part.sourceOut)),
  };
}

/** What Listen To This Clip asks for: the clip's stretch with its handles, inside the video. */
export function listenRange(
  span: { fromMs: number; toMs: number },
  videoDurationMs: number,
): { fromMs: number; toMs: number } {
  return {
    fromMs: Math.max(0, span.fromMs - LISTEN_HANDLE_MS),
    toMs: Math.min(videoDurationMs > 0 ? videoDurationMs : span.toMs, span.toMs + LISTEN_HANDLE_MS),
  };
}

function endsSentence(text: string): boolean {
  return /[.!?…]["')\]]*$/.test(text.trim());
}

/** The clip's words as paragraphs: broken at long pauses and sentence ends, with their time on the clip. */
export function transcriptParagraphs(
  words: readonly TranscriptWord[],
  places: ReadonlyMap<number, WordPlace>,
  doc: Pick<ClipDocument, 'segments'>,
  sourceId: string,
  unsureBelow = UNSURE_BELOW,
): TranscriptTextParagraph[] {
  const paragraphs: Array<{ key: string; words: TranscriptWord[] }> = [];
  let current: { key: string; words: TranscriptWord[] } | null = null;
  let previous: TranscriptWord | null = null;
  for (const word of words) {
    const count = current?.words.length ?? 0;
    const pause = previous ? word.start - previous.end : 0;
    const placeChanged =
      previous !== null &&
      (places.get(previous.i) === 'outside') !== (places.get(word.i) === 'outside');
    const breakHere =
      current === null ||
      pause >= PARAGRAPH_PAUSE_MS ||
      placeChanged ||
      count >= PARAGRAPH_MAX_WORDS ||
      (count >= PARAGRAPH_SOFT_WORDS && previous !== null && endsSentence(previous.text));
    if (breakHere) {
      current = { key: `p${word.i}`, words: [] };
      paragraphs.push(current);
    }
    (current as { words: TranscriptWord[] }).words.push(word);
    previous = word;
  }

  let previousOutside = false;
  return paragraphs.map((paragraph) => {
    const played = paragraph.words.find((word) => places.get(word.i) === 'played');
    const at = played ? toOutput(doc, sourceId, played.start) : null;
    const allOutside = paragraph.words.every((word) => places.get(word.i) === 'outside');
    // "Outside" once at the head of each run of context, not in every margin.
    const label =
      at !== null ? formatClipLength(at) : allOutside && !previousOutside ? 'Outside' : '';
    previousOutside = allOutside;
    return {
      key: paragraph.key,
      label,
      words: paragraph.words.map((word) => ({
        id: word.i,
        text: word.text,
        state: textState(places.get(word.i)),
        unsure: word.sure < unsureBelow,
      })),
    };
  });
}

/** How `TranscriptText` draws a word in each place. */
function textState(place: WordPlace | undefined): TranscriptWordState {
  if (place === 'played') return 'normal';
  return place === 'removed' ? 'removed' : 'outside';
}

/** The first word whose end is after `ms` (words are sorted by start). */
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
 * The word being said at `outputMs` on the clip: the word under the
 * playhead, or the one that ended within `SPOKEN_HOLD_MS` before it. Null in
 * a pause, before the first word and outside `sourceId`.
 */
export function spokenWordAt(
  doc: Pick<ClipDocument, 'segments'>,
  words: readonly TranscriptWord[],
  sourceId: string,
  outputMs: number,
): number | null {
  const moment = toSource(doc, outputMs);
  if (!moment || moment.sourceId !== sourceId) return null;
  const ms = moment.sourceMs;
  const at = firstEndingAfter(words, ms);
  const word = words[at];
  if (word && word.start <= ms) return word.i;
  const before = words[at - 1];
  if (before && ms - before.end < SPOKEN_HOLD_MS) return before.i;
  return null;
}

/** Whether the "hard to hear" note shows: enough of the clip's words were unsure. */
export function manyUnsure(
  words: readonly TranscriptWord[],
  places: ReadonlyMap<number, WordPlace>,
  unsureBelow = UNSURE_BELOW,
): boolean {
  const played = words.filter((word) => places.get(word.i) === 'played');
  const unsure = played.filter((word) => word.sure < unsureBelow).length;
  return unsure >= UNSURE_MIN_WORDS && unsure / Math.max(1, played.length) >= UNSURE_SHARE;
}

/** The sentence for a cut the engine refused. */
export function cutRefusalSentence(code: CutRefusalCode): string {
  switch (code) {
    case 'clip_too_short':
      return 'A clip needs at least 3 seconds.';
    case 'clip_too_long':
      return 'A clip can be at most 30 minutes long.';
    case 'too_many_segments':
      return `A clip can have at most ${MAX_SEGMENTS} parts. Remove fewer at once, or Undo some cuts first.`;
    case 'nothing_to_cut':
      return 'Those words are already cut from this clip.';
    case 'cannot_restore':
      return RESTORE_UNDO_SENTENCE;
    default:
      return 'That cut could not be made. Try a smaller selection.';
  }
}

/** A length as people say it: "4.2 seconds", "1 second", "1 minute 5 seconds". */
export function spokenLength(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds - minutes * 60);
    const minuteWord = minutes === 1 ? 'minute' : 'minutes';
    if (rest === 0) return `${minutes} ${minuteWord}`;
    return `${minutes} ${minuteWord} ${rest} ${rest === 1 ? 'second' : 'seconds'}`;
  }
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
}

/** "7 pauses, 4.2 seconds". */
export function pausesLine(count: number, totalMs: number): string {
  return `${count} ${count === 1 ? 'pause' : 'pauses'}, ${spokenLength(totalMs)}`;
}

/** Remove Silences found nothing at this length. */
export function noPausesLine(minMs: number): string {
  return `No pauses longer than ${spokenLength(minMs)}.`;
}

export const NO_FILLERS_LINE = 'No filler words found.';

/** Pauses kept because sound plays under them: said, so an empty result is not a mystery. */
export function loudPausesLine(count: number): string {
  return count === 1
    ? 'One pause has sound under it (music or a game), so it stays.'
    : `${count} pauses have sound under them (music or a game), so they stay.`;
}

/** The toast after a cleanup: what went, and how much shorter the clip is. */
export function cleanupToast(kind: 'pauses' | 'fillers', count: number, savedMs: number): string {
  const what =
    kind === 'pauses'
      ? `${count} ${count === 1 ? 'pause' : 'pauses'}`
      : `${count} filler ${count === 1 ? 'word' : 'words'}`;
  return `Removed ${what}. The clip is ${spokenLength(savedMs)} shorter.`;
}

/** What a cleanup records on the clip (Module 10): Save As Recipe reads it back. */
export type CleanupNote = NonNullable<ClipDocumentMeta['cleanup']>;

/**
 * A cleanup's cut with its note on the clip, in the same change (so the
 * same undo step): Remove Silences records the shortest pause it removed,
 * Remove Filler Words that fillers went. A refused cut stays refused.
 */
export function withCleanupNote(result: CutResult, note: CleanupNote): CutResult {
  if (!result.ok) return result;
  const cleanup: CleanupNote = { ...result.doc.meta?.cleanup, ...note };
  return { ...result, doc: { ...result.doc, meta: { ...result.doc.meta, cleanup } } };
}

/** The toast after deleting words. */
export function cutToast(words: number, savedMs: number): string {
  return `Cut ${words} ${words === 1 ? 'word' : 'words'}. The clip is ${spokenLength(savedMs)} shorter.`;
}

/** The stretch a run of the pane's words spans in the video (first start to last end). */
export function wordsSpan(
  words: readonly TranscriptWord[],
  ids: readonly number[],
): MsRange | null {
  const wanted = new Set(ids);
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  for (const word of words) {
    if (!wanted.has(word.i)) continue;
    fromMs = Math.min(fromMs, word.start);
    toMs = Math.max(toMs, word.end);
  }
  return Number.isFinite(fromMs) && Number.isFinite(toMs) ? { fromMs, toMs } : null;
}
