/**
 * Finding a website's feeds, because nobody knows their competitor's RSS address
 * (Module 07, research 01 section 3.9).
 *
 * Three ways, in the order they cost:
 *
 * 1. The page that came back is itself a feed (someone pasted the feed's address
 *    as the website). That is the one feed.
 * 2. The page links its feeds in `<link rel="alternate" type="application/rss+xml">`
 *    (or `atom+xml`). Those are taken as the site states them: nothing more is
 *    fetched.
 * 3. Only when the page links none: the common paths (`/feed`, `/rss.xml` and so
 *    on) are tried, and the ones that really answer with a feed are kept. Trying
 *    eight addresses on a site that already said where its feeds are would be
 *    eight requests for nothing.
 *
 * Every address here is a stranger's. A link survives only as `http` or `https`,
 * resolved against the page's own address, and the API checks each one against
 * the private-network guard before it is shown, saved or fetched. The probes go
 * through the injected fetch like everything else in this package.
 */
import type { DiscoverFetch } from './types';
import { isRecord, resolveHttpUrl } from './sources/competitor';
import { parseFeed } from './sources/feed-parser';
import { cleanText, stripHtml, tokenize } from './sources/html-text';
import { FEED_ACCEPT } from './sources/rss';

export type FeedFormat = 'rss' | 'atom';

export interface DiscoveredFeed {
  url: string;
  /** The feed's name as the site gives it. Empty when it gives none. */
  title: string;
  kind: FeedFormat;
}

export const MAX_DISCOVERED_FEEDS = 5;

export const COMMON_FEED_PATHS = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/blog/feed',
  '/blog/rss',
  '/index.xml',
] as const;

const TITLE_CHARS = 80;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_MAX_BYTES = 1024 * 1024;
/** How far into a body the opening tag of a feed can sit: a declaration, a stylesheet line, a comment. */
const SNIFF_CHARS = 2_048;

const LINK_TYPES: Record<string, FeedFormat> = {
  'application/rss+xml': 'rss',
  'application/atom+xml': 'atom',
};

/** Which kind of feed a body is, from its opening tag, or null when it is not one. */
export function feedFormatOf(body: string): FeedFormat | null {
  const match = /<(rss|feed|rdf:RDF)[\s>]/i.exec(body.slice(0, SNIFF_CHARS));
  if (!match) return null;
  return match[1].toLowerCase() === 'feed' ? 'atom' : 'rss';
}

function titleOf(text: string | undefined): string {
  return Array.from(cleanText(stripHtml(text ?? '')))
    .slice(0, TITLE_CHARS)
    .join('')
    .trim();
}

/** The feeds a page links in its `<link rel="alternate">` tags, in the page's order. */
export function findFeedLinks(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  for (const token of tokenize(html)) {
    if (feeds.length >= MAX_DISCOVERED_FEEDS) break;
    if (token.type !== 'open' || token.name !== 'link') continue;

    const rel = (token.attrs.rel ?? '').toLowerCase().split(/\s+/);
    const kind = LINK_TYPES[(token.attrs.type ?? '').trim().toLowerCase()];
    if (!rel.includes('alternate') || !kind) continue;

    const url = resolveHttpUrl(token.attrs.href, baseUrl);
    if (!url || seen.has(url)) continue;

    seen.add(url);
    feeds.push({ url, title: titleOf(token.attrs.title), kind });
  }

  return feeds;
}

async function probe(
  feedFetch: DiscoverFetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<DiscoveredFeed | null> {
  try {
    const response = await feedFetch(url, {
      accept: FEED_ACCEPT,
      signal: signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS),
      maxBytes: PROBE_MAX_BYTES,
    });
    const kind = response.status === 200 ? feedFormatOf(response.body) : null;
    if (!kind) return null;

    const feed = await parseFeed(response.body);
    const finalUrl = resolveHttpUrl(response.finalUrl || url, url);
    return finalUrl ? { url: finalUrl, title: titleOf(feed.title), kind } : null;
  } catch (error) {
    // A refusal by the address guard is not "no feed here": it must reach the caller.
    if (isRecord(error) && error.kind === 'unsafe_url') throw error;
    return null;
  }
}

export interface DiscoverFeedsOptions {
  fetch: DiscoverFetch;
  /** The caller's deadline for all the probes together. */
  signal?: AbortSignal;
}

/**
 * The feeds of the page at `baseUrl`, at most five. `html` is that page's body,
 * already fetched by the caller.
 */
export async function discoverFeeds(
  html: string,
  baseUrl: string,
  options: DiscoverFeedsOptions,
): Promise<DiscoveredFeed[]> {
  const own = feedFormatOf(html);
  if (own) {
    try {
      const feed = await parseFeed(html);
      const url = resolveHttpUrl(baseUrl, baseUrl);
      if (url) return [{ url, title: titleOf(feed.title), kind: own }];
    } catch {
      // It opened like a feed and did not read as one: go on as with any page.
    }
  }

  const linked = findFeedLinks(html, baseUrl);
  if (linked.length > 0) return linked;

  const candidates = COMMON_FEED_PATHS.flatMap((path) => resolveHttpUrl(path, baseUrl) ?? []);
  const settled = await Promise.allSettled(
    candidates.map((url) => probe(options.fetch, url, options.signal)),
  );

  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
    const feed = result.value;
    // `/feed` and `/feed/` usually end at one address.
    if (!feed || seen.has(feed.url) || feeds.length >= MAX_DISCOVERED_FEEDS) continue;
    seen.add(feed.url);
    feeds.push(feed);
  }
  return feeds;
}
