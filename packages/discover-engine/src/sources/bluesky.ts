/**
 * What Bluesky is talking about, from its public AppView (research 01, section
 * 3.6). Worldwide and English-heavy, never local, and shown as such. The endpoint
 * is `unspecced`, so it may change: any answer that is not the expected shape is
 * trouble, not a crash.
 *
 * A trend's `link` is a path on bsky.app, not an address. It is only ever joined
 * to our own `https://bsky.app`, and only when it starts with a single slash, so
 * nothing the answer says can send Open to another site.
 */
import type {
  DiscoverFetch,
  DiscoverSource,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { safeHttpUrl, stripHtml } from './html-text';

export const BLUESKY_TRENDS_URL =
  'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=10';

const ATTRIBUTION = { name: 'Bluesky', url: 'https://bsky.app' };
const MAX_ITEMS = 10;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

const PLAIN_COUNT = new Intl.NumberFormat('en');
const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact' });

/** `4,625` under ten thousand, `11K` and `1.2M` from there up. */
function countLabel(count: number): string {
  return (count < 10_000 ? PLAIN_COUNT : COMPACT_COUNT).format(count);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? stripHtml(value) : '';
}

/** A path on bsky.app becomes an address there. `//host`, a full address or a script does not. */
function trendUrl(link: unknown): string | undefined {
  if (typeof link !== 'string' || !/^\/(?![/\\])/.test(link)) return undefined;
  return safeHttpUrl(`${ATTRIBUTION.url}${link}`);
}

function isoDate(value: unknown): string | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function toItem(entry: unknown): SourceItem | null {
  if (!isRecord(entry)) return null;
  const title = textOf(entry.displayName);
  if (!title) return null;

  const posts = entry.postCount;
  const hasPosts = typeof posts === 'number' && Number.isFinite(posts) && posts >= 0;

  return {
    kind: 'social',
    source: { id: 'bluesky', name: ATTRIBUTION.name, url: ATTRIBUTION.url },
    title,
    summary: textOf(entry.description) || textOf(entry.category) || undefined,
    url: trendUrl(entry.link),
    publishedAt: isoDate(entry.startedAt),
    signal: hasPosts
      ? { label: `${countLabel(posts)} ${posts === 1 ? 'post' : 'posts'}`, posts }
      : undefined,
  };
}

export function createBlueskySource(options: { fetch: DiscoverFetch }): DiscoverSource {
  const { fetch: sourceFetch } = options;

  const empty = (failed: SourceFailure, warnings: string[] = []): SourceResult => ({
    items: [],
    attribution: ATTRIBUTION,
    warnings,
    failed,
  });

  return {
    id: 'bluesky',
    name: ATTRIBUTION.name,

    fetch: async ({ signal }: SourceInput): Promise<SourceResult> => {
      let body: unknown;
      try {
        const response = await sourceFetch(BLUESKY_TRENDS_URL, {
          accept: 'application/json',
          signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
          maxBytes: MAX_BYTES,
        });
        if (response.status !== 200) {
          const isTrouble = response.status === 429 || response.status >= 500;
          return empty(isTrouble ? 'upstream' : 'not_found');
        }
        body = JSON.parse(response.body);
      } catch {
        // The request never completed, or what came back was not JSON.
        return empty('upstream');
      }

      const trends = isRecord(body) && Array.isArray(body.trends) ? body.trends : null;
      const items = (trends ?? []).flatMap((entry) => toItem(entry) ?? []);
      // Rows, and not one of them readable, is a changed shape rather than a quiet day.
      if (!trends || (trends.length > 0 && items.length === 0)) {
        return empty('upstream', ['Bluesky answered in a shape this cannot read.']);
      }

      return { items: items.slice(0, MAX_ITEMS), attribution: ATTRIBUTION, warnings: [] };
    },
  };
}
