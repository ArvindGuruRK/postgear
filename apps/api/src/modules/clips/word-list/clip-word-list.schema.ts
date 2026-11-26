/**
 * The workspace's own bleep words (Sprint 13, Module 09): the body of
 * `PUT /clips/word-list`, and the one place the list's rules live.
 *
 * The Zod schema only bounds the shape (a strict object, an array of
 * strings, generous outer limits so a pasted list is never refused as
 * "Invalid input"). The rules a person can break are checked by
 * {@link normaliseWordList}, so each refusal is a sentence naming the limit.
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

/** Words a workspace list holds at most. */
export const MAX_WORD_LIST_WORDS = 200;
/** Characters a word may have at most (after trimming). */
export const MAX_WORD_CHARS = 40;
/** The body's outer bounds: far above the rules, only there to cap the work. */
const MAX_BODY_ENTRIES = 1_000;
const MAX_BODY_ENTRY_CHARS = 400;

export const putWordListSchema = z
  .object({
    words: z.array(z.string().max(MAX_BODY_ENTRY_CHARS)).max(MAX_BODY_ENTRIES),
  })
  .strict();
export type PutWordListInput = z.infer<typeof putWordListSchema>;

export type WordListRefusal = 'word_list_word_too_long' | 'word_list_one_word' | 'word_list_full';

export type NormalisedWordList =
  | { ok: true; words: string[] }
  | { ok: false; code: WordListRefusal };

/**
 * The list as it is kept: each entry trimmed, lower-cased and in its
 * composed form, blanks dropped, repeats kept once (first place wins).
 * Refused: an entry over 40 characters, an entry with a space inside (a bleep
 * matches whole words, so a phrase would never match), or more than 200
 * different words.
 */
export function normaliseWordList(raw: readonly string[]): NormalisedWordList {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const entry of raw) {
    const word = stripControlChars(entry).normalize('NFC').trim().toLowerCase();
    if (word.length === 0) continue;
    if (Array.from(word).length > MAX_WORD_CHARS) {
      return { ok: false, code: 'word_list_word_too_long' };
    }
    if (/\s/u.test(word)) return { ok: false, code: 'word_list_one_word' };
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  if (words.length > MAX_WORD_LIST_WORDS) return { ok: false, code: 'word_list_full' };
  return { ok: true, words };
}
