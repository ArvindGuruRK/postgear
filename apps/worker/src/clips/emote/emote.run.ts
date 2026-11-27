/**
 * Emote Maker (Sprint 13, Module 14): `clipEmoteWorkflow`'s one activity,
 * every step in one scratch folder.
 *
 * | Step | Stage, progress | What it does |
 * |---|---|---|
 * | fetch  | fetching, 0 to 10   | The file that covers the stretch: a clip's sharp range when one covers it (the same `pickSharpSource` rule an export uses), else the light copy. Read to scratch and measured with ffprobe |
 * | encode | encoding, 10 to 90  | One file per size, largest first, each down its ladder (`climbLadder`): FFmpeg with an argument array and the graph in `graph.txt`, then the file's own bytes measured (size, frames, loop). A required file that cannot fit fails the job with `emote_too_big`; an extra that cannot fit is listed and left out |
 * | finish | finishing, 90 to 100 | Every kept file and a stored (not compressed) zip of them go to `clips/<orgId>/exports/<jobId>/`, then the job is DONE with the names and sizes |
 *
 * No AI minutes and no watermark. The one download unit the API charged is
 * given back by `failJob` when anything here fails. The files are short
 * lived: no asset row points at them, so the orphan sweep removes them after
 * 24 hours, and the API refuses links to them after that.
 *
 * Simulation: the same real FFmpeg on whatever the import stored (the local
 * samples); a video whose title holds `[simulate:emote-too-big]` measures
 * every rung of its first required file as over the cap, so the ladder runs
 * out and the job fails the way a too-big emote does, without the encodes.
 *
 * Logs carry ids and counts only, never a picture or a name a person typed.
 */
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type MediaFacts, mapPercent, type RunTool } from '@postgear/media-tools';
import { clipKeys, type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import {
  climbLadder,
  compileEmote,
  EMOTE_GRAPH_FILE,
  type EmoteFile,
  type EmoteJobInput,
  type EmoteJobOutput,
  type EmoteMeasure,
  emoteOutputSchema,
  type EmoteRung,
  type EmoteSource,
  type EmoteStep,
  pickSharpSource,
  planEmote,
} from '@postgear/video-engine';
import { zipSync } from 'fflate';
import { ClipStepError } from '../failures';
import type { JobProgress } from '../job-progress';
import type { ClipRows, JobRow } from '../rows';
import { readEmoteFacts } from './emote-facts';

/** Forces the ladder to run out under simulation (also matched with a space). */
export const EMOTE_TOO_BIG_MARKER = '[simulate:emote-too-big]';
const EMOTE_TOO_BIG = /\[simulate[: ]emote-too-big\]/i;

/** Quiet, never reads stdin, overwrites (each rung writes the same name). */
const QUIET_HEAD = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'] as const;

/** One encode of at most 3 seconds into a file of at most 256 px. */
const ENCODE_TIMEOUT_MS = 120_000;

const SOURCE_FILE = 'source-0.mp4';

const CONTENT_TYPES: Record<EmoteFile['format'], string> = {
  gif: 'image/gif',
  webp: 'image/webp',
  apng: 'image/apng',
  png: 'image/png',
};

export interface EmoteRun {
  job: JobRow;
  input: EmoteJobInput;
  /** The job's scratch folder. */
  dir: string;
  signal: AbortSignal;
  runTool: RunTool;
  probe(file: string, opts: { cwd: string; signal: AbortSignal }): Promise<MediaFacts>;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile' | 'deletePrefix'>;
  rows: Pick<ClipRows, 'video' | 'videoAssets'>;
  progress: Pick<JobProgress, 'report' | 'flush' | 'done'>;
  heartbeat(): void;
  simulated: boolean;
  /** Temporal's attempt: a later one starts the job's folder clean. */
  attempt: number;
}

export interface EmoteOutcome {
  /** False when the job was closed by someone else before it could finish; nothing is kept. */
  finished: boolean;
  output: EmoteJobOutput | null;
}

function emoteFailed(cause?: unknown): ClipStepError {
  return new ClipStepError('emote_failed', { retryable: false, cause });
}

/** `emote-twitch-112.gif` as its key name and extension. */
function keyParts(fileName: string): {
  name: string;
  ext: 'gif' | 'webp' | 'apng' | 'png' | 'zip';
} {
  const dot = fileName.lastIndexOf('.');
  return {
    name: fileName.slice(0, dot),
    ext: fileName.slice(dot + 1) as 'gif' | 'webp' | 'apng' | 'png' | 'zip',
  };
}

/** Step 1: the covering file in scratch, and where it sits in the video. */
async function fetchSource(run: EmoteRun): Promise<{ source: EmoteSource; sharp: boolean }> {
  const { job, input, dir, signal } = run;
  const org = job.organizationId;
  const video = await run.rows.video(org, input.videoId);
  if (!video || video.deletedAt || video.status !== 'READY') throw emoteFailed();
  const assets = (await run.rows.videoAssets(org, video.id)).filter(
    (asset) => asset.kind === 'SEGMENT' || asset.kind === 'PROXY',
  );
  const picked = pickSharpSource({ fromMs: input.startMs, toMs: input.endMs }, assets);
  if (!picked) throw emoteFailed();
  try {
    await run.privateStorage.getToFile(picked.asset.key, path.join(dir, SOURCE_FILE), signal);
  } catch (error) {
    if (error instanceof StorageNotFoundError) throw emoteFailed(error);
    throw error;
  }
  const facts = await run.probe(path.join(dir, SOURCE_FILE), { cwd: dir, signal });
  run.heartbeat();
  return {
    source: {
      file: SOURCE_FILE,
      offsetMs: picked.sourceOffsetMs,
      width: facts.width,
      height: facts.height,
    },
    sharp: picked.sharp,
  };
}

/** One encode at one rung, measured from the file's own bytes. */
async function encodeAt(
  run: EmoteRun,
  plan: ReturnType<typeof planEmote>,
  step: EmoteStep,
  rung: EmoteRung,
  source: EmoteSource,
): Promise<EmoteMeasure> {
  const compiled = compileEmote(plan, step, rung, source, run.input.frame);
  await writeFile(path.join(run.dir, EMOTE_GRAPH_FILE), compiled.graph, 'utf8');
  try {
    await run.runTool('ffmpeg', [...QUIET_HEAD, ...compiled.args], {
      cwd: run.dir,
      timeoutMs: ENCODE_TIMEOUT_MS,
      signal: run.signal,
    });
  } catch (error) {
    if (run.signal.aborted) throw error;
    throw new ClipStepError('emote_failed', { retryable: true, cause: error });
  }
  run.heartbeat();
  const data = await readFile(path.join(run.dir, step.fileName));
  const facts = readEmoteFacts(data, step.output.format);
  if (!facts || facts.width !== step.output.size || facts.height !== step.output.size) {
    throw new ClipStepError('emote_failed', { retryable: true });
  }
  // A moving file must loop for ever; a still has one frame.
  if (!step.still && facts.loops !== 0)
    throw new ClipStepError('emote_failed', { retryable: true });
  return { bytes: data.length, frames: facts.frames };
}

export async function runEmote(run: EmoteRun): Promise<EmoteOutcome> {
  const { job, input, dir } = run;
  const org = job.organizationId;
  const plan = planEmote(input);

  await run.progress.report({ stage: 'fetching', progress: 0 });
  if (run.attempt > 1) {
    // A dead attempt may have stored some files: start the job's folder clean.
    await run.privateStorage.deletePrefix(clipKeys.exportPrefix(org, job.id));
  }
  const { source, sharp } = await fetchSource(run);
  await run.progress.report({ stage: 'fetching', progress: 10 });

  const video = run.simulated ? await run.rows.video(org, input.videoId) : null;
  const forceTooBig = video !== null && EMOTE_TOO_BIG.test(video.title);
  const forcedStep = forceTooBig ? plan.steps.find((step) => step.required) : undefined;

  const files: EmoteFile[] = [];
  const kept: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const result = await climbLadder(plan.profile, step.output, plan.seconds, async (rung) => {
      if (step === forcedStep) return { bytes: step.output.maxBytes + 1, frames: 1 };
      return encodeAt(run, plan, step, rung, source);
    });
    if (!result.fits && step.required) {
      console.warn(
        JSON.stringify({
          event: 'clips.emote.too_big',
          jobId: job.id,
          platform: input.platform,
          size: step.output.size,
          rungs: result.rung.index,
        }),
      );
      throw new ClipStepError('emote_too_big', { retryable: false });
    }
    files.push({
      name: step.fileName,
      size: step.output.size,
      format: step.output.format,
      bytes: result.measure.bytes,
      maxBytes: step.output.maxBytes,
      fits: result.fits,
      rung: result.rung.index,
      frames: result.measure.frames,
      fps: step.still ? 0 : result.rung.fps,
      extra: !step.required,
    });
    if (result.fits) kept.push(step.fileName);
    else await rm(path.join(dir, step.fileName), { force: true });
    await run.progress.report({
      stage: 'encoding',
      progress: mapPercent(((index + 1) / plan.steps.length) * 100, 10, 90),
    });
  }

  await run.progress.report({ stage: 'finishing', progress: 90 });
  // Stored, not compressed: GIF, WebP and PNG are compressed already.
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const name of kept) entries[name] = [await readFile(path.join(dir, name)), { level: 0 }];
  const zipBytes = zipSync(entries);
  await writeFile(path.join(dir, plan.zipName), zipBytes);

  for (const file of files.filter((candidate) => candidate.fits)) {
    const { name, ext } = keyParts(file.name);
    await run.privateStorage.putFile(
      clipKeys.exportFile(org, job.id, name, ext),
      path.join(dir, file.name),
      CONTENT_TYPES[file.format],
    );
    run.heartbeat();
  }
  const zipKey = keyParts(plan.zipName);
  await run.privateStorage.putFile(
    clipKeys.exportFile(org, job.id, zipKey.name, zipKey.ext),
    path.join(dir, plan.zipName),
    'application/zip',
  );
  const zipStat = await stat(path.join(dir, plan.zipName));

  const output = emoteOutputSchema.parse({
    platform: input.platform,
    files,
    zip: { name: plan.zipName, bytes: zipStat.size },
    sharp,
  });
  const finished = await run.progress.done(output);
  if (!finished) {
    // Cancelled while packing: nothing of this job is kept.
    await run.privateStorage.deletePrefix(clipKeys.exportPrefix(org, job.id));
    return { finished: false, output: null };
  }
  console.log(
    JSON.stringify({
      event: 'clips.emote.done',
      jobId: job.id,
      platform: input.platform,
      files: kept.length,
      left: files.length - kept.length,
      highestRung: Math.max(...files.map((file) => file.rung)),
      sharp,
    }),
  );
  return { finished: true, output };
}
