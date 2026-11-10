/**
 * Mastodon's trending hashtags, from one instance's public API (research 01,
 * section 3.7). Worldwide and community-flavoured: a source of hashtag ideas,
 * never a local signal.
 *
 * The instance is configuration, but it ends up inside an address, so it is
 * checked for being a plain public host name first. Anything else (a path, a
 * port, an IP address, `localhost`) reads the default instance instead of
 * becoming part of a request.
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

export const MASTODON_INSTANCE = 'mastodon.social';

export function mastodonTrendsUrl(instance: string = MASTODON_INSTANCE): string {
  return `https://${instance}/api/v1/trends/tags?limit=10`;
}

const NAME = 'Mastodon';
const MAX_ITEMS = 10;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

/** Dotted labels of letters, digits and hyphens, ending in a top-level name: no scheme, port, path or address literal. */
const HOST_NAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const PLAIN_COUNT = new Intl.NumberFormat('en');
const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact' });

/** `273` and `3,312` under ten thousand, `11K` and `1.2M` from there up. */
function countLabel(count: number): string {
  return (count < 10_000 ? PLAIN_COUNT : COMPACT_COUNT).format(count);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A day's count, which the API sends as a string of digits. Anything else is not a count. */
function countOf(value: unknown): number | undefined {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return undefined;
  const count = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

/**
 * Uses over the days the instance reports, which is seven. Undefined when not
 * one day can be read, so a tag never claims "0 uses" it did not report.
 */
function usesThisWeek(history: unknown): number | undefined {
  if (!Array.isArray(history)) return undefined;

  let days = 0;
  let uses = 0;
  for (const day of history) {
    const count = isRecord(day) ? countOf(day.uses) : undefined;
    if (count === undefined) continue;
    days += 1;
    uses += count;
  }
  return days > 0 ? uses : undefined;
}

function toItem(entry: unknown, home: string): SourceItem | null {
  if (!isRecord(entry) || typeof entry.name !== 'string') return null;
  // The API sends the bare word. A stray `#` must not become `##tag`.
  const name = stripHtml(entry.name).replace(/^#+/, '').trim();
  if (!name) return null;

  const uses = usesThisWeek(entry.history);

  return {
    kind: 'social',
    source: { id: 'mastodon', name: NAME, url: home },
    title: `#${name}`,
    url: typeof entry.url === 'string' ? safeHttpUrl(entry.url) : undefined,
    signal:
      uses === undefined
        ? undefined
        : {
            label: `${countLabel(uses)} ${uses === 1 ? 'use' : 'uses'} this week`,
            posts: uses,
          },
  };
}

export function createMastodonSource(options: {
  fetch: DiscoverFetch;
  instance?: string;
}): DiscoverSource {
  const { fetch: sourceFetch } = options;

  // A blank setting is no setting.
  const given = options.instance?.trim().toLowerCase() || undefined;
  const instance = given !== undefined && HOST_NAME.test(given) ? given : MASTODON_INSTANCE;
  const home = `https://${instance}`;
  const attribution = { name: NAME, url: home };
  // Said on every answer, because a wrong setting is otherwise silent.
  const standing =
    given === undefined || given === instance
      ? []
      : [`The Mastodon instance is not a host name, so this is ${MASTODON_INSTANCE}.`];

  const empty = (failed: SourceFailure, warnings: string[] = []): SourceResult => ({
    items: [],
    attribution,
    warnings: [...standing, ...warnings],
    failed,
  });

  return {
    id: 'mastodon',
    name: NAME,

    fetch: async ({ signal }: SourceInput): Promise<SourceResult> => {
      let body: unknown;
      try {
        const response = await sourceFetch(mastodonTrendsUrl(instance), {
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

      const tags = Array.isArray(body) ? body : null;
      const items = (tags ?? []).flatMap((entry) => toItem(entry, home) ?? []);
      // Rows, and not one of them readable, is a changed shape rather than a quiet day.
      if (!tags || (tags.length > 0 && items.length === 0)) {
        return empty('upstream', ['Mastodon answered in a shape this cannot read.']);
      }

      return { items: items.slice(0, MAX_ITEMS), attribution, warnings: [...standing] };
    },
  };
}
