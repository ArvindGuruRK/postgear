/**
 * A competitor's own feed, RSS or Atom, read into rows (Module 07): the title,
 * where it leads, a short summary, a picture when the feed names one, and when
 * it was published. The newest ten of the last 30 days.
 *
 * A feed is a stranger's text from end to end. Titles and summaries are stripped
 * to plain text, a link survives only as `http` or `https` (resolved against the
 * feed's own address, since feeds do write relative ones), and nothing of the
 * body ever reaches a message.
 *
 * `feedItems` is the mapper on its own, because a YouTube channel's feed is the
 * same format read with a different label (`youtube-channel.ts`).
 */
import type { SourceAttribution, SourceId, SourceItem, SourceResult } from '../types';
import {
  type CompetitorSource,
  type CompetitorSourceOptions,
  excerpt,
  failedRead,
  newest,
  readBody,
  resolveHttpUrl,
  unreadable,
} from './competitor';
import { type FeedItem, type ParsedFeed, parseFeed } from './feed-parser';
import { safeHttpUrl, stripHtml } from './html-text';

export const FEED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8';

const NAME = 'RSS';
const TITLE_CHARS = 200;

export interface FeedLabel {
  id: SourceId;
  /** What the rows are attributed to when the feed does not name itself. */
  fallbackName: string;
  /** Every row's summary, for a feed whose entries are all one thing (videos). */
  summary?: string;
}

function attributeUrl(node: { $?: Record<string, string> } | undefined): string | undefined {
  return node?.$?.url;
}

/** The picture an entry names: its media tags first, then an enclosure that is an image. */
function imageOf(entry: FeedItem, base: string): string | undefined {
  const enclosure = entry.enclosure;
  const candidates = [
    attributeUrl(entry.mediaThumbnail),
    attributeUrl(entry.mediaGroup?.['media:thumbnail']?.[0]),
    attributeUrl(entry.mediaContent),
    enclosure && /^image\//i.test(enclosure.type ?? '') ? enclosure.url : undefined,
  ];
  for (const candidate of candidates) {
    const url = resolveHttpUrl(candidate, base);
    if (url) return url;
  }
  return undefined;
}

/** A feed's own name and home, for the rows' attribution. */
export function feedAttribution(
  feed: ParsedFeed,
  feedUrl: string,
  label: FeedLabel,
): SourceAttribution {
  return {
    name: excerpt(stripHtml(feed.title ?? ''), 80) || label.fallbackName,
    url: resolveHttpUrl(feed.link, feedUrl),
  };
}

/** Every entry of a parsed feed that has a title, as rows. No cut by age or count yet. */
export function feedItems(feed: ParsedFeed, feedUrl: string, label: FeedLabel): SourceItem[] {
  const attribution = feedAttribution(feed, feedUrl, label);

  return feed.items.flatMap((entry): SourceItem[] => {
    const title = excerpt(stripHtml(entry.title ?? ''), TITLE_CHARS);
    if (!title) return [];

    const summary =
      label.summary ??
      excerpt(stripHtml(entry.contentSnippet ?? entry.content ?? entry.summary ?? ''));

    return [
      {
        kind: 'competitor',
        source: { id: label.id, name: attribution.name, url: attribution.url },
        title,
        summary: summary || undefined,
        url: resolveHttpUrl(entry.link, feedUrl),
        image: imageOf(entry, feedUrl),
        publishedAt: entry.isoDate,
      },
    ];
  });
}

/**
 * Fetches one feed and reads it, for any label. A body that is not a feed is
 * `unreadable`: the address answered, just not with a feed.
 */
export async function readCompetitorFeed(
  options: CompetitorSourceOptions,
  feedUrl: string,
  label: FeedLabel,
  signal?: AbortSignal,
): Promise<SourceResult> {
  const fallback: SourceAttribution = { name: label.fallbackName };
  const read = await readBody(options.fetch, feedUrl, FEED_ACCEPT, signal);
  if (!read.ok) return failedRead(fallback, read);

  let feed: ParsedFeed;
  try {
    feed = await parseFeed(read.body);
  } catch {
    return unreadable(fallback, 'The address did not answer with a feed.');
  }

  return {
    items: newest(feedItems(feed, read.finalUrl, label), options),
    attribution: feedAttribution(feed, read.finalUrl, label),
    warnings: [],
  };
}

export function createRssSource(options: CompetitorSourceOptions): CompetitorSource {
  const label: FeedLabel = { id: 'rss', fallbackName: NAME };

  return {
    id: 'rss',
    name: NAME,

    read: async (reference, signal) => {
      // Only ever an address the API already checked; this is the last look at its shape.
      const feedUrl = safeHttpUrl(reference);
      if (!feedUrl) return unreadable({ name: NAME }, 'The feed address is not a web address.');

      return readCompetitorFeed(options, feedUrl, label, signal);
    },
  };
}
