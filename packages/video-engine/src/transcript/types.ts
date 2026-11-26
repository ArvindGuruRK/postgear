/**
 * A video's speech as text, with a time for every word (Sprint 13, Module 02).
 *
 * One transcript per video and language, stored as a file (the `TRANSCRIPT`
 * asset), never a row and never a workflow payload. Everything is in the
 * **video's own time**, whole milliseconds: captions, cuts and AI picks map
 * words onto a clip through the time map, so a transcript never changes when
 * a clip is edited.
 *
 * - `covered` says which stretches were listened to. A stretch is listened to
 *   once: a request only ever fills the gaps (`covered.ts`).
 * - A word's `i` is its stable index: given once, never reused and never
 *   renumbered by a later merge, because a clip's caption edits and the
 *   picker's answers point at words by it.
 * - `sure` is how confident the listener was, 0 to 1. Unsure words are
 *   underlined in the editor, never in an export.
 *
 * Sentences are derived (`sentences.ts`), not stored.
 */

export const TRANSCRIPT_VERSION = 1 as const;

/** A stretch of the video, whole milliseconds, `fromMs` inclusive and `toMs` exclusive. */
export interface MsRange {
  fromMs: number;
  toMs: number;
}

export interface TranscriptWord {
  /** Stable index: never reused, never renumbered. */
  i: number;
  /** Video time, whole milliseconds. */
  start: number;
  end: number;
  /** The word as heard, with its punctuation ("job,"). Never empty. */
  text: string;
  /** 0 to 1. A word from a file the person supplied is 1. */
  sure: number;
}

/**
 * Where the words came from: `listened` (speech to text), `supplied` (the
 * person's own SRT or VTT file, free) or `translated` (from another
 * transcript of the same video).
 */
export const TRANSCRIPT_SOURCES = ['listened', 'supplied', 'translated'] as const;
export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number];

export interface Transcript {
  version: typeof TRANSCRIPT_VERSION;
  /** ISO 639-1, as detected or as asked. */
  language: string;
  /** What listened, such as `faster-whisper:large-v3-turbo`, `simulation` or `supplied`. */
  model: string;
  source: TranscriptSource;
  /** The stretches listened to: sorted, merged, never overlapping. */
  covered: MsRange[];
  /** Sorted by `start`. */
  words: TranscriptWord[];
  /** The index the next new word gets. */
  nextIndex: number;
}

/** A word as a listener returns it, before it has a stable index. */
export interface HeardWord {
  start: number;
  end: number;
  text: string;
  sure: number;
}

/** Words under this are shown as unsure (a dotted underline in the editor). */
export const UNSURE_BELOW = 0.6;

/** The most words one transcript may hold: 24 hours of fast speech. */
export const MAX_TRANSCRIPT_WORDS = 400_000;

/** The longest one word may be (a held note, a drawn-out shout). */
export const MAX_WORD_MS = 15_000;

/** The longest text of one word, punctuation included. */
export const MAX_WORD_CHARS = 80;

export function isUnsure(word: Pick<TranscriptWord, 'sure'>): boolean {
  return word.sure < UNSURE_BELOW;
}

/** A word belongs to the stretch its middle falls in, so no word is ever in two. */
export function wordMid(word: Pick<TranscriptWord, 'start' | 'end'>): number {
  return (word.start + word.end) / 2;
}

/** An empty transcript for a video nobody has listened to yet. */
export function emptyTranscript(
  language: string,
  model: string,
  source: TranscriptSource = 'listened',
): Transcript {
  return {
    version: TRANSCRIPT_VERSION,
    language,
    model,
    source,
    covered: [],
    words: [],
    nextIndex: 0,
  };
}
