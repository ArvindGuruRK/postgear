import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AutomationContextService } from './automation-context.service';
import { AutomationTriggers } from './automation-triggers';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';
import {
  CONNECTION_OAUTH_PLUGINS,
  ConnectionOAuthService,
  type OAuthConnectionPlugin,
} from './connections/connection-oauth.service';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsRepository } from './connections/connections.repository';
import { ConnectionsService } from './connections/connections.service';
import { googleClientFromConfig } from './connections/google/google-config';
import { GoogleHttp } from './connections/google/google-http';
import { GoogleOAuthPlugin } from './connections/google/google-oauth.plugin';
import { GoogleSheetsService } from './connections/google/google-sheets.service';
import { HookController } from './webhook/hook.controller';
import { HookThrottlerGuard } from './webhook/hook-throttler.guard';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookRepository } from './webhook/webhook.repository';
import { WebhookService } from './webhook/webhook.service';

/**
 * Workflows (Sprint 10): the builder's rows and routes (Module 03) and the
 * connections its steps use (Module 04).
 *
 * `AutomationContextService` is exported because the run engine (Module 07)
 * and activation (09) build the same validation context;
 * `AutomationTriggers` is the hook activation fills in; `ConnectionsRepository`
 * carries `markConnectionBroken` for the steps that send (12 and 13).
 * `CONNECTION_OAUTH_PLUGINS` holds Google (Module 13) when a real client id
 * and secret are configured, else nothing (Connect then answers
 * `unavailable`). Module 13 also adds the Sheets helpers the step panel
 * uses and the Webhook trigger (its private link and its panel).
 * `SchedulingModule` gives `AutomationTriggers` the Temporal client for
 * schedules and for cancelling runs of a deleted workflow (Module 09); it
 * depends on nothing but config, so there is no cycle.
 */
@Module({
  imports: [SchedulingModule],
  controllers: [AutomationsController, ConnectionsController, WebhookController, HookController],
  providers: [
    AutomationsService,
    AutomationsRepository,
    AutomationContextService,
    AutomationTriggers,
    ConnectionsService,
    ConnectionsRepository,
    ConnectionOAuthService,
    GoogleHttp,
    GoogleSheetsService,
    {
      provide: CONNECTION_OAUTH_PLUGINS,
      inject: [ConfigService, GoogleHttp],
      useFactory: (config: ConfigService<Env, true>, http: GoogleHttp): OAuthConnectionPlugin[] => {
        const client = googleClientFromConfig(config);
        return client ? [new GoogleOAuthPlugin(client, http)] : [];
      },
    },
    WebhookService,
    WebhookRepository,
    HookThrottlerGuard,
  ],
  exports: [AutomationContextService, AutomationTriggers, ConnectionsRepository],
})
export class AutomationsModule {}
