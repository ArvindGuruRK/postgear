/**
 * The language a post is written in, as the prompts say it (Sprint 11).
 *
 * Discover sends a BCP 47 tag (`ta`, `es-419`, `zh-Hant`); a model follows
 * "Write in Tamil" better than "Write in ta", so the prompt names it. The
 * table covers the languages Discover's places offer most, so those names do
 * not depend on the runtime's locale data; anything else goes through
 * `Intl.DisplayNames`, and the tag itself is the last resort (a model still
 * understands it).
 *
 * Only a name ever reaches the prompt: the tag is validated by the API
 * (`LANGUAGE_PATTERN`) before it gets here, and nothing is looked up
 * outside this file.
 */

const NAMES: Readonly<Record<string, string>> = {
  ar: 'Arabic',
  bn: 'Bengali',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  'es-419': 'Latin American Spanish',
  fa: 'Persian',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  gu: 'Gujarati',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  kn: 'Kannada',
  ko: 'Korean',
  ml: 'Malayalam',
  mr: 'Marathi',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  or: 'Odia',
  pa: 'Punjabi',
  pl: 'Polish',
  pt: 'Portuguese',
  'pt-150': 'European Portuguese',
  'pt-419': 'Brazilian Portuguese',
  'pt-BR': 'Brazilian Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
};

let displayNames: Intl.DisplayNames | null | undefined;

function intlName(tag: string): string | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    } catch {
      displayNames = null;
    }
  }
  if (!displayNames) return null;
  try {
    return displayNames.of(tag) ?? null;
  } catch {
    // A tag the runtime refuses to parse.
    return null;
  }
}

/**
 * "Tamil" for `ta`, "Latin American Spanish" for `es-419`, "English" for
 * `en-GB` (a regional English is still English to a writer), else the
 * runtime's English name, else the tag.
 */
export function languageName(tag: string): string {
  const exact = NAMES[tag];
  if (exact) return exact;

  const base = tag.split('-')[0] ?? tag;
  if (base === 'en') return NAMES.en;

  return intlName(tag) ?? NAMES[base] ?? tag;
}

/**
 * The rule both writing stages add when a language is set. Brand and product
 * names are what a translation most often breaks. (Hashtags are not named:
 * both stages already forbid them, and a rule about keeping them would read
 * as permission.)
 */
export function languageRule(tag: string): string {
  return `- Write in ${languageName(tag)}. Keep brand names and product names as they are. Do not translate the brand voice notes.`;
}

/** The `Language` field's value: the tag, then its name, so a reader of the prompt has both. */
export function languageField(tag: string): string {
  return `${tag} (${languageName(tag)})`;
}
