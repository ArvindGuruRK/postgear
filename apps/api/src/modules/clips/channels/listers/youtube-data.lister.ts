/**
 * `YouTubeDataLister` (Module 03, section 5; research 11, section 4): YouTube
 * channels through the official Data API v3 with an API key.
 *
 * - **Calls**: `channels.list` with `forHandle` (or `id` for a `UC...` id) to
 *   find the channel and its uploads list (1 unit), then per page
 *   `playlistItems.list` on the uploads list and `videos.list` for length,
 *   views and live state (1 unit each). Never `search.list` (100 units).
 * - **Lists**: the uploads list holds videos, Shorts and finished streams
 *   together, so the three lists are filters over it: Streams are the items
 *   with live streaming details, Shorts the others of three minutes or less,
 *   Videos the rest. A page can therefore hold fewer than 50 rows and still
 *   have a next page. YouTube lists newest first only.
 * - **Budget**: a Redis counter per Pacific day (YouTube's quota resets at
 *   midnight Pacific) caps Clips at 6,000 units, 60 percent of a key's
 *   10,000, so Discover keeps room when the keys are shared. Every call
 *   spends its unit before it is made; past the cap, or when YouTube itself
 *   says the quota is spent, the answer is `quota_exhausted` until the reset,
 *   and the selector falls back to the flat list.
 * - **Never logged**: the key (it rides in the query string, so no address is
 *   logged either).
 */
import type {
  ChannelLister,
  ChannelListQuery,
  ChannelPage,
  ChannelRef,
  ListedItem,
} from '@postgear/video-engine';
import { assertListKind, pageLimit, validateHandle } from '@postgear/video-engine';
import { z } from 'zod';
import type { RedisService } from '../../../redis/redis.service';
import { parseIso8601Duration } from './durations';
import type { ListerHttp, ListerHttpResponse } from './lister-http';
import { ListingFailure } from './listing-failure';

const API = 'https://www.googleapis.com/youtube/v3';
/** 60 percent of the default 10,000 units a day. */
export const YOUTUBE_DAILY_UNITS = 6_000;
/** A Short is three minutes or less (research 07, section 7). */
const SHORT_MAX_SECONDS = 180;
const UC_ID = /^UC[A-Za-z0-9_-]{22}$/;
const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const KEY_REASONS = new Set([
  'keyInvalid',
  'keyExpired',
  'accessNotConfigured',
  'forbidden',
  'ipRefererBlocked',
]);

const thumbnails = z.record(z.object({ url: z.string() }).partial()).optional();

const channelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(UC_ID),
        snippet: z.object({ title: z.string(), customUrl: z.string().optional(), thumbnails }),
        contentDetails: z.object({
          relatedPlaylists: z.object({ uploads: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/) }),
        }),
      }),
    )
    .optional(),
});

const playlistSchema = z.object({
  nextPageToken: z.string().max(512).optional(),
  items: z
    .array(
      z.object({ contentDetails: z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }) }),
    )
    .optional(),
});

const videosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          publishedAt: z.string(),
          liveBroadcastContent: z.string().optional(),
          thumbnails,
        }),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
        statistics: z.object({ viewCount: z.string().optional() }).optional(),
        liveStreamingDetails: z
          .object({
            actualStartTime: z.string().optional(),
            scheduledStartTime: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const errorSchema = z.object({
  error: z
    .object({ errors: z.array(z.object({ reason: z.string().optional() })).optional() })
    .optional(),
});

export interface YouTubeDataOptions {
  apiKey: string;
  http: ListerHttp;
  redis: Pick<RedisService, 'get' | 'set' | 'incrementWithTtl'>;
  now?: () => number;
}

export class YouTubeDataLister implements ChannelLister {
  readonly platform = 'youtube' as const;
  private readonly now: () => number;

  constructor(private readonly options: YouTubeDataOptions) {
    this.now = options.now ?? Date.now;
  }

  async resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef> {
    const checked = validateHandle('youtube', handle);
    if (!checked.ok) throw new ListingFailure('channel_not_found');
    const params: Record<string, string> = { part: 'snippet,contentDetails', maxResults: '1' };
    if (checked.channelId) params.id = checked.channelId;
    else params.forHandle = checked.handle;

    const answer = this.parse(channelsSchema, await this.call('/channels', params, signal));
    const channel = answer.items?.[0];
    if (!channel) throw new ListingFailure('channel_not_found');
    const custom = channel.snippet.customUrl;
    return {
      platform: 'youtube',
      handle: custom?.startsWith('@') ? custom : checked.handle,
      externalId: channel.id,
      displayName: channel.snippet.title || checked.handle,
      avatarUrl: pickThumbnail(channel.snippet.thumbnails, ['default', 'medium', 'high']),
      uploadsListId: channel.contentDetails.relatedPlaylists.uploads,
    };
  }

  async list(
    channel: ChannelRef,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    assertListKind('youtube', query.kind);
    if (query.sort === 'views') throw new ListingFailure('list_sort_unsupported');
    const uploads = await this.uploadsListOf(channel, signal);

    const params: Record<string, string> = {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: String(pageLimit(query.limit)),
    };
    if (query.cursor) params.pageToken = query.cursor;
    const playlist = this.parse(playlistSchema, await this.call('/playlistItems', params, signal));
    const ids = (playlist.items ?? []).map((item) => item.contentDetails.videoId);

    const items: ListedItem[] = [];
    if (ids.length > 0) {
      const videos = this.parse(
        videosSchema,
        await this.call(
          '/videos',
          {
            part: 'snippet,contentDetails,statistics,liveStreamingDetails',
            id: ids.join(','),
            maxResults: '50',
          },
          signal,
        ),
      );
      const byId = new Map((videos.items ?? []).map((video) => [video.id, video]));
      // Playlist order is newest first; a private or deleted video is simply absent.
      for (const id of ids) {
        const video = byId.get(id);
        if (!video) continue;
        const item = toItem(video);
        if (belongsTo(query.kind, item, video.liveStreamingDetails !== undefined)) items.push(item);
      }
    }

    const page: ChannelPage = { items };
    if (playlist.nextPageToken) page.nextCursor = playlist.nextPageToken;
    return page;
  }

  /** The uploads list: kept on the channel, derived from a `UC...` id, or found by the handle. */
  private async uploadsListOf(channel: ChannelRef, signal?: AbortSignal): Promise<string> {
    if (channel.uploadsListId) return channel.uploadsListId;
    if (UC_ID.test(channel.externalId)) return `UU${channel.externalId.slice(2)}`;
    const resolved = await this.resolve(channel.handle, signal);
    if (!resolved.uploadsListId) throw new ListingFailure('platform_changed');
    return resolved.uploadsListId;
  }

  /** One call: the day's budget first (one unit), then the request, then the status. */
  private async call(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const day = pacificDay(this.now());
    const spentKey = `clips:youtube:units:${day}`;
    const outKey = `clips:youtube:out:${day}`;
    if ((await this.options.redis.get(outKey)) !== null)
      throw new ListingFailure('quota_exhausted');
    // Kept two days so a key read near midnight still has its count.
    const spent = await this.options.redis.incrementWithTtl(spentKey, 2 * 24 * 60 * 60);
    if (spent > YOUTUBE_DAILY_UNITS) throw new ListingFailure('quota_exhausted');

    const query = new URLSearchParams({ ...params, key: this.options.apiKey }).toString();
    const response = await this.options.http({ url: `${API}${path}?${query}`, signal });
    if (response.status === 200) return response.json;
    throw await this.failureFor(response, outKey);
  }

  private async failureFor(response: ListerHttpResponse, outKey: string): Promise<ListingFailure> {
    const parsed = errorSchema.safeParse(response.json);
    const reasons = parsed.success
      ? (parsed.data.error?.errors ?? []).map((error) => error.reason ?? '')
      : [];
    if (reasons.some((reason) => QUOTA_REASONS.has(reason)) || response.status === 429) {
      // Spent for today on Google's side: stop asking until the Pacific midnight.
      await this.options.redis.set(outKey, '1', Math.max(60, secondsToPacificMidnight(this.now())));
      return new ListingFailure('quota_exhausted');
    }
    if (
      reasons.some((reason) => KEY_REASONS.has(reason)) ||
      response.status === 401 ||
      response.status === 403
    ) {
      return new ListingFailure('lister_unconfigured');
    }
    if (response.status === 404) return new ListingFailure('channel_not_found');
    if (response.status === 400) return new ListingFailure('platform_changed');
    return new ListingFailure('channel_listing_failed');
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ListingFailure('platform_changed');
    return parsed.data;
  }
}

type VideoRow = NonNullable<z.infer<typeof videosSchema>['items']>[number];

function toItem(video: VideoRow): ListedItem {
  const live = video.snippet.liveBroadcastContent;
  const isStream = video.liveStreamingDetails !== undefined;
  const durationSec = parseIso8601Duration(video.contentDetails?.duration);
  const views = Number(video.statistics?.viewCount);
  let state: ListedItem['state'] = 'ready';
  if (live === 'live') state = 'live';
  else if (live === 'upcoming') state = 'upcoming';
  // A finished stream with no length yet is still being processed.
  else if (isStream && (durationSec === null || durationSec === 0)) state = 'processing';

  let kind: ListedItem['kind'] = 'upload';
  if (isStream) kind = 'vod';
  else if (durationSec !== null && durationSec > 0 && durationSec <= SHORT_MAX_SECONDS)
    kind = 'short';

  return {
    externalId: video.id,
    kind,
    title: video.snippet.title,
    publishedAt: video.liveStreamingDetails?.actualStartTime ?? video.snippet.publishedAt,
    durationSec: state === 'ready' ? durationSec : null,
    viewCount: Number.isSafeInteger(views) && views >= 0 ? views : null,
    thumbnailUrl: pickThumbnail(video.snippet.thumbnails, ['medium', 'high', 'default']),
    state,
  };
}

function belongsTo(list: ChannelListQuery['kind'], item: ListedItem, isStream: boolean): boolean {
  if (list === 'streams') return isStream;
  if (list === 'shorts') return item.kind === 'short';
  return item.kind === 'upload';
}

function pickThumbnail(
  value: Record<string, { url?: string }> | undefined,
  order: readonly string[],
): string | null {
  for (const size of order) {
    const url = value?.[size]?.url;
    if (typeof url === 'string' && url.startsWith('https://') && url.length <= 2_048) return url;
  }
  return null;
}

/** The calendar day in Pacific time (YouTube's quota day), `YYYY-MM-DD`. */
export function pacificDay(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

/** Seconds until the next midnight in Pacific time. */
export function secondsToPacificMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = read('hour') * 3600 + read('minute') * 60 + read('second');
  return Math.max(1, 24 * 3600 - elapsed);
}
