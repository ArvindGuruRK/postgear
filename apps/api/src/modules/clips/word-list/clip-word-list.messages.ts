/**
 * What the word list routes say (Sprint 13, Module 09). Sentence case, plain
 * words; each refusal names the limit it hit.
 */
import { MAX_WORD_CHARS, MAX_WORD_LIST_WORDS, type WordListRefusal } from './clip-word-list.schema';

export const CLIP_WORD_LIST_MESSAGES: Record<WordListRefusal, string> = {
  word_list_word_too_long: `Each word can be at most ${MAX_WORD_CHARS} characters.`,
  word_list_one_word: 'Each entry must be one word, with no spaces.',
  word_list_full: `The list can hold at most ${MAX_WORD_LIST_WORDS} words. Remove some and save again.`,
};
