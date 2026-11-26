/**
 * Bleep Bad Words (Sprint 13, Module 09). Pure.
 *
 * - `findBleepWords` finds swear words in a transcript's words with a list:
 *   the language's default list (`word-lists/`) plus the workspace's own
 *   words (My Words). No model is called: a list is predictable and free.
 * - `setBleeps` writes the chosen words into the document's `bleeps`, in the
 *   video's own time (like crops), padded by `BLEEP_PAD_MS` each side and
 *   merged where they touch, so a bleep stays on its word through every edit.
 * - `bleepCoversWord` and `maskBleepedWord` are what the captions use: a
 *   bleeped word is drawn as its first letter and stars ("f***"). The
 *   transcript itself is never changed.
 *
 * Matching: whole words only ("class" never matches "ass"), case does not
 * matter, punctuation around a word is ignored, and a word is also tried in
 * its parts split at hyphens and apostrophes ("shit's"). English adds the
 * endings -s, -es, -ing and -ed (and a doubled last letter, "shitting"). A
 * workspace entry of several words matches those words in a row.
 */
import { MAX_BLEEPS } from '../document/limits';
import type { Bleep, ClipDocument } from '../document/schema';
import { EN_BLEEP_WORDS } from './word-lists/en';
import { HI_BLEEP_WORDS } from './word-lists/hi';
import { TA_BLEEP_WORDS } from './word-lists/ta';

/** Each bleep starts this much before its word and ends this much after it. */
export const BLEEP_PAD_MS = 40;

/** The default lists, by language. A language not here has none (the workspace's words still count). */
export const BLEEP_WORD_LISTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  en: EN_BLEEP_WORDS,
  hi: HI_BLEEP_WORDS,
  ta: TA_BLEEP_WORDS,
});

/** A word found to bleep: its transcript index, its time in the video, and the word as heard. */
export interface BleepWord {
  wordIndex: number;
  /** Video time, whole milliseconds. */
  from: number;
  to: number;
  text: string;
}

/** A transcript word as `findBleepWords` reads it. */
export interface BleepInputWord {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface BleepLists {
  /** The transcript's language ("en", "hi"; a region such as "en-GB" reads as "en"). */
  language: string;
  /** The workspace's own words (My Words). */
  workspace: readonly string[];
}

export type BleepMode = Bleep['mode'];

/** The language part of a code, lower case ("en-GB" gives "en"). */
function baseLanguage(language: string): string {
  return (language.toLowerCase().split(/[-_]/)[0] ?? '').trim();
}

/** The default list for a language (empty when there is none). */
export function defaultBleepList(language: string): readonly string[] {
  return BLEEP_WORD_LISTS[baseLanguage(language)] ?? [];
}

/** A word as compared: one Unicode form, lower case, no punctuation around it. Marks (Devanagari vowel signs) are kept. */
function bare(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
}

/** The forms a word is tried in: itself, and its parts split at hyphens and apostrophes. */
function parts(word: string): string[] {
  const whole = bare(word);
  if (whole.length === 0) return [];
  const split = whole
    .split(/[-'’‐‑]+/u)
    .map(bare)
    .filter((part) => part.length > 0);
  return split.length > 1 ? [whole, ...split] : [whole];
}

const ENGLISH_ENDINGS = ['ing', 'ed', 'es', 's'] as const;

/** The word and the base forms its English endings could hide. */
function englishStems(word: string): string[] {
  const stems = [word];
  for (const ending of ENGLISH_ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    if (stem.length < 2) continue;
    stems.push(stem);
    const last = stem.length - 1;
    // "shitting" is "shit" with its last letter doubled.
    if (stem.length > 2 && stem[last] === stem[last - 1]) stems.push(stem.slice(0, -1));
  }
  return stems;
}

/** Whether one word (already bare) is on the list. */
function wordMatches(word: string, single: ReadonlySet<string>, english: boolean): boolean {
  for (const part of parts(word)) {
    const forms = english ? englishStems(part) : [part];
    if (forms.some((form) => single.has(form))) return true;
  }
  return false;
}

/**
 * The words to bleep, in time order. `words` are the transcript's words (any
 * order; usually the ones the clip plays). Each word is listed once, even
 * when it is on both lists.
 */
export function findBleepWords(words: readonly BleepInputWord[], lists: BleepLists): BleepWord[] {
  const english = baseLanguage(lists.language) === 'en';
  const single = new Set<string>();
  const phrases: string[][] = [];
  for (const entry of [...defaultBleepList(lists.language), ...lists.workspace]) {
    const tokens = entry
      .split(/\s+/u)
      .map(bare)
      .filter((token) => token.length > 0);
    if (tokens.length === 1) single.add(tokens[0] as string);
    else if (tokens.length > 1) phrases.push(tokens);
  }
  if (single.size === 0 && phrases.length === 0) return [];

  const ordered = [...words].sort((a, b) => a.start - b.start || a.index - b.index);
  const found = new Map<number, BleepWord>();
  const take = (word: BleepInputWord) => {
    if (!found.has(word.index)) {
      found.set(word.index, {
        wordIndex: word.index,
        from: word.start,
        to: word.end,
        text: word.text,
      });
    }
  };

  ordered.forEach((word, position) => {
    if (wordMatches(word.text, single, english)) take(word);
    for (const phrase of phrases) {
      const run = ordered.slice(position, position + phrase.length);
      if (run.length !== phrase.length) continue;
      const matches = run.every((other, k) => {
        const token = phrase[k] as string;
        const text = bare(other.text);
        return english && k === phrase.length - 1
          ? englishStems(text).includes(token)
          : text === token;
      });
      if (matches) for (const other of run) take(other);
    }
  });
  return [...found.values()].sort((a, b) => a.from - b.from || a.wordIndex - b.wordIndex);
}

/** A bleep's id: the same words always give the same id, so undo, redo and re-ticking stay clean. */
function bleepId(sourceIndex: number, from: number, to: number): string {
  return `blp_${sourceIndex}_${from}_${to}`;
}

/** Padded, sorted and merged where they touch or overlap. */
function bleepRangesFor(words: readonly BleepWord[]): Array<{ from: number; to: number }> {
  const ranges = words
    .filter((word) => Number.isFinite(word.from) && Number.isFinite(word.to) && word.to > word.from)
    .map((word) => ({
      from: Math.max(0, Math.round(word.from) - BLEEP_PAD_MS),
      to: Math.round(word.to) + BLEEP_PAD_MS,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function sameBleeps(a: readonly Bleep[], b: readonly Bleep[]): boolean {
  return (
    a.length === b.length &&
    a.every((bleep, i) => {
      const other = b[i] as Bleep;
      return (
        bleep.id === other.id &&
        bleep.source === other.source &&
        bleep.from === other.from &&
        bleep.to === other.to &&
        bleep.mode === other.mode
      );
    })
  );
}

/**
 * Replaces the bleeps of one video (`source`, the document's source id) with
 * `words`, all in `mode`: one undo step. Each word is padded by
 * `BLEEP_PAD_MS` each side, and bleeps that touch are merged into one. Other
 * sources' bleeps (a montage) are kept. At most `MAX_BLEEPS` are kept in all,
 * the earliest first. Returns the same document when nothing changed, and
 * when `source` is not one of the clip's videos.
 */
export function setBleeps(
  doc: ClipDocument,
  words: readonly BleepWord[],
  mode: BleepMode,
  source: string,
): ClipDocument {
  const sourceIndex = doc.sources.findIndex((entry) => entry.id === source);
  if (sourceIndex < 0) return doc;
  const others = doc.bleeps.filter((bleep) => bleep.source !== source);
  const room = Math.max(0, MAX_BLEEPS - others.length);
  const mine: Bleep[] = bleepRangesFor(words)
    .slice(0, room)
    .map((range) => ({ id: bleepId(sourceIndex, range.from, range.to), source, ...range, mode }));
  const bleeps = [...others, ...mine].sort(
    (a, b) => a.from - b.from || a.to - b.to || a.source.localeCompare(b.source),
  );
  return sameBleeps(bleeps, doc.bleeps) ? doc : { ...doc, bleeps };
}

/** Takes every bleep off (Bleep Bad Words switched off). The same document when there were none. */
export function clearBleeps(doc: ClipDocument): ClipDocument {
  return doc.bleeps.length === 0 ? doc : { ...doc, bleeps: [] };
}

/** The mode the clip's bleeps use, or null when it has none. */
export function bleepModeOf(doc: Pick<ClipDocument, 'bleeps'>): BleepMode | null {
  return doc.bleeps[0]?.mode ?? null;
}

/**
 * Whether bleeps of `source` cover more than half of a word (video time).
 * The padding of a bleep reaches into the words beside it; this keeps those
 * words shown and ticked as they are.
 */
export function bleepCoversWord(
  bleeps: readonly Pick<Bleep, 'source' | 'from' | 'to'>[],
  source: string,
  word: { start: number; end: number },
): boolean {
  const length = word.end - word.start;
  if (!(length > 0)) return false;
  let covered = 0;
  for (const bleep of bleeps) {
    if (bleep.source !== source) continue;
    covered += Math.max(0, Math.min(bleep.to, word.end) - Math.max(bleep.from, word.start));
  }
  return covered * 2 > length;
}

/** Letters with the marks drawn on them (a Devanagari vowel sign stays with its letter). */
function letterClusters(text: string): string[] {
  const clusters: string[] = [];
  for (const char of text) {
    const joins = /[\p{M}‌‍]/u.test(char);
    if (joins && clusters.length > 0) clusters[clusters.length - 1] += char;
    else clusters.push(char);
  }
  return clusters;
}

/**
 * A bleeped word as captions show it: its first letter, then one star for
 * each letter after it ("fuck" gives "f***"). Punctuation around the word
 * stays ("shit," gives "s***,").
 */
export function maskBleepedWord(text: string): string {
  const match = /^([^\p{L}\p{M}\p{N}]*)(.*?)([^\p{L}\p{M}\p{N}]*)$/su.exec(text);
  const lead = match?.[1] ?? '';
  const core = match?.[2] ?? text;
  const tail = match?.[3] ?? '';
  const clusters = letterClusters(core);
  if (clusters.length === 0) return text;
  return `${lead}${clusters[0]}${'*'.repeat(clusters.length - 1)}${tail}`;
}
