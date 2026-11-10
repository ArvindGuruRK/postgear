/**
 * Stale-while-revalidate over Redis, with a single-flight lock.
 *
 * This is what makes the module free to run. An entry is shared by everyone who
 * asks for that place, so one Chennai fetch serves every Chennai workspace, and it
 * has two windows: a short one in which it is simply the answer, and a long one in
 * which it is answered at once while a fresh copy is fetched behind the scenes. A
 * person only ever waits on a place nobody has asked about for hours.
 *
 * ## The lock is never released, only left to expire
 *
 * It says "someone is fetching this". After a successful fetch nobody reads it,
 * because the entry is fresh. After a failed one, leaving it in place is the point:
 * a struggling source gets one attempt per lock window for each place, whoever asks.
 * That also removes the classic race of deleting a lock a later holder now owns.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export const LOCK_SECONDS = 20;
const WAIT_FOR_HOLDER_MS = 3_000;
const WAIT_POLL_MS = 250;

export interface CacheEntry {
  /** ISO 8601. */
  fetchedAt: string;
}

export interface LoadOptions<T extends CacheEntry> {
  /** How long this entry counts as fresh. An entry with a failure in it can say less. */
  freshMs: (entry: T) => number;
  keepSeconds: number;
  /** The fetch. Gets the old copy, so a part that fails can keep what it had. */
  refresh: (previous: T | null) => Promise<T>;
  /** Runs only when nothing is cached, before anything else happens. May throw to refuse. */
  beforeMiss?: () => Promise<void>;
}

/** `missing` means the holder did not finish in time, and nothing else is to hand. */
export type LoadState = 'fresh' | 'stale' | 'missing';

export interface Loaded<T> {
  entry: T | null;
  state: LoadState;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class DiscoverCache {
  private readonly logger = new Logger(DiscoverCache.name);

  constructor(private readonly redis: RedisService) {}

  async load<T extends CacheEntry>(key: string, options: LoadOptions<T>): Promise<Loaded<T>> {
    const cached = await this.read<T>(key);

    if (cached) {
      if (Date.now() - Date.parse(cached.fetchedAt) < options.freshMs(cached)) {
        return { entry: cached, state: 'fresh' };
      }
      if (await this.takeLock(key)) {
        // Nobody waits for this one, so its failure can only be logged.
        void this.fetchAndStore(key, cached, options).catch((error: unknown) => {
          this.logger.warn(
            JSON.stringify({
              event: 'discover.feed.refresh_failed',
              key,
              reason: error instanceof Error ? error.name : 'unknown',
            }),
          );
        });
      }
      return { entry: cached, state: 'stale' };
    }

    await options.beforeMiss?.();

    if (await this.takeLock(key)) {
      return { entry: await this.fetchAndStore(key, null, options), state: 'fresh' };
    }

    const arrived = await this.waitForHolder<T>(key);
    return arrived ? { entry: arrived, state: 'fresh' } : { entry: null, state: 'missing' };
  }

  private takeLock(key: string): Promise<boolean> {
    return this.redis.setIfAbsent(`discover:lock:${key}`, '1', LOCK_SECONDS);
  }

  private async fetchAndStore<T extends CacheEntry>(
    key: string,
    previous: T | null,
    options: LoadOptions<T>,
  ): Promise<T> {
    const entry = await options.refresh(previous);
    await this.redis.set(key, JSON.stringify(entry), options.keepSeconds);
    return entry;
  }

  private async waitForHolder<T extends CacheEntry>(key: string): Promise<T | null> {
    const deadline = Date.now() + WAIT_FOR_HOLDER_MS;
    while (Date.now() < deadline) {
      await sleep(WAIT_POLL_MS);
      const entry = await this.read<T>(key);
      if (entry) return entry;
    }
    return null;
  }

  /** A copy that cannot be read is the same as no copy: it gets replaced, not served. */
  private async read<T extends CacheEntry>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    try {
      const entry = JSON.parse(raw) as T;
      return Number.isNaN(Date.parse(entry.fetchedAt)) ? null : entry;
    } catch {
      return null;
    }
  }
}
