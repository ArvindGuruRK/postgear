/**
 * The spoken languages Clips offers (Sprint 13, Module 02; decision D13-05).
 *
 * The listener knows about a hundred languages, but a language is offered
 * only when its captions can be **drawn**: the export draws captions with the
 * fonts the render ships (the Studio families cover Latin script; Noto Sans
 * Tamil and Noto Sans Devanagari were added for Tamil, Hindi and Marathi), and
 * a missing font fails an export with `font_missing` instead of swapping. So
 * a script with no font here has no language here. Adding one is a font and a
 * row in this table.
 *
 * `highlight` is how the spoken word may be marked in an export: libass can
 * change colour inside a Latin word's letters, but a colour change inside a
 * Tamil or Devanagari letter cluster draws dotted circles, so those languages
 * mark whole words only and default to marking the whole page.
 */

export const TRANSCRIPT_SCRIPTS = ['latin', 'tamil', 'devanagari'] as const;
export type TranscriptScript = (typeof TRANSCRIPT_SCRIPTS)[number];

export interface TranscriptLanguage {
  /** ISO 639-1. */
  code: string;
  /** The name a person reads, in English. */
  name: string;
  script: TranscriptScript;
  /** The finest highlight an export can draw: within a word, or whole words only. */
  highlight: 'word' | 'page';
  /** The font captions fall back to when a style's own font has no letters for this script. */
  font: string | null;
}

export const TRANSCRIPT_LANGUAGES: readonly TranscriptLanguage[] = Object.freeze([
  { code: 'en', name: 'English', script: 'latin', highlight: 'word', font: null },
  {
    code: 'hi',
    name: 'Hindi',
    script: 'devanagari',
    highlight: 'page',
    font: 'Noto Sans Devanagari',
  },
  { code: 'ta', name: 'Tamil', script: 'tamil', highlight: 'page', font: 'Noto Sans Tamil' },
  {
    code: 'mr',
    name: 'Marathi',
    script: 'devanagari',
    highlight: 'page',
    font: 'Noto Sans Devanagari',
  },
  { code: 'es', name: 'Spanish', script: 'latin', highlight: 'word', font: null },
  { code: 'fr', name: 'French', script: 'latin', highlight: 'word', font: null },
  { code: 'de', name: 'German', script: 'latin', highlight: 'word', font: null },
  { code: 'pt', name: 'Portuguese', script: 'latin', highlight: 'word', font: null },
  { code: 'it', name: 'Italian', script: 'latin', highlight: 'word', font: null },
  { code: 'nl', name: 'Dutch', script: 'latin', highlight: 'word', font: null },
  { code: 'id', name: 'Indonesian', script: 'latin', highlight: 'word', font: null },
  { code: 'tr', name: 'Turkish', script: 'latin', highlight: 'word', font: null },
] as const);

/** "Detect Automatically": the listener picks the language from the first speech it hears. */
export const LANGUAGE_AUTO = 'auto' as const;

export const TRANSCRIPT_LANGUAGE_CODES: readonly string[] = Object.freeze(
  TRANSCRIPT_LANGUAGES.map((language) => language.code),
);

export function transcriptLanguage(code: string): TranscriptLanguage | null {
  return TRANSCRIPT_LANGUAGES.find((language) => language.code === code) ?? null;
}

/** True for a language Clips can listen for and draw. */
export function isTranscriptLanguage(code: unknown): code is string {
  return typeof code === 'string' && TRANSCRIPT_LANGUAGE_CODES.includes(code);
}

/** True for `auto` or a supported language: what a request may ask for. */
export function isLanguageChoice(value: unknown): value is string {
  return value === LANGUAGE_AUTO || isTranscriptLanguage(value);
}

/** The name a person reads for a code; the code itself, upper case, when unknown. */
export function languageName(code: string): string {
  return transcriptLanguage(code)?.name ?? code.toUpperCase();
}
