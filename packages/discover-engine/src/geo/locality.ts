/**
 * Building a {@link Locality}: every way of arriving at a place goes through
 * here, so the languages and names are filled the same way each time.
 */
import type { Locality } from '../types';
import { resolveLanguages } from './languages';
import { REGION_NAMES } from './region-languages';
import { countryFromTimeZone, countryName, defaultTimeZone } from './timezone';

/** No place at all: the worldwide groups only. */
export const WORLDWIDE: Readonly<Locality> = Object.freeze({
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: ['en'],
});

export interface LocalityFields {
  countryCode: string;
  countryName?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
  city?: string | null;
  timeZone?: string | null;
}

export function buildLocality(fields: LocalityFields): Locality {
  const regionCode = fields.regionCode ?? null;
  return {
    countryCode: fields.countryCode,
    countryName: fields.countryName ?? countryName(fields.countryCode),
    regionCode,
    regionName: fields.regionName ?? (regionCode ? (REGION_NAMES[regionCode] ?? null) : null),
    city: fields.city ?? null,
    timeZone: fields.timeZone ?? defaultTimeZone(fields.countryCode),
    languages: resolveLanguages({ countryCode: fields.countryCode, regionCode }),
  };
}

/** A country-level place from the browser's zone, with no upstream call. Unknown means Worldwide. */
export function localityFromTimeZone(timeZone: string): Locality {
  const country = countryFromTimeZone(timeZone);
  return country ? buildLocality({ countryCode: country, timeZone }) : { ...WORLDWIDE };
}
