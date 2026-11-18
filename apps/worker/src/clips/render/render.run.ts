/**
 * An export (Module 05 section 4), as three steps in one activity and one
 * scratch folder:
 *
 * | Step            | Stage, progress  | What it does |
 * |-----------------|------------------|--------------|
 * | `renderPrepare` | fetching 0-10    | Pick each video's file (the clip's sharp range or the light copy), download it, probe it, check the fonts, `buildRenderPlan` |
 * | `renderExecute` | rendering 10-90  | `compileFfmpeg`, then the executor (`render.mp4.part`, renamed only when FFmpeg ended cleanly) |
 * | `renderFinish`  | finishing 90-100 | The poster (a JPEG one second in), both files into the public media space, the API's finish route (the Media row, the clip marked exported, the bell), the job DONE |
 *
 * Waiting for a running SEGMENT job happens before this, in the workflow
 * (a durable timer between short checks, never a busy loop here).
 *
 * The public keys are derived from the job id (`exportMediaKeys`), so a
 * retry overwrites what a dead attempt stored and the failure bookkeeping
 * removes it; the finish route is idempotent per job.
 */
import * as path from 'node:path';
import {
  type MediaFacts,
  mapPercent,
  type PosterResult,
  type RenderClipInput,
  type RenderClipResult,
} from '@postgear/media-tools';
import {
  clipKeys,
  type PrivateStorage,
  type StorageBackend,
  StorageNotFoundError,
} from '@postgear/storage';
import {
  buildRenderPlan,
  checkFonts,
  compileFfmpeg,
  emptyFontManifest,
  fontsNeeded,
  type RenderInput,
  type RenderPlan,
  type RenderSourceAsset,
  renderOutputSchema,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { ClipInternalClient } from '../internal-client';
import type { JobProgress } from '../job-progress';
import { exportMediaKeys } from '../keys';
import type { ClipRows, JobRow } from '../rows';
import { pickRenderSource, rangesBySource } from './render-source';

export interface RenderTools {
  probe(file: string, options: { cwd: string; signal: AbortSignal }): Promise<MediaFacts>;
  render(input: Omit<RenderClipInput, 'runTool'>): Promise<RenderClipResult>;
  poster(options: {
    cwd: string;
    signal: AbortSignal;
    input: string;
    output: string;
    facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
    atMs: number;
  }): Promise<PosterResult>;
}

export interface RenderRun {
  job: JobRow;
  input: RenderInput;
  dir: string;
  signal: AbortSignal;
  tools: RenderTools;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile'>;
  storage: Pick<StorageBackend, 'put' | 'delete'>;
  internal: Pick<ClipInternalClient, 'finishExport'>;
  rows: Pick<ClipRows, 'video' | 'videoAssets' | 'segmentAssets'>;
  progress: Pick<JobProgress, 'report' | 'flush' | 'done'>;
  heartbeat(): void;
}

export interface RenderOutcome {
  /** False when the job was closed before it could be marked done. */
  finished: boolean;
  mediaId: string | null;
  proofKey: string | null;
  durationMs: number;
}

/** An export problem no retry can fix (the video or its light copy is gone). */
function exportFailed(cause?: unknown): ClipStepError {
  return new ClipStepError('export_failed', { retryable: false, cause });
}

export async function renderPrepare(run: RenderRun): Promise<RenderPlan> {
  const { job, input, dir, signal } = run;
  const org = job.organizationId;
  await run.progress.report({ stage: 'fetching', progress: 0 });

  // No fonts ship before Module 11: a document with text cannot render yet.
  if (checkFonts(emptyFontManifest(), fontsNeeded(input.document)).length > 0) {
    throw new ClipStepError('font_missing');
  }

  const ranges = rangesBySource(input.document);
  const sources: Record<string, RenderSourceAsset> = {};
  let index = 0;
  for (const [sourceId, range] of ranges) {
    const source = input.document.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw exportFailed();
    const video = await run.rows.video(org, source.videoId);
    if (!video || video.deletedAt) throw exportFailed();

    // The newest light copy, as the API's choice takes it (rows come oldest first).
    const proxy = (await run.rows.videoAssets(org, video.id))
      .filter((asset) => asset.kind === 'PROXY')
      .at(-1);
    const segments = (await run.rows.segmentAssets(org, input.clipId)).filter(
      (asset) => asset.videoId === video.id,
    );
    const picked = pickRenderSource(range, segments, proxy ?? null);
    if (!picked) throw exportFailed();

    const file = `source-${index}.mp4`;
    const target = path.join(dir, file);
    try {
      await run.privateStorage.getToFile(picked.asset.key, target, signal);
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw exportFailed(error);
      throw error;
    }
    const facts = await run.tools.probe(target, { cwd: dir, signal });
    sources[sourceId] = {
      file,
      sourceOffsetMs: picked.sourceOffsetMs,
      durationMs: facts.durationMs,
      width: facts.width,
      height: facts.height,
      fps: facts.fps,
      hasAudio: facts.hasAudio,
    };
    index += 1;
    run.heartbeat();
    await run.progress.report({
      stage: 'fetching',
      progress: mapPercent((index / Math.max(1, ranges.size)) * 100, 0, 10),
    });
  }

  // Throws a typed `RenderCompileError` (permanent) for anything it cannot draw.
  return buildRenderPlan(input.document, {
    quality: input.quality,
    proof: input.proof,
    watermark: input.watermark,
    assets: { sources },
  });
}

export async function renderExecute(run: RenderRun, plan: RenderPlan): Promise<RenderClipResult> {
  await run.progress.report({ stage: 'rendering', progress: 10 });
  const compiled = compileFfmpeg(plan);
  return run.tools.render({
    scratchDir: run.dir,
    compiled,
    outFile: 'render.mp4',
    signal: run.signal,
    onProgress: (update) => {
      void run.progress.report({
        stage: 'rendering',
        progress: mapPercent(update.percent, 10, 90),
      });
    },
  });
}

/** The name in Media, always ending in `.mp4`. */
export function exportName(name: string): string {
  const trimmed = name.trim() || 'Clip';
  return /\.mp4$/i.test(trimmed) ? trimmed : `${trimmed}.mp4`;
}

export async function renderFinish(
  run: RenderRun,
  plan: RenderPlan,
  rendered: RenderClipResult,
): Promise<RenderOutcome> {
  const { job, input } = run;
  const org = job.organizationId;
  const durationMs = plan.output.durationMs;
  await run.progress.report({ stage: 'finishing', progress: 90 });

  if (input.proof) {
    // Preview Export (Module 15): a private file kept 24 hours, no Media row, no bell.
    const proofKey = clipKeys.proofFile(org, job.id, 'proof', 'mp4');
    await run.privateStorage.putFile(proofKey, rendered.file, 'video/mp4');
    const finished = await run.progress.done(
      renderOutputSchema.parse({ mediaId: null, proofKey, durationMs }),
    );
    return { finished, mediaId: null, proofKey, durationMs };
  }

  const poster = await run.tools.poster({
    cwd: run.dir,
    signal: run.signal,
    input: rendered.file,
    output: path.join(run.dir, 'poster.jpg'),
    facts: { durationMs, width: plan.output.width, height: plan.output.height },
    atMs: Math.min(1_000, Math.floor(durationMs / 2)),
  });
  if (run.signal.aborted) throw new ClipStepError('cancelled');

  const keys = exportMediaKeys(job.id, job.createdAt);
  // A dead attempt may have stored these already, and local storage refuses to overwrite.
  await run.storage.delete(keys.video);
  await run.storage.put(keys.video, { filePath: rendered.file, size: rendered.bytes }, 'video/mp4');
  run.heartbeat();
  await run.storage.delete(keys.poster);
  await run.storage.put(keys.poster, { filePath: poster.file, size: poster.bytes }, 'image/jpeg');
  await run.progress.report({ stage: 'finishing', progress: 95 });
  if (run.signal.aborted) throw new ClipStepError('cancelled');

  const answer = await run.internal.finishExport(job.id, {
    organizationId: org,
    clipId: input.clipId,
    revision: input.revision,
    key: keys.video,
    bytes: rendered.bytes,
    posterKey: keys.poster,
    durationMs,
    width: plan.output.width,
    height: plan.output.height,
    fps: plan.output.fps,
    name: exportName(input.name),
  });
  const finished = await run.progress.done(
    renderOutputSchema.parse({ mediaId: answer.mediaId, proofKey: null, durationMs }),
  );
  return { finished, mediaId: answer.mediaId, proofKey: null, durationMs };
}

export async function runRender(run: RenderRun): Promise<RenderOutcome> {
  const plan = await renderPrepare(run);
  if (run.signal.aborted) throw new ClipStepError('cancelled');
  const rendered = await renderExecute(run, plan);
  if (run.signal.aborted) throw new ClipStepError('cancelled');
  return renderFinish(run, plan, rendered);
}
