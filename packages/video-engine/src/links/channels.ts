/**
 * The `ChannelLister` contract (Module 03, section 5; research 11, 6.2).
 *
 * "What has this channel put out lately?", metadata only. A lister never
 * returns a download address: the web builds the canonical link from
 * `{ platform, kind, externalId }` and posts it to the probe, so Import keeps
 * every check.
 *
 * Pure and shared: the API holds the Twitch Helix and YouTube Data API
 * listers, media-tools the yt-dlp flat lister and the simulated one, and both
 * sides throw the same `ChannelListerError`.
 */
import type {
  ChannelPage,
  ChannelRef,
  ClipPlatformId,
  ListKind,
  ListPeriod,
  ListSort,
} from './types';

/** One page request. */
export interface ChannelListQuery {
  kind: ListKind;
  /** Opaque; from the previous page's `nextCursor`. */
  cursor?: string;
  /** 1 to 50. */
  limit: number;
  /** Twitch clips only. */
  period?: ListPeriod;
  sort?: ListSort;
}

/** One platform's lister. */
export interface ChannelLister {
  readonly platform: ClipPlatformId;
  /** A checked handle to the channel. Throws `ChannelListerError` (`channel_not_found` and so on). */
  resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef>;
  /** One page of a list. */
  list(channel: ChannelRef, query: ChannelListQuery, signal?: AbortSignal): Promise<ChannelPage>;
}

/** Items in one page at most (research 11, section 7). */
export const MAX_LIST_PAGE = 50;
/** Items a session may page through (20 pages of 50). */
export const MAX_LIST_ITEMS = 1000;

/** The lists each platform has. */
export const PLATFORM_LIST_KINDS: Readonly<Record<ClipPlatformId, readonly ListKind[]>> =
  Object.freeze({
    twitch: Object.freeze(['streams', 'clips'] as ListKind[]),
    kick: Object.freeze(['streams', 'clips'] as ListKind[]),
    youtube: Object.freeze(['uploads', 'streams', 'shorts'] as ListKind[]),
  });

/**
 * Why a list could not be read. `platform_rate_limited` and `channel_listing_failed`
 * are worth another try later; the API's selector falls back to this binding
 * on the official listers' `platform_rate_limited` and `quota_exhausted`.
 */
export type ChannelListerErrorCode =
  | 'channel_not_found'
  | 'channel_listing_failed'
  | 'platform_changed'
  | 'platform_rate_limited'
  | 'list_sort_unsupported'
  | 'list_kind_unsupported'
  | 'cancelled';

export class ChannelListerError extends Error {
  readonly code: ChannelListerErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ChannelListerErrorCode,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(`channel list failed: ${code}`);
    this.name = 'ChannelListerError';
    this.code = code;
    this.retryable =
      options.retryable ?? (code === 'platform_rate_limited' || code === 'channel_listing_failed');
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Throws unless `kind` is a list `platform` has. */
export function assertListKind(platform: ClipPlatformId, kind: ListKind): void {
  if (!PLATFORM_LIST_KINDS[platform].includes(kind)) {
    throw new ChannelListerError('list_kind_unsupported', { retryable: false });
  }
}

/** The page size asked for, held to 1 to 50. */
export function pageLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_LIST_PAGE;
  return Math.min(MAX_LIST_PAGE, Math.max(1, Math.floor(limit)));
}

/**
 * Our cursors are the 1-based position of the next item, as text. Anything
 * else (or past the 1,000 item cap) reads as the end of the list.
 */
export function cursorStart(cursor: string | undefined): number | null {
  if (cursor === undefined || cursor === '') return 1;
  if (!/^\d{1,4}$/.test(cursor)) return null;
  const start = Number(cursor);
  return start >= 1 && start <= MAX_LIST_ITEMS ? start : null;
}

/** The cursor for the page after one that started at `start` and held `limit` items, if allowed. */
export function nextCursorAfter(start: number, limit: number, more: boolean): string | undefined {
  const next = start + limit;
  return more && next <= MAX_LIST_ITEMS ? String(next) : undefined;
}

/** How long Twitch keeps a past broadcast: 7 days, 14 for affiliates, 60 for partners (reported). */
export function twitchArchiveDays(broadcasterType: string | undefined): number | null {
  if (broadcasterType === undefined) return null;
  if (broadcasterType === 'partner') return 60;
  if (broadcasterType === 'affiliate') return 14;
  return 7;
}

/** When Twitch deletes a past broadcast published at `publishedAt`, or undefined when unknown. */
export function twitchArchiveExpiry(
  publishedAt: string,
  broadcasterType: string | undefined,
): string | undefined {
  const days = twitchArchiveDays(broadcasterType);
  const time = Date.parse(publishedAt);
  if (days === null || Number.isNaN(time)) return undefined;
  return new Date(time + days * 24 * 60 * 60 * 1000).toISOString();
}

// --- The worker's list workflow (`clipListChannelWorkflow`) ---------------------

/**
 * What the API asks `clipListChannelWorkflow` on `postgear-media-quick`: the
 * yt-dlp flat lister (Kick always, Twitch and YouTube as the fallback). The
 * channel page it lists is built from the checked handle, never pasted text.
 */
export type ClipListChannelRequest =
  | { op: 'resolve'; platform: ClipPlatformId; handle: string }
  | { op: 'list'; platform: ClipPlatformId; channel: ChannelRef; query: ChannelListQuery };

export type ClipListChannelAnswer =
  | { op: 'resolve'; channel: ChannelRef }
  | { op: 'list'; page: ChannelPage };
