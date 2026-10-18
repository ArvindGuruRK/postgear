/**
 * The safety net: every fifteen minutes, make sure every queued post and every
 * refreshable channel has its workflow.
 *
 * Started by the worker at boot under a fixed id, so there is exactly one of
 * it per namespace no matter how many workers run. It is itself durable: a
 * cron in the worker process would stop when the process did, which is the
 * one moment the safety net is for.
 *
 * `continueAsNew` every ninety-six iterations (a day) keeps the history short.
 */
import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { reconcileSchedules } = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 5,
  },
});

export const RECONCILE_INTERVAL = '15 minutes';
const ITERATIONS_PER_RUN = 96;

export async function maintenanceWorkflow(): Promise<void> {
  for (let iteration = 0; iteration < ITERATIONS_PER_RUN; iteration++) {
    try {
      await reconcileSchedules();
    } catch {
      // A reconcile that fails after its own retries is tried again next
      // interval; the net must keep running regardless.
    }

    await sleep(RECONCILE_INTERVAL);
  }

  await continueAsNew<typeof maintenanceWorkflow>();
}
