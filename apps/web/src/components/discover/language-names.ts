/**
 * How the language chip names a language: its own name first, then English
 * ("தமிழ் Tamil"), so a Tamil reader finds Tamil and a colleague can tell what
 * it is.
 *
 * The table covers the languages Google News has an edition in (the chip only
 * offers those), spelled the way the editions spell them (`es-419`, `pt-150`,
 * `zh-Hant`). Anything else, such as a language only the AI is asked to write
 * in, falls back to the browser's `Intl.DisplayNames`, and then to the code.
 */

export interface LanguageName {
  /** In the language itself. */
  native: string;
  english: string;
}

const NAMES: Record<string, LanguageName> = {
  ar: { native: 'العربية', english: 'Arabic' },
  bg: { native: 'Български', english: 'Bulgarian' },
  bn: { native: 'বাংলা', english: 'Bengali' },
  cs: { native: 'Čeština', english: 'Czech' },
  de: { native: 'Deutsch', english: 'German' },
  el: { native: 'Ελληνικά', english: 'Greek' },
  en: { native: 'English', english: 'English' },
  es: { native: 'Español', english: 'Spanish' },
  'es-419': { native: 'Español (Latinoamérica)', english: 'Spanish (Latin America)' },
  fr: { native: 'Français', english: 'French' },
  gu: { native: 'ગુજરાતી', english: 'Gujarati' },
  he: { native: 'עברית', english: 'Hebrew' },
  hi: { native: 'हिन्दी', english: 'Hindi' },
  hu: { native: 'Magyar', english: 'Hungarian' },
  id: { native: 'Bahasa Indonesia', english: 'Indonesian' },
  it: { native: 'Italiano', english: 'Italian' },
  ja: { native: '日本語', english: 'Japanese' },
  kn: { native: 'ಕನ್ನಡ', english: 'Kannada' },
  ko: { native: '한국어', english: 'Korean' },
  lt: { native: 'Lietuvių', english: 'Lithuanian' },
  lv: { native: 'Latviešu', english: 'Latvian' },
  ml: { native: 'മലയാളം', english: 'Malayalam' },
  mr: { native: 'मराठी', english: 'Marathi' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  no: { native: 'Norsk', english: 'Norwegian' },
  pa: { native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  pl: { native: 'Polski', english: 'Polish' },
  pt: { native: 'Português', english: 'Portuguese' },
  'pt-150': { native: 'Português (Portugal)', english: 'Portuguese (Portugal)' },
  'pt-419': { native: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  ro: { native: 'Română', english: 'Romanian' },
  ru: { native: 'Русский', english: 'Russian' },
  sk: { native: 'Slovenčina', english: 'Slovak' },
  sl: { native: 'Slovenščina', english: 'Slovenian' },
  sr: { native: 'Српски', english: 'Serbian' },
  sv: { native: 'Svenska', english: 'Swedish' },
  ta: { native: 'தமிழ்', english: 'Tamil' },
  te: { native: 'తెలుగు', english: 'Telugu' },
  th: { native: 'ไทย', english: 'Thai' },
  tr: { native: 'Türkçe', english: 'Turkish' },
  uk: { native: 'Українська', english: 'Ukrainian' },
  vi: { native: 'Tiếng Việt', english: 'Vietnamese' },
  zh: { native: '中文', english: 'Chinese' },
  'zh-Hans': { native: '简体中文', english: 'Chinese (Simplified)' },
  'zh-Hant': { native: '繁體中文', english: 'Chinese (Traditional)' },
};

function displayName(code: string, locale: string): string | null {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    const name = names.of(code);
    // An unknown code comes back as itself.
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

export function languageName(code: string): LanguageName {
  const known = NAMES[code] ?? NAMES[code.toLowerCase()];
  if (known) return known;

  const english = displayName(code, 'en') ?? code;
  const native = displayName(code, code) ?? english;
  return { native: native.charAt(0).toUpperCase() + native.slice(1), english };
}

/** "தமிழ் Tamil"; English once, not twice. */
export function languageLabel(code: string): string {
  const { native, english } = languageName(code);
  return native === english ? english : `${native} ${english}`;
}
