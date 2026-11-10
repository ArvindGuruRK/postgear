/**
 * What the competitor sources share (Module 07): a website's feeds, a YouTube
 * channel, a Bluesky author, a Mastodon account.
 *
 * They differ from the place sources in one way that shapes everything here:
 * what they read is named by a person, not by us. So each takes a reference (an
 * address, a channel id, a handle), checks its shape before it can become part of
 * a request, and reads through the injected fetch, which the API binds to the
 * SSRF-guarded one.
 *
 * ## Reached, or read
 *
 * A source that did not answer, and a source that answered with something else
 * (a web page where a feed should be, a body over the size cap, another shape of
 * JSON), are two different sentences on the page: "could not be reached" and
 * "could not be read". The second is `unreadable`, and it is never `upstream`:
 * the host is fine, so it must not count towards a breaker.
 *
 * ## The age limit takes a clock and an off switch
 *
 * Items older than 30 days are dropped, against a clock the caller may pass.
 * Simulation switches the limit off with `maxAgeMs: null`, as the composer does,
 * because hand-written samples all pass 30 days a month after they are written.
 */
import type {
  DiscoverFetch,
  SourceAttribution,
  SourceFailure,
  SourceId,
  SourceItem,
  SourceResult,
} from '../types';
import { safeHttpUrl } from './html-text';

export const COMPETITOR_MAX_ITEMS = 10;
export const COMPETITOR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How much of a post or a summary a row carries. */
export const COMPETITOR_TEXT_CHARS = 240;

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

export interface CompetitorSourceOptions {
  fetch: DiscoverFetch;
  /** Null turns the 30 day limit off. */
  maxAgeMs?: number | null;
  now?: () => Date;
}

/** Never throws: a failure comes back as an empty {@link SourceResult} with `failed` set. */
export interface CompetitorSource {
  readonly id: SourceId;
  readonly name: string;
  /** `reference` is what a person entered: a feed address, a channel id, a handle. */
  readonly read: (reference: string, signal?: AbortSignal) => Promise<SourceResult>;
}

/** Dotted labels of letters, digits and hyphens, ending in a top-level name: no scheme, port, path or address literal. */
const HOST_NAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function isHostName(value: string): boolean {
  return HOST_NAME.test(value);
}

/** The first `max` characters by code point, with three full stops when something was cut. */
export function excerpt(text: string, max: number = COMPETITOR_TEXT_CHARS): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  return `${points
    .slice(0, max - 3)
    .join('')
    .trimEnd()}...`;
}

/** A link as a feed wrote it, which may be relative to the feed's own address. */
export function resolveHttpUrl(value: string | undefined | null, base: string): string | undefined {
  if (!value) return undefined;
  try {
    return safeHttpUrl(new URL(value.trim(), base).toString());
  } catch {
    return undefined;
  }
}

export function isoDate(value: unknown): string | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timeOf(item: SourceItem): number {
  const time = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * The newest ten of what a competitor published in the last 30 days. An item
 * with no date cannot be judged, so it stays, after the dated ones.
 */
export function newest(
  items: SourceItem[],
  options: Pick<CompetitorSourceOptions, 'maxAgeMs' | 'now'>,
): SourceItem[] {
  const maxAgeMs = options.maxAgeMs === undefined ? COMPETITOR_MAX_AGE_MS : options.maxAgeMs;
  const now = (options.now?.() ?? new Date()).getTime();

  return items
    .filter((item) => {
      if (maxAgeMs === null) return true;
      const time = timeOf(item);
      return time === Number.NEGATIVE_INFINITY || now - time <= maxAgeMs;
    })
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, COMPETITOR_MAX_ITEMS);
}

export function emptyResult(
  attribution: SourceAttribution,
  failed: SourceFailure,
  extra: { unreadable?: boolean; warnings?: string[] } = {},
): SourceResult {
  return {
    items: [],
    attribution,
    warnings: extra.warnings ?? [],
    failed,
    ...(extra.unreadable ? { unreadable: true } : {}),
  };
}

/** The answer was not what this reads: the host is fine, the address is not usable. */
export function unreadable(attribution: SourceAttribution, warning: string): SourceResult {
  return emptyResult(attribution, 'not_found', { unreadable: true, warnings: [warning] });
}

export type BodyRead =
  | { ok: true; body: string; finalUrl: string }
  | { ok: false; failed: SourceFailure; unreadable?: boolean };

/**
 * One request through the injected fetch, and never a throw. A 429 or a 5xx is
 * trouble; any other bad status means there is nothing at that address. A body
 * over the cap is the one thrown failure that is not trouble either: the guarded
 * fetch names it `too_large`, and that is a feed we cannot read, not a host that
 * is down.
 */
export async function readBody(
  sourceFetch: DiscoverFetch,
  url: string,
  accept: string,
  signal?: AbortSignal,
): Promise<BodyRead> {
  try {
    const response = await sourceFetch(url, {
      accept,
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      maxBytes: MAX_BYTES,
    });
    if (response.status !== 200) {
      const isTrouble = response.status === 429 || response.status >= 500;
      return { ok: false, failed: isTrouble ? 'upstream' : 'not_found' };
    }
    return { ok: true, body: response.body, finalUrl: response.finalUrl || url };
  } catch (error) {
    const kind = isRecord(error) ? error.kind : undefined;
    // Too big, or a redirect the address guard refused: the address is no use to
    // us, and neither says the host is down. Counting a refused redirect as
    // trouble would let one such address rest its host for every workspace.
    return kind === 'too_large' || kind === 'unsafe_url'
      ? { ok: false, failed: 'not_found', unreadable: true }
      : { ok: false, failed: 'upstream' };
  }
}

/** A failed {@link readBody} as the result a source answers with. */
export function failedRead(
  attribution: SourceAttribution,
  read: Extract<BodyRead, { ok: false }>,
): SourceResult {
  return emptyResult(attribution, read.failed, { unreadable: read.unreadable });
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
