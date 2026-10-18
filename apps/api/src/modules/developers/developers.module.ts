import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ChannelsModule } from '../channels/channels.module';
import { PostsModule } from '../posts/posts.module';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { ApiKeysRepository } from './api-keys/api-keys.repository';
import { ApiKeysService } from './api-keys/api-keys.service';
import { ApiKeyThrottlerGuard } from './auth/api-key-throttler.guard';
import { ApiKeyGuard } from './auth/api-key.guard';
import { V1AnalyticsController } from './v1/v1-analytics.controller';
import { V1ChannelsController } from './v1/v1-channels.controller';
import { V1MeController } from './v1/v1-me.controller';
import { V1MeService } from './v1/v1-me.service';
import { V1PostsController } from './v1/v1-posts.controller';

/**
 * Developers (Sprint 8, PRD 5.10): API keys, the `/v1` public API behind
 * them, the per-key throttle and the OpenAPI document.
 *
 * `/v1` is a second front door to three existing modules, not a second
 * implementation: posts, channels and analytics are imported for their
 * services and called with the workspace `ApiKeyGuard` resolved. Nothing
 * here reads their tables. The one table this module owns is `ApiKey`.
 *
 * The two guards are providers so `@UseGuards()` can resolve their
 * dependencies: the repository for `ApiKeyGuard`, and the global throttler
 * module's options and store for `ApiKeyThrottlerGuard`.
 *
 * `BillingModule` is deliberately not imported: `/v1/me` reads the plan
 * tier through the pure `plans.ts`; see `v1-me.service.ts`. The OpenAPI
 * document is served from `main.ts` (`openapi/setup-openapi.ts`), outside
 * the Nest router, so it is not a controller here.
 */
@Module({
  imports: [PostsModule, ChannelsModule, AnalyticsModule],
  controllers: [
    ApiKeysController,
    V1MeController,
    V1ChannelsController,
    V1PostsController,
    V1AnalyticsController,
  ],
  providers: [ApiKeysService, ApiKeysRepository, ApiKeyGuard, ApiKeyThrottlerGuard, V1MeService],
})
export class DevelopersModule {}
