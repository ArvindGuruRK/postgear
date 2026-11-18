/**
 * The list cache: fresh copies answer without a fetch, an older one is
 * fetched again, a failed fetch falls back to a copy of at most 24 hours, an
 * older copy is never answered, one fetch per key, and a refresh stamp makes
 * every page of the channel not fresh. Redis is the real service's
 * in-process fallback; the cache's clock is ours.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ChannelPage } from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';
import {
  ChannelListCache,
  type CachedListPage,
  LIST_FRESH_MS,
  LIST_MAX_AGE_MS,
} from './channel-list.cache';
import { ListingFailure } from './listers/listing-failure';

const KEY = 'clipch:twitch:1234:streams:newest:-:';
const STAMP = 'clipch:stamp:twitch:1234';
const PAGE: ChannelPage = { items: [], nextCursor: '51' };

function setup() {
  let now = Date.parse('2026-11-18T12:00:00.000Z');
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const cache = new ChannelListCache(
    redis,
    () => now,
    async () => undefined,
  );
  const fetch = jest.fn(async () => ({ page: PAGE, source: 'official' as const }));
  return {
    redis,
    cache,
    fetch,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
    store: async (ageMs: number) => {
      const entry: CachedListPage = {
        fetchedAt: new Date(now - ageMs).toISOString(),
        source: 'flat',
        page: { items: [] },
      };
      await redis.set(KEY, JSON.stringify(entry), 24 * 60 * 60);
    },
  };
}

beforeAll(() => Logger.overrideLogger(false));

describe('ChannelListCache', () => {
  it('fetches once, then answers from the cache while fresh', async () => {
    const { cache, fetch, advance } = setup();
    const first = await cache.load(KEY, STAMP, fetch);
    expect(first.stale).toBe(false);
    advance(LIST_FRESH_MS - 1_000);
    const second = await cache.load(KEY, STAMP, fetch);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches again after ten minutes', async () => {
    const { cache, fetch, advance } = setup();
    await cache.load(KEY, STAMP, fetch);
    advance(LIST_FRESH_MS + 1_000);
    await cache.load(KEY, STAMP, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers an older copy, marked stale, when the new fetch fails', async () => {
    const { cache, store } = setup();
    await store(3 * 60 * 60 * 1000);
    const failing = jest.fn(async () => {
      throw new ListingFailure('platform_rate_limited');
    });
    const loaded = await cache.load(KEY, STAMP, failing);
    expect(loaded.stale).toBe(true);
    expect(loaded.source).toBe('flat');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('never answers a copy older than 24 hours', async () => {
    const { cache, store } = setup();
    await store(LIST_MAX_AGE_MS + 60_000);
    const failing = jest.fn(async () => {
      throw new ListingFailure('channel_listing_failed');
    });
    await expect(cache.load(KEY, STAMP, failing)).rejects.toMatchObject({
      code: 'channel_listing_failed',
    });
  });

  it('shares one fetch between callers asking for the same key at once', async () => {
    const { cache } = setup();
    let release: () => void = () => undefined;
    const fetch = jest.fn(
      () =>
        new Promise<{ page: ChannelPage; source: 'official' }>((resolve) => {
          release = () => resolve({ page: PAGE, source: 'official' });
        }),
    );
    const callers = Array.from({ length: 10 }, () => cache.load(KEY, STAMP, fetch));
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const answers = await Promise.all(callers);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Set(answers.map((answer) => answer.fetchedAt)).size).toBe(1);
  });

  it('treats every copy fetched before a refresh as not fresh', async () => {
    const { cache, fetch, advance } = setup();
    await cache.load(KEY, STAMP, fetch);
    advance(1_000);
    await cache.dropChannel(STAMP);
    advance(1_000);
    await cache.load(KEY, STAMP, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('replaces a copy it cannot read instead of serving it', async () => {
    const { cache, fetch, redis } = setup();
    await redis.set(KEY, '{"fetchedAt":"yesterday"', 60);
    const loaded = await cache.load(KEY, STAMP, fetch);
    expect(loaded.stale).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
