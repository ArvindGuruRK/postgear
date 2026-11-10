/**
 * Which written languages X counts double (Sprint 11, Module 04).
 *
 * X weighs every code point past U+10FF as 2, apart from a few punctuation
 * spans (`xWeightedLength` in social-core, which follows X's own published
 * algorithm). The engine is asked for at most N characters and checks the
 * parts with `text.length`, so a draft written in one of these scripts would
 * reach X at up to twice its limit. For those languages the AI is asked for
 * half of X's limit instead.
 *
 * A language is placed by its usual script (`Intl.Locale(...).maximize()`,
 * CLDR's likely subtags): `mn` is Cyrillic and light, `mn-Mong` is heavy, and
 * `ja` is heavy whatever its mix of kana and kanji. Every script listed here
 * is checked against social-core's counter in the spec, so the list cannot
 * drift from what the composer measures.
 */
export const X_HEAVY_SCRIPTS: ReadonlySet<string> = new Set([
  'Bopo', // Bopomofo
  'Cans', // Canadian Aboriginal syllabics (Inuktitut, Cree)
  'Cher', // Cherokee
  'Ethi', // Ethiopic (Amharic, Tigrinya)
  'Hang', // Hangul
  'Hani', // Han
  'Hans', // Simplified Chinese
  'Hant', // Traditional Chinese, Cantonese
  'Hira', // Hiragana
  'Jpan', // Japanese (Han and kana)
  'Kana', // Katakana
  'Khmr', // Khmer
  'Kore', // Korean (Hangul and Han)
  'Mong', // Traditional Mongolian
  'Olck', // Ol Chiki (Santali)
  'Tfng', // Tifinagh (Standard Moroccan Amazigh, Tachelhit)
  'Vaii', // Vai
  'Yiii', // Yi
]);

/** True when `language` is usually written in a script X counts double. */
export function writtenHeavyOnX(language: string | undefined): boolean {
  if (!language) {
    return false;
  }

  try {
    const { script } = new Intl.Locale(language).maximize();
    return script !== undefined && X_HEAVY_SCRIPTS.has(script);
  } catch {
    // The schema only lets well-formed tags through; anything else keeps X's full limit.
    return false;
  }
}
