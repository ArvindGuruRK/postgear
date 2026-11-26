/**
 * Finding faces (Sprint 13, Module 07): the Node half of a FACES job. Free.
 *
 * The workflow runs three steps:
 * 1. `prepareFaces` (here): the job goes RUNNING at "Finding faces", the
 *    video and its light copy are looked up, and the Python input is built
 *    (storage keys, never paths).
 * 2. `mediaPyDetectFaces` (Python, on `postgear-media-py`): decodes the
 *    stretch at five pictures a second and stores the face file at a key made
 *    from the job id.
 * 3. `finishFaces` (here): the file is read back and checked against the
 *    engine's strict copy of its shape (boxes and times, nothing more), then
 *    kept where it is as the video's `FACE_TRACKS` asset, with the job's DONE
 *    in one transaction. A stretch with no face is DONE with `found: 0`, and
 *    its file is kept too, so the next press does not look again.
 *
 * Logs carry ids and counts, never a box.
 */
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import {
  FACES_MAX_WIDTH,
  FACES_SAMPLE_FPS,
  MEDIA_CONTRACT_VERSION,
  type MediaPyDetectFacesInput,
  type MediaPyDetectFacesOutput,
} from '@postgear/media-contract';
import type { PrivateStorage } from '@postgear/storage';
import {
  type FaceTracksAssetMeta,
  type FacesInput,
  facesOutputSchema,
  readFaceFile,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import type { JobProgress } from '../job-progress';
import { facesFileKey } from '../keys';
import type { AssetRow, ClipRows, VideoLinkRow, VideoRow } from '../rows';
import { simulationHint } from '../transcribe/transcribe.run';

const gunzipAsync = promisify(gunzip);

export const FACES_MIME = 'application/gzip';
/** A face file larger than this is refused before it is unzipped (three hours is a few MB). */
const MAX_GZ_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 128 * 1024 * 1024;

/** Forcing switches in a video's title, read only when the providers are simulated. */
export const FACES_FAIL_MARKER = '[simulate:faces-fail]';
export const FACES_SLOW_MARKER = '[simulate:faces-slow]';

export interface FacesRun {
  jobId: string;
  organizationId: string;
  input: FacesInput;
  rows: Pick<ClipRows, 'video' | 'videoAssets' | 'videoLink' | 'finishFaces'>;
  privateStorage: PrivateStorage;
  progress: Pick<JobProgress, 'report'>;
  simulated: boolean;
  now: () => Date;
}

/** Which sample's recorded boxes a simulated run answers from, and any forced state. */
export function facesHint(
  video: Pick<VideoRow, 'title'>,
  link: VideoLinkRow | null,
): NonNullable<MediaPyDetectFacesInput['simulation']> {
  const sample = simulationHint(video, link).sample;
  const force = video.title.includes(FACES_FAIL_MARKER)
    ? 'fail'
    : video.title.includes(FACES_SLOW_MARKER)
      ? 'slow'
      : null;
  return { sample, force };
}

function newestKey(assets: readonly AssetRow[], kind: AssetRow['kind']): string | null {
  return assets.filter((row) => row.kind === kind).at(-1)?.key ?? null;
}

/** Step 1: the Python activity's input. */
export async function prepareFaces(run: FacesRun): Promise<MediaPyDetectFacesInput> {
  await run.progress.report({ stage: 'faces', progress: 5 });
  const [video, link, assets] = await Promise.all([
    run.rows.video(run.organizationId, run.input.videoId),
    run.rows.videoLink(run.organizationId, run.input.videoId),
    run.rows.videoAssets(run.organizationId, run.input.videoId),
  ]);
  if (!video || video.deletedAt || video.status !== 'READY' || video.durationMs === null) {
    throw new ClipStepError('faces_failed', { retryable: false });
  }
  const proxyKey = newestKey(assets, 'PROXY');
  if (!proxyKey) throw new ClipStepError('faces_failed', { retryable: false });
  const toMs = Math.min(run.input.toMs, video.durationMs);
  if (run.input.fromMs >= toMs) throw new ClipStepError('faces_failed', { retryable: false });

  return {
    version: MEDIA_CONTRACT_VERSION,
    jobId: run.jobId,
    orgId: run.organizationId,
    videoId: video.id,
    proxyKey,
    durationMs: video.durationMs,
    ranges: [{ fromMs: run.input.fromMs, toMs }],
    sampleFps: FACES_SAMPLE_FPS,
    maxWidth: FACES_MAX_WIDTH,
    simulation: run.simulated ? facesHint(video, link) : null,
  };
}

/**
 * Step 3: check, keep and close. `dir` is the activity's scratch folder. A
 * retry is safe: the asset's id is the job's and its key is made from it.
 * Returns false when the job was closed meanwhile (the file is removed).
 */
export async function finishFaces(
  run: FacesRun,
  found: MediaPyDetectFacesOutput,
  dir: string,
): Promise<boolean> {
  const { organizationId: org, jobId } = run;
  const videoId = run.input.videoId;
  const key = facesFileKey(org, videoId, jobId);
  // The key is ours by construction; an answer naming any other key is refused.
  if (found.facesKey !== key) throw new ClipStepError('faces_failed', { retryable: false });
  await run.progress.report({ stage: 'faces', progress: 92 });

  const file = path.join(dir, 'faces.json.gz');
  let pictures: number;
  let boxes: number;
  let bytes: number;
  try {
    await run.privateStorage.getToFile(key, file);
    bytes = (await stat(file)).size;
    if (bytes > MAX_GZ_BYTES) throw new ClipStepError('faces_failed', { retryable: false });
    const json = await gunzipAsync(await readFile(file), { maxOutputLength: MAX_JSON_BYTES });
    const frames = readFaceFile(JSON.parse(json.toString('utf8')));
    // Anything but boxes and times is refused, and the file is not kept.
    if (!frames) throw new ClipStepError('faces_failed', { retryable: false });
    pictures = frames.length;
    boxes = frames.reduce((sum, frame) => sum + frame.boxes.length, 0);
  } catch (error) {
    if (error instanceof ClipStepError) {
      await deleteQuietly(run.privateStorage, [key]);
      throw error;
    }
    throw new ClipStepError('faces_failed', { retryable: true, cause: error });
  }

  const meta: FaceTracksAssetMeta = {
    fromMs: run.input.fromMs,
    toMs: run.input.toMs,
    sampleFps: FACES_SAMPLE_FPS,
    found: boxes,
    producer: found.producer,
  };
  const output = facesOutputSchema.parse({ assetId: jobId, found: boxes, sampled: pictures });
  const finished = await run.rows.finishFaces({
    jobId,
    organizationId: org,
    videoId,
    asset: {
      id: jobId,
      videoId,
      clipId: null,
      kind: 'FACE_TRACKS',
      key,
      bytes,
      mimeType: FACES_MIME,
      meta: { ...meta },
    },
    output,
    now: run.now(),
  });
  if (!finished) {
    await deleteQuietly(run.privateStorage, [key]);
    return false;
  }
  console.log(
    JSON.stringify({
      event: 'clips.faces.done',
      jobId,
      videoId,
      pictures,
      found: boxes,
      producer: found.producer,
    }),
  );
  return true;
}
