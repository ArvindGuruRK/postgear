/**
 * Fetching and reading a feed, for every source that speaks RSS or Atom.
 *
 * `rss-parser` is used for parsing only: its own `parseURL` would reach the
 * network with no SSRF guard, so nothing here ever calls it. The body always
 * arrives through the injected {@link DiscoverFetch}.
 *
 * One parser instance serves every request. The XML parser underneath runs
 * synchronously inside `parseString`, so two calls can never interleave.
 */
import Parser from 'rss-parser';
import type { DiscoverFetch, SourceFailure } from '../types';

export { stripHtml } from './html-text';

const FEED_TIMEOUT_MS = 8_000;
const FEED_MAX_BYTES = 1024 * 1024;
const FEED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8';

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

/** What the XML parser makes of `<source url="...">Name</source>`. */
interface XmlTextNode {
  _?: string;
  $?: Record<string, string>;
}

/** One `<ht:news_item>` block in a Google Trends feed. */
export interface TrendsNewsItemNode {
  'ht:news_item_title'?: string[];
  'ht:news_item_url'?: string[];
  'ht:news_item_source'?: string[];
  'ht:news_item_picture'?: string[];
}

interface CustomItemFields {
  approxTraffic?: string;
  picture?: string;
  newsItems?: TrendsNewsItemNode[];
  sourceNodes?: (XmlTextNode | string)[];
  mediaContent?: XmlTextNode;
  mediaThumbnail?: XmlTextNode;
  /** A YouTube channel feed keeps an entry's thumbnail inside `<media:group>`. */
  mediaGroup?: { 'media:thumbnail'?: XmlTextNode[]; 'media:content'?: XmlTextNode[] };
}

export type FeedItem = Parser.Item & CustomItemFields;
export type ParsedFeed = Parser.Output<CustomItemFields>;

const parser = new Parser<Record<string, never>, CustomItemFields>({
  customFields: {
    item: [
      ['ht:approx_traffic', 'approxTraffic'],
      ['ht:picture', 'picture'],
      ['ht:news_item', 'newsItems', { keepArray: true }],
      // Kept as an array so the node keeps its `url` attribute: without
      // `keepArray` the parser reduces it to the bare name.
      ['source', 'sourceNodes', { keepArray: true }],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:group', 'mediaGroup'],
    ],
  },
});

export async function parseFeed(body: string): Promise<ParsedFeed> {
  try {
    return await parser.parseString(body);
  } catch {
    // The parser's own message quotes the document, which is a stranger's text.
    throw new FeedParseError('The answer was not a readable feed.');
  }
}

/** The publisher an item names: its name, and its address when that is a real one. */
export function itemSource(item: FeedItem): { name: string; url?: string } | null {
  const node = item.sourceNodes?.[0];
  if (node === undefined) return null;
  if (typeof node === 'string') return { name: node };
  return { name: node._ ?? '', url: node.$?.url };
}

export type FeedRead =
  | { ok: true; feed: ParsedFeed }
  /** `status` is absent when the request never completed. */
  | { ok: false; failure: SourceFailure; status?: number };

/**
 * Fetches and parses, and never throws, which is what lets a source keep its own
 * promise of never throwing.
 *
 * A 429, a 5xx, a dropped connection and a page that is not a feed (Google's
 * consent page, say) all mean the service is in trouble. Any other 4xx means it
 * is fine and simply has nothing at that address.
 */
export async function readFeed(
  fetchFeed: DiscoverFetch,
  url: string,
  signal?: AbortSignal,
): Promise<FeedRead> {
  try {
    const response = await fetchFeed(url, {
      accept: FEED_ACCEPT,
      signal: signal ?? AbortSignal.timeout(FEED_TIMEOUT_MS),
      maxBytes: FEED_MAX_BYTES,
    });

    if (response.status !== 200) {
      const isTrouble = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        failure: isTrouble ? 'upstream' : 'not_found',
        status: response.status,
      };
    }

    return { ok: true, feed: await parseFeed(response.body) };
  } catch {
    return { ok: false, failure: 'upstream' };
  }
}
