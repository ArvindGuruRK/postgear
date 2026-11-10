/**
 * ISO 3166 helpers, and how a place turns into a Google Trends `geo`.
 *
 * The region pattern is deliberately loose after the dash because the real codes
 * are: `IN-TN`, `US-CA`, `AT-1`, `CN-34`, `ZA-KZN`, `BE-BRU`.
 */
import type { Locality } from '../types';

const COUNTRY_CODE = /^[A-Z]{2}$/;
const REGION_CODE = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

export function isCountryCode(code: string): boolean {
  return COUNTRY_CODE.test(code);
}

export function isRegionCode(code: string): boolean {
  return REGION_CODE.test(code);
}

/** `IN-TN` to `IN`. */
export function countryOf(regionCode: string): string {
  return regionCode.split('-')[0];
}

/** The region when there is one, else the country. Null for Worldwide: Trends has no such feed. */
export function trendsGeo(locality: Pick<Locality, 'countryCode' | 'regionCode'>): string | null {
  return locality.regionCode ?? locality.countryCode;
}
