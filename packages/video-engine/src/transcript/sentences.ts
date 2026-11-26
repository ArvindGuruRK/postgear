/**
 * Sentences, worked out from the words: never stored.
 *
 * A sentence ends at closing punctuation (`.`, `!`, `?`, the ellipsis, and
 * the danda Hindi uses), at a pause long enough that the speaker stopped, at
 * the edge of a listened stretch, or when it has run on for too long with
 * neither (a stream with no punctuation at all still reads in rows).
 *
 * Captions page by them, the transcript pane shows them as paragraphs, and
 * the moment picker shows them to the model as numbered rows and takes row
 * numbers back, so the model can never invent a time.
 */
import type { MsRange, Transcript, TranscriptWord } from './types';

export interface Sentence {
  /** Video time of the first word's start and the last word's end. */
  from: number;
  to: number;
  /** Positions in `transcript.words` (not stable indexes), both inclusive. */
  wordFrom: number;
  wordTo: number;
  text: string;
}

export interface SentenceOptions {
  /** A silence this long ends the sentence. Default 900 ms. */
  pauseMs?: number;
  /** A sentence never holds more words than this. Default 40. */
  maxWords?: number;
  /** A sentence never runs longer than this. Default 20 seconds. */
  maxMs?: number;
}

export const SENTENCE_PAUSE_MS = 900;
export const SENTENCE_MAX_WORDS = 40;
export const SENTENCE_MAX_MS = 20_000;

/** Closing punctuation, allowing quotes and brackets after it. */
const SENTENCE_END = /[.!?…।॥]+["'”’)\]]*$/u;

/** True when this word closes a sentence by its punctuation. */
export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text);
}

/** Words joined as a line of text. */
export function joinWords(words: readonly Pick<TranscriptWord, 'text'>[]): string {
  return words.map((word) => word.text).join(' ');
}

function coveredIndex(covered: readonly MsRange[], ms: number): number {
  return covered.findIndex((range) => ms >= range.fromMs && ms < range.toMs);
}

/** The transcript's sentences, in order. Every word is in exactly one. */
export function sentences(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  options: SentenceOptions = {},
): Sentence[] {
  const pauseMs = options.pauseMs ?? SENTENCE_PAUSE_MS;
  const maxWords = Math.max(1, options.maxWords ?? SENTENCE_MAX_WORDS);
  const maxMs = options.maxMs ?? SENTENCE_MAX_MS;
  const { words, covered } = transcript;
  const out: Sentence[] = [];
  let first = 0;

  const close = (last: number) => {
    const slice = words.slice(first, last + 1);
    const head = slice[0] as TranscriptWord;
    const tail = slice[slice.length - 1] as TranscriptWord;
    out.push({
      from: head.start,
      to: tail.end,
      wordFrom: first,
      wordTo: last,
      text: joinWords(slice),
    });
    first = last + 1;
  };

  for (let at = 0; at < words.length; at += 1) {
    const word = words[at] as TranscriptWord;
    const next = words[at + 1];
    if (!next) {
      close(at);
      break;
    }
    const start = (words[first] as TranscriptWord).start;
    const acrossStretches =
      covered.length > 1 && coveredIndex(covered, word.start) !== coveredIndex(covered, next.start);
    if (
      endsSentence(word.text) ||
      next.start - word.end >= pauseMs ||
      acrossStretches ||
      at - first + 1 >= maxWords ||
      next.end - start > maxMs
    ) {
      close(at);
    }
  }
  return out;
}

/** The sentence a moment falls in, or the nearest one before it; null with no sentences. */
export function sentenceAt(list: readonly Sentence[], ms: number): Sentence | null {
  let found: Sentence | null = null;
  for (const sentence of list) {
    if (sentence.from > ms) break;
    found = sentence;
  }
  return found ?? list[0] ?? null;
}
