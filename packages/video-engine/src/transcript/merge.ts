/**
 * Joining a newly listened stretch into a video's transcript.
 *
 * Rules:
 * - Nothing that already has an index is renumbered. A new word gets the next
 *   free index, even when it sits earlier in the video than older words.
 * - A stretch listened to again (a forced re-listen, or a block the rounding
 *   widened) replaces the old words of that stretch, except that a word heard
 *   the same way at the same moment keeps its old index, so caption edits and
 *   picks that point at it still do.
 * - Only words whose middle falls inside the incoming stretches are taken,
 *   and they are clamped to whole, forward milliseconds.
 */
import { mergeRanges } from './covered';
import {
  type HeardWord,
  MAX_TRANSCRIPT_WORDS,
  MAX_WORD_CHARS,
  MAX_WORD_MS,
  type MsRange,
  type Transcript,
  type TranscriptWord,
  wordMid,
} from './types';

/** What a listening run hands back for the stretches it was asked for. */
export interface IncomingStretch {
  /** The stretches this run listened to (they become covered even when silent). */
  ranges: readonly MsRange[];
  words: readonly HeardWord[];
  /** The language it found, used when the transcript has none yet. */
  language?: string;
  model?: string;
}

/** Two hearings of one word: the same text within this many ms of each other. */
export const SAME_WORD_MS = 60;

export class TranscriptTooLongError extends Error {
  constructor() {
    super('The transcript would hold more words than it may.');
    this.name = 'TranscriptTooLongError';
  }
}

function inAny(ranges: readonly MsRange[], ms: number): boolean {
  return ranges.some((range) => ms >= range.fromMs && ms < range.toMs);
}

/** A heard word made safe to store: whole ms, forward, a bounded length, trimmed text. */
export function cleanHeardWord(word: HeardWord): HeardWord | null {
  const text = typeof word.text === 'string' ? word.text.replace(/\s+/g, ' ').trim() : '';
  if (text.length === 0) return null;
  const start = Math.max(0, Math.round(word.start));
  let end = Math.round(word.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) end = start + 1;
  if (end - start > MAX_WORD_MS) end = start + MAX_WORD_MS;
  const sure = Number.isFinite(word.sure) ? Math.min(1, Math.max(0, word.sure)) : 0;
  return {
    start,
    end,
    text: text.slice(0, MAX_WORD_CHARS),
    sure: Math.round(sure * 1000) / 1000,
  };
}

/** The transcript with the incoming stretches joined in. Pure: `existing` is not changed. */
export function mergeTranscript(existing: Transcript, incoming: IncomingStretch): Transcript {
  const ranges = mergeRanges(incoming.ranges);
  if (ranges.length === 0) return existing;

  const kept: TranscriptWord[] = [];
  const replaced: TranscriptWord[] = [];
  for (const word of existing.words) {
    (inAny(ranges, wordMid(word)) ? replaced : kept).push(word);
  }

  let nextIndex = existing.nextIndex;
  const reused = new Set<number>();
  const added: TranscriptWord[] = [];
  const heard = incoming.words
    .map(cleanHeardWord)
    .filter((word): word is HeardWord => word !== null && inAny(ranges, wordMid(word)))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  for (const word of heard) {
    const same = replaced.find(
      (old) =>
        !reused.has(old.i) &&
        old.text === word.text &&
        Math.abs(old.start - word.start) <= SAME_WORD_MS,
    );
    if (same) {
      reused.add(same.i);
      added.push({ ...word, i: same.i });
    } else {
      added.push({ ...word, i: nextIndex });
      nextIndex += 1;
    }
  }

  const words = [...kept, ...added].sort((a, b) => a.start - b.start || a.i - b.i);
  if (words.length > MAX_TRANSCRIPT_WORDS) throw new TranscriptTooLongError();

  return {
    version: existing.version,
    language:
      existing.words.length === 0 && incoming.language ? incoming.language : existing.language,
    model: incoming.model ?? existing.model,
    source: existing.source,
    covered: mergeRanges([...existing.covered, ...ranges]),
    words,
    nextIndex,
  };
}
