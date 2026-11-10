/**
 * Google News publishes one edition per country and language, and the three
 * locale parameters (`hl`, `gl`, `ceid`) must agree or the feed quietly answers
 * with empty or default-region results (research 01, section 3.2).
 *
 * Seeded from the GNews project's lists. The rows for India, the US and France
 * were fetched for the fixtures; the rest are reported, not verified.
 */

export interface NewsEdition {
  country: string;
  /** The language part of `ceid`, which is what the feed answers in. */
  language: string;
  hl: string;
  ceid: string;
}

export interface NewsLocale {
  hl: string;
  gl: string;
  ceid: string;
  /** The language the chosen edition really answers in. */
  language: string;
}

function edition(country: string, language: string, hl: string = language): NewsEdition {
  return { country, language, hl, ceid: `${country}:${language}` };
}

export const NEWS_EDITIONS: readonly NewsEdition[] = [
  edition('IN', 'en', 'en-IN'),
  edition('IN', 'hi'),
  edition('IN', 'ta'),
  edition('IN', 'te'),
  edition('IN', 'ml'),
  edition('IN', 'kn'),
  edition('IN', 'mr'),
  edition('IN', 'bn'),
  edition('IN', 'gu'),
  edition('IN', 'pa'),
  edition('US', 'en', 'en-US'),
  edition('US', 'es-419'),
  edition('GB', 'en', 'en-GB'),
  edition('CA', 'en', 'en-CA'),
  edition('CA', 'fr', 'fr-CA'),
  edition('FR', 'fr'),
  edition('DE', 'de'),
  edition('AT', 'de', 'de-AT'),
  edition('CH', 'de', 'de-CH'),
  edition('CH', 'fr', 'fr-CH'),
  edition('ES', 'es'),
  edition('IT', 'it'),
  edition('PT', 'pt-150', 'pt-PT'),
  edition('BR', 'pt-419', 'pt-BR'),
  edition('MX', 'es-419'),
  edition('AR', 'es-419'),
  edition('CL', 'es-419'),
  edition('CO', 'es-419'),
  edition('PE', 'es-419'),
  edition('NL', 'nl'),
  edition('BE', 'fr'),
  edition('BE', 'nl'),
  edition('SE', 'sv'),
  edition('NO', 'no'),
  edition('PL', 'pl'),
  edition('CZ', 'cs'),
  edition('HU', 'hu'),
  edition('RO', 'ro'),
  edition('GR', 'el'),
  edition('BG', 'bg'),
  edition('RS', 'sr'),
  edition('SK', 'sk'),
  edition('SI', 'sl'),
  edition('LT', 'lt'),
  edition('LV', 'lv'),
  edition('UA', 'uk'),
  edition('RU', 'ru'),
  edition('TR', 'tr'),
  edition('IL', 'he'),
  edition('AE', 'ar'),
  edition('SA', 'ar'),
  edition('EG', 'ar'),
  edition('LB', 'ar'),
  edition('MA', 'fr'),
  edition('SN', 'fr'),
  edition('ZA', 'en', 'en-ZA'),
  edition('NG', 'en', 'en-NG'),
  edition('KE', 'en', 'en-KE'),
  edition('GH', 'en', 'en-GH'),
  edition('UG', 'en', 'en-UG'),
  edition('TZ', 'en', 'en-TZ'),
  edition('ET', 'en', 'en-ET'),
  edition('BW', 'en', 'en-BW'),
  edition('NA', 'en', 'en-NA'),
  edition('ZW', 'en', 'en-ZW'),
  edition('PK', 'en', 'en-PK'),
  edition('BD', 'bn'),
  edition('LK', 'en', 'en-LK'),
  edition('SG', 'en', 'en-SG'),
  edition('MY', 'en', 'en-MY'),
  edition('PH', 'en', 'en-PH'),
  edition('ID', 'id'),
  edition('VN', 'vi'),
  edition('TH', 'th'),
  edition('JP', 'ja'),
  edition('KR', 'ko'),
  edition('CN', 'zh-Hans', 'zh-CN'),
  edition('TW', 'zh-Hant', 'zh-TW'),
  edition('HK', 'zh-Hant', 'zh-HK'),
  edition('AU', 'en', 'en-AU'),
  edition('NZ', 'en', 'en-NZ'),
  edition('IE', 'en', 'en-IE'),
];

const WORLD_EDITION = edition('US', 'en', 'en-US');

function primarySubtag(language: string): string {
  return language.split('-')[0].toLowerCase();
}

function toLocale(row: NewsEdition): NewsLocale {
  return { hl: row.hl, gl: row.country, ceid: row.ceid, language: row.language };
}

/**
 * The edition to read a place's news from. The language matches exactly, then by
 * its primary subtag (`es` finds `es-419`, `pt` finds `pt-419`), then the
 * country's own first edition, so asking for Konkani in India reads Indian news
 * in English rather than American news. A country with no edition gets `US:en`.
 */
export function editionFor(country: string | null, language: string): NewsLocale {
  const rows = NEWS_EDITIONS.filter((row) => row.country === country);
  const wanted = language.toLowerCase();

  const match =
    rows.find((row) => row.language.toLowerCase() === wanted) ??
    rows.find((row) => primarySubtag(row.language) === primarySubtag(wanted)) ??
    rows[0] ??
    WORLD_EDITION;

  return toLocale(match);
}

/** The languages Google News really has for a country. */
export function languagesWithEdition(country: string | null): string[] {
  return NEWS_EDITIONS.filter((row) => row.country === country).map((row) => row.language);
}

/**
 * A place's own languages that have an edition, in the place's order and written
 * the way the edition is (`es` becomes `es-419`): what the News language chip
 * offers. With no edition for the country, the feed is the US English one, so that
 * is the one thing to offer.
 */
export function newsLanguagesFor(country: string | null, languages: readonly string[]): string[] {
  const rows = NEWS_EDITIONS.filter((row) => row.country === country);
  if (rows.length === 0) return [WORLD_EDITION.language];

  const offered = languages.flatMap((language) => {
    const wanted = language.toLowerCase();
    const row =
      rows.find((candidate) => candidate.language.toLowerCase() === wanted) ??
      rows.find((candidate) => primarySubtag(candidate.language) === primarySubtag(wanted));
    return row ? [row.language] : [];
  });

  return offered.length > 0 ? [...new Set(offered)] : [rows[0].language];
}
