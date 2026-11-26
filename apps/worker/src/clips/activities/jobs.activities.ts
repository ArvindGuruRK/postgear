/**
 * The activities behind the clip job workflows (Modules 04 and 05).
 *
 * Work (one activity per job, all its steps inside one scratch folder, so no
 * file has to survive a worker restart; see `import.steps.ts`):
 * - `clipImport` (`postgear-media`): fetch, inspect, normalise, derive, store.
 * - `clipSegment` (`postgear-media`): the sharp range of a clip.
 * - `clipHighlights` (`postgear-media`, Module 16): Find Clips' measuring,
 *   scoring and the new clips (`highlights/highlights.run.ts`).
 * - `clipRender` (`postgear-render`): prepare, render, finish.
 * - `clipRenderWaitState` (`postgear-render`): one short look at the job and
 *   at the clip's running SEGMENT job; the workflow sleeps between looks.
 * - `clipDownload` (`postgear-media`, Module 18): fetch the chosen format,
 *   MP3 for Audio Only, store it for 24 hours (`download/download.run.ts`).
 * - `clipSaveDownload` and `saveDownloadFailed` (`postgear-media`, Module 18):
 *   Save To Media on a finished download (`download/save-download.run.ts`).
 *
 * Bookkeeping (run by the workflow after the work finally failed or was
 * cancelled, in a non-cancellable scope; see `job-outcomes.ts`):
 * - `clipJobFailed`, `clipJobCancelled`, `clipJobSettled`.
 *
 * Every work activity first moves the job to RUNNING; a job that was closed
 * meanwhile (the API cancelled a job whose workflow it could not reach, or
 * the reconcile failed it) answers `closed` and the workflow ends quietly.
 */
import * as path from 'node:path';
import {
  assertFreeDisk,
  makePoster,
  measureFileLoudness,
  measureLoudness,
  mp3Args,
  probeFile,
  probeSound,
  readOutputFacts,
  renderClip,
  runFfmpeg,
  withScratch,
} from '@postgear/media-tools';
import type {
  MediaPyDetectFacesInput,
  MediaPyDetectFacesOutput,
  MediaPyMotionInput,
  MediaPyStillsInput,
  MediaPyTranscribeInput,
  MediaPyTranscribeOutput,
} from '@postgear/media-contract';
import type { ClipJobWorkflowInput } from '@postgear/scheduling';
import { downloadOutputSchema } from '@postgear/video-engine';
import { type ActivityRun, runClipActivity } from '../activity-kit';
import type { ClipActivityDeps } from '../deps';
import { type DownloadTools, runDownload } from '../download/download.run';
import { runSaveDownload, saveDownloadFailed } from '../download/save-download.run';
import { finishFaces, prepareFaces } from '../faces/faces.run';
import { ClipStepError } from '../failures';
import {
  gatherHighlights,
  type HighlightsRun,
  readRunSetup,
  runHighlights,
} from '../highlights/highlights.run';
import { finishWatching, lookForAction, startWatching } from '../highlights/watch';
import { deleteQuietly, runImport } from '../import/import.steps';
import { type ImportTools, mediaImportTools } from '../import/import.tools';
import { cancelJob, failJob, type JobFailure, openJob } from '../job-outcomes';
import { JobClosedError, type JobProgress, jobProgress } from '../job-progress';
import { allImportKeys } from '../keys';
import { type RenderTools, runRender } from '../render/render.run';
import { type ClipRows, prismaClipRows } from '../rows';
import { runSegment } from '../segment/segment.run';
import { prismaSoundFileRows, type SoundFileRows } from '../sounds/rows';
import { prismaStickerFileRows, type StickerFileRows } from '../stickers/rows';
import { finishTranscribe, prepareTranscribe } from '../transcribe/transcribe.run';

/** What a work activity answers. `closed`: the job was closed by someone else; nothing was kept. */
export interface ClipWorkResult {
  status: 'done' | 'closed';
}

/** Sprint 13: what `clipTranscribePrepare` hands the workflow: the Python activity's input, or closed. */
export type TranscribePrepared =
  | { status: 'closed' }
  | { status: 'ready'; payload: MediaPyTranscribeInput };

/** Module 07: what `clipFacesPrepare` hands the workflow: the Python activity's input, or closed. */
export type FacesPrepared =
  | { status: 'closed' }
  | { status: 'ready'; payload: MediaPyDetectFacesInput };

/**
 * Module 06: a Find Clips run's first step. `watch`: the run asks to Look For
 * Action, and this is the motion measure's input (null: the stored motion
 * track covers the stretch, or there is nothing to measure).
 */
export type HighlightsStep =
  | ClipWorkResult
  | { status: 'watch'; motion: MediaPyMotionInput | null };

/** Module 06: the look step's answer: the stills to cut, if any. */
export type HighlightsLook =
  | { status: 'closed'; stills: null }
  | { status: 'look'; stills: MediaPyStillsInput | null };

export interface RenderWaitState {
  /** The job is no longer open: the workflow ends quietly. */
  closed: boolean;
  /** A SEGMENT job of the same clip is still fetching the sharp range. */
  segmentRunning: boolean;
}

export interface ClipJobActivityOptions {
  rows?: ClipRows;
  /** Module 16: tests shorten the slow marker's hold. */
  sleep?: HighlightsRun['sleep'];
  /** The rows a clip's sticker files come from (tests pass their own). */
  stickerRows?: StickerFileRows;
  /** The rows a clip's sound files come from (tests pass their own). */
  soundRows?: SoundFileRows;
  importTools?: ImportTools;
  renderTools?: RenderTools;
  /** Module 18: the probes and the MP3 conversion (tests pass their own). */
  downloadTools?: DownloadTools;
  now?: () => Date;
}

/** QUEUED to RUNNING; false when the job was closed meanwhile. */
async function start(progress: JobProgress): Promise<boolean> {
  try {
    await progress.running();
    return true;
  } catch (error) {
    if (error instanceof JobClosedError) return false;
    throw error;
  }
}

export function createJobActivities(deps: ClipActivityDeps, options: ClipJobActivityOptions = {}) {
  const rows = options.rows ?? prismaClipRows;
  const now = options.now ?? (() => new Date());
  const importTools = options.importTools ?? mediaImportTools(deps.runTool);
  const renderTools: RenderTools = options.renderTools ?? {
    probe: (file, opts) => probeFile(deps.runTool, file, opts),
    render: (input) => renderClip({ ...input, runTool: deps.runTool }),
    poster: (opts) => makePoster({ ...opts, runTool: deps.runTool }),
    measure: (input) => measureLoudness({ ...input, runTool: deps.runTool }),
    measureFile: (input) => measureFileLoudness({ ...input, runTool: deps.runTool }),
    facts: (file, opts) => readOutputFacts(deps.runTool, file, opts),
  };
  const downloadTools: DownloadTools = options.downloadTools ?? {
    probeVideo: (file, opts) => probeFile(deps.runTool, file, opts),
    probeSound: (file, opts) => probeSound(deps.runTool, file, opts),
    async toMp3(opts) {
      // Both files sit in the scratch folder, so FFmpeg is given plain names.
      await runFfmpeg({
        runTool: deps.runTool,
        cwd: opts.cwd,
        signal: opts.signal,
        durationMs: opts.durationMs,
        args: mp3Args(path.basename(opts.input), path.basename(opts.output)),
        onProgress: opts.onProgress,
      });
    },
  };
  const outcomeDeps = {
    rows,
    privateStorage: deps.privateStorage,
    storage: deps.storage,
    internal: deps.internal,
    now,
  };

  /**
   * A highlights run's rows, checked. `first`: the run's first step, which
   * moves the job and the run to RUNNING (null when it was closed meanwhile).
   * A later step answers null when the job is no longer open.
   */
  async function openHighlights(ref: ClipJobWorkflowInput, first: boolean) {
    const { job, input } = await openJob(rows, ref, 'HIGHLIGHTS');
    const run = await rows.highlightRun(job.organizationId, input.runId);
    if (!run || run.videoId !== input.videoId) {
      throw new ClipStepError('highlights_failed', { retryable: false });
    }
    const progress = jobProgress(job.id, { kind: 'HIGHLIGHTS' });
    if (first) {
      if (!(await start(progress))) return null;
      await rows.markRunRunning(job.organizationId, run.id);
    } else if (job.status !== 'RUNNING' && job.status !== 'QUEUED') {
      return null;
    }
    const [video, link] = await Promise.all([
      rows.video(job.organizationId, input.videoId),
      rows.videoLink(job.organizationId, input.videoId),
    ]);
    if (!video || video.deletedAt || video.status !== 'READY' || !link) {
      throw new ClipStepError('highlights_failed', { retryable: false });
    }
    return { job, input, run, video, link, progress };
  }

  function highlightsRun(
    opened: NonNullable<Awaited<ReturnType<typeof openHighlights>>>,
    dir: string,
    activity: ActivityRun,
  ): HighlightsRun {
    return {
      jobId: opened.job.id,
      organizationId: opened.job.organizationId,
      input: opened.input,
      run: opened.run,
      video: opened.video,
      link: opened.link,
      dir,
      signal: activity.signal,
      producers: deps.providers.signalProducers,
      privateStorage: deps.privateStorage,
      rows,
      progress: opened.progress,
      heartbeat: activity.heartbeat,
      now,
      simulated: deps.providers.simulated,
      sleep: options.sleep,
      internal: deps.internal,
    };
  }

  return {
    async clipImport(ref: ClipJobWorkflowInput): Promise<ClipWorkResult> {
      return runClipActivity('clipImport', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'IMPORT');
        const progress = jobProgress(job.id, { kind: 'IMPORT' });
        if (!(await start(progress))) return { status: 'closed' };

        const video = await rows.video(job.organizationId, input.videoId);
        if (!video || video.deletedAt) throw new ClipStepError('tool_failed', { retryable: false });

        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          if (activity.attempt > 1) {
            // A dead attempt may have stored some files: the keys are known, so start clean.
            await deleteQuietly(
              deps.privateStorage,
              allImportKeys(job.organizationId, video.id, job.id),
            );
          }
          const outcome = await runImport({
            jobId: job.id,
            organizationId: job.organizationId,
            input,
            video,
            dir,
            signal: activity.signal,
            tools: importTools,
            downloader: deps.providers.downloader,
            privateStorage: deps.privateStorage,
            internal: deps.internal,
            rows,
            progress,
            heartbeat: activity.heartbeat,
            now,
          });
          return { status: outcome.stored ? 'done' : 'closed' };
        });
      });
    },

    async clipSegment(ref: ClipJobWorkflowInput): Promise<ClipWorkResult> {
      return runClipActivity('clipSegment', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'SEGMENT');
        const progress = jobProgress(job.id, { kind: 'SEGMENT' });
        if (!(await start(progress))) return { status: 'closed' };

        const video = await rows.video(job.organizationId, input.videoId);
        if (!video || video.deletedAt) throw new ClipStepError('tool_failed', { retryable: false });

        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          // A range is far smaller than a video; a few hundred MB of room is plenty.
          await assertFreeDisk(dir, 512 * 1024 * 1024);
          const outcome = await runSegment({
            jobId: job.id,
            organizationId: job.organizationId,
            input,
            video,
            dir,
            signal: activity.signal,
            runTool: deps.runTool,
            probe: (file) => probeFile(deps.runTool, file, { cwd: dir, signal: activity.signal }),
            downloader: deps.providers.downloader,
            privateStorage: deps.privateStorage,
            rows,
            progress,
            heartbeat: activity.heartbeat,
            now,
          });
          return { status: outcome.stored ? 'done' : 'closed' };
        });
      });
    },

    /**
     * Sprint 13, Module 02: a listening job's first step. Moves the job to
     * RUNNING ("Listening to what is said") and builds the one JSON object the
     * Python service takes. Short: it only reads rows.
     */
    async clipTranscribePrepare(ref: ClipJobWorkflowInput): Promise<TranscribePrepared> {
      return runClipActivity('clipTranscribePrepare', ref.jobId, async () => {
        const { job, input } = await openJob(rows, ref, 'TRANSCRIBE');
        const progress = jobProgress(job.id, { kind: 'TRANSCRIBE' });
        if (!(await start(progress))) return { status: 'closed' };
        const payload = await prepareTranscribe({
          jobId: job.id,
          organizationId: job.organizationId,
          input,
          rows,
          privateStorage: deps.privateStorage,
          progress,
          simulated: deps.providers.simulated,
          now,
        });
        return { status: 'ready', payload };
      });
    },

    /**
     * Sprint 13, Module 02: a listening job's last step. Merges what Python
     * heard into the video's transcript, swaps the stored file with the job's
     * DONE, and gives the AI minutes back when nothing was heard.
     */
    async clipTranscribeFinish(
      ref: ClipJobWorkflowInput & { heard: MediaPyTranscribeOutput },
    ): Promise<ClipWorkResult> {
      return runClipActivity('clipTranscribeFinish', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'TRANSCRIBE');
        const progress = jobProgress(job.id, { kind: 'TRANSCRIBE' });
        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          const outcome = await finishTranscribe(
            {
              jobId: job.id,
              organizationId: job.organizationId,
              input,
              rows,
              privateStorage: deps.privateStorage,
              progress,
              simulated: deps.providers.simulated,
              now,
            },
            ref.heard,
            dir,
            deps.internal,
          );
          return { status: outcome.finished ? 'done' : 'closed' };
        });
      });
    },

    /** Sprint 13, Module 07: a faces job's first step (RUNNING at "Finding faces", the Python input). */
    async clipFacesPrepare(ref: ClipJobWorkflowInput): Promise<FacesPrepared> {
      return runClipActivity('clipFacesPrepare', ref.jobId, async () => {
        const { job, input } = await openJob(rows, ref, 'FACES');
        const progress = jobProgress(job.id, { kind: 'FACES' });
        if (!(await start(progress))) return { status: 'closed' };
        const payload = await prepareFaces({
          jobId: job.id,
          organizationId: job.organizationId,
          input,
          rows,
          privateStorage: deps.privateStorage,
          progress,
          simulated: deps.providers.simulated,
          now,
        });
        return { status: 'ready', payload };
      });
    },

    /** Sprint 13, Module 07: a faces job's last step: check the file, keep it, DONE. */
    async clipFacesFinish(
      ref: ClipJobWorkflowInput & { found: MediaPyDetectFacesOutput },
    ): Promise<ClipWorkResult> {
      return runClipActivity('clipFacesFinish', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'FACES');
        const progress = jobProgress(job.id, { kind: 'FACES' });
        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          const finished = await finishFaces(
            {
              jobId: job.id,
              organizationId: job.organizationId,
              input,
              rows,
              privateStorage: deps.privateStorage,
              progress,
              simulated: deps.providers.simulated,
              now,
            },
            ref.found,
            dir,
          );
          return { status: finished ? 'done' : 'closed' };
        });
      });
    },

    /**
     * A Find Clips run's first (or only) step. With Look For Action (Module
     * 06) it stops after gathering and answers the motion measure's input;
     * the workflow goes on with `mediaPyMotion`, `clipHighlightsLook`,
     * `mediaPyStills` and `clipHighlightsFinish`.
     */
    async clipHighlights(ref: ClipJobWorkflowInput): Promise<HighlightsStep> {
      return runClipActivity('clipHighlights', ref.jobId, async (activity) => {
        const opened = await openHighlights(ref, true);
        if (!opened) return { status: 'closed' };
        return withScratch(deps.scratchRoot, activity.scratchId(opened.job.id), async (dir) => {
          // The light copy and the analysis sound come down; a few hundred MB is plenty.
          await assertFreeDisk(dir, 512 * 1024 * 1024);
          const run = highlightsRun(opened, dir, activity);
          const chosen = readRunSetup(opened.run.params);
          if (chosen?.setup.action) {
            const gathered = await gatherHighlights(run);
            const watch = await startWatching(run, gathered, chosen.setup);
            return { status: 'watch', motion: watch.motion };
          }
          const outcome = await runHighlights(run);
          return { status: outcome.finished ? 'done' : 'closed' };
        });
      });
    },

    /** Module 06, step 3: the bursts, and the stills to cut when the vision check is on. */
    async clipHighlightsLook(
      ref: ClipJobWorkflowInput & { motionKey: string | null; motionFailed: boolean },
    ): Promise<HighlightsLook> {
      return runClipActivity('clipHighlightsLook', ref.jobId, async (activity) => {
        const opened = await openHighlights(ref, false);
        if (!opened) return { status: 'closed', stills: null };
        return withScratch(deps.scratchRoot, activity.scratchId(opened.job.id), async (dir) => {
          const look = await lookForAction(highlightsRun(opened, dir, activity), {
            motionKey: ref.motionKey,
            motionFailed: ref.motionFailed,
          });
          return { status: 'look', stills: look.stills };
        });
      });
    },

    /** Module 06, step 5: the still check, the scoring, and the watch files deleted. */
    async clipHighlightsFinish(
      ref: ClipJobWorkflowInput & { stillKeys: string[] | null },
    ): Promise<ClipWorkResult> {
      return runClipActivity('clipHighlightsFinish', ref.jobId, async (activity) => {
        const opened = await openHighlights(ref, false);
        if (!opened) return { status: 'closed' };
        return withScratch(deps.scratchRoot, activity.scratchId(opened.job.id), async (dir) => {
          const outcome = await finishWatching(highlightsRun(opened, dir, activity), ref.stillKeys);
          return { status: outcome.finished ? 'done' : 'closed' };
        });
      });
    },

    async clipRenderWaitState(
      ref: ClipJobWorkflowInput & { first: boolean },
    ): Promise<RenderWaitState> {
      return runClipActivity('clipRenderWaitState', ref.jobId, async () => {
        const job = await rows.job(ref.organizationId, ref.jobId);
        if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) {
          return { closed: true, segmentRunning: false };
        }
        if (ref.first) {
          const progress = jobProgress(job.id, { kind: 'RENDER' });
          if (!(await start(progress))) return { closed: true, segmentRunning: false };
          await progress.report({ stage: 'fetching', progress: 0 });
        }
        if (!job.clipId) return { closed: false, segmentRunning: false };
        const running = await rows.openClipJobs(job.organizationId, job.clipId, 'SEGMENT');
        return { closed: false, segmentRunning: running > 0 };
      });
    },

    async clipRender(ref: ClipJobWorkflowInput): Promise<ClipWorkResult> {
      return runClipActivity('clipRender', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'RENDER');
        const progress = jobProgress(job.id, { kind: 'RENDER' });
        if (!(await start(progress))) return { status: 'closed' };

        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          await assertFreeDisk(dir, 1024 * 1024 * 1024);
          const outcome = await runRender({
            job,
            input,
            dir,
            signal: activity.signal,
            tools: renderTools,
            privateStorage: deps.privateStorage,
            storage: deps.storage,
            internal: deps.internal,
            rows,
            stickerRows: options.stickerRows ?? prismaStickerFileRows,
            soundRows: options.soundRows ?? prismaSoundFileRows,
            // Sprint 13: a clip's captions come from the workspace's own transcript and style rows.
            captionRows: rows,
            progress,
            fonts: deps.fonts,
            watermark: deps.watermark ?? null,
            now,
            simulated: deps.providers.simulated,
            heartbeat: activity.heartbeat,
          });
          return { status: outcome.finished ? 'done' : 'closed' };
        });
      });
    },

    async clipDownload(ref: ClipJobWorkflowInput): Promise<ClipWorkResult> {
      return runClipActivity('clipDownload', ref.jobId, async (activity) => {
        const { job, input } = await openJob(rows, ref, 'DOWNLOAD');
        const progress = jobProgress(job.id, { kind: 'DOWNLOAD' });
        if (!(await start(progress))) return { status: 'closed' };

        return withScratch(deps.scratchRoot, activity.scratchId(job.id), async (dir) => {
          // The fetched file and, for Audio Only, its MP3 side by side.
          const expected = input.expectedBytes ?? 0;
          await assertFreeDisk(dir, Math.max(512 * 1024 * 1024, expected * 2));
          const outcome = await runDownload({
            job,
            input,
            dir,
            signal: activity.signal,
            downloader: deps.providers.downloader,
            tools: downloadTools,
            privateStorage: deps.privateStorage,
            rows,
            progress,
            heartbeat: activity.heartbeat,
            now,
          });
          return { status: outcome.finished ? 'done' : 'closed' };
        });
      });
    },

    async clipSaveDownload(ref: ClipJobWorkflowInput): Promise<{ mediaId: string }> {
      return runClipActivity('clipSaveDownload', ref.jobId, async (activity) => {
        const row = await rows.downloadRow(ref.organizationId, ref.jobId);
        const output = row?.status === 'DONE' ? downloadOutputSchema.safeParse(row.output) : null;
        if (
          !row ||
          !output?.success ||
          output.data.ext !== 'mp4' ||
          output.data.media?.status !== 'saving'
        ) {
          throw new ClipStepError('media_save_failed', { retryable: false });
        }
        return withScratch(deps.scratchRoot, activity.scratchId(`${row.id}-media`), (dir) =>
          runSaveDownload({
            row,
            output: output.data,
            dir,
            signal: activity.signal,
            privateStorage: deps.privateStorage,
            storage: deps.storage,
            internal: deps.internal,
            poster: renderTools.poster,
            heartbeat: activity.heartbeat,
          }),
        );
      });
    },

    async clipSaveDownloadFailed(ref: ClipJobWorkflowInput): Promise<void> {
      return runClipActivity('clipSaveDownloadFailed', ref.jobId, () =>
        saveDownloadFailed({ rows, storage: deps.storage }, ref),
      );
    },

    async clipJobFailed(failure: JobFailure): Promise<boolean> {
      return runClipActivity('clipJobFailed', failure.jobId, () => failJob(outcomeDeps, failure));
    },

    async clipJobCancelled(ref: ClipJobWorkflowInput): Promise<boolean> {
      return runClipActivity('clipJobCancelled', ref.jobId, () => cancelJob(outcomeDeps, ref));
    },

    /** Starts the workspace's next waiting jobs. Never fails the workflow. */
    async clipJobSettled(ref: ClipJobWorkflowInput): Promise<void> {
      await deps.internal.settled(ref.jobId, { organizationId: ref.organizationId });
    },
  };
}
