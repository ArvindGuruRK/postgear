/**
 * Rising searches for a place, from Google Trends' public RSS feed: a keyword, an
 * approximate volume, and the stories behind it with real publisher addresses.
 * The mapping follows the RSS path of `trendspyg` (MIT), research 02 section 3.
 *
 * Sub-regions come first, because that is the point of the module, but coverage
 * differs by place, so an empty feed or a not-found falls back to the country.
 * A 429 or a dropped connection does not: Google asked us to back off, or is not
 * answering, and asking again straight away is neither polite nor useful.
 */
import { trendsGeo } from '../geo/iso3166';
import type {
  DiscoverFetch,
  DiscoverSource,
  RelatedHeadline,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { type FeedItem, type FeedRead, readFeed, type TrendsNewsItemNode } from './feed-parser';
import { cleanText, safeHttpUrl, stripHtml } from './html-text';

const ATTRIBUTION = { name: 'Google Trends', url: 'https://trends.google.com/trending' };

export function trendsFeedUrl(geo: string): string {
  return `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
}

function trendsPageUrl(geo: string): string {
  return `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}`;
}

/**
 * "200+" to 200: the feed gives a floor, and the plus means "at least". The other
 * forms ("2,000+", "10K+", "1M+") turn up depending on the volume and the locale.
 */
export function parseTraffic(text: string | undefined): number | undefined {
  const match = /^([\d.,]*\d)\s*([KkMm]?)/.exec(text?.trim() ?? '');
  if (!match) return undefined;

  const scale = { k: 1_000, m: 1_000_000 }[match[2].toLowerCase()] ?? 1;
  const digits = match[1].replace(/[.,]/g, '');
  const value = Number(digits) * scale;
  return Number.isFinite(value) ? value : undefined;
}

function relatedOf(nodes: TrendsNewsItemNode[] | undefined): RelatedHeadline[] {
  const related: RelatedHeadline[] = [];
  for (const node of nodes ?? []) {
    const title = stripHtml(node['ht:news_item_title']?.[0] ?? '');
    const url = safeHttpUrl(node['ht:news_item_url']?.[0]);
    if (title && url) {
      related.push({ title, url, source: stripHtml(node['ht:news_item_source']?.[0] ?? '') });
    }
  }
  return related;
}

function toItem(entry: FeedItem, rank: number, geo: string): SourceItem | null {
  const title = stripHtml(entry.title ?? '');
  if (!title) return null;

  const related = relatedOf(entry.newsItems);
  const volume = cleanText(entry.approxTraffic ?? '');

  return {
    kind: 'trend',
    source: { id: 'google-trends', name: ATTRIBUTION.name, url: trendsPageUrl(geo) },
    title,
    // Open goes to an article, not back to Google.
    url: related[0]?.url,
    image: safeHttpUrl(entry.picture),
    publishedAt: entry.isoDate,
    signal: {
      label: volume ? `${volume} searches` : 'Rising',
      rank,
      traffic: parseTraffic(volume),
    },
    related,
  };
}

function itemsFrom(read: Extract<FeedRead, { ok: true }>, geo: string): SourceItem[] {
  return read.feed.items.flatMap((entry, index) => toItem(entry, index + 1, geo) ?? []);
}

/** Whether the country is worth asking after this answer from the region. */
function shouldTryCountry(read: FeedRead): boolean {
  if (read.ok) return read.feed.items.length === 0;
  return read.status !== undefined && read.status !== 429;
}

export function createGoogleTrendsSource(options: { fetch: DiscoverFetch }): DiscoverSource {
  const { fetch: feedFetch } = options;

  const empty = (warnings: string[], failed?: SourceResult['failed']): SourceResult => ({
    items: [],
    attribution: ATTRIBUTION,
    warnings,
    ...(failed ? { failed } : {}),
  });

  return {
    id: 'google-trends',
    name: ATTRIBUTION.name,

    fetch: async ({ locality, signal }: SourceInput): Promise<SourceResult> => {
      const geo = trendsGeo(locality);
      if (!geo) return empty(['Google Trends has no worldwide feed.']);

      const first = await readFeed(feedFetch, trendsFeedUrl(geo), signal);
      const country = locality.countryCode;
      const canFallBack = country !== null && country !== geo && shouldTryCountry(first);

      let answered = first;
      let answeredGeo = geo;
      if (canFallBack) {
        answered = await readFeed(feedFetch, trendsFeedUrl(country), signal);
        answeredGeo = country;
      }

      const warnings = canFallBack
        ? [`Google Trends has nothing for ${geo}, so this is ${country}.`]
        : [];

      if (!answered.ok) return empty(warnings, answered.failure);

      return {
        items: itemsFrom(answered, answeredGeo),
        attribution: ATTRIBUTION,
        warnings,
        answeredGeo,
      };
    },
  };
}
