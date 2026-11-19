/**
 * The clip job workflows (Modules 04 and 05), each keyed `clip-job:<jobId>`
 * and started by the API after it wrote the `ClipJob` row:
 *
 * - `clipImportWorkflow` (`postgear-media`): one `clipImport` activity.
 * - `clipSegmentWorkflow` (`postgear-media`): one `clipSegment` activity.
 * - `clipHighlightsWorkflow` (`postgear-media`, Module 16): one
 *   `clipHighlights` activity (loudness, scenes, chat, scoring); a failure or
 *   a cancel gives the AI minutes back in the bookkeeping.
 * - `clipRenderWorkflow` (`postgear-render`): waits while the clip's sharp
 *   range is still being fetched (a short look, then a durable timer, for at
 *   most `RENDER_SEGMENT_WAIT_MS`; after that it renders from whatever is
 *   there, the light copy at worst), then one `clipRender` activity.
 *
 * - `clipDownloadWorkflow` (`postgear-media`, Module 18): one `clipDownload`
 *   activity; a failure or a cancel empties its folder and gives back both
 *   charges in the bookkeeping.
 * - `clipSaveDownloadWorkflow` (`postgear-media`, Module 18), keyed
 *   `clip-save-download:<jobId>`: Save To Media on a finished download. Not
 *   a job of its own (no cancel, no settle): one `clipSaveDownload` activity,
 *   and `clipSaveDownloadFailed` when it fails for good.
 *
 * Cancel, timeouts, retries and the failure bookkeeping are in `clip-job.ts`.
 * Activities run on the workflow's own queue.
 */
import {
  CLIP_FAILURE_TYPES,
  CLIP_HEARTBEAT_MS,
  CLIP_SAVE_DOWNLOAD_ATTEMPT_MS,
  CLIP_SAVE_DOWNLOAD_WORK_MS,
  type ClipJobWorkflowInput,
} from '@postgear/scheduling';
import { log, proxyActivities, sleep } from '@temporalio/workflow';
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

export async function clipHighlightsWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'HIGHLIGHTS', () => workActivities('HIGHLIGHTS').clipHighlights(input));
}

export async function clipDownloadWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'DOWNLOAD', () => workActivities('DOWNLOAD').clipDownload(input));
}

/**
 * Save To Media's copy: two tries a minute apart, both inside
 * `CLIP_SAVE_DOWNLOAD_WORK_MS`, so the workflow (limited to
 * `CLIP_SAVE_DOWNLOAD_TIMEOUT_MS`) is always still there to run the failure
 * bookkeeping. One try that used most of the workflow's time left the second
 * to be cut off by the execution limit, and the row said "Saving" for ever.
 */
const saveWork = proxyActivities<ClipActivities>({
  startToCloseTimeout: CLIP_SAVE_DOWNLOAD_ATTEMPT_MS,
  scheduleToCloseTimeout: CLIP_SAVE_DOWNLOAD_WORK_MS,
  heartbeatTimeout: 2 * CLIP_HEARTBEAT_MS,
  retry: {
    initialInterval: '1 minute',
    maximumAttempts: 2,
    nonRetryableErrorTypes: [CLIP_FAILURE_TYPES.permanent],
  },
});

const saveBookkeeping = proxyActivities<ClipActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 4 },
});

export async function clipSaveDownloadWorkflow(
  input: ClipJobWorkflowInput,
): Promise<'saved' | 'failed'> {
  try {
    await saveWork.clipSaveDownload(input);
    return 'saved';
  } catch (error) {
    log.warn('clip save to media failed', { jobId: input.jobId, error: String(error) });
    await saveBookkeeping.clipSaveDownloadFailed(input).catch((cleanupError: unknown) => {
      log.warn('clip save to media bookkeeping failed', {
        jobId: input.jobId,
        error: String(cleanupError),
      });
    });
    return 'failed';
  }
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
