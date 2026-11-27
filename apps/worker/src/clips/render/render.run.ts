/**
 * An export (Module 05 section 4), as three steps in one activity and one
 * scratch folder:
 *
 * | Step            | Stage, progress  | What it does |
 * |-----------------|------------------|--------------|
 * | `renderPrepare` | fetching 0-10    | Check the fonts, pick each video's file (the clip's sharp range or the light copy), download it, probe it, `buildRenderPlan`, copy the fonts the text uses into `fonts/` |
 * | `renderExecute` | rendering 10-90  | The loudness measure (`compileMeasure`, seconds), `compileFfmpeg` with its correction, the executor (`render.mp4.part`, renamed only when FFmpeg ended cleanly), the file checked against the plan (`verifyOutput`, Module 15), then measured again |
 * | `renderFinish`  | finishing 90-100 | The poster (a JPEG one second in), both files into the public media space, the API's finish route (the Media row, the clip marked exported, the bell), the job DONE |
 *
 * Waiting for a running SEGMENT job happens before this, in the workflow
 * (a durable timer between short checks, never a busy loop here).
 *
 * The public keys are derived from the job id (`exportMediaKeys`), so a
 * retry overwrites what a dead attempt stored and the failure bookkeeping
 * removes it; the finish route is idempotent per job.
 *
 * A proof (Preview Export, Module 15) runs every program below normal
 * priority, so it never slows an export, and ends as a private file with a
 * PROOF asset row kept 24 hours: no Media row, no bell.
 */
import * as path from 'node:path';
import {
  copyFontsInto,
  copyWatermarkInto,
  type FontsFolder,
  type MediaFacts,
  type MeasureFileInput,
  type MeasureLoudnessInput,
  mapPercent,
  type PosterResult,
  type RenderClipInput,
  type RenderClipResult,
  type WatermarkFile,
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
  pickSourceFiles,
  compileFfmpeg,
  compileMeasure,
  decideLoudness,
  expectedOutputOf,
  FONTS_DIR,
  fontsNeeded,
  type LoudnessDecision,
  type LoudnessMeasure,
  type LoudnessResult,
  loudnessResult,
  type RenderedFileFacts,
  type RenderInput,
  type RenderPlan,
  type RenderSourceAsset,
  renderOutputSchema,
  verifyOutput,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { ClipInternalClient } from '../internal-client';
import type { JobProgress } from '../job-progress';
import { exportMediaKeys } from '../keys';
import type { AssetRow, ClipRows, JobRow } from '../rows';
import { type CaptionRows, fetchCaptionsTracks } from '../captions/files';
import { fetchSoundFiles } from '../sounds/files';
import type { SoundFileRows } from '../sounds/rows';
import { fetchStickerFiles } from '../stickers/files';
import type { StickerFileRows } from '../stickers/rows';
import { rangesBySource } from './render-source';

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
  /** The loudness measuring pass (Module 14); without it the export is not evened out (tests). */
  measure?(input: Omit<MeasureLoudnessInput, 'runTool'>): Promise<LoudnessMeasure | null>;
  /** The finished file's loudness, for the job's output. */
  measureFile?(input: Omit<MeasureFileInput, 'runTool'>): Promise<LoudnessMeasure | null>;
  /**
   * What the finished file really is (Module 15), checked against the plan
   * before anything is stored. The worker always passes it; a test without it
   * skips the check.
   */
  facts?(
    file: string,
    options: { cwd: string; signal: AbortSignal; priority?: 'normal' | 'low' },
  ): Promise<RenderedFileFacts>;
}

/** The render's file and the loudness the job records. */
export type RenderedClip = RenderClipResult & { loudness: LoudnessResult };

export interface RenderRun {
  job: JobRow;
  input: RenderInput;
  dir: string;
  signal: AbortSignal;
  tools: RenderTools;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile'>;
  storage: Pick<StorageBackend, 'put' | 'delete' | 'read'>;
  internal: Pick<ClipInternalClient, 'finishExport'>;
  rows: Pick<ClipRows, 'video' | 'videoAssets' | 'segmentAssets' | 'recordProof'>;
  /** The library rows and upload assets a clip's stickers come from (Module 12). */
  stickerRows: StickerFileRows;
  /** The library rows and upload assets a clip's sounds come from (Module 14). */
  soundRows?: SoundFileRows;
  /** Sprint 13: the workspace's transcript and caption style rows a clip's captions come from. */
  captionRows?: CaptionRows;
  progress: Pick<JobProgress, 'report' | 'flush' | 'done'>;
  /** The fonts folder (null when it was never built): text in the clip then fails `font_missing`. */
  fonts: FontsFolder | null;
  /**
   * The "Made with PostGear" mark read at boot (Module 15). A job whose input
   * asks for the mark copies it into its scratch folder; without it such a
   * job fails as the plan's `input_missing`.
   */
  watermark?: WatermarkFile | null;
  /** The clock for the proof's 24 hours (tests pass their own). */
  now?: () => Date;
  /** `CLIPS_SIMULATION` (Module 20): the forcing markers in the clip's name apply. */
  simulated?: boolean;
  heartbeat(): void;
}

/**
 * Module 20's forcing markers, read from the clip's name under
 * `CLIPS_SIMULATION` only: `[simulate:render-fail]` fails an export,
 * `[simulate:preview-fail]` fails a Preview Export. The job carries the name
 * as its file name, where the colon became a space, so both are read.
 */
export const RENDER_FAIL_MARKER = '[simulate:render-fail]';
export const PREVIEW_FAIL_MARKER = '[simulate:preview-fail]';
const RENDER_FAIL = /\[simulate[: ]render-fail\]/i;
const PREVIEW_FAIL = /\[simulate[: ]preview-fail\]/i;

/** The forced failure for this render, or null (always null outside simulation). */
export function forcedRenderFailure(
  run: Pick<RenderRun, 'input' | 'simulated'>,
): ClipStepError | null {
  if (run.simulated !== true) return null;
  if (run.input.proof) {
    return PREVIEW_FAIL.test(run.input.name)
      ? new ClipStepError('preview_failed', { retryable: false })
      : null;
  }
  return RENDER_FAIL.test(run.input.name)
    ? new ClipStepError('export_failed', { retryable: false })
    : null;
}

export interface RenderOutcome {
  /** False when the job was closed before it could be marked done. */
  finished: boolean;
  mediaId: string | null;
  proofKey: string | null;
  durationMs: number;
}

/** How long a Preview Export's file is kept (Module 15). */
export const PROOF_KEEP_MS = 24 * 60 * 60 * 1000;

/** A proof's programs run below normal priority; an export's at normal. */
function priorityOf(input: RenderInput): { priority?: 'low' } {
  return input.proof ? { priority: 'low' } : {};
}

/** An export problem no retry can fix (the video or its light copy is gone). */
function exportFailed(cause?: unknown): ClipStepError {
  return new ClipStepError('export_failed', { retryable: false, cause });
}

export async function renderPrepare(run: RenderRun): Promise<RenderPlan> {
  const { job, input, dir, signal } = run;
  const org = job.organizationId;
  await run.progress.report({ stage: 'fetching', progress: 0 });

  // A text's family must be in the fonts folder before anything is downloaded.
  const families = fontsNeeded(input.document);
  if (families.length > 0 && checkFonts(run.fonts?.manifest ?? null, families).length > 0) {
    throw new ClipStepError('font_missing');
  }

  // Every video the document plays must still be there; its assets are read inside the workspace.
  const assetsByVideo = new Map<string, AssetRow[]>();
  for (const sourceId of rangesBySource(input.document).keys()) {
    const source = input.document.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw exportFailed();
    if (assetsByVideo.has(source.videoId)) continue;
    const video = await run.rows.video(org, source.videoId);
    if (!video || video.deletedAt) throw exportFailed();
    // Every clip's sharp ranges of this video and its light copies, as the API's choice reads them.
    const assets = (await run.rows.videoAssets(org, video.id)).filter(
      (asset) => asset.kind === 'SEGMENT' || asset.kind === 'PROXY',
    );
    assetsByVideo.set(source.videoId, assets);
  }
  // The one rule (`pickSourceFiles`): a file per source, or per part of a montage that no single
  // sharp range covers.
  const picks = pickSourceFiles(input.document, (videoId) => assetsByVideo.get(videoId) ?? []);
  const wanted = new Set(
    picks.flatMap((entry) =>
      entry.parts ? entry.parts.map((part) => part.picked?.asset.id) : [entry.picked?.asset.id],
    ),
  );
  const sources: Record<string, RenderSourceAsset> = {};
  const segmentSources: Record<string, RenderSourceAsset> = {};
  const fetchedFiles = new Map<string, RenderSourceAsset>();
  let index = 0;
  const fetchFile = async (
    picked: { asset: AssetRow; sourceOffsetMs: number } | null,
  ): Promise<RenderSourceAsset> => {
    if (!picked) throw exportFailed();
    const known = fetchedFiles.get(picked.asset.id);
    if (known) return known;
    const file = `source-${index}.mp4`;
    const target = path.join(dir, file);
    try {
      await run.privateStorage.getToFile(picked.asset.key, target, signal);
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw exportFailed(error);
      throw error;
    }
    const facts = await run.tools.probe(target, { cwd: dir, signal });
    const asset: RenderSourceAsset = {
      file,
      sourceOffsetMs: picked.sourceOffsetMs,
      durationMs: facts.durationMs,
      width: facts.width,
      height: facts.height,
      fps: facts.fps,
      hasAudio: facts.hasAudio,
    };
    fetchedFiles.set(picked.asset.id, asset);
    index += 1;
    run.heartbeat();
    await run.progress.report({
      stage: 'fetching',
      progress: mapPercent((index / Math.max(1, wanted.size)) * 100, 0, 10),
    });
    return asset;
  };
  for (const entry of picks) {
    if (entry.parts) {
      for (const part of entry.parts) segmentSources[part.segmentId] = await fetchFile(part.picked);
    } else {
      sources[entry.sourceId] = await fetchFile(entry.picked);
    }
  }

  // A sticker that is not there is left out, and the plan stops with `sticker_missing`.
  const stickers = await fetchStickerFiles(
    { rows: run.stickerRows, storage: run.storage, privateStorage: run.privateStorage },
    org,
    input.document,
    dir,
    signal,
  );
  run.heartbeat();

  // A sound that is not there is left out too, and the plan stops with `sound_missing`.
  const sounds = run.soundRows
    ? await fetchSoundFiles(
        { rows: run.soundRows, storage: run.storage, privateStorage: run.privateStorage },
        org,
        input.document,
        dir,
        signal,
      )
    : {};
  run.heartbeat();

  // Sprint 13: the clip's captions (the transcript's words and the style), looked up inside the
  // workspace. Without the rows a clip with captions stops at the plan with `captions_missing`.
  // A montage (Module 11) has one captions track per video: each one's words are fetched.
  const fetched = run.captionRows
    ? await fetchCaptionsTracks(
        { rows: run.captionRows, privateStorage: run.privateStorage },
        org,
        input.videoId,
        input.document,
        dir,
        signal,
      )
    : {};
  const captions = fetched.captions;
  run.heartbeat();

  // The mark, when the plan asks for it: copied in under its plain name, with its real size.
  const watermark =
    input.watermark && run.watermark ? await copyWatermarkInto(run.watermark, dir) : null;

  // Throws a typed `RenderCompileError` (permanent) for anything it cannot draw.
  const plan = buildRenderPlan(input.document, {
    quality: input.quality,
    proof: input.proof,
    watermark: input.watermark,
    assets: {
      sources,
      stickers,
      sounds,
      // Captions draw with fonts too, so the folder is handed in for them as well.
      fonts:
        run.fonts && (families.length > 0 || captions !== undefined)
          ? { dir: FONTS_DIR, manifest: run.fonts.manifest }
          : null,
      watermark,
      captions: captions ?? null,
      ...(Object.keys(segmentSources).length > 0 ? { segmentSources } : {}),
      ...(fetched.captionsByTrack ? { captionsByTrack: fetched.captionsByTrack } : {}),
    },
  });
  // Only the twins this clip uses go into the job's fonts folder: libass sees nothing else to pick.
  if (run.fonts && plan.fonts.files.length > 0) {
    const missing = await copyFontsInto(run.fonts, plan.fonts.files, dir, FONTS_DIR);
    if (missing.length > 0) throw new ClipStepError('font_missing');
  }
  return plan;
}

export async function renderExecute(run: RenderRun, plan: RenderPlan): Promise<RenderedClip> {
  await run.progress.report({ stage: 'rendering', progress: 10 });
  const forced = forcedRenderFailure(run);
  if (forced) throw forced;
  const priority = priorityOf(run.input);

  // Pass 1: measure the mix (seconds); a clip with no sound skips both passes.
  let decision: LoudnessDecision | null = null;
  const measure = run.tools.measure ? compileMeasure(plan) : null;
  if (measure && run.tools.measure) {
    decision = decideLoudness(
      await run.tools.measure({
        scratchDir: run.dir,
        compiled: measure,
        signal: run.signal,
        ...priority,
      }),
    );
    run.heartbeat();
    if (run.signal.aborted) throw new ClipStepError('cancelled');
  }

  // Pass 2: the render, with the correction when the measure asked for one.
  const compiled = compileFfmpeg(plan, { loudness: decision });
  const rendered = await run.tools.render({
    scratchDir: run.dir,
    compiled,
    outFile: 'render.mp4',
    signal: run.signal,
    ...priority,
    onProgress: (update) => {
      void run.progress.report({
        stage: 'rendering',
        progress: mapPercent(update.percent, 10, 90),
      });
    },
  });

  // The file must be what the plan asked for before anything is stored or charged.
  if (run.tools.facts) {
    const facts = await run.tools.facts(rendered.file, {
      cwd: run.dir,
      signal: run.signal,
      ...priority,
    });
    run.heartbeat();
    const problems = verifyOutput(facts, expectedOutputOf(plan));
    if (problems.length > 0) {
      console.warn(
        JSON.stringify({ event: 'clips.render.output_invalid', jobId: run.job.id, problems }),
      );
      throw new ClipStepError('render_output_invalid', {
        cause: new Error(`The rendered file failed the check: ${problems.join(', ')}`),
      });
    }
  }

  // The finished file, measured again: the job records the loudness it really has.
  let final: LoudnessMeasure | null = null;
  if (decision?.apply && run.tools.measureFile) {
    final = await run.tools.measureFile({
      scratchDir: run.dir,
      file: path.basename(rendered.file),
      signal: run.signal,
      ...priority,
    });
  }
  return { ...rendered, loudness: loudnessResult(decision, final) };
}

/** The name in Media, always ending in `.mp4`. */
export function exportName(name: string): string {
  const trimmed = name.trim() || 'Clip';
  return /\.mp4$/i.test(trimmed) ? trimmed : `${trimmed}.mp4`;
}

export async function renderFinish(
  run: RenderRun,
  plan: RenderPlan,
  rendered: RenderClipResult & { loudness?: LoudnessResult },
): Promise<RenderOutcome> {
  const loudness = rendered.loudness ?? null;
  const { job, input } = run;
  const org = job.organizationId;
  const durationMs = plan.output.durationMs;
  const { width, height, fps } = plan.output;
  const facts = { durationMs, width, height, fps, bytes: rendered.bytes };
  await run.progress.report({ stage: 'finishing', progress: 90 });

  if (input.proof) {
    // Preview Export (Module 15): a private file kept 24 hours, no Media row, no bell.
    const proofKey = clipKeys.proofFile(org, job.id, 'proof', 'mp4');
    await run.privateStorage.putFile(proofKey, rendered.file, 'video/mp4');
    const expiresAt = new Date((run.now ?? (() => new Date()))().getTime() + PROOF_KEEP_MS);
    await run.rows.recordProof(org, {
      videoId: input.videoId,
      clipId: input.clipId,
      kind: 'PROOF',
      key: proofKey,
      bytes: rendered.bytes,
      mimeType: 'video/mp4',
      meta: { jobId: job.id, expiresAt: expiresAt.toISOString(), durationMs, width, height },
    });
    const finished = await run.progress.done(
      renderOutputSchema.parse({ mediaId: null, proofKey, loudness, ...facts }),
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
    width,
    height,
    fps,
    name: exportName(input.name),
    fingerprint: input.fingerprint ?? null,
  });
  const finished = await run.progress.done(
    renderOutputSchema.parse({ mediaId: answer.mediaId, proofKey: null, loudness, ...facts }),
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
