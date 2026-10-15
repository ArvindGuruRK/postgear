/**
 * The throttler's counter store: Redis when there is one, memory when there
 * is not, and memory again for the duration of any Redis failure.
 *
 * `@nestjs/throttler` ships an in-process store and `@nest-lab/throttler-
 * storage-redis` a shared one. Neither degrades: with Redis configured, a
 * restart of the container turns every request into a 500 from inside the
 * guard. This wrapper applies the same rule `RedisService` does for the login
 * throttle — fail *open* to per-instance accuracy, never closed — because a
 * rate limit that is briefly per-process is a smaller failure than an API
 * that refuses everyone while Redis comes back.
 */
import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');

  constructor(
    private readonly primary: ThrottlerStorage | null,
    private readonly fallback: ThrottlerStorage,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.primary) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    try {
      return await this.primary.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (error) {
      this.logger.error(
        `Redis throttle store failed, counting in-process instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
