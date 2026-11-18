/**
 * The clip job workflows (Modules 04 and 05), each keyed `clip-job:<jobId>`
 * and started by the API after it wrote the `ClipJob` row:
 *
 * - `clipImportWorkflow` (`postgear-media`): one `clipImport` activity.
 * - `clipSegmentWorkflow` (`postgear-media`): one `clipSegment` activity.
 * - `clipRenderWorkflow` (`postgear-render`): waits while the clip's sharp
 *   range is still being fetched (a short look, then a durable timer, for at
 *   most `RENDER_SEGMENT_WAIT_MS`; after that it renders from whatever is
 *   there, the light copy at worst), then one `clipRender` activity.
 *
 * Cancel, timeouts, retries and the failure bookkeeping are in `clip-job.ts`.
 * Activities run on the workflow's own queue.
 */
import type { ClipJobWorkflowInput } from '@postgear/scheduling';
import { proxyActivities, sleep } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';
import { type ClipJobOutcome, runClipJob, workActivities } from './clip-job';

/** How often the export looks again at a running sharp range. */
export const RENDER_SEGMENT_POLL_MS = 10_000;
/** The longest an export waits for a sharp range before it uses what it has. */
export const RENDER_SEGMENT_WAIT_MS = 15 * 60_000;

const look = proxyActivities<ClipActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 3 },
});

export async function clipImportWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'IMPORT', () => workActivities('IMPORT').clipImport(input));
}

export async function clipSegmentWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'SEGMENT', () => workActivities('SEGMENT').clipSegment(input));
}

export async function clipRenderWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'RENDER', async () => {
    const waitStartedAt = Date.now();
    for (let first = true; ; first = false) {
      const state = await look.clipRenderWaitState({ ...input, first });
      if (state.closed) return { status: 'closed' };
      if (!state.segmentRunning || Date.now() - waitStartedAt >= RENDER_SEGMENT_WAIT_MS) break;
      await sleep(RENDER_SEGMENT_POLL_MS);
    }
    // Budget read after the wait, so the render gets what is really left.
    return workActivities('RENDER').clipRender(input);
  });
}
