/**
 * The channel list cache (Module 03, section 5; research 11, section 7).
 *
 * - **Key**: `clipch:<platform>:<externalId>:<kind>:<sort>:<period>:<cursor>`,
 *   shared by every workspace that added the channel (it is public metadata).
 * - **Fresh** for ten minutes: answered without asking any binding.
 * - **Older**: fetched again. If that fails, the old copy is answered for up
 *   to 24 hours with `stale: true` and its `updatedAt`, so the page can say
 *   "Updated N hours ago". A copy older than 24 hours is never answered (the
 *   Twitch developer agreement allows caching for 24 hours only; YouTube's
 *   limit is longer), and Redis drops it at that age anyway.
 * - **One fetch per key**: concurrent callers in this process share one
 *   promise, and a Redis lock makes other instances wait for its result
 *   instead of fetching too, so ten open tabs cost one call.
 * - **Refresh**: a stamp per channel (`clipch:stamp:<platform>:<externalId>`);
 *   any copy fetched before it counts as not fresh. That drops every page of
 *   the channel at once without listing keys.
 */
import { Logger } from '@nestjs/common';
import type { ChannelPage, ClipPlatformId } from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';
import type { ListingSource } from './channel-lister.selector';

export const LIST_FRESH_MS = 10 * 60 * 1000;
export const LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEEP_SECONDS = LIST_MAX_AGE_MS / 1000;
/** Held while one instance fetches; longer than the slowest fetch (the flat list's 25 s wait). */
const LOCK_SECONDS = 45;
const WAIT_FOR_HOLDER_MS = 30_000;
const WAIT_POLL_MS = 250;

export interface CachedListPage {
  /** ISO time the binding answered. */
  fetchedAt: string;
  source: ListingSource;
  page: ChannelPage;
}

export interface LoadedListPage extends CachedListPage {
  /** True when this is an older copy answered because a new fetch failed. */
  stale: boolean;
}

export interface ListCacheKeyParts {
  platform: ClipPlatformId;
  externalId: string;
  kind: string;
  sort: string;
  period: string;
  /** Empty for the first page. */
  cursor: string;
}

export function listCacheKey(parts: ListCacheKeyParts): string {
  return [
    'clipch',
    parts.platform,
    parts.externalId,
    parts.kind,
    parts.sort,
    parts.period,
    parts.cursor,
  ].join(':');
}

export function channelStampKey(platform: ClipPlatformId, externalId: string): string {
  return `clipch:stamp:${platform}:${externalId}`;
}

export class ChannelListCache {
  private readonly logger = new Logger(ChannelListCache.name);
  private readonly inFlight = new Map<string, Promise<LoadedListPage>>();

  constructor(
    private readonly redis: RedisService,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /**
   * The page under `key`: fresh from the cache, or fetched with `fetch`, or
   * (when that fails) an older copy within 24 hours. Throws the fetch's error
   * when there is no copy to fall back on.
   */
  async load(
    key: string,
    stampKey: string,
    fetch: () => Promise<{ page: ChannelPage; source: ListingSource }>,
  ): Promise<LoadedListPage> {
    const [cached, stamp] = await Promise.all([this.read(key), this.readStamp(stampKey)]);
    if (cached && this.isFresh(cached, stamp)) return { ...cached, stale: false };

    const running = this.inFlight.get(key);
    if (running) return running;
    const work = this.refresh(key, stampKey, cached, stamp, fetch).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, work);
    return work;
  }

  /** Marks every cached page of a channel as not fresh. */
  async dropChannel(stampKey: string): Promise<void> {
    await this.redis.set(stampKey, new Date(this.now()).toISOString(), KEEP_SECONDS);
  }

  private async refresh(
    key: string,
    stampKey: string,
    cached: CachedListPage | null,
    stamp: number,
    fetch: () => Promise<{ page: ChannelPage; source: ListingSource }>,
  ): Promise<LoadedListPage> {
    const lockKey = `${key}:lock`;
    const locked = await this.redis.setIfAbsent(lockKey, '1', LOCK_SECONDS);
    if (!locked) {
      // Another instance is fetching this key: wait for its copy.
      const arrived = await this.waitForHolder(key, stampKey);
      if (arrived) return { ...arrived, stale: false };
      if (cached && this.isUsable(cached)) return { ...cached, stale: true };
    }

    try {
      const fetched = await fetch();
      const entry: CachedListPage = {
        fetchedAt: new Date(this.now()).toISOString(),
        source: fetched.source,
        page: fetched.page,
      };
      await this.redis.set(key, JSON.stringify(entry), KEEP_SECONDS);
      return { ...entry, stale: false };
    } catch (error) {
      if (cached && this.isUsable(cached)) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.channels.stale_served',
            ageMinutes: Math.round((this.now() - Date.parse(cached.fetchedAt)) / 60_000),
            refreshedSince: stamp > Date.parse(cached.fetchedAt),
          }),
        );
        return { ...cached, stale: true };
      }
      throw error;
    } finally {
      if (locked) await this.redis.delete(lockKey);
    }
  }

  private async waitForHolder(key: string, stampKey: string): Promise<CachedListPage | null> {
    const deadline = this.now() + WAIT_FOR_HOLDER_MS;
    while (this.now() < deadline) {
      await this.sleep(WAIT_POLL_MS);
      const [entry, stamp] = await Promise.all([this.read(key), this.readStamp(stampKey)]);
      if (entry && this.isFresh(entry, stamp)) return entry;
      // The holder finished (lock gone) without a fresh copy: stop waiting.
      if ((await this.redis.get(`${key}:lock`)) === null) return null;
    }
    return null;
  }

  private isFresh(entry: CachedListPage, stamp: number): boolean {
    const fetchedAt = Date.parse(entry.fetchedAt);
    return this.now() - fetchedAt < LIST_FRESH_MS && fetchedAt >= stamp;
  }

  /** Within the 24 hour limit: the only copies ever answered. */
  private isUsable(entry: CachedListPage): boolean {
    return this.now() - Date.parse(entry.fetchedAt) <= LIST_MAX_AGE_MS;
  }

  private async readStamp(stampKey: string): Promise<number> {
    const raw = await this.redis.get(stampKey);
    const time = raw === null ? Number.NaN : Date.parse(raw);
    return Number.isNaN(time) ? 0 : time;
  }

  /** A copy that cannot be read is no copy: it is replaced, never served. */
  private async read(key: string): Promise<CachedListPage | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      const entry = JSON.parse(raw) as CachedListPage;
      if (
        typeof entry.fetchedAt !== 'string' ||
        Number.isNaN(Date.parse(entry.fetchedAt)) ||
        (entry.source !== 'official' && entry.source !== 'flat') ||
        !Array.isArray(entry.page?.items)
      ) {
        return null;
      }
      return this.isUsable(entry) ? entry : null;
    } catch {
      return null;
    }
  }
}
