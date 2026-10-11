/**
 * Keeps one channel's access token alive.
 *
 * Sleeps until thirty minutes before `Integration.tokenExpiration`, refreshes,
 * reads the new expiry, and sleeps again — for as long as the channel exists
 * and can be refreshed. The reference's equivalent waits until the exact
 * expiry; refreshing early means a post due at the moment the token dies finds
 * a live one.
 *
 * Like the publish workflow, it re-reads the row after every sleep, so a
 * disconnect, a reconnect (which issues a fresh token and a new expiry) or a
 * manual refresh from the Channels page are all picked up without any
 * coordination beyond a `wake` signal.
 *
 * The loop ends when a refresh fails: the activity has flagged the channel as
 * needing reconnection, and reconnecting starts a new run with the new token.
 */
import {
  condition,
  continueAsNew,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import { type TokenRefreshInput, WAKE_SIGNAL } from '@postgear/scheduling';
import type { Activities } from '../activities';

export const wakeSignal = defineSignal(WAKE_SIGNAL);

const { loadIntegrationSchedule, refreshChannelToken } = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 10,
  },
});

/**
 * A refresh that yields a token with no later expiry would otherwise loop
 * immediately; this is the least it waits before refreshing again.
 */
const MIN_GAP_MS = 6 * 60 * 60_000;

/** Refreshes before the history is rolled over into a fresh run. */
const REFRESHES_PER_RUN = 50;

export type TokenRefreshOutcome =
  | 'gone'
  | 'needs_reconnect'
  | 'not_set_up'
  | 'no_refresh_token'
  | 'no_expiry'
  | 'refresh_failed';

export async function tokenRefreshWorkflow(input: TokenRefreshInput): Promise<TokenRefreshOutcome> {
  // Counted, for the reason the publish workflow gives: a wake during the read
  // must interrupt the wait that follows.
  let wakes = 0;
  setHandler(wakeSignal, () => {
    wakes += 1;
  });

  let refreshes = 0;
  let lastRefreshAt: number | null = null;

  for (;;) {
    const wakesBeforeRead = wakes;
    const schedule = await loadIntegrationSchedule(input);

    if (schedule.status === 'skip') {
      return schedule.reason;
    }

    let refreshAt = new Date(schedule.refreshAt).getTime();

    if (lastRefreshAt !== null && refreshAt < lastRefreshAt + MIN_GAP_MS) {
      refreshAt = lastRefreshAt + MIN_GAP_MS;
    }

    const delay = refreshAt - Date.now();

    if (delay > 0) {
      const interrupted = await condition(() => wakes !== wakesBeforeRead, delay);

      if (interrupted) {
        continue;
      }
    }

    log.info('refreshing channel token', { integrationId: input.integrationId });

    if (!(await refreshChannelToken(input))) {
      return 'refresh_failed';
    }

    lastRefreshAt = Date.now();
    refreshes += 1;

    if (refreshes >= REFRESHES_PER_RUN) {
      await continueAsNew<typeof tokenRefreshWorkflow>(input);
    }
  }
}
