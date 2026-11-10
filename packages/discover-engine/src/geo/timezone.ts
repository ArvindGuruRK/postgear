/**
 * Country facts from `countries-and-timezones`: the browser's time zone is the
 * one thing we can read about a place with no permission prompt, which is what
 * makes the first visit to Discover show something instead of nothing.
 */
import { getCountry, getCountryForTimezone, getTimezonesForCountry } from 'countries-and-timezones';

/**
 * The library lists a country's zones alphabetically, so its first zone for the
 * US is `America/Adak` and for Portugal the Azores. For the countries where that
 * would put "today" hours away from nearly everyone, name the main zone.
 */
const MAIN_ZONES: Readonly<Record<string, string>> = {
  AU: 'Australia/Sydney',
  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',
  CL: 'America/Santiago',
  ES: 'Europe/Madrid',
  ID: 'Asia/Jakarta',
  KZ: 'Asia/Almaty',
  MN: 'Asia/Ulaanbaatar',
  MX: 'America/Mexico_City',
  NZ: 'Pacific/Auckland',
  PT: 'Europe/Lisbon',
  RU: 'Europe/Moscow',
  US: 'America/New_York',
};

/** `Asia/Kolkata` to `IN`. Null when the zone names no country (`Etc/UTC`, or nonsense). */
export function countryFromTimeZone(timeZone: string): string | null {
  return getCountryForTimezone(timeZone)?.id ?? null;
}

export function defaultTimeZone(country: string): string | null {
  return MAIN_ZONES[country] ?? getTimezonesForCountry(country)?.[0]?.name ?? null;
}

export function countryName(country: string): string | null {
  // The library's one name that reads badly in a heading.
  if (country === 'US') return 'United States';
  return getCountry(country)?.name ?? null;
}

/** A real ISO country, not merely two capital letters. */
export function isKnownCountry(country: string): boolean {
  return getCountry(country) !== null;
}
