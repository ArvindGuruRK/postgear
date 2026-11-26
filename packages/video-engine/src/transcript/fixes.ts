/**
 * Word fixes a person made, kept for the whole video.
 *
 * A fix is `{ at, text }`: the moment the word starts and what it should say.
 * It is keyed by time, not by index, and applied when a transcript is read
 * (`applyFixes`), so listening to the video again keeps every fix: the word
 * heard at that moment takes the fixed text, whatever index it has now.
 *
 * Fixes live in the transcript asset's `meta`, never in a clip: fixing a name
 * once fixes it in every clip of the video. A clip's own caption edits (hide
 * this word here) are in the clip document and are a different thing.
 */
import { MAX_WORD_CHARS, type Transcript, type TranscriptWord } from './types';

export interface WordFix {
  /** The fixed word's start, video time in whole ms. */
  at: number;
  /** What the word should say. Never empty. */
  text: string;
}

/** A fix follows its word across a re-listen that moved it by up to this much. */
export const FIX_MATCH_MS = 250;

/** The most fixes one video keeps. */
export const MAX_WORD_FIXES = 5_000;

/** Letters and digits only, lowercased: how two spellings of a word are compared. */
export function wordCore(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}']/gu, '');
}

/** True for a control character (a tab, a newline, a NUL): never part of a word. */
function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}

/** A fix's text made safe to store, or null when nothing is left. */
export function cleanFixText(text: string): string | null {
  const clean = Array.from(text, (char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length === 0 ? null : clean.slice(0, MAX_WORD_CHARS);
}

/** The fix for a word: the nearest fix within `FIX_MATCH_MS` of its start. */
function fixFor(word: TranscriptWord, sorted: readonly WordFix[]): WordFix | null {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] as WordFix).at < word.start) low = mid + 1;
    else high = mid;
  }
  let best: WordFix | null = null;
  for (const candidate of [sorted[low - 1], sorted[low]]) {
    if (!candidate) continue;
    const distance = Math.abs(candidate.at - word.start);
    if (distance <= FIX_MATCH_MS && (!best || distance < Math.abs(best.at - word.start))) {
      best = candidate;
    }
  }
  return best;
}

/** The transcript as a person reads it: every fixed word says its fixed text and is sure. */
export function applyFixes(transcript: Transcript, fixes: readonly WordFix[]): Transcript {
  if (fixes.length === 0) return transcript;
  const sorted = [...fixes].sort((a, b) => a.at - b.at);
  const taken = new Set<WordFix>();
  const words = transcript.words.map((word) => {
    const fix = fixFor(word, sorted);
    if (!fix || taken.has(fix)) return word;
    taken.add(fix);
    return { ...word, text: fix.text, sure: 1 };
  });
  return { ...transcript, words };
}

/** The fixes with one word's fix added or replaced. Returns the same list when nothing changes. */
export function upsertFix(
  fixes: readonly WordFix[],
  word: Pick<TranscriptWord, 'start'>,
  text: string,
): WordFix[] {
  const clean = cleanFixText(text);
  if (clean === null) return [...fixes];
  const rest = fixes.filter((fix) => Math.abs(fix.at - word.start) > FIX_MATCH_MS);
  const next = [...rest, { at: Math.round(word.start), text: clean }].sort((a, b) => a.at - b.at);
  return next.slice(-MAX_WORD_FIXES);
}

/** The fixes with the one for this word removed (the word reads as heard again). */
export function removeFix(
  fixes: readonly WordFix[],
  word: Pick<TranscriptWord, 'start'>,
): WordFix[] {
  return fixes.filter((fix) => Math.abs(fix.at - word.start) > FIX_MATCH_MS);
}

/** The punctuation around a word, kept when its letters are replaced. */
function wrap(original: string, replacement: string): string {
  const lead = /^[^\p{L}\p{N}]*/u.exec(original)?.[0] ?? '';
  const tail = /[^\p{L}\p{N}]*$/u.exec(original)?.[0] ?? '';
  // A word that is all punctuation keeps nothing: the replacement stands alone.
  return lead.length + tail.length >= original.length
    ? replacement
    : `${lead}${replacement}${tail}`;
}

/**
 * Replace Everywhere: a fix for every word that reads as `from` (letters and
 * digits compared, case and punctuation ignored), keeping each word's own
 * punctuation. Pass the transcript with the current fixes applied. Answers
 * the new fix list and how many words changed.
 */
export function replaceEverywhere(
  transcript: Pick<Transcript, 'words'>,
  fixes: readonly WordFix[],
  from: string,
  to: string,
): { fixes: WordFix[]; changed: number } {
  const target = wordCore(from);
  const clean = cleanFixText(to);
  if (target.length === 0 || clean === null) return { fixes: [...fixes], changed: 0 };
  let next = [...fixes];
  let changed = 0;
  for (const word of transcript.words) {
    if (wordCore(word.text) !== target) continue;
    const text = wrap(word.text, clean);
    if (text === word.text) continue;
    next = upsertFix(next, word, text);
    changed += 1;
  }
  return { fixes: next, changed };
}

/** How many other words in the video read the same as this one (for the Replace Everywhere offer). */
export function sameWordCount(transcript: Pick<Transcript, 'words'>, word: TranscriptWord): number {
  const target = wordCore(word.text);
  if (target.length === 0) return 0;
  let count = 0;
  for (const other of transcript.words) {
    if (other.i !== word.i && wordCore(other.text) === target) count += 1;
  }
  return count;
}
