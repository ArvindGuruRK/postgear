/**
 * A translation of a clip's words (Sprint 13, Module 03). Pure.
 *
 * The words a clip says are cut into sentences, each sentence is translated
 * as one line (by the API's model client), and each translated line takes its
 * sentence's own start and end, spread over its words by their length. So a
 * translated caption is on screen exactly while its sentence is said, even
 * though no word of it was ever timed. A translation marks the page, never
 * one word (`wordTimed: false`).
 */
import { type Sentence, sentences } from '../transcript/sentences';
import {
  MAX_TRANSCRIPT_WORDS,
  type MsRange,
  type Transcript,
  TRANSCRIPT_VERSION,
  type TranscriptWord,
} from '../transcript/types';
import { mergeRanges } from '../transcript/covered';
import { wordsInRanges } from '../transcript/window';
import { spreadWords } from './srt';

/** A sentence is at most this long, so one caption line is never a paragraph. */
export const TRANSLATE_SENTENCE_MAX_WORDS = 24;

export interface TranslationLine {
  /** Video time, whole milliseconds. */
  from: number;
  to: number;
  text: string;
}

/** The sentences said inside `ranges`, in order: what is sent to be translated. */
export function translationLines(
  transcript: Pick<Transcript, 'words'>,
  ranges: readonly MsRange[],
): TranslationLine[] {
  const covered = mergeRanges(ranges);
  const words = wordsInRanges(transcript, covered);
  return sentences({ words, covered }, { maxWords: TRANSLATE_SENTENCE_MAX_WORDS }).map(
    (sentence: Sentence) => ({ from: sentence.from, to: sentence.to, text: sentence.text }),
  );
}

/**
 * The translated transcript: line N of `translated` stands where line N of
 * `lines` was said. Throws a `RangeError` when the two do not line up, since a
 * line out of step would caption the wrong moment.
 */
export function translatedTranscript(input: {
  lines: readonly TranslationLine[];
  translated: readonly string[];
  language: string;
  model: string;
  ranges: readonly MsRange[];
}): Transcript {
  if (input.lines.length !== input.translated.length) {
    throw new RangeError('A translation needs one line for each sentence.');
  }
  const words: TranscriptWord[] = [];
  input.lines.forEach((line, at) => {
    // A sentence never runs into the next one, whatever the listener's word ends said.
    const next = input.lines[at + 1];
    const end = next ? Math.min(line.to, next.from) : line.to;
    for (const word of spreadWords(input.translated[at] as string, line.from, end)) {
      if (words.length >= MAX_TRANSCRIPT_WORDS) return;
      words.push({ i: words.length, ...word });
    }
  });
  return {
    version: TRANSCRIPT_VERSION,
    language: input.language,
    model: input.model,
    source: 'translated',
    covered: mergeRanges(input.ranges),
    words,
    nextIndex: words.length,
  };
}
