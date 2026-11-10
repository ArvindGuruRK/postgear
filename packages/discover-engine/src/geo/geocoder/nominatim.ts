/**
 * Coordinates and typed cities into places, through OpenStreetMap's Nominatim.
 *
 * Mapping only. The usage policy (one request a second across the deployment,
 * an identifying User-Agent, cached results, no autocomplete) is the API's job
 * and lives in its locality service, because only the API can count across every
 * workspace. See research 03, section 3.
 *
 * Nothing here repeats a query or a coordinate in an error or a warning: both are
 * things a person typed or where they are, and errors end up in logs.
 */
import type { DiscoverFetch, Geocoder, Locality } from '../../types';
import { isRegionCode } from '../iso3166';
import { buildLocality, localityFromTimeZone, WORLDWIDE } from '../locality';

const BASE_URL = 'https://nominatim.openstreetmap.org';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const MAX_RESULTS = 8;

export type GeocoderErrorKind = 'rate_limited' | 'unavailable';

export class GeocoderError extends Error {
  constructor(
    readonly kind: GeocoderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GeocoderError';
  }
}

export interface NominatimOptions {
  fetch: DiscoverFetch;
  userAgent: string;
  /** Names come back in this language. Default English, which Google News' place feed reads best. */
  acceptLanguage?: string;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  region?: string;
  country?: string;
  country_code?: string;
  'ISO3166-2-lvl4'?: string;
  'ISO3166-2-lvl3'?: string;
  'ISO3166-2-lvl5'?: string;
  'ISO3166-2-lvl6'?: string;
}

interface NominatimPlace {
  address?: NominatimAddress;
  error?: string;
}

/**
 * A place from one Nominatim answer, or null when it has no country to read a
 * feed for. Level 4 is the state in most countries; the others cover the ones
 * that file their first division elsewhere.
 */
export function placeFromNominatim(place: NominatimPlace): Locality | null {
  const address = place.address;
  const country = address?.country_code?.toUpperCase();
  if (!address || !country) return null;

  const code =
    address['ISO3166-2-lvl4'] ??
    address['ISO3166-2-lvl3'] ??
    address['ISO3166-2-lvl5'] ??
    address['ISO3166-2-lvl6'] ??
    null;

  return buildLocality({
    countryCode: country,
    countryName: address.country ?? null,
    regionCode: code && isRegionCode(code) ? code : null,
    regionName: address.state ?? address.region ?? null,
    city:
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      null,
  });
}

function placeKey(place: Locality): string {
  return [place.countryCode, place.regionCode, place.city].join('|');
}

export function createNominatimGeocoder(options: NominatimOptions): Geocoder {
  const { fetch: nominatimFetch, userAgent, acceptLanguage = 'en' } = options;

  async function getJson(url: string): Promise<unknown> {
    let response: Awaited<ReturnType<DiscoverFetch>>;
    try {
      response = await nominatimFetch(url, {
        accept: 'application/json',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        maxBytes: MAX_BYTES,
        userAgent,
      });
    } catch {
      // The cause is dropped on purpose: a fetch error can quote the URL, and the URL holds the coordinates.
      throw new GeocoderError('unavailable', 'The place service could not be reached.');
    }

    if (response.status === 429) {
      throw new GeocoderError('rate_limited', 'The place service asked us to slow down.');
    }
    if (response.status !== 200) {
      throw new GeocoderError(
        'unavailable',
        `The place service answered with HTTP ${response.status}.`,
      );
    }

    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new GeocoderError('unavailable', 'The place service sent something unreadable.');
    }
  }

  return {
    reverse: async (lat, lng, language = acceptLanguage) => {
      const query = new URLSearchParams({
        format: 'jsonv2',
        zoom: '10',
        addressdetails: '1',
        lat: String(lat),
        lon: String(lng),
        'accept-language': language,
      });
      const answer = (await getJson(`${BASE_URL}/reverse?${query}`)) as NominatimPlace;
      // The open sea answers `{ "error": "Unable to geocode" }`: a place with no country.
      return placeFromNominatim(answer) ?? { ...WORLDWIDE };
    },

    search: async (text, language = acceptLanguage) => {
      const query = new URLSearchParams({
        q: text,
        format: 'jsonv2',
        addressdetails: '1',
        limit: String(MAX_RESULTS),
        'accept-language': language,
      });
      const answer = await getJson(`${BASE_URL}/search?${query}`);
      if (!Array.isArray(answer)) return [];

      const places = new Map<string, Locality>();
      for (const entry of answer as NominatimPlace[]) {
        const place = placeFromNominatim(entry);
        if (place && !places.has(placeKey(place))) places.set(placeKey(place), place);
      }
      return [...places.values()].slice(0, MAX_RESULTS);
    },

    fromTimeZone: localityFromTimeZone,
  };
}
