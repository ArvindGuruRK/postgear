/**
 * `clipRuntimeCheckWorkflow` (Module 02): one activity that answers the
 * worker's video tools from its cached doctor. Started by `GET /clips/status`
 * with a per-minute id (`USE_EXISTING`), so many open pages share one run,
 * and waited on for at most `CLIP_RUNTIME_CHECK_WAIT_MS`.
 *
 * Sprint 13 (Module 01): it also asks the Python media service through
 * Temporal (`mediaPyHealth` on `postgear-media-py`, four seconds at most), in
 * parallel with the doctor, and adds the answer as `mediaPy`. A Python
 * service that does not answer is `ok: false`, never a failed check: the
 * video tools still report as they did.
 *
 * No retry: a check that fails is answered as "not running" by the API, and
 * the next minute asks again.
 */
import { MEDIA_CONTRACT_VERSION } from '@postgear/media-contract/names';
import type { ClipMediaPyReport, ClipRuntimeReport } from '@postgear/scheduling';
import { patched, proxyActivities } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';
import { mediaPyHealth } from '../../clips/media-py';

const { clipRuntimeCheck } = proxyActivities<ClipActivities>({
  // The doctor can run a one-line render; a cached answer is instant.
  startToCloseTimeout: '9 seconds',
  scheduleToCloseTimeout: '9 seconds',
  retry: { maximumAttempts: 1 },
});

/** The answer when the Python service did not reply. */
export const MEDIA_PY_OFF: ClipMediaPyReport = Object.freeze({
  ok: false,
  simulation: null,
  contractVersion: null,
  serviceVersion: null,
  bindings: {},
});

async function askMediaPy(): Promise<ClipMediaPyReport> {
  try {
    const health = await mediaPyHealth({ version: MEDIA_CONTRACT_VERSION });
    return {
      ok: health.contractVersion === MEDIA_CONTRACT_VERSION,
      simulation: health.simulation,
      contractVersion: health.contractVersion,
      serviceVersion: health.serviceVersion,
      bindings: Object.fromEntries(
        Object.entries(health.bindings).map(([name, binding]) => [name, binding.state]),
      ),
    };
  } catch {
    return MEDIA_PY_OFF;
  }
}

export async function clipRuntimeCheckWorkflow(): Promise<ClipRuntimeReport> {
  if (!patched('media-py-health')) return clipRuntimeCheck();
  const [report, mediaPy] = await Promise.all([clipRuntimeCheck(), askMediaPy()]);
  return { ...report, mediaPy };
}
