import { Module } from '@nestjs/common';
import { SchedulingModule } from '../../scheduling/scheduling.module';
import { AutomationsModule } from '../automations.module';
import { AutomationRunEventsService } from './automation-run-events.service';
import { AutomationRunsController } from './automation-runs.controller';
import { AutomationRunsRepository } from './automation-runs.repository';
import { AutomationRunsService } from './automation-runs.service';
import { AutomationTestRunsController } from './automation-test-runs.controller';

/**
 * Workflow runs from the API side (Sprint 10, Module 07): test runs, step
 * tests, run history, live progress, cancel and review. The worker runs
 * them (`apps/worker`); this module writes the rows and starts or signals
 * `automationRunWorkflow` through `SchedulingService`.
 *
 * Its own module beside `AutomationsModule`, which it imports for
 * `AutomationContextService` (the validation context a test is checked
 * against). `RedisService` (the per-person test throttle) is global.
 */
@Module({
  imports: [AutomationsModule, SchedulingModule],
  controllers: [AutomationTestRunsController, AutomationRunsController],
  providers: [AutomationRunsService, AutomationRunEventsService, AutomationRunsRepository],
})
export class AutomationRunsModule {}
