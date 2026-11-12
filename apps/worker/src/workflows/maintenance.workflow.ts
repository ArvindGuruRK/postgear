/**
 * The safety net: every fifteen minutes, make sure every queued post and every
 * refreshable channel has its workflow.
 *
 * Started by the worker at boot under a fixed id, so there is exactly one of
 * it per namespace no matter how many workers run. It is itself durable: a
 * cron in the worker process would stop when the process did, which is the
 * one moment the safety net is for.
 *
 * Sprint 10, Module 09: each pass also prunes finished workflow runs older
 * than 30 days. That step is new to a workflow that is always running, so
 * it sits behind `patched`: a history recorded before it replays unchanged.
 *
 * Sprint 11, Module 10: each pass also asks the API for Discover's jobs
 * (pre-warm the places people look at in their morning, refresh competitors,
 * send Monday's digests), behind a `patched` of its own for the same reason.
 *
 * `continueAsNew` every ninety-six iterations (a day) keeps the history short.
 */
import { continueAsNew, patched, proxyActivities, sleep } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { reconcileSchedules, pruneAutomationRuns } = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 5,
  },
});

/**
 * Discover's jobs run three calls to the API, each up to five minutes; one
 * attempt only, since the next pass is fifteen minutes away and every job
 * decides for itself what is due.
 */
const { discoverMaintenance } = proxyActivities<Activities>({
  startToCloseTimeout: '16 minutes',
  heartbeatTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

export const RECONCILE_INTERVAL = '15 minutes';
const ITERATIONS_PER_RUN = 96;
export const AUTOMATION_PRUNE_PATCH = 'automation-run-prune';
export const DISCOVER_MAINTENANCE_PATCH = 'discover-maintenance';

export async function maintenanceWorkflow(): Promise<void> {
  for (let iteration = 0; iteration < ITERATIONS_PER_RUN; iteration++) {
    try {
      await reconcileSchedules();
    } catch {
      // A reconcile that fails after its own retries is tried again next
      // interval; the net must keep running regardless.
    }

    if (patched(AUTOMATION_PRUNE_PATCH)) {
      try {
        await pruneAutomationRuns();
      } catch {
        // Old runs wait for the next pass; nothing depends on them going now.
      }
    }

    if (patched(DISCOVER_MAINTENANCE_PATCH)) {
      try {
        await discoverMaintenance();
      } catch {
        // Warm copies and digests wait for the next pass; nothing else depends on them.
      }
    }

    await sleep(RECONCILE_INTERVAL);
  }

  await continueAsNew<typeof maintenanceWorkflow>();
}
