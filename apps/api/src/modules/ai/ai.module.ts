import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { MediaService } from '../media/media.service';
import { PostsModule } from '../posts/posts.module';
import { RedisService } from '../redis/redis.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CreditsRepository } from './credits/credits.repository';
import { CreditsService } from './credits/credits.service';
import { createAiEngine } from './engine/engine.factory';
import { AI_ENGINE } from './engine/engine.types';

/**
 * The AI content engine and copilot (Sprint 6).
 *
 * Depends on channels (what a generation targets, what the copilot can list
 * and draft to), posts (the copilot's drafts go through `PostsService`, so
 * every rule a draft is held to applies) and media (generated images become
 * library items). `RedisService` arrives through the global `RedisModule`.
 *
 * The engine is a provider behind a token, built once from the environment,
 * so the service never knows which mode it has and a test hands it a fake —
 * the same pattern as the scheduling module's Temporal connection.
 */
@Module({
  imports: [ChannelsModule, MediaModule, PostsModule],
  controllers: [AiController],
  providers: [
    AiService,
    CreditsService,
    CreditsRepository,
    {
      provide: AI_ENGINE,
      inject: [ConfigService, RedisService, MediaService],
      useFactory: (config: ConfigService<Env, true>, redis: RedisService, media: MediaService) =>
        createAiEngine({ config, redis, media }),
    },
  ],
})
export class AiModule {}
