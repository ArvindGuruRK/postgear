/**
 * My Channels (Module 03, section 5): add a Twitch, YouTube or Kick channel
 * and browse its public streams, videos and clips (metadata only), with the
 * official listers, the worker's flat fallback, a cache and throttles.
 *
 * The bindings are built once from the environment (`createListerSets`);
 * `LISTER_HTTP` may be overridden in a test module so nothing reaches the
 * network. Imports `ClipLinksModule` for the platform breaker the flat list
 * shares with the probe. Redis and config are global.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { EntitlementsModule } from '../../entitlements/entitlements.module';
import { RedisService } from '../../redis/redis.service';
import { SchedulingModule } from '../../scheduling/scheduling.module';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipLinksModule } from '../links/clip-links.module';
import { ClipPlatformBreaker } from '../links/platform-breaker';
import { ChannelListCache } from './channel-list.cache';
import { CHANNEL_LISTER_SETS, ChannelListerSelector } from './channel-lister.selector';
import { createListerSets } from './channel-listers.factory';
import { ClipChannelsController } from './clip-channels.controller';
import { ClipChannelsRepository } from './clip-channels.repository';
import { ClipChannelsService } from './clip-channels.service';

@Module({
  imports: [SchedulingModule, EntitlementsModule, ClipLinksModule],
  controllers: [ClipChannelsController],
  providers: [
    ClipChannelsRepository,
    ClipChannelsService,
    ChannelListerSelector,
    {
      provide: ChannelListCache,
      useFactory: (redis: RedisService) => new ChannelListCache(redis),
      inject: [RedisService],
    },
    {
      provide: CHANNEL_LISTER_SETS,
      useFactory: (
        config: ConfigService<Env, true>,
        scheduling: SchedulingService,
        redis: RedisService,
        breaker: ClipPlatformBreaker,
      ) => createListerSets({ config, scheduling, redis, breaker }),
      inject: [ConfigService, SchedulingService, RedisService, ClipPlatformBreaker],
    },
  ],
})
export class ClipChannelsModule {}
