/**
 * Remove Bad Takes (Sprint 13, Module 17 item 3). Pure.
 *
 * Someone who stumbles usually starts the sentence again: "So today we are,
 * so today we are going to look at three tricks." This finds each start that
 * is said again soon after and offers to cut the earlier attempt, keeping the
 * last one, the way Remove Silences and Remove Filler Words offer theirs:
 * shown first, each with a tick, and applied as one undo step.
 *
 * The rule, kept small so it is easy to trust:
 * - an attempt begins at a fresh start: the first word, or a word after a
 *   pause of `RESTART_PAUSE_MS`, a sentence end or a cut-off mark;
 * - a later fresh start within `TAKE_MAX_WORDS` words and `TAKE_MAX_MS`
 *   repeats its first `TAKE_MATCH_WORDS` words or more (case and punctuation
 *   aside), so one repeated word ("I, I think") is never a take;
 * - the earlier attempt was abandoned: no finished sentence inside it, so
 *   two sentences that merely open alike ("That is the worst thing you can
 *   do. ... That is such a good point.") are left alone. A whole finished
 *   sentence counts only when it is said again word for word and has at
 *   least `FULL_REPEAT_WORDS` words ("Hours are a trap. Hours are a trap."),
 *   so "Oh no! Oh no, no, no!" stays;
 * - three attempts in a row keep only the last; the cut runs from the first
 *   attempt's first word to the word before the kept one (`cutForPositions`,
 *   so the breath before the kept start stays).
 *
 * Honest limits: a sentence said twice on purpose looks the same, and with
 * no speaker model a second speaker echoing the first does too, which is why
 * every take is shown with its words first and can be unticked.
 */
import type { MsRange, Transcript, TranscriptWord } from '../transcript/types';
import { cutForPositions } from './word-cuts';

/** Words two attempts must share at their start to be one take said again. */
export const TAKE_MATCH_WORDS = 2;
/** The most words an abandoned attempt may have. */
export const TAKE_MAX_WORDS = 25;
/** The longest an abandoned attempt may last, first word to the restart. */
export const TAKE_MAX_MS = 20_000;
/** A whole finished sentence said again counts from this many words. */
export const FULL_REPEAT_WORDS = 3;
/** A pause this long before a word makes it a fresh start. */
export const RESTART_PAUSE_MS = 300;

export interface BadTake {
  /** The stable indexes of the words cut (the earlier attempts), in time order. */
  words: number[];
  /** The stable index of the first word of the attempt that is kept. */
  keptFrom: number;
  /** How many words the attempts share at their start. */
  matched: number;
  /** One cut, video time. */
  cut: MsRange;
}

/** A word as compared: lower case, no punctuation around it. */
function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/**
 * What ends a thought: a sentence end, or a cut-off mark (a hyphen, the
 * ellipsis, the en and em dashes, written by code point).
 */
const THOUGHT_ENDS = [
  '.',
  '!',
  '?',
  '-',
  ...[0x2026, 0x2013, 0x2014].map((code) => String.fromCharCode(code)),
];

/** Ends a finished sentence: a full stop, "!" or "?", but not a trailing "...". */
function endsASentence(word: TranscriptWord): boolean {
  const text = word.text.trim();
  return /[.!?]$/.test(text) && !text.endsWith('..');
}

function endsAThought(word: TranscriptWord): boolean {
  const text = word.text.trim();
  return THOUGHT_ENDS.some((mark) => text.endsWith(mark));
}

function inside(word: TranscriptWord, windows: readonly MsRange[]): boolean {
  const middle = (word.start + word.end) / 2;
  return windows.some((window) => middle >= window.fromMs && middle < window.toMs);
}

/**
 * The bad takes inside `windows` (the stretches the clip plays, video time),
 * in time order. `words` must be sorted by time, as a transcript's are.
 */
export function findBadTakes(
  transcript: Pick<Transcript, 'words'>,
  windows: readonly MsRange[],
): BadTake[] {
  const { words } = transcript;
  const keys = words.map((word) => bare(word.text));
  const freshStart = (p: number): boolean => {
    if (p === 0) return true;
    const before = words[p - 1] as TranscriptWord;
    const word = words[p] as TranscriptWord;
    return word.start - before.end >= RESTART_PAUSE_MS || endsAThought(before);
  };
  /** How many words from `a` are said again from `b`, never reaching past `b`. */
  const shared = (a: number, b: number): number => {
    let n = 0;
    while (b + n < words.length && n < b - a && keys[a + n] !== '' && keys[a + n] === keys[b + n]) {
      n += 1;
    }
    return n;
  };
  /** The next fresh start that says `from`'s start again, with the words shared. */
  const restartOf = (from: number): { at: number; matched: number } | null => {
    const first = words[from] as TranscriptWord;
    const last = Math.min(words.length - 1, from + TAKE_MAX_WORDS);
    for (let q = from + 1; q <= last; q += 1) {
      const word = words[q] as TranscriptWord;
      if (word.start - first.start > TAKE_MAX_MS) break;
      // A finished sentence inside the attempt: it was not abandoned.
      if (q - 2 >= from && endsASentence(words[q - 2] as TranscriptWord)) break;
      if (!freshStart(q)) continue;
      const matched = shared(from, q);
      const finished = endsASentence(words[q - 1] as TranscriptWord);
      const take = finished
        ? matched === q - from && matched >= FULL_REPEAT_WORDS
        : matched >= TAKE_MATCH_WORDS;
      if (take) return { at: q, matched };
    }
    return null;
  };

  const takes: BadTake[] = [];
  let p = 0;
  while (p < words.length) {
    const word = words[p] as TranscriptWord;
    const found = keys[p] !== '' && freshStart(p) && inside(word, windows) ? restartOf(p) : null;
    if (!found) {
      p += 1;
      continue;
    }
    // Keep only the last of several attempts.
    let kept = found;
    for (let again = restartOf(kept.at); again; again = restartOf(kept.at)) kept = again;

    const cutWords = words.slice(p, kept.at);
    const keptWord = words[kept.at] as TranscriptWord;
    const cut = cutForPositions(words, p, kept.at - 1);
    if (cut && inside(keptWord, windows) && cutWords.every((w) => inside(w, windows))) {
      takes.push({
        words: cutWords.map((w) => w.i),
        keptFrom: keptWord.i,
        matched: found.matched,
        cut,
      });
    }
    p = kept.at;
  }
  return takes;
}
