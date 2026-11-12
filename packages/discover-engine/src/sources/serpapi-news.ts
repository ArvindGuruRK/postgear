/**
 * Google News through SerpApi (Module 10): the same editions as the public feeds,
 * for a deployment that would rather pay for answers than read the feeds itself.
 * Off unless the API is given a key and picks it with `DISCOVER_NEWS_PROVIDER`.
 * It is a {@link GoogleNewsSource}, so the API swaps it in with no new path.
 *
 * ## What maps, and what does not
 *
 * - Top stories: no query and no token is the edition's front page.
 * - Seven of the eight topics are Google News topic pages, named by the token
 *   in each page's address (`news.google.com/topics/<token>`). The tokens were
 *   written for the US English edition; `gl` and `hl` still pick the edition.
 *   SerpApi's own guide shows the Technology one; the rest share its form.
 * - NATION has no fixed token: Google builds it from the country. So it is a
 *   search for the country's English name, and the front page without a country.
 * - A place is a search for its city, and a competitor a search for its name,
 *   each held to the last days with Google's `when:` operator as the feeds are.
 *
 * `hl` and `gl` come from `editionFor`, as the feeds' do: Google News answers an
 * edition it does not have with something else, quietly.
 *
 * ## The key travels in the address
 *
 * SerpApi takes it as `api_key`, last in the query. So the address is never put
 * in a warning or a returned field, SerpApi's own error text is never repeated,
 * and a thrown fetch error is dropped unread. {@link serpApiNewsPrefix} is the
 * most of the address that may ever be quoted.
 *
 * ## Answers
 *
 * A 401 is a bad key and a 403 an account that may not search, both trouble for
 * every place alike. A 429 is a spent plan or the hourly limit. "Google hasn't
 * returned any results" comes back as a 200 with an `error` and no list, and is
 * a plain empty answer (SerpApi's status page documents all of these).
 */
import { editionFor, type NewsLocale } from '../geo/editions';
import { countryName } from '../geo/timezone';
import { isGoogleNewsLink } from '../reader/google-news-link';
import type {
  DiscoverFetch,
  DiscoverFetchResponse,
  RelatedHeadline,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { isoDate, isRecord, parseJson } from './competitor';
import { type GoogleNewsSource, isNewsTopic, type NewsTopic, searchPhrase } from './google-news';
import { safeHttpUrl, stripHtml } from './html-text';

const ENDPOINT = 'https://serpapi.com/search.json';
const ATTRIBUTION = { name: 'Google News via SerpApi', url: 'https://serpapi.com' };
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RELATED = 5;
const MAX_MENTIONS = 10;
const SHAPE = 'SerpApi answered in a shape this cannot read.';

/** Google News topic pages by token. NATION is missing on purpose (see above). */
export const SERPAPI_TOPIC_TOKENS: Readonly<Partial<Record<NewsTopic, string>>> = {
  WORLD: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB',
  BUSINESS: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  TECHNOLOGY: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
  ENTERTAINMENT: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
  SPORTS: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  SCIENCE: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB',
  HEALTH: 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ',
};

/** Everything before the key. Tests and any log line stop here. */
export function serpApiNewsPrefix(query: Record<string, string>): string {
  return `${ENDPOINT}?${new URLSearchParams({ engine: 'google_news', ...query })}&api_key=`;
}

export function serpApiNewsUrl(query: Record<string, string>, apiKey: string): string {
  return `${serpApiNewsPrefix(query)}${encodeURIComponent(apiKey)}`;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? stripHtml(value) : '';
}

interface Story {
  title: string;
  link: string;
  publisher: string;
  image?: string;
  publishedAt?: string;
}

function storyOf(value: unknown): Story | null {
  if (!isRecord(value)) return null;
  const title = textOf(value.title);
  const link = typeof value.link === 'string' ? safeHttpUrl(value.link) : undefined;
  if (!title || !link) return null;

  const thumbnail = [value.thumbnail, value.thumbnail_small].find((x) => typeof x === 'string');
  return {
    title,
    link,
    publisher: isRecord(value.source) ? textOf(value.source.name) : '',
    image: typeof thumbnail === 'string' ? safeHttpUrl(thumbnail) : undefined,
    publishedAt: isoDate(value.iso_date),
  };
}

/**
 * One row of `news_results`: a story, or a cluster of them. A cluster leads with
 * its `highlight`, or failing that its first story, and the rest are related.
 */
function toItem(entry: unknown, locale: NewsLocale): SourceItem | null {
  if (!isRecord(entry)) return null;
  const cluster = Array.isArray(entry.stories)
    ? entry.stories.flatMap((s) => storyOf(s) ?? [])
    : [];
  const lead = storyOf(entry.highlight) ?? storyOf(entry) ?? cluster[0];
  if (!lead) return null;

  const related: RelatedHeadline[] = cluster
    .filter((story) => story.link !== lead.link)
    .slice(0, MAX_RELATED)
    .map((story) => ({ title: story.title, url: story.link, source: story.publisher }));

  return {
    kind: 'news',
    source: { id: 'serpapi', name: lead.publisher || ATTRIBUTION.name },
    title: lead.title,
    // SerpApi gives the publisher's own address. A Google redirect, should one
    // come back, goes where the feeds put theirs, for the reader to resolve.
    ...(isGoogleNewsLink(lead.link) ? { opaqueUrl: lead.link } : { url: lead.link }),
    image: lead.image,
    publishedAt: lead.publishedAt,
    language: locale.language,
    related,
  };
}

/** The search for a phrase, held to the last days, as the feeds' `when:` holds theirs. */
function phraseQuery(phrase: string, days: number): string {
  return `"${phrase}" when:${days}d`;
}

export function createSerpApiNewsSource(options: {
  fetch: DiscoverFetch;
  apiKey: string;
}): GoogleNewsSource {
  const { fetch: sourceFetch, apiKey } = options;

  const localeOf = (input: SourceInput) => editionFor(input.locality.countryCode, input.language);

  const read = async (
    input: SourceInput,
    locale: NewsLocale,
    query: Record<string, string>,
  ): Promise<SourceResult> => {
    const warnings =
      locale.language === input.language
        ? []
        : [`Google News has no ${input.language} edition here, so this is ${locale.language}.`];
    const failed = (failure: SourceFailure, warning: string): SourceResult => ({
      items: [],
      attribution: ATTRIBUTION,
      warnings: [...warnings, warning],
      failed: failure,
    });

    let response: DiscoverFetchResponse;
    try {
      response = await sourceFetch(
        serpApiNewsUrl(
          { ...query, gl: locale.gl.toLowerCase(), hl: locale.hl.toLowerCase() },
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
      return failed('upstream', 'SerpApi did not answer.');
    }

    if (response.status === 401 || response.status === 403) {
      return failed('upstream', 'SerpApi refused the key.');
    }
    if (response.status === 429) {
      return failed('upstream', 'SerpApi has no searches left, or was asked too often.');
    }
    if (response.status >= 500) return failed('upstream', `SerpApi answered ${response.status}.`);
    // A 400 or a 404 is about this one request, not SerpApi's health.
    if (response.status !== 200) return failed('not_found', 'SerpApi could not run this search.');

    const body = parseJson(response.body);
    if (!isRecord(body)) return failed('upstream', SHAPE);
    if (body.news_results === undefined) {
      // No list and an error is Google finding nothing, which SerpApi answers with a 200.
      return typeof body.error === 'string'
        ? { items: [], attribution: ATTRIBUTION, warnings }
        : failed('upstream', SHAPE);
    }
    if (!Array.isArray(body.news_results)) return failed('upstream', SHAPE);

    const items = body.news_results.flatMap((entry) => toItem(entry, locale) ?? []);
    // Rows, and not one of them readable, is a changed shape rather than a quiet day.
    if (body.news_results.length > 0 && items.length === 0) return failed('upstream', SHAPE);

    return { items, attribution: ATTRIBUTION, warnings };
  };

  const top: GoogleNewsSource['top'] = (input) => read(input, localeOf(input), {});

  const place: GoogleNewsSource['place'] = (input) => {
    const city = searchPhrase(input.locality.city ?? '');
    if (!city) {
      return Promise.resolve({
        items: [],
        attribution: ATTRIBUTION,
        warnings: ['SerpApi has no place to search for without a city.'],
      });
    }
    return read(input, localeOf(input), { q: phraseQuery(city, 2) });
  };

  const topic: GoogleNewsSource['topic'] = (input, id) => {
    const token = SERPAPI_TOPIC_TOKENS[id];
    if (token) return read(input, localeOf(input), { topic_token: token });

    // NATION: the country's own news is a search for its name, in English since
    // that is the one name we always have. Without a country it is the front page.
    const country = input.locality.countryCode;
    const name = searchPhrase(
      (country && countryName(country)) ?? input.locality.countryName ?? '',
    );
    return name ? read(input, localeOf(input), { q: phraseQuery(name, 2) }) : top(input);
  };

  const search: GoogleNewsSource['search'] = async (query, input) => {
    const phrase = searchPhrase(query);
    if (!phrase) {
      return {
        items: [],
        attribution: ATTRIBUTION,
        warnings: ['SerpApi has nothing to search for without a phrase.'],
      };
    }

    const answer = await read(input, localeOf(input), { q: phraseQuery(phrase, 7) });
    const mentions = answer.items
      .map(({ related: _related, ...story }): SourceItem => ({ ...story, kind: 'competitor' }))
      .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || 0)
      .slice(0, MAX_MENTIONS);

    return { ...answer, items: mentions };
  };

  return {
    id: 'serpapi',
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
