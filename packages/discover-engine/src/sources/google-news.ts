/**
 * Headlines from Google News' public RSS feeds: a place, an edition's top stories,
 * or one of its topics.
 *
 * The three locale parameters must agree or the feed quietly answers with empty
 * or default-region results, so they only ever come from `editionFor`.
 *
 * Every `link` here is an opaque Google redirect. It is kept as `opaqueUrl` and
 * `url` stays unset: the module that resolves one does so only when a person
 * presses Read, and Open works with the redirect either way.
 */
import { editionFor, type NewsLocale } from '../geo/editions';
import type {
  DiscoverFetch,
  DiscoverSource,
  RelatedHeadline,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { type FeedItem, itemSource, readFeed } from './feed-parser';
import { cleanText, decodeEntities, safeHttpUrl, stripHtml, tokenize } from './html-text';

const ATTRIBUTION = { name: 'Google News', url: 'https://news.google.com' };
const FEED_BASE = 'https://news.google.com/rss';
const MAX_RELATED = 5;

export const NEWS_TOPICS = [
  'WORLD',
  'NATION',
  'BUSINESS',
  'TECHNOLOGY',
  'ENTERTAINMENT',
  'SPORTS',
  'SCIENCE',
  'HEALTH',
] as const;

export type NewsTopic = (typeof NEWS_TOPICS)[number];

export function isNewsTopic(value: string): value is NewsTopic {
  return (NEWS_TOPICS as readonly string[]).includes(value);
}

/** Written out by hand: the values come from our own table, and `ceid` keeps its colon as the feeds show it. */
function localeQuery(locale: NewsLocale): string {
  return `hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
}

export function newsTopUrl(locale: NewsLocale): string {
  return `${FEED_BASE}?${localeQuery(locale)}`;
}

export function newsPlaceUrl(city: string, locale: NewsLocale): string {
  return `${FEED_BASE}/headlines/section/geo/${encodeURIComponent(city)}?${localeQuery(locale)}`;
}

export function newsTopicUrl(topic: NewsTopic, locale: NewsLocale): string {
  return `${FEED_BASE}/headlines/section/topic/${topic}?${localeQuery(locale)}`;
}

/** "Headline - Publisher" to "Headline", only when the tail really is this publisher. */
export function stripPublisher(title: string, publisher: string): string {
  const tail = ` - ${publisher}`;
  return publisher && title.length > tail.length && title.endsWith(tail)
    ? title.slice(0, -tail.length).trimEnd()
    : title;
}

/**
 * The description is a small HTML list of the same story from other publishers:
 * `<li><a href="...">Headline</a> <font color="...">Publisher</font></li>`.
 */
export function parseRelated(description: string | undefined): RelatedHeadline[] {
  const related: RelatedHeadline[] = [];
  let current: { url: string; title: string[]; source: string[] } | null = null;
  let inside: 'title' | 'source' | null = null;

  const finish = () => {
    if (current) {
      const title = cleanText(current.title.join(''));
      if (title) {
        related.push({ title, url: current.url, source: cleanText(current.source.join('')) });
      }
    }
    current = null;
  };

  for (const token of tokenize(description ?? '')) {
    if (token.type === 'open' && token.name === 'a') {
      finish();
      const url = safeHttpUrl(token.attrs.href);
      current = url ? { url, title: [], source: [] } : null;
      inside = 'title';
    } else if (token.type === 'open' && token.name === 'font') {
      inside = 'source';
    } else if (token.type === 'close') {
      inside = null;
    } else if (token.type === 'text' && current && inside) {
      (inside === 'title' ? current.title : current.source).push(decodeEntities(token.text));
    }
  }
  finish();

  return related;
}

function toItem(entry: FeedItem, locale: NewsLocale): SourceItem | null {
  const publisher = itemSource(entry);
  const publisherName = stripHtml(publisher?.name ?? '');
  const title = stripPublisher(stripHtml(entry.title ?? ''), publisherName);
  const opaqueUrl = safeHttpUrl(entry.link);
  if (!title || !opaqueUrl) return null;

  const related = parseRelated(entry.content)
    // The list usually opens with the story itself.
    .filter(
      (story) => story.url !== opaqueUrl && stripPublisher(story.title, story.source) !== title,
    )
    .slice(0, MAX_RELATED);

  return {
    kind: 'news',
    source: {
      id: 'google-news',
      name: publisherName || ATTRIBUTION.name,
      url: safeHttpUrl(publisher?.url),
    },
    title,
    opaqueUrl,
    publishedAt: entry.isoDate,
    language: locale.language,
    related,
  };
}

export interface GoogleNewsSource extends DiscoverSource {
  /** The stories of the locality's city. Nothing to ask for without one. */
  readonly place: (input: SourceInput) => Promise<SourceResult>;
  /** The top stories of the locality's edition. */
  readonly top: (input: SourceInput) => Promise<SourceResult>;
  /** One topic in the locality's edition. */
  readonly topic: (input: SourceInput, topic: NewsTopic) => Promise<SourceResult>;
}

export function createGoogleNewsSource(options: { fetch: DiscoverFetch }): GoogleNewsSource {
  const { fetch: feedFetch } = options;

  const read = async (
    input: SourceInput,
    locale: NewsLocale,
    url: string,
  ): Promise<SourceResult> => {
    const answer = await readFeed(feedFetch, url, input.signal);
    const warnings =
      locale.language === input.language
        ? []
        : [`Google News has no ${input.language} edition here, so this is ${locale.language}.`];

    if (!answer.ok) {
      return { items: [], attribution: ATTRIBUTION, warnings, failed: answer.failure };
    }

    return {
      items: answer.feed.items.flatMap((entry) => toItem(entry, locale) ?? []),
      attribution: ATTRIBUTION,
      warnings,
    };
  };

  const localeOf = (input: SourceInput) => editionFor(input.locality.countryCode, input.language);

  const place: GoogleNewsSource['place'] = (input) => {
    const city = input.locality.city;
    if (!city) {
      return Promise.resolve({
        items: [],
        attribution: ATTRIBUTION,
        warnings: ['Google News has no place feed without a city.'],
      });
    }
    const locale = localeOf(input);
    return read(input, locale, newsPlaceUrl(city, locale));
  };

  const top: GoogleNewsSource['top'] = (input) => {
    const locale = localeOf(input);
    return read(input, locale, newsTopUrl(locale));
  };

  const topic: GoogleNewsSource['topic'] = (input, id) => {
    const locale = localeOf(input);
    return read(input, locale, newsTopicUrl(id, locale));
  };

  return {
    id: 'google-news',
    name: ATTRIBUTION.name,
    place,
    top,
    topic,

    // The one call the shared interface knows: the narrowest feed the input can name.
    fetch: (input) => {
      if (input.topic && isNewsTopic(input.topic)) return topic(input, input.topic);
      return input.locality.city ? place(input) : top(input);
    },
  };
}
