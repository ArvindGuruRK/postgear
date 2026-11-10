/**
 * From a place to its languages: the override table when the region decides,
 * otherwise CLDR's list for the country. The first language is the default for
 * News and for the AI; the viewer can always change it.
 */
import type { Locality } from '../types';
import { COUNTRY_LANGUAGES } from './languages.generated';
import { REGION_LANGUAGES } from './region-languages';

function isEnglish(language: string): boolean {
  return language.toLowerCase().split('-')[0] === 'en';
}

/**
 * Always a usable list: de-duplicated, and with English last when the place does
 * not already have it, so the AI can always write in it. An unknown country is
 * just `['en']`.
 */
export function resolveLanguages(locality: Pick<Locality, 'countryCode' | 'regionCode'>): string[] {
  const { regionCode, countryCode } = locality;

  const listed =
    (regionCode ? REGION_LANGUAGES[regionCode] : undefined) ??
    (countryCode ? (REGION_LANGUAGES[countryCode] ?? COUNTRY_LANGUAGES[countryCode]) : undefined) ??
    [];

  const languages = [...new Set(listed)];
  if (!languages.some(isEnglish)) languages.push('en');

  return languages;
}
