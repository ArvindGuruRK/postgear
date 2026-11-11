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
  Competitor,
  CompetitorInput,
  CompetitorItemsResponse,
  CompetitorsResponse,
  DiscoveredFeed,
  DiscoverSettings,
  DiscoverSettingsPatch,
  DiscoverStatus,
  FeedKind,
  FeedResponse,
  Locality,
  LocalityResponse,
  LocalitySearchResponse,
  NewsTopic,
  ReaderArticle,
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
 * The feed query for a place, for any of the four tabs the feed answers
 * (Trending, News, Videos, Festivals). Worldwide sends no country; a region
 * or a city is only sent with its country, as the API requires. `regionName`
 * and the city only change headings, never what is fetched. The time zone is
 * what the Festivals answer counts its `today` in. The language is sent for
 * every tab, though only Trending and News read differently in another one.
 *
 * Every call asks with `useWorkspaceSources=1` (Module 06): the API then
 * leaves out the groups this workspace switched off and names them in
 * `hidden`.
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
  query.set('useWorkspaceSources', '1');
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

/** The competitors this workspace follows, oldest first, and how many it may follow. */
export function getCompetitors(): Promise<CompetitorsResponse> {
  return api<CompetitorsResponse>('/discover/competitors');
}

/**
 * Follows a competitor. Refusals arrive as `ApiError` with the API's sentence
 * and a `code`: `competitor_private` (an address on a private network),
 * `competitor_limit` (the workspace already follows 20), `competitor_unreachable`
 * (the website's name does not exist).
 */
export function createCompetitor(input: CompetitorInput): Promise<Competitor> {
  return api<{ competitor: Competitor }>('/discover/competitors', {
    method: 'POST',
    body: input,
  }).then((result) => result.competitor);
}

/** Changes what was sent and nothing else. Null clears an optional field. */
export function updateCompetitor(id: string, patch: Partial<CompetitorInput>): Promise<Competitor> {
  return api<{ competitor: Competitor }>(`/discover/competitors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  }).then((result) => result.competitor);
}

/** Admins only. The id answers 404 afterwards. */
export function removeCompetitor(id: string): Promise<void> {
  return api<{ message: string }>(`/discover/competitors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

/**
 * The feeds a website offers. Called on Find Feeds or when the website field
 * loses focus, never per keystroke: the API allows five a minute per workspace
 * (`competitor_throttled`). A site with no feed answers an empty list.
 */
export function findCompetitorFeeds(url: string): Promise<DiscoveredFeed[]> {
  return api<{ feeds: DiscoveredFeed[] }>('/discover/competitors/discover-feeds', {
    method: 'POST',
    body: { url },
  }).then((result) => result.feeds);
}

/** The newest of what one competitor published, across its feeds, channel, accounts and the news. */
export function getCompetitorItems(id: string): Promise<CompetitorItemsResponse> {
  return api<CompetitorItemsResponse>(`/discover/competitors/${encodeURIComponent(id)}/items`);
}

/**
 * Reads a page for the reader sheet (Module 08): a story's own address, or a
 * Google News link, which the API turns into the publisher's address first.
 * Only when a person presses Read, never ahead of time.
 *
 * Refusals arrive as `ApiError` with the API's sentence and a `code`:
 * `read_private` (an address on a private network), `read_failed` (the page
 * could not be read), `read_not_article` (it has no article), `link_unresolved`
 * (a Google News link that would not open here) and `read_throttled` (429,
 * more than ten reads a minute). Open still works for every one of them.
 */
export function readPage(url: string): Promise<ReaderArticle> {
  return api<{ article: ReaderArticle }>('/discover/read', {
    method: 'POST',
    body: { url },
  }).then((result) => result.article);
}

/** What the workspace saved for Discover, or the defaults when it saved nothing. Any member may read it. */
export function getDiscoverSettings(): Promise<DiscoverSettings> {
  return api<{ settings: DiscoverSettings }>('/discover/settings').then(
    (result) => result.settings,
  );
}

/**
 * Saves part of the workspace's Discover settings and answers all of them.
 * Admins only: a member is refused with the API's own sentence (403), so the
 * page never offers a member anything that calls this.
 */
export function saveDiscoverSettings(patch: DiscoverSettingsPatch): Promise<DiscoverSettings> {
  return api<{ settings: DiscoverSettings }>('/discover/settings', {
    method: 'PATCH',
    body: patch,
  }).then((result) => result.settings);
}
