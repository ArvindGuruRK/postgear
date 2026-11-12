/**
 * The lists a place picker offers: every country the engine can read for, and
 * the first-level regions of a country, so a person can choose a place without
 * a geocoder (when it is off, or when they would rather not share where they are).
 *
 * Countries are named by `Intl.DisplayNames` in the picker's language, which
 * knows every one of them in every language the browser does. Regions come from
 * `regions.generated.ts` (see `scripts/generate-regions.ts` for where they come
 * from and why some countries have none), in English, and are sorted in the
 * picker's language. Nothing here reaches the network.
 *
 * `displayLanguage` can arrive from a query string, so it is never trusted: a
 * tag `Intl` refuses reads English, and only a handful of formatters are kept.
 */
import type { Locality } from '../types';
import { isCountryCode, isRegionCode } from './iso3166';
import { COUNTRY_LANGUAGES } from './languages.generated';
import { buildLocality } from './locality';
import { COUNTRY_REGIONS } from './regions.generated';
import { isKnownCountry } from './timezone';

export interface PlaceOption {
  /** ISO 3166-1 alpha-2 for a country, ISO 3166-2 for a region. */
  code: string;
  name: string;
}

/**
 * Where the English name `Intl` gives is not what the rest of the engine calls a
 * country. `countryName` in `timezone.ts` names the United States the same way,
 * and a place found by the geocoder says "Hong Kong", not "Hong Kong SAR China".
 */
const ENGLISH_NAMES: Readonly<Record<string, string>> = {
  HK: 'Hong Kong',
  MO: 'Macao',
  US: 'United States',
};

/**
 * Every country with a language list that is a place a person can be: the
 * codes CLDR keeps for things that are not countries (`AC`, `DG`, `EA`, `IC`,
 * `TA`, `XK` and the like) are left out because the rest of the engine does not
 * know them, and so are the uninhabited ones whose only language is "unknown".
 */
const PICKABLE_COUNTRIES: readonly string[] = Object.keys(COUNTRY_LANGUAGES).filter(
  (code) =>
    isCountryCode(code) &&
    isKnownCountry(code) &&
    !COUNTRY_LANGUAGES[code].every((language) => language === 'und'),
);

const MAX_CACHED_LANGUAGES = 16;

interface Formatters {
  names: Intl.DisplayNames;
  collator: Intl.Collator;
  english: boolean;
}

const formatters = new Map<string, Formatters>();

/** The formatters for a language, or English's when `Intl` will not take the tag. */
function formattersFor(displayLanguage: string): Formatters {
  let locale = 'en';
  try {
    locale = Intl.getCanonicalLocales(displayLanguage)[0] ?? 'en';
  } catch {
    // Not a language tag: English below.
  }

  const cached = formatters.get(locale);
  if (cached) return cached;

  let made: Formatters;
  try {
    made = {
      names: new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'code' }),
      collator: new Intl.Collator([locale, 'en']),
      english: locale.toLowerCase().split('-')[0] === 'en',
    };
  } catch {
    return formattersFor('en');
  }

  // A stranger can name a new language on every request; the cache must not grow with them.
  if (formatters.size >= MAX_CACHED_LANGUAGES) formatters.clear();
  formatters.set(locale, made);
  return made;
}

function sortedByName(options: PlaceOption[], collator: Intl.Collator): PlaceOption[] {
  return options.sort((a, b) => collator.compare(a.name, b.name) || (a.code < b.code ? -1 : 1));
}

/** Every pickable country, named in `displayLanguage` and sorted by that name. A fresh list each call. */
export function listCountries(displayLanguage = 'en'): PlaceOption[] {
  const { names, collator, english } = formattersFor(displayLanguage);
  return sortedByName(
    PICKABLE_COUNTRIES.map((code) => ({
      code,
      name: (english ? ENGLISH_NAMES[code] : undefined) ?? names.of(code) ?? code,
    })),
    collator,
  );
}

/**
 * The first-level regions of a country, with ISO 3166-2 codes and English names,
 * sorted in `displayLanguage`. Empty for a country the table has no whole list
 * for, which the picker shows as the country alone.
 */
export function listRegions(countryCode: string, displayLanguage = 'en'): PlaceOption[] {
  const country = countryCode.toUpperCase();
  if (!isCountryCode(country) || !Object.hasOwn(COUNTRY_REGIONS, country)) return [];

  const { collator } = formattersFor(displayLanguage);
  return sortedByName(
    COUNTRY_REGIONS[country].map(([code, name]) => ({ code, name })),
    collator,
  );
}

/**
 * The place a picker's choice stands for, or null when the choice is not one of
 * the lists above: a country that is not pickable, or a region that is not one
 * of that country's. A region gives the place its English name, which
 * `buildLocality` alone knows only for a few.
 */
export function buildLocalityFromPicker(
  countryCode: string,
  regionCode: string | null,
): Locality | null {
  const country = countryCode.toUpperCase();
  if (!isCountryCode(country) || !PICKABLE_COUNTRIES.includes(country)) return null;
  if (regionCode === null || regionCode === '') return buildLocality({ countryCode: country });

  const region = regionCode.toUpperCase();
  if (!isRegionCode(region)) return null;
  const row = (COUNTRY_REGIONS[country] ?? []).find(([code]) => code === region);
  if (!row) return null;

  return buildLocality({ countryCode: country, regionCode: row[0], regionName: row[1] });
}
