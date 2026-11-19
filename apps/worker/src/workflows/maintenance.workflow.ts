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
 * Sprint 12: each pass also asks the API to reconcile clip jobs (lost
 * starts, gone workflows), behind `patched('clips-reconcile')`.
 *
 * Sprint 12, Module 19: each pass also asks the API to sweep Clips (expiry
 * notices and removals, short-lived files, abandoned uploads, the charge
 * backstop, the storage notice, and once a day orphan files and ended
 * overrides), behind `patched('clips-sweep')`.
 *
 * Sprint 12, Module 19: each pass also starts posters and lengths for up to
 * twenty older Media videos (`mediaVideoFactsWorkflow` on the media queue),
 * behind `patched('media-video-facts')`.
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

/**
 * Sprint 12: the API's Clips reconcile, one short call. It never throws (a
 * pass that could not run is tried again next interval), so one attempt.
 */
const { clipsReconcile } = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 1 },
});

/**
 * Module 19: the API's Clips sweep. Bounded batches keep it short; it never
 * throws, so one attempt (the next pass carries on where this one stopped).
 */
const { clipsSweep } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 1 },
});

/**
 * Module 19: one query and at most twenty workflow starts; the FFmpeg work
 * runs on the media worker. Never throws, so one attempt (the next pass picks
 * up whatever this one did not).
 */
const { mediaVideoFactsBackfill } = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 1 },
});

export const RECONCILE_INTERVAL = '15 minutes';
const ITERATIONS_PER_RUN = 96;
export const AUTOMATION_PRUNE_PATCH = 'automation-run-prune';
export const DISCOVER_MAINTENANCE_PATCH = 'discover-maintenance';
export const CLIPS_RECONCILE_PATCH = 'clips-reconcile';
export const CLIPS_SWEEP_PATCH = 'clips-sweep';
export const MEDIA_VIDEO_FACTS_PATCH = 'media-video-facts';

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

    if (patched(CLIPS_RECONCILE_PATCH)) {
      try {
        await clipsReconcile();
      } catch {
        // Lost clip job starts wait for the next pass; the API's own settle starts most of them.
      }
    }

    if (patched(CLIPS_SWEEP_PATCH)) {
      try {
        await clipsSweep();
      } catch {
        // Expiry and cleanup wait for the next pass; every part is idempotent.
      }
    }

    if (patched(MEDIA_VIDEO_FACTS_PATCH)) {
      try {
        await mediaVideoFactsBackfill();
      } catch {
        // Older videos wait for the next pass; the library shows their first frame meanwhile.
      }
    }

    await sleep(RECONCILE_INTERVAL);
  }

  await continueAsNew<typeof maintenanceWorkflow>();
}
