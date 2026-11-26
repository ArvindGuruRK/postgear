/**
 * Which writing systems a typed line uses, and whether a voice can read it
 * (Sprint 13, Module 09). Letters only: digits, spaces, marks and emoji are
 * read by every voice. Three scripts are told apart, the ones Clips' voices
 * cover (Latin for English, Devanagari for Hindi, Tamil); any other letter is
 * `other`, which no voice reads yet.
 */

export type TextScript = 'latin' | 'devanagari' | 'tamil' | 'other';

/** The spoken language a voice must read for each script. */
export const SCRIPT_LANGUAGES: Readonly<Record<Exclude<TextScript, 'other'>, string>> =
  Object.freeze({ latin: 'en', devanagari: 'hi', tamil: 'ta' });

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const TAMIL = /\p{Script=Tamil}/u;

/** The scripts of the line's letters (empty for a line with no letters). */
export function textScripts(text: string): Set<TextScript> {
  const scripts = new Set<TextScript>();
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    if (LATIN.test(character)) scripts.add('latin');
    else if (DEVANAGARI.test(character)) scripts.add('devanagari');
    else if (TAMIL.test(character)) scripts.add('tamil');
    else scripts.add('other');
  }
  return scripts;
}

/** True when the voice reads every script the line is written in. */
export function voiceReads(languages: readonly string[], text: string): boolean {
  for (const script of textScripts(text)) {
    if (script === 'other') return false;
    if (!languages.includes(SCRIPT_LANGUAGES[script])) return false;
  }
  return true;
}
