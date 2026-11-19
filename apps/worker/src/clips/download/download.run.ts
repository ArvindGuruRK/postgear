/**
 * Download in any format (Sprint 12, Module 18): `clipDownloadWorkflow`'s one
 * activity, every step in one scratch folder.
 *
 * | Step | Stage, progress | What it does |
 * |---|---|---|
 * | fetch  | fetching, 0 to 85  | `downloader.fetchFormat` to scratch, stopped past `maxBytes` (the space the plan has left). Separate picture and sound are joined to an MP4 with its index first (`+faststart`) by the downloader itself |
 * | finish | fetching, 85 to 100 | Audio Only: converted to a 192 kbps MP3 and read back with ffprobe (it must say MP3). Video: `probeFile` confirms it is a video we can read. Then the file goes to the private space and, in one transaction, the job is DONE with `output` and `expiresAt` (24 hours) and the DOWNLOAD asset row is written |
 *
 * A YouTube fetch may report no number (`percent: null`): the row then stays
 * at its last number and the tab shows a moving bar.
 *
 * The asset row's id is the job's id and its key is derived from it, so the
 * failure bookkeeping, Module 19's sweep and Delete Download all find it.
 * The failure itself (one sentence, nothing kept, both charges given back)
 * is `failJob` in `job-outcomes.ts`.
 */
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type Downloader,
  DownloaderError,
  type MediaFacts,
  mapPercent,
  type SoundFacts,
} from '@postgear/media-tools';
import { CLIP_SHORT_LIVED_MS } from '@postgear/scheduling';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  type DownloadInput,
  downloadExtension,
  downloadFileName,
  downloadOutputSchema,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import type { JobProgress } from '../job-progress';
import type { ClipRows, JobRow } from '../rows';

/** The fetch's share of the bar; the conversion and the store take the rest. */
export const DOWNLOAD_FETCH_TO = 85;

export interface DownloadTools {
  /** A video's facts (`probeFile`): throws when it is not a video we can read. */
  probeVideo(file: string, opts: { cwd: string; signal: AbortSignal }): Promise<MediaFacts>;
  /** A sound file's facts (`probeSound`). */
  probeSound(file: string, opts: { cwd: string; signal: AbortSignal }): Promise<SoundFacts>;
  /** The sound to a 192 kbps MP3 (`mp3Args`); `onProgress` gets 0 to 100. */
  toMp3(opts: {
    input: string;
    output: string;
    cwd: string;
    signal: AbortSignal;
    durationMs: number;
    onProgress(percent: number): void;
  }): Promise<void>;
}

export interface DownloadRun {
  job: JobRow;
  input: DownloadInput;
  dir: string;
  signal: AbortSignal;
  downloader: Downloader;
  tools: DownloadTools;
  privateStorage: Pick<PrivateStorage, 'putFile' | 'delete'>;
  rows: Pick<ClipRows, 'finishDownload'>;
  progress: Pick<JobProgress, 'report'>;
  heartbeat(): void;
  now(): Date;
}

export interface DownloadOutcome {
  /** False when the job was closed while it ran: nothing is kept. */
  finished: boolean;
}

interface DeliveredFacts {
  durationMs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export async function runDownload(run: DownloadRun): Promise<DownloadOutcome> {
  const { job, input, dir, signal } = run;
  const org = job.organizationId;
  const report = (progress: number) =>
    void run.progress.report({ stage: 'fetching', progress }).catch(() => undefined);
  await run.progress.report({ stage: 'fetching', progress: 0 });

  // 1. Fetch the chosen format (MP4 for video, M4A for Audio Only).
  let fetched: string;
  try {
    const result = await run.downloader.fetchFormat(
      {
        link: input.link,
        formatId: input.formatId,
        outFile: path.join(dir, input.audioOnly ? 'fetched.m4a' : 'fetched.mp4'),
        maxBytes: input.maxBytes,
      },
      (update) => {
        run.heartbeat();
        if (update.percent !== null) report(mapPercent(update.percent, 0, DOWNLOAD_FETCH_TO));
      },
      signal,
    );
    fetched = result.path;
  } catch (error) {
    if (error instanceof DownloaderError && error.code === 'too_big') {
      throw new ClipStepError('download_too_big', { retryable: false, cause: error });
    }
    throw error;
  }
  if (signal.aborted) throw new ClipStepError('cancelled');
  await run.progress.report({ stage: 'fetching', progress: DOWNLOAD_FETCH_TO });

  // 2. Make it what was asked for, and check it is.
  const ext = downloadExtension(input.audioOnly);
  let file = fetched;
  let facts: DeliveredFacts;
  if (input.audioOnly) {
    file = path.join(dir, 'file.mp3');
    await run.tools.toMp3({
      input: fetched,
      output: file,
      cwd: dir,
      signal,
      durationMs: input.durationMs,
      onProgress: (percent) => report(mapPercent(percent, DOWNLOAD_FETCH_TO, 95)),
    });
    const sound = await run.tools.probeSound(file, { cwd: dir, signal });
    if (sound.codec !== 'mp3') {
      throw new ClipStepError('download_failed', {
        retryable: false,
        cause: new Error(`The converted file reads as ${sound.codec}, not MP3`),
      });
    }
    facts = { durationMs: sound.durationMs, width: null, height: null, fps: null };
  } else {
    const video = await run.tools.probeVideo(file, { cwd: dir, signal });
    facts = {
      durationMs: video.durationMs,
      width: video.width > 0 ? video.width : null,
      height: video.height > 0 ? video.height : null,
      fps: video.fps > 0 ? video.fps : null,
    };
  }
  run.heartbeat();
  const { size: bytes } = await stat(file);
  if (bytes > input.maxBytes) throw new ClipStepError('download_too_big', { retryable: false });
  if (signal.aborted) throw new ClipStepError('cancelled');
  await run.progress.report({ stage: 'fetching', progress: 95 });

  // 3. Store it, then the job DONE and the asset row together.
  const key = clipKeys.downloadFile(org, job.id, 'file', ext);
  const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
  let stored = false;
  try {
    // A dead attempt may have stored it already, and local storage refuses to overwrite.
    await run.privateStorage.delete(key);
    await run.privateStorage.putFile(key, file, mimeType);
    stored = true;
    if (signal.aborted) throw new ClipStepError('cancelled');

    const now = run.now();
    const expiresAt = new Date(now.getTime() + CLIP_SHORT_LIVED_MS);
    const output = downloadOutputSchema.parse({
      assetId: job.id,
      key,
      bytes,
      ext,
      fileName: downloadFileName(input.title, ext),
      durationMs: Math.max(0, Math.round(facts.durationMs)),
      width: facts.width,
      height: facts.height,
      fps: facts.fps,
    });
    const finished = await run.rows.finishDownload({
      jobId: job.id,
      organizationId: org,
      asset: {
        id: job.id,
        videoId: null,
        kind: 'DOWNLOAD',
        key,
        bytes,
        mimeType,
        meta: { jobId: job.id, expiresAt: expiresAt.toISOString() },
      },
      output,
      expiresAt,
      now,
    });
    if (!finished) {
      await deleteQuietly(run.privateStorage, [key]);
      return { finished: false };
    }
    return { finished: true };
  } catch (error) {
    if (stored) await deleteQuietly(run.privateStorage, [key]);
    throw error;
  }
}

/**
 * The sentence a failed download ends with: the platform's own reasons
 * (gone quality, private or missing video, a platform resting or paused, too
 * long, too big for the space) keep their words; anything else is "We could
 * not prepare this file. Try again."
 */
const KEPT_DOWNLOAD_CODES: ReadonlySet<string> = new Set([
  'format_gone',
  'link_private',
  'link_not_found',
  'link_live',
  'link_not_a_video',
  'platform_resting',
  'platform_paused',
  'clips_video_too_long',
  'download_too_big',
  'cancelled',
]);

export function downloadFailureCode(code: string): string {
  if (code === 'too_big' || code === 'clips_storage_full') return 'download_too_big';
  return KEPT_DOWNLOAD_CODES.has(code) ? code : 'download_failed';
}
