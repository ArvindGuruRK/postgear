/**
 * `clipRuntimeCheckWorkflow` (Module 02): one activity that answers the
 * worker's video tools from its cached doctor. Started by `GET /clips/status`
 * with a per-minute id (`USE_EXISTING`), so many open pages share one run,
 * and waited on for at most `CLIP_RUNTIME_CHECK_WAIT_MS`.
 *
 * No retry: a check that fails is answered as "not running" by the API, and
 * the next minute asks again.
 */
import type { ClipRuntimeReport } from '@postgear/scheduling';
import { proxyActivities } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';

const { clipRuntimeCheck } = proxyActivities<ClipActivities>({
  // The doctor can run a one-line render; a cached answer is instant.
  startToCloseTimeout: '9 seconds',
  scheduleToCloseTimeout: '9 seconds',
  retry: { maximumAttempts: 1 },
});

export async function clipRuntimeCheckWorkflow(): Promise<ClipRuntimeReport> {
  return clipRuntimeCheck();
}
