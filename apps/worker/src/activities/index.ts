/**
 * Every activity the worker registers, built from one set of dependencies.
 *
 * Workflows import only the *type* of this object (`import type`), which the
 * bundler erases — so nothing here, Prisma included, is ever pulled into the
 * workflow sandbox.
 */
import { createAnalyticsActivities } from './analytics.activities';
import type { ActivityDeps } from './deps';
import { createIntegrationActivities } from './integration.activities';
import { createMaintenanceActivities } from './maintenance.activities';
import { createPublishActivities } from './publish.activities';
import { createWebhookActivities } from './webhook.activities';

export type { AnalyticsSchedule, AnalyticsSyncResult } from './analytics.activities';
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
    ...createIntegrationActivities(deps),
    ...createAnalyticsActivities(deps),
    ...createMaintenanceActivities(deps),
    ...createWebhookActivities(deps),
  };
}

export type Activities = ReturnType<typeof createActivities>;
