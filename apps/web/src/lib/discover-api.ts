/**
 * Discover's routes (Sprint 11), typed once so the page, the place popover and
 * later the settings page call them the same way. Every call goes through
 * `api()`, so a refusal arrives as `ApiError` with the API's own sentence and
 * `code` (`locality_throttled`, `locality_unavailable`, `feed_throttled`).
 *
 * ## The position
 *
 * The browser hands over a precise point. It is rounded to two decimals (about
 * a kilometre) here, in `roundCoordinate`, before it leaves this file, and it
 * is never kept: not in state, not in storage, not in a log. The API refuses
 * anything finer, so a caller that skipped this would fail rather than leak.
 */
import type {
  DiscoverStatus,
  FeedKind,
  FeedResponse,
  Locality,
  LocalityResponse,
  LocalitySearchResponse,
  NewsTopic,
} from '@/types/discover';
import { api } from './api';

/**
 * A coordinate as the API takes it: two decimals, as text. `toFixed` rounds on
 * the binary value (1.005 can become 1.00), which is close enough for a
 * kilometre. Anything that is not a real number throws, so a broken position
 * never becomes a request.
 */
export function roundCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('A coordinate must be a finite number.');
  }
  const rounded = value.toFixed(2);
  // "-0.00" is the same place as "0.00"; send the plain one.
  return rounded === '-0.00' ? '0.00' : rounded;
}

export function getDiscoverStatus(): Promise<DiscoverStatus> {
  return api<{ status: DiscoverStatus }>('/discover/status').then((result) => result.status);
}

/** The place at a position. Rounded here; the raw numbers go no further. */
export function localityFromPosition(latitude: number, longitude: number): Promise<Locality> {
  const query = new URLSearchParams({
    lat: roundCoordinate(latitude),
    lng: roundCoordinate(longitude),
  });
  return api<LocalityResponse>(`/discover/locality?${query}`).then((result) => result.locality);
}

/** The country a time zone belongs to, or Worldwide. No prompt, no outside call. */
export function localityFromTimeZone(timeZone: string): Promise<Locality> {
  const query = new URLSearchParams({ tz: timeZone });
  return api<LocalityResponse>(`/discover/locality?${query}`).then((result) => result.locality);
}

/** A typed city. Called on Enter or the Search button only, never per keystroke. */
export function searchPlaces(text: string): Promise<LocalitySearchResponse> {
  const query = new URLSearchParams({ q: text });
  return api<LocalitySearchResponse>(`/discover/locality/search?${query}`);
}

/**
 * The feed query for a place. Worldwide sends no country; a region or a city
 * is only sent with its country, as the API requires. `regionName` and the
 * city only change headings, never what is fetched.
 */
export function feedQuery(
  kind: FeedKind,
  place: Locality,
  language: string,
  topic?: NewsTopic,
): URLSearchParams {
  const query = new URLSearchParams({ kind });

  if (place.countryCode) {
    query.set('country', place.countryCode);
    if (place.regionCode) query.set('region', place.regionCode);
    if (place.regionName) query.set('regionName', place.regionName);
    if (place.city) query.set('city', place.city);
  }
  query.set('lang', language);
  if (place.timeZone) query.set('tz', place.timeZone);
  if (topic) query.set('topic', topic);

  return query;
}

export function getFeed(
  kind: FeedKind,
  place: Locality,
  language: string,
  topic?: NewsTopic,
): Promise<FeedResponse> {
  return api<FeedResponse>(`/discover/feed?${feedQuery(kind, place, language, topic)}`);
}
