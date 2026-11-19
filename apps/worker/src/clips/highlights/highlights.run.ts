/**
 * One Find Clips run (Module 16 section 4), inside one scratch folder:
 *
 * | Stage      | Progress | What happens |
 * | ---------- | -------- | ------------ |
 * | `loudness` | 0-30     | The video's stored tracks are read; loudness is measured from the analysis sound unless a current one is stored |
 * | `scenes`   | 30-75    | Scene changes from the light copy's keyframes, unless stored |
 * | `chat`     | 75-90    | A Twitch past stream's chat, when a chat source is bound, unless stored |
 * | `scoring`  | 90-100   | `findHighlights`, the new tracks stored, then one transaction: the run DONE, old unopened AI clips out, new clips in |
 *
 * Rules:
 * - A track already stored for the video at its current version is reused,
 *   never measured again (a second run costs no FFmpeg time).
 * - A producer that fails (anything but a cancel) is logged and left out:
 *   the run goes on with the tracks it has. Only when every producer that
 *   ran failed and nothing is left does the run fail (and give its minutes
 *   back); a run that simply finds nothing is a success.
 * - Under `CLIPS_SIMULATION`, `[simulate:highlights-fail]` in the video's
 *   title fails the scoring step, and `[simulate:highlights-slow]` holds it
 *   for 30 seconds (so Cancel can be tried); both are ignored otherwise.
 */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  gunzipSignalsFile,
  gzipSignalsFile,
  mapPercent,
  SIGNALS_MIME,
  type SignalProducers,
} from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import {
  createClipDocument,
  findHighlights,
  type HighlightRange,
  type HighlightsInput,
  highlightsOutputSchema,
  outputDuration,
  reusableTrack,
  type SignalsAssetMeta,
  type SignalsFile,
  type SignalTrack,
  type SignalTrackName,
  type TrackName,
  withTracks,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import type { JobProgress } from '../job-progress';
import { highlightsSignalsKey } from '../keys';
import type {
  AssetRow,
  ClipRows,
  HighlightRunRow,
  NewHighlightClip,
  VideoLinkRow,
  VideoRow,
} from '../rows';

export const FAIL_MARKER = '[simulate:highlights-fail]';
export const SLOW_MARKER = '[simulate:highlights-slow]';
export const SLOW_HOLD_MS = 30_000;
/** Clip titles: "{video title} {n}", within the API's 200 characters. */
const MAX_TITLE = 200;

export interface HighlightsRun {
  jobId: string;
  organizationId: string;
  input: HighlightsInput;
  run: HighlightRunRow;
  video: VideoRow;
  link: VideoLinkRow;
  dir: string;
  signal: AbortSignal;
  producers: SignalProducers;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile' | 'delete'>;
  rows: Pick<ClipRows, 'videoAssets' | 'finishHighlights'>;
  progress: Pick<JobProgress, 'report' | 'flush'>;
  heartbeat(): void;
  now(): Date;
  /** `CLIPS_SIMULATION`: the forcing markers apply. */
  simulated: boolean;
  /** Tests shorten the slow marker's hold. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface HighlightsOutcome {
  /** False when the job was closed while it ran: nothing is kept. */
  finished: boolean;
  found: number;
  used: SignalTrackName[];
  /** Tracks measured in this run (the rest were reused). */
  measured: TrackName[];
  /** How long each stage took, in ms, for the log. */
  timings: Record<string, number>;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ClipStepError('cancelled', { retryable: false });
}

/** The newest stored SIGNALS file of the video, or none (a file that does not read is ignored). */
async function storedSignals(run: HighlightsRun, assets: AssetRow[]): Promise<SignalsFile | null> {
  const asset = assets.filter((row) => row.kind === 'SIGNALS').at(-1);
  if (!asset) return null;
  const file = path.join(run.dir, 'signals-stored.json.gz');
  try {
    await run.privateStorage.getToFile(asset.key, file, run.signal);
    return await gunzipSignalsFile(await readFile(file));
  } catch (error) {
    throwIfCancelled(run.signal);
    console.warn(
      JSON.stringify({
        event: 'clips.highlights.signals_unreadable',
        jobId: run.jobId,
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return null;
  }
}

/** One asset's file into the scratch folder; null when the video has none of that kind. */
async function fetchAsset(
  run: HighlightsRun,
  assets: AssetRow[],
  kind: AssetRow['kind'],
  name: string,
): Promise<string | null> {
  const asset = assets.filter((row) => row.kind === kind).at(-1);
  if (!asset) return null;
  const file = path.join(run.dir, name);
  await run.privateStorage.getToFile(asset.key, file, run.signal);
  return file;
}

type Measure = () => Promise<SignalTrack | null>;

/**
 * Runs one producer. A cancel is rethrown; any other failure is logged and
 * answers `failed`, so the run goes on with what it has.
 */
async function attempt(
  run: HighlightsRun,
  name: SignalTrackName,
  measure: Measure,
): Promise<{ track: SignalTrack | null; failed: boolean }> {
  try {
    const track = await measure();
    run.heartbeat();
    return { track, failed: false };
  } catch (error) {
    throwIfCancelled(run.signal);
    console.warn(
      JSON.stringify({
        event: 'clips.highlights.producer_failed',
        jobId: run.jobId,
        track: name,
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return { track: null, failed: true };
  }
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** "{video title} {n}", the video title cut so the whole fits. */
export function highlightTitle(videoTitle: string, n: number): string {
  const suffix = ` ${n}`;
  const base = videoTitle.trim() || 'Untitled Video';
  return `${base.slice(0, MAX_TITLE - suffix.length).trimEnd()}${suffix}`;
}

/** The clips for the ranges, best first, each a 9:16 document of its range. */
export function highlightClips(
  video: Pick<VideoRow, 'id' | 'title'>,
  link: Pick<VideoLinkRow, 'width' | 'height'>,
  ranges: readonly HighlightRange[],
): NewHighlightClip[] {
  return ranges.map((range, index) => {
    const document = createClipDocument({
      videoId: video.id,
      fromMs: range.fromMs,
      toMs: range.toMs,
      ratio: '9:16',
      fps: 30,
      ...(link.width && link.height ? { sourceAspect: link.width / link.height } : {}),
    });
    return {
      id: randomUUID(),
      title: highlightTitle(video.title, index + 1),
      range: { fromMs: range.fromMs, toMs: range.toMs },
      document: document as unknown as Record<string, unknown>,
      ratio: document.canvas.ratio,
      durationMs: outputDuration(document),
      score: range.score,
      reasons: [...range.reasons],
    };
  });
}

export async function runHighlights(run: HighlightsRun): Promise<HighlightsOutcome> {
  const { video, signal } = run;
  const durationMs = video.durationMs ?? 0;
  if (durationMs <= 0) throw new ClipStepError('highlights_failed', { retryable: false });
  const timings: Record<string, number> = {};
  const clock = () => run.now().getTime();

  // --- loudness ---------------------------------------------------------------------
  let started = clock();
  await run.progress.report({ stage: 'loudness', progress: 0 });
  const assets = await run.rows.videoAssets(run.organizationId, video.id);
  const stored = await storedSignals(run, assets);
  const reuse = (name: SignalTrackName) =>
    stored ? reusableTrack(stored, name, durationMs) : null;

  const tracks: SignalTrack[] = [];
  const measured: SignalTrack[] = [];
  let ran = 0;
  let failures = 0;
  const take = (result: { track: SignalTrack | null; failed: boolean }) => {
    ran += 1;
    if (result.failed) failures += 1;
    if (result.track) {
      tracks.push(result.track);
      measured.push(result.track);
    }
  };

  const storedLoudness = reuse('loudness');
  if (storedLoudness) tracks.push(storedLoudness);
  else if (video.hasAudio) {
    take(
      await attempt(run, 'loudness', async () => {
        const audioFile = await fetchAsset(run, assets, 'ANALYSIS_AUDIO', 'analysis.wav');
        await run.progress.report({ stage: 'loudness', progress: 10 });
        return run.producers.loudness({
          cwd: run.dir,
          durationMs,
          audioFile,
          signal,
          onProgress: (percent) =>
            void run.progress.report({ stage: 'loudness', progress: mapPercent(percent, 10, 30) }),
        });
      }),
    );
  }
  throwIfCancelled(signal);
  timings.loudness = clock() - started;

  // --- scenes ----------------------------------------------------------------------
  started = clock();
  await run.progress.report({ stage: 'scenes', progress: 30 });
  const storedScene = reuse('scene');
  if (storedScene) tracks.push(storedScene);
  else {
    take(
      await attempt(run, 'scene', async () => {
        const videoFile = await fetchAsset(run, assets, 'PROXY', 'proxy.mp4');
        if (!videoFile) return null;
        await run.progress.report({ stage: 'scenes', progress: 40 });
        return run.producers.scene({
          cwd: run.dir,
          durationMs,
          videoFile,
          signal,
          onProgress: (percent) =>
            void run.progress.report({ stage: 'scenes', progress: mapPercent(percent, 40, 75) }),
        });
      }),
    );
  }
  throwIfCancelled(signal);
  timings.scenes = clock() - started;

  // --- chat ------------------------------------------------------------------------
  started = clock();
  await run.progress.report({ stage: 'chat', progress: 75 });
  const storedChat = reuse('chat');
  if (storedChat) tracks.push(storedChat);
  else if (
    run.link.platform === 'twitch' &&
    run.link.kind === 'past_stream' &&
    run.producers.chatEnabled
  ) {
    // Chat that cannot be read is not a failure: the run says which tracks it used.
    const result = await attempt(run, 'chat', () =>
      run.producers.chat({
        platform: run.link.platform,
        kind: run.link.kind,
        externalId: run.link.externalId,
        durationMs,
        signal,
      }),
    );
    if (result.track) {
      tracks.push(result.track);
      measured.push(result.track);
    }
  }
  const storedReplayed = reuse('replayed');
  if (storedReplayed) tracks.push(storedReplayed);
  throwIfCancelled(signal);
  timings.chat = clock() - started;

  // --- scoring ---------------------------------------------------------------------
  started = clock();
  await run.progress.report({ stage: 'scoring', progress: 90 });
  if (run.simulated && video.title.includes(SLOW_MARKER)) {
    const until = clock() + SLOW_HOLD_MS;
    while (clock() < until && !signal.aborted) {
      run.heartbeat();
      await (run.sleep ?? defaultSleep)(1_000, signal);
    }
    throwIfCancelled(signal);
  }
  if (run.simulated && video.title.includes(FAIL_MARKER)) {
    throw new ClipStepError('highlights_failed', { retryable: false });
  }
  if (tracks.length === 0 && ran > 0 && failures === ran) {
    // Every producer that ran broke: charging for that would be wrong.
    throw new ClipStepError('highlights_failed', { retryable: false });
  }

  const result = findHighlights(tracks, { durationMs });
  const clips = highlightClips(video, run.link, result.ranges);
  throwIfCancelled(signal);

  // The new tracks join the stored ones; nothing to write when all were reused.
  let signalsAsset = null;
  const key = highlightsSignalsKey(run.organizationId, video.id, run.jobId);
  if (measured.length > 0) {
    const merged = withTracks(stored, durationMs, measured);
    const bytes = await gzipSignalsFile(merged);
    const file = path.join(run.dir, 'signals.json.gz');
    await writeFile(file, bytes);
    await run.privateStorage.putFile(key, file, SIGNALS_MIME);
    const meta: SignalsAssetMeta = {
      durationMs: merged.durationMs,
      tracks: merged.tracks.map((track) => ({ name: track.name, version: track.version })),
    };
    signalsAsset = {
      id: run.jobId,
      videoId: video.id,
      kind: 'SIGNALS' as const,
      key,
      bytes: bytes.length,
      mimeType: SIGNALS_MIME,
      meta: { ...meta },
    };
  }
  await run.progress.report({ stage: 'scoring', progress: 97 });

  const output = highlightsOutputSchema.parse({ found: clips.length, used: result.used });
  let finished: Awaited<ReturnType<ClipRows['finishHighlights']>>;
  try {
    finished = await run.rows.finishHighlights({
      jobId: run.jobId,
      organizationId: run.organizationId,
      videoId: video.id,
      runId: run.input.runId,
      clips,
      tracks: result.used,
      signals: signalsAsset,
      output,
      createdById: run.run.createdById,
      now: run.now(),
    });
  } catch (error) {
    if (signalsAsset) await deleteQuietly(run.privateStorage, [key]);
    throw error;
  }
  if (!finished.finished) {
    if (signalsAsset) await deleteQuietly(run.privateStorage, [key]);
    return { finished: false, found: 0, used: [], measured: [], timings };
  }
  await deleteQuietly(run.privateStorage, finished.replacedKeys);
  timings.scoring = clock() - started;

  console.log(
    JSON.stringify({
      event: 'clips.highlights.done',
      jobId: run.jobId,
      runId: run.input.runId,
      found: clips.length,
      used: result.used,
      skipped: result.skipped,
      measured: measured.map((track) => track.name),
      replaced: finished.replaced,
      covered: finished.covered,
      timings,
    }),
  );
  return {
    finished: true,
    found: clips.length,
    used: result.used,
    measured: measured.map((track) => track.name),
    timings,
  };
}
