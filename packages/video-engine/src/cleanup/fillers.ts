/**
 * Remove Filler Words (Sprint 13, Module 04). Pure.
 *
 * A small list per language of words that carry no meaning: "um", "uh",
 * "erm", "hmm" always; "you know" and "like" only when they stand alone
 * between pauses (or commas), since "I like it" and "do you know" are real
 * speech. Hindi and Tamil start with empty lists until someone who speaks
 * them picks the words.
 *
 * Honest limit (research 06, section 5): speech to text often leaves fillers
 * out, and a filler that was never written down cannot be cut by its time.
 */
import type { MsRange, Transcript, TranscriptWord } from '../transcript/types';
import { cutForPositions } from './word-cuts';

/** A pause this long on both sides makes "like" or "you know" stand alone. */
export const FILLER_PAUSE_MS = 250;

export interface FillerGroup {
  /** The filler as shown ("um", "you know"). */
  key: string;
  count: number;
  /** The stable indexes of every word found, in time order. */
  words: number[];
  /** One cut per occurrence, video time. */
  cuts: MsRange[];
}

interface FillerRules {
  /** Single words that are always fillers: pattern and the name shown. */
  always: ReadonlyArray<readonly [RegExp, string]>;
  /** Single words that are fillers only between pauses. */
  alone: readonly string[];
  /** Two-word fillers, only between pauses. */
  pairs: ReadonlyArray<readonly [string, string]>;
}

const NONE: FillerRules = { always: [], alone: [], pairs: [] };

const RULES: Readonly<Record<string, FillerRules>> = {
  en: {
    always: [
      [/^u+m+$/, 'um'],
      [/^u+h+m*$/, 'uh'],
      [/^e+r+m+$/, 'erm'],
      [/^h+m+$/, 'hmm'],
    ],
    alone: ['like'],
    pairs: [['you', 'know']],
  },
  hi: NONE,
  ta: NONE,
};

/** The languages with a filler list (the rest say "No filler words found."). */
export function hasFillerList(language: string): boolean {
  const rules = RULES[language];
  return rules !== undefined && rules.always.length + rules.alone.length + rules.pairs.length > 0;
}

/** A word as compared: lower case, no punctuation around it. */
function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

function endsWithComma(word: TranscriptWord): boolean {
  return /[,;:…]$|\.\.\.$/.test(word.text.trim());
}

/** A pause (or a comma) before position `first` and after position `last`. */
function standsAlone(words: readonly TranscriptWord[], first: number, last: number): boolean {
  const head = words[first] as TranscriptWord;
  const tail = words[last] as TranscriptWord;
  const before = words[first - 1];
  const after = words[last + 1];
  const pauseBefore =
    !before || head.start - before.end >= FILLER_PAUSE_MS || endsWithComma(before);
  const pauseAfter = !after || after.start - tail.end >= FILLER_PAUSE_MS || endsWithComma(tail);
  return pauseBefore && pauseAfter;
}

function inside(word: TranscriptWord, windows: readonly MsRange[]): boolean {
  const middle = (word.start + word.end) / 2;
  return windows.some((window) => middle >= window.fromMs && middle < window.toMs);
}

/**
 * The filler words inside `windows` (the stretches the clip plays, video
 * time), grouped by filler, most frequent first.
 */
export function findFillers(
  transcript: Pick<Transcript, 'words'>,
  language: string,
  windows: readonly MsRange[],
): FillerGroup[] {
  const rules = RULES[language] ?? NONE;
  const { words } = transcript;
  const groups = new Map<string, FillerGroup>();
  const add = (key: string, first: number, last: number) => {
    const cut = cutForPositions(words, first, last);
    if (!cut) return;
    const group = groups.get(key) ?? { key, count: 0, words: [], cuts: [] };
    group.count += 1;
    for (let p = first; p <= last; p += 1) group.words.push((words[p] as TranscriptWord).i);
    group.cuts.push(cut);
    groups.set(key, group);
  };

  for (let p = 0; p < words.length; p += 1) {
    const word = words[p] as TranscriptWord;
    if (!inside(word, windows)) continue;
    const text = bare(word.text);
    if (text.length === 0) continue;

    const pair = rules.pairs.find(([one, two]) => {
      const next = words[p + 1];
      return text === one && next !== undefined && bare(next.text) === two;
    });
    if (pair && standsAlone(words, p, p + 1)) {
      add(`${pair[0]} ${pair[1]}`, p, p + 1);
      p += 1;
      continue;
    }
    const always = rules.always.find(([pattern]) => pattern.test(text));
    if (always) {
      add(always[1], p, p);
      continue;
    }
    if (rules.alone.includes(text) && standsAlone(words, p, p)) add(text, p, p);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
