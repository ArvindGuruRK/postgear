import { Module } from '@nestjs/common';
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

/**
 * Workflows (Sprint 10): the builder's rows and routes (Module 03) and the
 * connections its steps use (Module 04).
 *
 * `AutomationContextService` is exported because the run engine (Module 07)
 * and activation (09) build the same validation context;
 * `AutomationTriggers` is the hook activation fills in; `ConnectionsRepository`
 * carries `markConnectionBroken` for the steps that send (12 and 13).
 * `CONNECTION_OAUTH_PLUGINS` is empty until Google arrives in Module 13.
 * `SchedulingModule` gives `AutomationTriggers` the Temporal client for
 * schedules and for cancelling runs of a deleted workflow (Module 09); it
 * depends on nothing but config, so there is no cycle.
 */
@Module({
  imports: [SchedulingModule],
  controllers: [AutomationsController, ConnectionsController],
  providers: [
    AutomationsService,
    AutomationsRepository,
    AutomationContextService,
    AutomationTriggers,
    ConnectionsService,
    ConnectionsRepository,
    ConnectionOAuthService,
    { provide: CONNECTION_OAUTH_PLUGINS, useValue: [] satisfies OAuthConnectionPlugin[] },
  ],
  exports: [AutomationContextService, AutomationTriggers, ConnectionsRepository],
})
export class AutomationsModule {}
