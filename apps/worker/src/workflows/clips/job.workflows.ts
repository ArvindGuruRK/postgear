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
 * - `clipSpeechWorkflow` (`postgear-media`, Sprint 13 Module 09): prepare,
 *   `mediaPySpeak` (Python), finish; see the function.
 * - `clipAutoEditWorkflow` (`postgear-media`, Sprint 13 Module 10): one
 *   `clipAutoEdit` activity (wait for the listen job, then the API makes the
 *   clip with the recipe applied).
 * - `clipEmoteWorkflow` (`postgear-media`, Sprint 13 Module 14): one
 *   `emoteExport` activity (every size of one emote down its ladder); a
 *   failure or a cancel empties its folder and gives the download back.
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
  MEDIA_PY_TIMINGS,
} from '@postgear/scheduling';
import { isCancellation, log, proxyActivities, sleep } from '@temporalio/workflow';
import type { ClipActivities } from '../../clips/activities';
import { mediaPyWork } from '../../clips/media-py';
import { type ClipJobOutcome, runClipJob, workActivities, workBudgetMs } from './clip-job';

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

/**
 * Find Clips. Sprint 12's run (and a setup without Look For Action) is one
 * `clipHighlights` step. With Look For Action (Sprint 13, Module 06) the
 * first step stops after gathering, and the workflow goes on: the motion
 * measure (`mediaPyMotion`, Python), the look (bursts, and which stills to
 * cut), the stills (`mediaPyStills`, Python, only with the vision check on),
 * then the finish (the still check, scoring, files deleted).
 *
 * A failed motion measure is not a failed run: it goes on without action and
 * the finish gives that step's minutes back. Failed stills leave the bursts
 * unchecked. A cancel anywhere is a cancel; `runClipJob` books it and the
 * bookkeeping deletes every watch file.
 */
export async function clipHighlightsWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'HIGHLIGHTS', async () => {
    const first = await workActivities('HIGHLIGHTS').clipHighlights(input);
    if (first.status !== 'watch') return first;

    let motionKey: string | null = null;
    let motionFailed = false;
    if (first.motion) {
      try {
        const measure = mediaPyWork(
          'mediaPyMotion',
          MEDIA_PY_TIMINGS.mediaPyMotion,
          workBudgetMs('HIGHLIGHTS'),
        );
        motionKey = (await measure(first.motion)).trackKey;
      } catch (error) {
        if (isCancellation(error)) throw error;
        log.warn('clip motion measure failed', { jobId: input.jobId, error: String(error) });
        motionFailed = true;
      }
    }

    const look = await workActivities('HIGHLIGHTS').clipHighlightsLook({
      ...input,
      motionKey,
      motionFailed,
    });
    if (look.status === 'closed') return { status: 'closed' };

    let stillKeys: string[] | null = null;
    if (look.stills) {
      try {
        const cut = mediaPyWork(
          'mediaPyStills',
          MEDIA_PY_TIMINGS.mediaPyStills,
          workBudgetMs('HIGHLIGHTS'),
        );
        stillKeys = (await cut(look.stills)).keys;
      } catch (error) {
        if (isCancellation(error)) throw error;
        log.warn('clip stills failed', { jobId: input.jobId, error: String(error) });
      }
    }
    return workActivities('HIGHLIGHTS').clipHighlightsFinish({ ...input, stillKeys });
  });
}

/**
 * Sprint 13, Module 02: listening (`postgear-media`). Three steps: prepare
 * (rows, here), `mediaPyTranscribe` (the Python service, on
 * `postgear-media-py`), finish (merge and store, here). A failure or a cancel
 * of any step is booked by `runClipJob`, which gives the AI minutes back.
 */
export async function clipTranscribeWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'TRANSCRIBE', async () => {
    const prepared = await look.clipTranscribePrepare(input);
    if (prepared.status === 'closed') return { status: 'closed' };
    const listen = mediaPyWork(
      'mediaPyTranscribe',
      MEDIA_PY_TIMINGS.mediaPyTranscribe,
      workBudgetMs('TRANSCRIBE'),
    );
    const heard = await listen(prepared.payload);
    return workActivities('TRANSCRIBE').clipTranscribeFinish({ ...input, heard });
  });
}

/**
 * Sprint 13, Module 07: finding faces (`postgear-media`). Free. Three steps:
 * prepare (here), `mediaPyDetectFaces` (Python), finish (keep the face file
 * as the video's asset, here). A failure or a cancel of any step is booked by
 * `runClipJob`, whose bookkeeping deletes a face file Python already wrote.
 */
export async function clipFacesWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'FACES', async () => {
    const prepared = await look.clipFacesPrepare(input);
    if (prepared.status === 'closed') return { status: 'closed' };
    const detect = mediaPyWork(
      'mediaPyDetectFaces',
      MEDIA_PY_TIMINGS.mediaPyDetectFaces,
      workBudgetMs('FACES'),
    );
    const found = await detect(prepared.payload);
    return workActivities('FACES').clipFacesFinish({ ...input, found });
  });
}

/**
 * Sprint 13, Module 09: Text To Speech (`postgear-media`), behind
 * `CLIPS_TTS`. Three steps: prepare (the line stored as the job's text file,
 * here), `mediaPySpeak` (Python: the WAV), finish (the editor's `.m4a` kept
 * as the workspace's own sound, here). A failure or a cancel of any step is
 * booked by `runClipJob`, whose bookkeeping removes the job's three files
 * and gives the AI minutes back.
 */
export async function clipSpeechWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'SPEECH', async () => {
    const prepared = await look.clipSpeechPrepare(input);
    if (prepared.status === 'closed') return { status: 'closed' };
    const speak = mediaPyWork(
      'mediaPySpeak',
      MEDIA_PY_TIMINGS.mediaPySpeak,
      workBudgetMs('SPEECH'),
    );
    const spoken = await speak(prepared.payload);
    return workActivities('SPEECH').clipSpeechFinish({ ...input, spoken });
  });
}

/**
 * Sprint 13, Module 10: Auto-Edit Video (`postgear-media`). One activity:
 * stage `listening` waits for the video's listen job (heartbeating; a listen
 * job that failed or was cancelled fails this one with `transcribe_failed`,
 * never retried, and no clip is made), then stage `applying` asks the API to
 * make the whole-video clip with the recipe (idempotent on the job's
 * `clipId`, so the second attempt is safe). No charge of its own; a cancel is
 * booked by `runClipJob` like every clip job (the API cancels the listen job
 * it started).
 */
export async function clipAutoEditWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'AUTO_EDIT', () => workActivities('AUTO_EDIT').clipAutoEdit(input));
}

/** Sprint 13, Module 14: one Emote Maker export press (no AI minutes, one download unit). */
export async function clipEmoteWorkflow(input: ClipJobWorkflowInput): Promise<ClipJobOutcome> {
  return runClipJob(input, 'EMOTE', () => workActivities('EMOTE').emoteExport(input));
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
