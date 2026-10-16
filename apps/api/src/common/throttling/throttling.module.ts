import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Env } from '../../config/env';
import { RedisService } from '../../modules/redis/redis.service';
import { AppThrottlerGuard } from './app-throttler.guard';
import { ResilientThrottlerStorage } from './resilient-throttler.storage';

/** One minute, the window every ceiling in `.env.example` is stated per. */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * Rate limiting (Sprint 8, PRD 5.12): `@nestjs/throttler` with a Redis store
 * shared by every API instance, as the sprint document recommends.
 *
 * One named throttler, `default`, is the per-address ceiling applied
 * globally by `AppThrottlerGuard`. The public API's per-key ceiling is a
 * second guard in the developers module that reuses this module's store and
 * options — which is why the module is `@Global()` and re-exports
 * `ThrottlerModule`: a guard applied with `@UseGuards()` resolves its
 * dependencies from the module its controller lives in.
 *
 * The login throttle (`LoginThrottleGuard`) keeps its own counters: it has
 * a tighter budget and deliberately omits `Retry-After`.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService<Env, true>, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: THROTTLE_WINDOW_MS,
            limit: config.get('RATE_LIMIT_PER_MIN', { infer: true }),
          },
        ],
        storage: new ResilientThrottlerStorage(
          redis.rawClient ? new ThrottlerStorageRedisService(redis.rawClient) : null,
          new ThrottlerStorageService(),
        ),
        errorMessage: 'Too many requests. Please slow down and try again.',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
  exports: [ThrottlerModule],
})
export class ThrottlingModule {}
