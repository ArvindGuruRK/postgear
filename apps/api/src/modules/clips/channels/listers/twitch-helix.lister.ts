/**
 * `TwitchHelixLister` (Module 03, section 5; research 11, section 3): Twitch
 * channels through the official Helix API with an app token.
 *
 * - **Token**: client credentials from `id.twitch.tv` (no person logs in),
 *   kept in Redis until a day before it expires, one fetch at a time per
 *   process. A 401 drops it and the call is tried once more with a new one.
 *   Bad keys read as `lister_unconfigured`, so the selector falls back to the
 *   flat list instead of failing.
 * - **Calls**: `Get Users` (name to id), `Get Videos` with `type=archive`
 *   (past streams), `Get Clips` (sorted by views by Twitch), 50 a page, and on
 *   the first page of past streams one `Get Streams` to mark the stream that
 *   is still live. `muted_segments` is always null with an app token, so
 *   muted videos are not flagged here; they surface at Import.
 * - **Rate limit**: when `Ratelimit-Remaining` drops under a fifth of
 *   `Ratelimit-Limit` (80 percent used), or on a 429, Twitch is paused until
 *   `Ratelimit-Reset` (at most a minute) and every call in that time is
 *   `platform_rate_limited`, which the selector answers from the flat list.
 * - **Never logged**: the client secret, the token, or an address.
 */
import type {
  ChannelLister,
  ChannelListQuery,
  ChannelPage,
  ChannelRef,
  ListedItem,
} from '@postgear/video-engine';
import {
  assertListKind,
  pageLimit,
  twitchArchiveExpiry,
  validateHandle,
} from '@postgear/video-engine';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RedisService } from '../../../redis/redis.service';
import { parseHelixDuration } from './durations';
import type { ListerHttp, ListerHttpResponse } from './lister-http';
import { ListingFailure } from './listing-failure';

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const DAY_SECONDS = 24 * 60 * 60;
const PAUSE_KEY = 'clips:twitch:pause';
/** Stop at 80 percent of the bucket: pause when less than a fifth is left. */
const REMAINING_FLOOR = 0.2;
const MAX_PAUSE_SECONDS = 60;
const THUMB_WIDTH = '320';
const THUMB_HEIGHT = '180';
const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;

const tokenSchema = z.object({
  access_token: z.string().min(1).max(512),
  expires_in: z.number().int().positive(),
});

const usersSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().regex(/^\d{1,20}$/),
      login: z.string(),
      display_name: z.string(),
      broadcaster_type: z.string().optional(),
      profile_image_url: z.string().optional(),
    }),
  ),
});

const pagination = z.object({ cursor: z.string().max(512).optional() }).optional();

const videosSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      stream_id: z.string().nullable().optional(),
      title: z.string(),
      created_at: z.string(),
      published_at: z.string().optional(),
      thumbnail_url: z.string(),
      view_count: z.number().int().nonnegative(),
      duration: z.string(),
      type: z.string().optional(),
    }),
  ),
  pagination,
});

const clipsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      created_at: z.string(),
      thumbnail_url: z.string(),
      view_count: z.number().int().nonnegative(),
      duration: z.number().nonnegative(),
    }),
  ),
  pagination,
});

const streamsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export interface TwitchHelixOptions {
  clientId: string;
  clientSecret: string;
  http: ListerHttp;
  redis: Pick<RedisService, 'get' | 'set' | 'delete'>;
  now?: () => number;
}

export class TwitchHelixLister implements ChannelLister {
  readonly platform = 'twitch' as const;
  private readonly now: () => number;
  private readonly tokenKey: string;
  private tokenFlight: Promise<string> | null = null;

  constructor(private readonly options: TwitchHelixOptions) {
    this.now = options.now ?? Date.now;
    // Named after the client id (hashed), so new keys never use an old token.
    const id = createHash('sha256').update(options.clientId).digest('hex').slice(0, 12);
    this.tokenKey = `clips:twitch:token:${id}`;
  }

  async resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef> {
    const checked = validateHandle('twitch', handle);
    if (!checked.ok) throw new ListingFailure('channel_not_found');
    const user = await this.userByLogin(checked.handle, signal);
    const ref: ChannelRef = {
      platform: 'twitch',
      handle: user.login.toLowerCase(),
      externalId: user.id,
      displayName: user.display_name || user.login,
      avatarUrl: httpsOrNull(user.profile_image_url),
    };
    if (user.broadcaster_type !== undefined) ref.broadcasterType = user.broadcaster_type;
    return ref;
  }

  async list(
    channel: ChannelRef,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    assertListKind('twitch', query.kind);
    const userId = /^\d{1,20}$/.test(channel.externalId)
      ? channel.externalId
      : (await this.userByLogin(channel.handle, signal)).id;
    const first = String(pageLimit(query.limit));
    return query.kind === 'clips'
      ? this.clips(channel, userId, first, query, signal)
      : this.pastStreams(channel, userId, first, query, signal);
  }

  private async pastStreams(
    channel: ChannelRef,
    userId: string,
    first: string,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    const params: Record<string, string> = {
      user_id: userId,
      type: 'archive',
      first,
      sort: query.sort === 'views' ? 'views' : 'time',
    };
    if (query.cursor) params.after = query.cursor;
    const answer = this.parse(videosSchema, await this.helix('/videos', params, signal));

    // Only the newest page can hold the stream that is still going.
    let liveStreamId: string | null = null;
    if (!query.cursor && query.sort !== 'views') {
      const live = this.parse(
        streamsSchema,
        await this.helix('/streams', { user_id: userId, type: 'live' }, signal),
      );
      liveStreamId = live.data[0]?.id ?? null;
    }

    const items = answer.data.map((video): ListedItem => {
      const publishedAt = video.published_at || video.created_at;
      const live = liveStreamId !== null && video.stream_id === liveStreamId;
      const thumbnail = sizedThumbnail(video.thumbnail_url);
      const item: ListedItem = {
        externalId: video.id,
        kind: 'vod',
        title: video.title,
        publishedAt,
        durationSec: parseHelixDuration(video.duration),
        viewCount: video.view_count,
        thumbnailUrl: thumbnail,
        // A past broadcast with no picture yet is still being processed.
        state: live ? 'live' : thumbnail === null ? 'processing' : 'ready',
      };
      const expiresAt = twitchArchiveExpiry(publishedAt, channel.broadcasterType);
      if (expiresAt) item.expiresAt = expiresAt;
      return item;
    });
    return withCursor(items, answer.pagination?.cursor);
  }

  private async clips(
    channel: ChannelRef,
    userId: string,
    first: string,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    const params: Record<string, string> = { broadcaster_id: userId, first };
    if (query.cursor) params.after = query.cursor;
    if (query.period && query.period !== 'all') {
      const end = this.now();
      params.started_at = new Date(
        end - PERIOD_DAYS[query.period] * DAY_SECONDS * 1000,
      ).toISOString();
      params.ended_at = new Date(end).toISOString();
    }
    const answer = this.parse(clipsSchema, await this.helix('/clips', params, signal));
    const items = answer.data.map(
      (clip): ListedItem => ({
        externalId: clip.id,
        kind: 'clip',
        title: clip.title,
        publishedAt: clip.created_at,
        durationSec: Math.round(clip.duration * 10) / 10,
        viewCount: clip.view_count,
        thumbnailUrl: httpsOrNull(clip.thumbnail_url),
        state: 'ready',
        channel: channel.handle,
      }),
    );
    return withCursor(items, answer.pagination?.cursor);
  }

  private async userByLogin(login: string, signal?: AbortSignal) {
    const answer = this.parse(usersSchema, await this.helix('/users', { login }, signal));
    const user = answer.data[0];
    if (!user) throw new ListingFailure('channel_not_found');
    return user;
  }

  /** One Helix call: paused check, token, one retry on 401, rate-limit bookkeeping, status mapping. */
  private async helix(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if ((await this.options.redis.get(PAUSE_KEY)) !== null) {
      throw new ListingFailure('platform_rate_limited');
    }
    const url = `${HELIX}${path}?${new URLSearchParams(params).toString()}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
      const response = await this.options.http({
        url,
        headers: { 'Client-Id': this.options.clientId, Authorization: `Bearer ${token}` },
        signal,
      });
      await this.noteBucket(response);

      if (response.status === 200) return response.json;
      if (response.status === 401 && attempt === 0) {
        await this.options.redis.delete(this.tokenKey);
        continue;
      }
      throw this.failureFor(response.status);
    }
    throw new ListingFailure('lister_unconfigured');
  }

  private failureFor(status: number): ListingFailure {
    if (status === 429) return new ListingFailure('platform_rate_limited');
    // A malformed login fails the whole call; we checked it first, so this is a miss.
    if (status === 400 || status === 404) return new ListingFailure('channel_not_found');
    if (status === 401 || status === 403) return new ListingFailure('lister_unconfigured');
    return new ListingFailure('channel_listing_failed');
  }

  /** Pauses Twitch until the bucket refills once 80 percent of it is used, or on a 429. */
  private async noteBucket(response: ListerHttpResponse): Promise<void> {
    const limit = Number(response.header('ratelimit-limit'));
    const remaining = Number(response.header('ratelimit-remaining'));
    const nearlyEmpty =
      Number.isFinite(limit) &&
      limit > 0 &&
      Number.isFinite(remaining) &&
      remaining < limit * REMAINING_FLOOR;
    if (!nearlyEmpty && response.status !== 429) return;
    const reset = Number(response.header('ratelimit-reset'));
    const wait = Number.isFinite(reset) ? Math.ceil(reset - this.now() / 1000) : MAX_PAUSE_SECONDS;
    await this.options.redis.set(PAUSE_KEY, '1', Math.min(MAX_PAUSE_SECONDS, Math.max(1, wait)));
  }

  /** The app token from Redis, or a new one (one fetch at a time in this process). */
  private async token(fresh: boolean): Promise<string> {
    if (!fresh) {
      const cached = await this.options.redis.get(this.tokenKey);
      if (cached) return cached;
    }
    if (!this.tokenFlight) {
      this.tokenFlight = this.fetchToken().finally(() => {
        this.tokenFlight = null;
      });
    }
    return this.tokenFlight;
  }

  private async fetchToken(): Promise<string> {
    const response = await this.options.http({
      url: TOKEN_URL,
      method: 'POST',
      form: {
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'client_credentials',
      },
    });
    if (response.status === 429) throw new ListingFailure('platform_rate_limited');
    if (response.status >= 400 && response.status < 500)
      throw new ListingFailure('lister_unconfigured');
    const parsed = tokenSchema.safeParse(response.json);
    if (response.status !== 200 || !parsed.success)
      throw new ListingFailure('channel_listing_failed');

    const { access_token: token, expires_in: expiresIn } = parsed.data;
    // Kept until a day before it expires; a short-lived token is kept for half its life.
    const keep =
      expiresIn > 2 * DAY_SECONDS
        ? expiresIn - DAY_SECONDS
        : Math.max(60, Math.floor(expiresIn / 2));
    await this.options.redis.set(this.tokenKey, token, keep);
    return token;
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ListingFailure('platform_changed');
    return parsed.data;
  }
}

/** Helix's picture template at the one size it serves (320 by 180); empty means none yet. */
function sizedThumbnail(template: string): string | null {
  if (template.length === 0) return null;
  return httpsOrNull(template.replace('%{width}', THUMB_WIDTH).replace('%{height}', THUMB_HEIGHT));
}

function httpsOrNull(address: string | undefined): string | null {
  return typeof address === 'string' && address.startsWith('https://') && address.length <= 2_048
    ? address
    : null;
}

function withCursor(items: ListedItem[], cursor: string | undefined): ChannelPage {
  const page: ChannelPage = { items };
  // Helix sends a cursor on the last page too; an empty page ends the list.
  if (cursor && items.length > 0) page.nextCursor = cursor;
  return page;
}
