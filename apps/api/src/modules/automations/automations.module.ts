import { Module } from '@nestjs/common';
import { AutomationContextService } from './automation-context.service';
import { AutomationTriggers } from './automation-triggers';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';

/**
 * Workflows (Sprint 10, Module 03): the builder's rows and routes.
 *
 * `AutomationContextService` is exported because connections (Module 04),
 * the run engine (07) and activation (09) build the same validation
 * context; `AutomationTriggers` is the hook activation fills in.
 */
@Module({
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationsRepository,
    AutomationContextService,
    AutomationTriggers,
  ],
  exports: [AutomationContextService, AutomationTriggers],
})
export class AutomationsModule {}
