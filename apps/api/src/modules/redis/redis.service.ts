import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * A tiny counter/KV store over Redis, with an in-process fallback.
 *
 * Only the operations rate limiting and OAuth state actually need are exposed
 * — `incrementWithTtl`, `get`, `set`, `delete` — rather than the whole ioredis
 * surface. Keeping it narrow is what makes the in-memory fallback tractable.
 *
 * ## What the fallback is and is not
 *
 * When `REDIS_URL` is unset the service uses a `Map` so the API still boots
 * without `docker compose up`. That fallback is **single-process and
 * non-durable**: with more than one API instance each gets its own counters,
 * so a per-IP limit of 10 becomes 10 *per instance*. It is a development
 * convenience, and it logs a warning saying so at startup.
 *
 * This is exactly why account lockout does **not** live here. Lockout state is
 * on the `User` row in Postgres, because losing it — to an eviction, a
 * restart, or a second instance — would be a silent bypass of the control.
 * Losing an IP counter merely resets a one-minute window.
 */

interface CounterStore {
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

@Injectable()
export class RedisService implements CounterStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');

    if (!url) {
      this.client = null;
      this.logger.warn(
        'REDIS_URL is not set — rate limiting is using an in-process store. ' +
          'Counters are per-instance and lost on restart. Do not run production this way.',
      );
      return;
    }

    this.client = new Redis(url, {
      // Fail fast instead of queueing commands forever behind a dead server:
      // a request that is waiting on a rate-limit check is a request the user
      // is watching a spinner for.
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });

    this.client.on('error', (error: Error) => {
      // Logged, not thrown. `callWithFallback` degrades each individual
      // operation to the in-memory path, so a Redis outage slows the throttle
      // down to per-instance accuracy rather than taking the API down.
      this.logger.error(`Redis error: ${error.message}`);
    });
  }

  /**
   * Increments a counter, setting its TTL on first write only.
   *
   * The TTL must not be refreshed on every increment or the window becomes a
   * sliding one that never expires under sustained load — an attacker hitting
   * the endpoint continuously would stay throttled forever, and, worse, a
   * legitimate user sharing a NAT with them never recovers.
   */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    return this.callWithFallback(
      async (client) => {
        const count = await client.incr(key);
        if (count === 1) {
          await client.expire(key, ttlSeconds);
        }
        return count;
      },
      () => {
        const existing = this.readMemory(key);
        const count = existing ? Number(existing) + 1 : 1;
        const expiresAt = existing
          ? (this.memory.get(key)?.expiresAt ?? Date.now() + ttlSeconds * 1000)
          : Date.now() + ttlSeconds * 1000;
        this.memory.set(key, { value: String(count), expiresAt });
        return count;
      },
    );
  }

  async get(key: string): Promise<string | null> {
    return this.callWithFallback(
      (client) => client.get(key),
      () => this.readMemory(key),
    );
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.callWithFallback(
      async (client) => {
        await client.set(key, value, 'EX', ttlSeconds);
      },
      () => {
        this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      },
    );
  }

  async delete(key: string): Promise<void> {
    await this.callWithFallback(
      async (client) => {
        await client.del(key);
      },
      () => {
        this.memory.delete(key);
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  /**
   * Runs against Redis when it is available, and falls back to the in-memory
   * store on any failure.
   *
   * Failing *open* here is the right trade only because of what these counters
   * gate: a degraded rate limit is worse than a perfect one but far better
   * than a login endpoint that returns 500 for everyone because Redis is
   * restarting. The control that must never fail open — account lockout —
   * deliberately does not use this class.
   */
  private async callWithFallback<T>(
    withRedis: (client: Redis) => Promise<T>,
    withMemory: () => T,
  ): Promise<T> {
    if (!this.client) {
      return withMemory();
    }

    try {
      return await withRedis(this.client);
    } catch (error) {
      this.logger.error(
        `Redis operation failed, falling back to in-process store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return withMemory();
    }
  }

  /** Reads from the fallback map, honouring the TTL lazily. */
  private readMemory(key: string): string | null {
    const entry = this.memory.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }

    return entry.value;
  }
}
