/**
 * Every activity the worker registers, built from one set of dependencies.
 *
 * Workflows import only the *type* of this object (`import type`), which the
 * bundler erases, so nothing here, Prisma included, is ever pulled into the
 * workflow sandbox.
 */
import { createAnalyticsActivities } from './analytics.activities';
import { createAutomationActivities } from './automation.activities';
import type { ActivityDeps } from './deps';
import { createIntegrationActivities } from './integration.activities';
import { createMaintenanceActivities } from './maintenance.activities';
import { createPublishActivities } from './publish.activities';
import { createRepeatActivities } from './repeat.activities';
import { createWebhookActivities } from './webhook.activities';

export type { NextOccurrenceResult } from '../lib/next-occurrence';
export type {
  AutomationActivities,
  FinishRunInput,
  NodeRunResult,
  RunPlan,
  RunRef,
  SettleFailureInput,
  StepRef,
} from '../automation/activity-contract';
export type { AnalyticsSchedule, AnalyticsSyncResult } from './analytics.activities';
export type { AutomationActivityOptions } from './automation.activities';
export type { ActivityDeps } from './deps';
export type { IntegrationSchedule } from './integration.activities';
export type { ReconcileReport } from './maintenance.activities';
export type {
  MarkPublishFailedInput,
  PublishJob,
  PublishResult,
  RecordPublishedInput,
} from './publish.activities';
export type { DeliverWebhookResult, MarkWebhookDeliveryFailedInput } from './webhook.activities';

export function createActivities(deps: ActivityDeps) {
  return {
    ...createPublishActivities(deps),
    // 2026-10-19: the next occurrence of a repeating post.
    ...createRepeatActivities(deps),
    ...createIntegrationActivities(deps),
    ...createAnalyticsActivities(deps),
    ...createMaintenanceActivities(deps),
    ...createWebhookActivities(deps),
    // Sprint 10: workflow runs (the Workflow Builder).
    ...createAutomationActivities(deps),
  };
}

export type Activities = ReturnType<typeof createActivities>;
