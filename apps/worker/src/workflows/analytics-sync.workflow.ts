/**
 * Keeps one channel's metrics current: a sync a day, or one now.
 *
 * Shaped like the refresh loop. It re-reads the channel before every sync,
 * so a disconnect, a reconnect or a channel disabled from the Channels
 * page is picked up at the next slot with no coordination; the loop ends
 * when the read says the channel cannot be synced as it stands, and the
 * maintenance reconcile starts a fresh run once it can be again.
 *
 * ## "Sync now" is a signal, counted
 *
 * The signal handler increments a counter rather than setting a flag, for
 * the reason the publish workflow gives: a click that lands while the
 * schedule is being read must still interrupt the wait that follows. A
 * request is honoured at once, but never within two minutes of the last
 * attempt. Clicks inside that window coalesce into one sync at the end of
 * it, which is what a person repeatedly pressing the button wants, and is
 * what keeps a stuck button from hammering a platform.
 *
 * ## Why the workflow keeps its own last-attempt time
 *
 * The database records when a sync last *succeeded*. A sync that failed
 * for good (a dead token the activity has already flagged) does not move
 * that, and a workflow that slept only until the database's slot would
 * wake at once and loop. So the slot is the later of the two: the
 * database's, and a day after this run's own last attempt.
 */

import {
  type AnalyticsSyncInput,
  type AnalyticsSyncSkipReason,
  SYNC_NOW_SIGNAL,
} from '@postgear/scheduling';
import {
  condition,
  continueAsNew,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { Activities } from '../activities';
import { nextSyncSlot, SYNC_NOW_MIN_GAP_MS } from '../lib/analytics-slot';

export const syncNowSignal = defineSignal(SYNC_NOW_SIGNAL);

const { loadAnalyticsSchedule, syncChannelAnalytics } = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '1 minute',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 5,
  },
});

/** Syncs before the history is rolled over into a fresh run: a month at one a day. */
const SYNCS_PER_RUN = 30;

export type AnalyticsSyncOutcome = AnalyticsSyncSkipReason;

export async function analyticsSyncWorkflow(
  input: AnalyticsSyncInput,
): Promise<AnalyticsSyncOutcome> {
  let requests = 0;
  setHandler(syncNowSignal, () => {
    requests += 1;
  });

  let handled = 0;
  let syncs = 0;
  let lastAttemptAt: number | null = null;

  for (;;) {
    const schedule = await loadAnalyticsSchedule(input);

    if (schedule.status === 'skip') {
      return schedule.reason;
    }

    const now = Date.now();
    let dueAt = Math.max(
      new Date(schedule.nextSyncAt).getTime(),
      lastAttemptAt === null ? 0 : nextSyncSlot(lastAttemptAt, input.integrationId, now),
    );

    if (requests > handled) {
      handled = requests;
      dueAt = Math.min(dueAt, Math.max(now, (lastAttemptAt ?? 0) + SYNC_NOW_MIN_GAP_MS));
    }

    const delay = dueAt - now;

    if (delay > 0) {
      const interrupted = await condition(() => requests > handled, delay);

      if (interrupted) {
        continue;
      }
    }

    lastAttemptAt = Date.now();
    log.info('syncing channel analytics', { integrationId: input.integrationId });

    try {
      await syncChannelAnalytics(input);
    } catch (error) {
      // The activity's retry policy is spent. The row already says why; the
      // next slot is a day away and the loop must keep running until then.
      log.warn('channel analytics sync failed after retries', {
        integrationId: input.integrationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    syncs += 1;

    if (syncs >= SYNCS_PER_RUN) {
      await continueAsNew<typeof analyticsSyncWorkflow>(input);
    }
  }
}
