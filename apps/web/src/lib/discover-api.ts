/**
 * Discover's routes (Sprint 11), typed once so the page, the place popover and
 * later the settings page call them the same way. Every call goes through
 * `api()`, so a refusal arrives as `ApiError` with the API's own sentence and
 * `code` (`locality_throttled`, `locality_unavailable`, `feed_throttled`).
 *
 * ## Fault tolerance (Module 10)
 *
 * Reads (`GET`) go through `withRetry`: a blip on the way (offline for a
 * second, a 502 from a proxy, a 503 while the API restarts, a 504) is tried
 * again twice, after about 0.4 and 1.2 seconds, with a little jitter so a
 * room of tabs does not come back at once. A refusal (4xx, including a 429
 * throttle, which says to slow down) is never retried, and nor is a cancel.
 * Every call has a timeout, and the feed's can be cancelled by the page when
 * the place changes. Writes are retried only where repeating them is safe
 * (saving an idea, marking seen, the member's place), and say so.
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
  CompetitorResearchResponse,
  CompetitorsResponse,
  CompetitorUnseen,
  DiscoveredFeed,
  DiscoverItem,
  DiscoverSettings,
  DiscoverSettingsPatch,
  DiscoverStatus,
  FeedKind,
  FeedResponse,
  Locality,
  LocalityResponse,
  LocalitySearchResponse,
  MyPlace,
  NewsTopic,
  PlaceOption,
  ReaderArticle,
  SavedIdea,
  SavedIdeasResponse,
} from '@/types/discover';
import { API_UNREACHABLE, ApiError, type ApiOptions, api } from './api';

/** A read: how long it may take before it counts as unreachable. */
const READ_TIMEOUT_MS = 20_000;
/** The feed can wait on a source the API is fetching for the first time. */
const FEED_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [400, 1_200] as const;

/** Worth another try: never reached, or a gateway or a restart in the way. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.status === API_UNREACHABLE ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs `call`, and again after a short wait while it fails in a way worth retrying. */
export async function withRetry<T>(
  call: () => Promise<T>,
  signal?: AbortSignal,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (signal?.aborted || attempt >= delays.length || !isTransient(error)) throw error;
      await wait(delays[attempt] * (0.8 + Math.random() * 0.4), signal);
    }
  }
}

/** A `GET` with a timeout and the retries above. */
function read<T>(path: string, options: Pick<ApiOptions, 'signal' | 'timeoutMs'> = {}): Promise<T> {
  return withRetry(() => api<T>(path, { timeoutMs: READ_TIMEOUT_MS, ...options }), options.signal);
}

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
  return read<{ status: DiscoverStatus }>('/discover/status').then((result) => result.status);
}

/** The place at a position. Rounded here; the raw numbers go no further. */
export function localityFromPosition(latitude: number, longitude: number): Promise<Locality> {
  const query = new URLSearchParams({
    lat: roundCoordinate(latitude),
    lng: roundCoordinate(longitude),
  });
  return api<LocalityResponse>(`/discover/locality?${query}`, {
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.locality);
}

/** The country a time zone belongs to, or Worldwide. No prompt, no outside call. */
export function localityFromTimeZone(timeZone: string): Promise<Locality> {
  const query = new URLSearchParams({ tz: timeZone });
  return read<LocalityResponse>(`/discover/locality?${query}`).then((result) => result.locality);
}

/**
 * A typed city. Without the operator's own place finder, called on Enter or
 * the Search button only; with it (`status.typeahead`), as someone types, a
 * moment after they pause, and cancelled when they type on.
 */
export function searchPlaces(text: string, signal?: AbortSignal): Promise<LocalitySearchResponse> {
  const query = new URLSearchParams({ q: text });
  return api<LocalitySearchResponse>(`/discover/locality/search?${query}`, {
    signal,
    timeoutMs: READ_TIMEOUT_MS,
  });
}

/** Module 10: every country the picker offers, by name. From the API's own tables. */
export function getCountries(): Promise<PlaceOption[]> {
  return read<{ countries: PlaceOption[] }>('/discover/locality/countries').then(
    (result) => result.countries,
  );
}

/** Module 10: a country's regions, by name. Empty for a country Trends does not split. */
export function getRegions(countryCode: string): Promise<PlaceOption[]> {
  const query = new URLSearchParams({ country: countryCode });
  return read<{ regions: PlaceOption[] }>(`/discover/locality/regions?${query}`).then(
    (result) => result.regions,
  );
}

/** Module 10: the whole place a country and one of its regions (or none) make. */
export function getPickedLocality(
  countryCode: string,
  regionCode: string | null,
): Promise<Locality> {
  const query = new URLSearchParams({ country: countryCode });
  if (regionCode) query.set('region', regionCode);
  return read<{ locality: Locality }>(`/discover/locality/pick?${query}`).then(
    (result) => result.locality,
  );
}

/** Module 10: a country for a first visit from the address the request came from, or null. */
export function guessLocalityFromAddress(): Promise<Locality | null> {
  return api<{ locality: Locality | null }>('/discover/locality/guess', {
    timeoutMs: 5_000,
  }).then((result) => result.locality);
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
  signal?: AbortSignal,
): Promise<FeedResponse> {
  return read<FeedResponse>(`/discover/feed?${feedQuery(kind, place, language, topic)}`, {
    signal,
    timeoutMs: FEED_TIMEOUT_MS,
  });
}

/** The competitors this workspace follows, oldest first, and how many it may follow. */
export function getCompetitors(): Promise<CompetitorsResponse> {
  return read<CompetitorsResponse>('/discover/competitors');
}

/** Module 10: what this person has not seen yet, per competitor. Never fetches anything new. */
export function getCompetitorUnseen(signal?: AbortSignal): Promise<CompetitorUnseen> {
  return read<CompetitorUnseen>('/discover/competitors/unseen', { signal });
}

/** Module 10: this person has now seen these competitors (all of them when `ids` is left out). */
export function markCompetitorsSeen(ids?: string[]): Promise<void> {
  return withRetry(() =>
    api<{ ok: true }>('/discover/competitors/seen', {
      method: 'POST',
      body: ids ? { ids } : {},
      timeoutMs: READ_TIMEOUT_MS,
    }),
  ).then(() => undefined);
}

/**
 * Module 10: Research This Competitor. Costs 3 AI credits, unless today's
 * copy answers (`cached`). Refusals: 402 out of credits, 422 not enough posts
 * yet, 503 AI not set up; a failed write refunds the credits and says so.
 */
export function researchCompetitor(id: string): Promise<CompetitorResearchResponse> {
  return api<CompetitorResearchResponse>(
    `/discover/competitors/${encodeURIComponent(id)}/research`,
    { method: 'POST', timeoutMs: 60_000 },
  );
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
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.competitor);
}

/** Changes what was sent and nothing else. Null clears an optional field. */
export function updateCompetitor(id: string, patch: Partial<CompetitorInput>): Promise<Competitor> {
  return api<{ competitor: Competitor }>(`/discover/competitors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.competitor);
}

/** Admins only. The id answers 404 afterwards. */
export function removeCompetitor(id: string): Promise<void> {
  return api<{ message: string }>(`/discover/competitors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: READ_TIMEOUT_MS,
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
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.feeds);
}

/** The newest of what one competitor published, across its feeds, channel, accounts and the news. */
export function getCompetitorItems(id: string): Promise<CompetitorItemsResponse> {
  return read<CompetitorItemsResponse>(`/discover/competitors/${encodeURIComponent(id)}/items`, {
    timeoutMs: FEED_TIMEOUT_MS,
  });
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
    timeoutMs: FEED_TIMEOUT_MS,
  }).then((result) => result.article);
}

/** What the workspace saved for Discover, or the defaults when it saved nothing. Any member may read it. */
export function getDiscoverSettings(): Promise<DiscoverSettings> {
  return read<{ settings: DiscoverSettings }>('/discover/settings').then(
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
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.settings);
}

// ---------------------------------------------------------------------------
// Saved Ideas (Module 10)
// ---------------------------------------------------------------------------

export function getSavedIdeas(signal?: AbortSignal): Promise<SavedIdeasResponse> {
  return read<SavedIdeasResponse>('/discover/ideas', { signal });
}

/**
 * Saves a card for the workspace. Safe to repeat (the API answers the first
 * copy for a card saved twice), so a blip is retried. 409 when the workspace
 * already keeps 200.
 */
export function saveIdea(input: {
  item: DiscoverItem;
  place: SavedIdea['place'];
  language: string;
  note?: string;
}): Promise<SavedIdea> {
  return withRetry(() =>
    api<{ idea: SavedIdea }>('/discover/ideas', {
      method: 'POST',
      body: input,
      timeoutMs: READ_TIMEOUT_MS,
    }),
  ).then((result) => result.idea);
}

/** Null clears the note. */
export function updateIdeaNote(id: string, note: string | null): Promise<SavedIdea> {
  return api<{ idea: SavedIdea }>(`/discover/ideas/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { note },
    timeoutMs: READ_TIMEOUT_MS,
  }).then((result) => result.idea);
}

export function removeIdea(id: string): Promise<void> {
  return api<{ message: string }>(`/discover/ideas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: READ_TIMEOUT_MS,
  }).then(() => undefined);
}

// ---------------------------------------------------------------------------
// The place each member chose (Module 10)
// ---------------------------------------------------------------------------

/** The place this member last chose in this workspace, or null. */
export function getMyPlace(): Promise<MyPlace | null> {
  return read<{ place: MyPlace | null }>('/discover/my-place', { timeoutMs: 8_000 }).then(
    (result) => result.place,
  );
}

/** Safe to repeat: the same place saved twice is the same row. */
export function saveMyPlace(place: Omit<MyPlace, 'updatedAt'>): Promise<MyPlace | null> {
  return withRetry(() =>
    api<{ place: MyPlace | null }>('/discover/my-place', {
      method: 'PUT',
      body: place,
      timeoutMs: READ_TIMEOUT_MS,
    }),
  ).then((result) => result.place);
}

export function clearMyPlace(): Promise<void> {
  return withRetry(() =>
    api<{ place: null }>('/discover/my-place', { method: 'DELETE', timeoutMs: READ_TIMEOUT_MS }),
  ).then(() => undefined);
}
