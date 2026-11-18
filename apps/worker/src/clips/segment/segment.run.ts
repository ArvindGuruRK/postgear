/**
 * The sharp range of a clip (Module 05 section 3): the clip's part of the
 * video at the plan's best height, normalised (H.264, AAC, constant frame
 * rate, a two second closed GOP) so it seeks exactly, stored as a SEGMENT
 * asset with `meta { fromMs, toMs, height, fps }`.
 *
 * - Link: `downloader.fetchRange` (the input range is already widened by the
 *   handles and clamped to the video).
 * - Upload: the ORIGINAL from private storage, then one FFmpeg run of the
 *   downloader's own `normaliseArgs` (the exact cut and the normalise in one
 *   encode, with the same frame rate rule as a link's range), so an upload's
 *   sharp range is made exactly as a link's is.
 * - Gone: when the platform copy (or the uploaded file) is no longer there,
 *   the video is marked `hdAvailable = false` and the job ends DONE with
 *   `{ gone: true, assetId: null }`; exports fall back to the light copy.
 *
 * The asset row's id is the job's id and its key is derived from it, so a
 * retry or the failure bookkeeping always finds what an attempt stored.
 */
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type Downloader,
  DownloaderError,
  type MediaFacts,
  mapPercent,
  normaliseArgs,
  type RunTool,
  runFfmpeg,
} from '@postgear/media-tools';
import { type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import {
  type SegmentAssetMeta,
  type SegmentInput,
  segmentOutputSchema,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly, originalExtension } from '../import/import.steps';
import type { JobProgress } from '../job-progress';
import { segmentKey } from '../keys';
import type { ClipRows, VideoRow } from '../rows';

/** Fetch codes that mean the platform's copy is gone, not that something broke. */
export const GONE_CODES: ReadonlySet<string> = new Set([
  'format_gone',
  'link_not_found',
  'link_private',
]);

export interface SegmentRun {
  jobId: string;
  organizationId: string;
  input: SegmentInput;
  video: VideoRow;
  dir: string;
  signal: AbortSignal;
  runTool: RunTool;
  probe(file: string): Promise<MediaFacts>;
  downloader: Downloader;
  privateStorage: PrivateStorage;
  rows: ClipRows;
  progress: Pick<JobProgress, 'report' | 'flush'>;
  heartbeat(): void;
  now(): Date;
}

export interface SegmentOutcome {
  /** False when the job was closed while it ran: nothing is kept. */
  stored: boolean;
  gone: boolean;
  assetId: string | null;
}

/** Makes the range file in the scratch folder, or answers null when the source is gone. */
export async function fetchSegmentFile(run: SegmentRun): Promise<string | null> {
  const { input, dir, signal } = run;
  const outFile = path.join(dir, 'segment.mp4');

  if (input.origin.type === 'link') {
    try {
      const fetched = await run.downloader.fetchRange(
        {
          link: input.origin.link,
          fromMs: input.fromMs,
          toMs: input.toMs,
          maxHeight: input.maxHeight,
          outFile,
        },
        (update) => {
          if (update.percent !== null) {
            void run.progress.report({
              stage: 'fetching',
              progress: mapPercent(update.percent, 0, 90),
            });
          }
        },
        signal,
      );
      return fetched.path;
    } catch (error) {
      if (error instanceof DownloaderError && GONE_CODES.has(error.code)) return null;
      throw error;
    }
  }

  const originalKey = input.origin.originalKey;
  const original = path.join(dir, `original.${originalExtension(originalKey)}`);
  try {
    await run.privateStorage.getToFile(originalKey, original, signal);
  } catch (error) {
    if (error instanceof StorageNotFoundError) return null;
    throw error;
  }
  await run.progress.report({ stage: 'fetching', progress: 30 });

  const fps = run.video.fps ?? (await run.probe(original)).fps;
  const durationMs = input.toMs - input.fromMs;
  await runFfmpeg({
    runTool: run.runTool,
    cwd: dir,
    signal,
    durationMs,
    args: normaliseArgs({ inFile: original, outFile, startMs: input.fromMs, durationMs, fps }),
    onProgress: (percent) => {
      void run.progress.report({ stage: 'fetching', progress: mapPercent(percent, 30, 90) });
    },
  });
  return outFile;
}

export async function runSegment(run: SegmentRun): Promise<SegmentOutcome> {
  const { organizationId, jobId, input } = run;
  await run.progress.report({ stage: 'fetching', progress: 0 });
  const key = segmentKey(organizationId, input.videoId, jobId);

  const file = await fetchSegmentFile(run);
  if (run.signal.aborted) throw new ClipStepError('cancelled');

  if (file === null) {
    const output = segmentOutputSchema.parse({ gone: true, assetId: null });
    const finished = await run.rows.finishSegment({
      jobId,
      organizationId,
      videoId: input.videoId,
      asset: null,
      output,
      now: run.now(),
    });
    return { stored: finished, gone: true, assetId: null };
  }

  // The range is ours: check it really is a video, and read its size and rate for the meta.
  const facts = await run.probe(file);
  run.heartbeat();
  const meta: SegmentAssetMeta = {
    fromMs: input.fromMs,
    toMs: input.toMs,
    height: facts.height,
    fps: facts.fps,
  };
  const { size } = await stat(file);

  let stored = false;
  try {
    await run.privateStorage.putFile(key, file, 'video/mp4');
    stored = true;
    await run.progress.report({ stage: 'fetching', progress: 95 });
    if (run.signal.aborted) throw new ClipStepError('cancelled');

    const output = segmentOutputSchema.parse({ gone: false, assetId: jobId });
    const finished = await run.rows.finishSegment({
      jobId,
      organizationId,
      videoId: input.videoId,
      asset: {
        id: jobId,
        videoId: input.videoId,
        clipId: input.clipId,
        kind: 'SEGMENT',
        key,
        bytes: size,
        mimeType: 'video/mp4',
        meta: { ...meta },
      },
      output,
      now: run.now(),
    });
    if (!finished) {
      await deleteQuietly(run.privateStorage, [key]);
      return { stored: false, gone: false, assetId: null };
    }
    return { stored: true, gone: false, assetId: jobId };
  } catch (error) {
    if (stored) await deleteQuietly(run.privateStorage, [key]);
    throw error;
  }
}
