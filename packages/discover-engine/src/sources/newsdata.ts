/**
 * Headlines from NewsData.io's latest-news endpoint (Module 10), for a deployment
 * that picks it with `DISCOVER_NEWS_PROVIDER` and gives the API a key. It is a
 * {@link GoogleNewsSource}, so the API swaps it in with no new path.
 *
 * `/api/1/latest` covers the last 48 hours, the window News keeps anyway.
 *
 * - Top stories are the country's `top` category, in the language asked for.
 * - All eight topics have a category: NATION is `domestic`, the rest share our
 *   names (NewsData's list: business, crime, domestic, education, entertainment,
 *   environment, food, health, lifestyle, other, politics, science, sports,
 *   technology, top, tourism, world).
 * - A place is a search for its city's name, and a competitor one for theirs.
 *
 * Codes are what NewsData takes: the country in lower case, the language as its
 * ISO 639-1 part (`es-419` is asked for as `es`). Every row comes with a real
 * publisher address, so there is no redirect to resolve.
 *
 * ## The key travels in the address
 *
 * NewsData takes it as `apikey`, last in the query. So the address is never put
 * in a warning or a returned field, NewsData's own error text is never repeated,
 * and a thrown fetch error is dropped unread. {@link newsDataPrefix} is the most
 * of the address that may ever be quoted.
 *
 * ## Answers
 *
 * Errors come as `{"status":"error","results":{"message","code"}}`. 401 is a bad
 * key and 403 a plan that does not cover the request, trouble for every place
 * alike; 429 is the rate limit or spent credits. A 422 is a filter NewsData does
 * not support (a country or a language it has no news for), so it is about this
 * place, as is a 400.
 */
import type {
  DiscoverFetch,
  DiscoverFetchResponse,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { excerpt, isoDate, isRecord, parseJson } from './competitor';
import { type GoogleNewsSource, isNewsTopic, type NewsTopic, searchPhrase } from './google-news';
import { safeHttpUrl, stripHtml } from './html-text';

const ENDPOINT = 'https://newsdata.io/api/1/latest';
const ATTRIBUTION = { name: 'NewsData.io', url: 'https://newsdata.io' };
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MENTIONS = 10;
const SHAPE = 'NewsData.io answered in a shape this cannot read.';

export const NEWSDATA_CATEGORIES: Readonly<Record<NewsTopic, string>> = {
  WORLD: 'world',
  NATION: 'domestic',
  BUSINESS: 'business',
  TECHNOLOGY: 'technology',
  ENTERTAINMENT: 'entertainment',
  SPORTS: 'sports',
  SCIENCE: 'science',
  HEALTH: 'health',
};

/** The error codes that mean the key, or its plan, is refused. */
const REFUSED = new Set(['Unauthorized', 'AccessDenied']);
/** The ones that mean slow down, or come back when there are credits again. */
const LIMITED = new Set([
  'TooManyRequests',
  'RateLimitExceeded',
  'ApiLimitExceeded',
  'ApiKeyLimitExceeded',
]);

/** Everything before the key. Tests and any log line stop here. */
export function newsDataPrefix(query: Record<string, string>): string {
  return `${ENDPOINT}?${new URLSearchParams(query)}&apikey=`;
}

export function newsDataUrl(query: Record<string, string>, apiKey: string): string {
  return `${newsDataPrefix(query)}${encodeURIComponent(apiKey)}`;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? stripHtml(value) : '';
}

/**
 * `pubDate` is `2026-11-09 08:15:00` in the zone `pubDateTZ` names, which is UTC
 * unless a request asks for another (these never do). A date in a zone we did not
 * ask for is left out rather than guessed at.
 */
function publishedAtOf(value: unknown, zone: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const plain = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  if (!plain) return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim()) ? isoDate(value) : undefined;
  const isUtc = zone === undefined || zone === null || zone === 'UTC';
  return isUtc ? isoDate(`${plain[1]}T${plain[2]}Z`) : undefined;
}

/** A plan can answer a field it does not include with a notice in its place. */
function summaryOf(value: unknown): string | undefined {
  const text = textOf(value);
  return text && !/only available in/i.test(text) ? excerpt(text) : undefined;
}

function toItem(entry: unknown, language: string): SourceItem | null {
  if (!isRecord(entry) || entry.duplicate === true) return null;
  const title = textOf(entry.title);
  const url = typeof entry.link === 'string' ? safeHttpUrl(entry.link) : undefined;
  if (!title || !url) return null;

  return {
    kind: 'news',
    source: {
      id: 'newsdata',
      name: textOf(entry.source_name) || textOf(entry.source_id) || ATTRIBUTION.name,
      url: typeof entry.source_url === 'string' ? safeHttpUrl(entry.source_url) : undefined,
    },
    title,
    summary: summaryOf(entry.description),
    url,
    image: typeof entry.image_url === 'string' ? safeHttpUrl(entry.image_url) : undefined,
    publishedAt: publishedAtOf(entry.pubDate, entry.pubDateTZ),
    // NewsData names the language in words ("tamil"); the tag asked for is the one we use.
    language,
  };
}

function errorCodeOf(body: unknown): string | undefined {
  const results = isRecord(body) && isRecord(body.results) ? body.results : null;
  return results && typeof results.code === 'string' ? results.code : undefined;
}

export function createNewsDataSource(options: {
  fetch: DiscoverFetch;
  apiKey: string;
}): GoogleNewsSource {
  const { fetch: sourceFetch, apiKey } = options;

  const languageOf = (input: SourceInput) => input.language.split('-')[0].toLowerCase();

  const read = async (input: SourceInput, query: Record<string, string>): Promise<SourceResult> => {
    const language = languageOf(input);
    const country = input.locality.countryCode?.toLowerCase();
    const failed = (failure: SourceFailure, warning: string): SourceResult => ({
      items: [],
      attribution: ATTRIBUTION,
      warnings: [warning],
      failed: failure,
    });

    let response: DiscoverFetchResponse;
    try {
      response = await sourceFetch(
        newsDataUrl(
          { ...(country ? { country } : {}), language, removeduplicate: '1', ...query },
          apiKey,
        ),
        {
          accept: 'application/json',
          signal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
          maxBytes: MAX_BYTES,
        },
      );
    } catch {
      // Nothing of the error is kept: it can quote the address, and the address holds the key.
      return failed('upstream', 'NewsData.io did not answer.');
    }

    const body = parseJson(response.body);
    const code = errorCodeOf(body);
    const isError = response.status !== 200 || (isRecord(body) && body.status === 'error');

    if (isError) {
      if (response.status === 401 || response.status === 403 || (code && REFUSED.has(code))) {
        return failed('upstream', 'NewsData.io refused the key, or its plan does not cover this.');
      }
      if (response.status === 429 || (code && LIMITED.has(code))) {
        return failed('upstream', 'NewsData.io has no credits left, or was asked too often.');
      }
      if (response.status >= 500) {
        return failed('upstream', `NewsData.io answered ${response.status}.`);
      }
      // A 400 or a 422: this place, language or phrase is one it cannot search.
      return failed('not_found', 'NewsData.io has no news for this here.');
    }

    const results = isRecord(body) && Array.isArray(body.results) ? body.results : null;
    if (!results) return failed('upstream', SHAPE);

    const items = results.flatMap((entry) => toItem(entry, language) ?? []);
    // Rows, and not one of them readable, is a changed shape rather than a quiet day.
    if (results.length > 0 && items.length === 0) return failed('upstream', SHAPE);

    return { items, attribution: ATTRIBUTION, warnings: [] };
  };

  const top: GoogleNewsSource['top'] = (input) => read(input, { category: 'top' });

  const place: GoogleNewsSource['place'] = (input) => {
    const city = searchPhrase(input.locality.city ?? '');
    if (!city) {
      return Promise.resolve({
        items: [],
        attribution: ATTRIBUTION,
        warnings: ['NewsData.io has no place to search for without a city.'],
      });
    }
    return read(input, { q: `"${city}"` });
  };

  const topic: GoogleNewsSource['topic'] = (input, id) =>
    read(input, { category: NEWSDATA_CATEGORIES[id] });

  const search: GoogleNewsSource['search'] = async (query, input) => {
    const phrase = searchPhrase(query);
    if (!phrase) {
      return {
        items: [],
        attribution: ATTRIBUTION,
        warnings: ['NewsData.io has nothing to search for without a phrase.'],
      };
    }

    const answer = await read(input, { q: `"${phrase}"` });
    const mentions = answer.items
      .map((story): SourceItem => ({ ...story, kind: 'competitor' }))
      .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || 0)
      .slice(0, MAX_MENTIONS);

    return { ...answer, items: mentions };
  };

  return {
    id: 'newsdata',
    name: ATTRIBUTION.name,
    place,
    top,
    topic,
    search,

    // The one call the shared interface knows: the narrowest answer the input can name.
    fetch: (input) => {
      if (input.topic && isNewsTopic(input.topic)) return topic(input, input.topic);
      return input.locality.city ? place(input) : top(input);
    },
  };
}
