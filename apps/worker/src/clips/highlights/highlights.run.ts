/**
 * One Find Clips run (Module 16 section 4), inside one scratch folder:
 *
 * | Stage      | Progress | What happens |
 * | ---------- | -------- | ------------ |
 * | `loudness` | 0-30     | The video's stored tracks are read; loudness is measured from the analysis sound unless a current one is stored |
 * | `scenes`   | 30-75    | Scene changes from the light copy's keyframes, unless stored |
 * | `chat`     | 75-80    | A Twitch past stream's chat, when a chat source is bound, unless stored |
 * | `listening`| 80-86    | Sprint 13, a run with a setup: waits for its listening job (Module 02), when the stretch was not listened to yet |
 * | `reading`  | 86-90    | Sprint 13: the API reads the transcript for moments (`pickMoments`) |
 * | `scoring`  | 90-100   | `findHighlights`, and with a setup the moments blended with the signals of the chosen stretch; the new tracks stored, then one transaction: the run DONE, old unopened AI clips out, new clips in |
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
import { type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import type { ClipPickedMoment } from '@postgear/scheduling';
import {
  type BlendedClip,
  blendWithSignals,
  builtInCaptionStyle,
  type ClipSetup,
  captionLookSchema,
  clipSetupSchema,
  createCaptionsTrack,
  createClipDocument,
  DEFAULT_CAPTION_STYLE,
  findHighlights,
  genreTuning,
  readTranscriptAssetMeta,
  type TitledCandidate,
  withCaptionsTrack,
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
import type { ClipInternalClient } from '../internal-client';
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
  rows: Pick<ClipRows, 'videoAssets' | 'finishHighlights'> &
    Partial<Pick<ClipRows, 'job' | 'captionStyle'>>;
  /** Sprint 13, Module 05: the API's moment picker (a run with a setup). */
  internal?: Pick<ClipInternalClient, 'pickMoments'>;
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

/**
 * The newest stored SIGNALS file of the video, or none. Only a file that is
 * really gone from storage, or one that does not read, counts as none (its
 * tracks are measured again). Any other storage failure fails the step, to
 * be tried again: going on without the file would write a new one without
 * the stored tracks no producer can measure again (the heat map).
 */
async function storedSignals(run: HighlightsRun, assets: AssetRow[]): Promise<SignalsFile | null> {
  const asset = assets.filter((row) => row.kind === 'SIGNALS').at(-1);
  if (!asset) return null;
  const file = path.join(run.dir, 'signals-stored.json.gz');
  const skip = (error: unknown) => {
    console.warn(
      JSON.stringify({
        event: 'clips.highlights.signals_unreadable',
        jobId: run.jobId,
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return null;
  };
  try {
    await run.privateStorage.getToFile(asset.key, file, run.signal);
  } catch (error) {
    throwIfCancelled(run.signal);
    if (error instanceof StorageNotFoundError) return skip(error);
    // A storage hiccup: `tool_failed`, retryable (`classifyClipError`).
    throw error;
  }
  try {
    return await gunzipSignalsFile(await readFile(file));
  } catch (error) {
    // The same bytes read the same way next time: measuring again is the only way on.
    return skip(error);
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

/** Sprint 13, Module 05: the run's setup, or null for Sprint 12's run (Quick Find). */
export function readRunSetup(
  params: unknown,
): { setup: ClipSetup; listenJobId: string | null } | null {
  if (!params || typeof params !== 'object') return null;
  const value = params as Record<string, unknown>;
  const setup = clipSetupSchema.safeParse(value.setup);
  if (!setup.success) return null;
  return {
    setup: setup.data,
    listenJobId: typeof value.listenJobId === 'string' ? value.listenJobId : null,
  };
}

/** How often the listening job is looked at, and the longest the run waits for it. */
export const LISTEN_POLL_MS = 2_000;
const TERMINAL = new Set(['DONE', 'FAILED', 'CANCELLED']);

/** The listening job's end (any end: no words simply means the signals alone). */
async function waitForListening(run: HighlightsRun, listenJobId: string): Promise<void> {
  if (!run.rows.job) return;
  let progress = 80;
  for (;;) {
    throwIfCancelled(run.signal);
    const job = await run.rows.job(run.organizationId, listenJobId);
    if (!job || TERMINAL.has(job.status)) return;
    run.heartbeat();
    progress = Math.min(85, progress + 0.25);
    await run.progress.report({ stage: 'listening', progress: Math.floor(progress) });
    await (run.sleep ?? defaultSleep)(LISTEN_POLL_MS, run.signal);
  }
}

/** The moments as the blend takes them. */
function asCandidates(moments: readonly ClipPickedMoment[]): TitledCandidate[] {
  return moments.map((moment) => ({ ...moment, title: moment.title }));
}

/**
 * The captions track for a new clip, when the setup asks for captions and
 * the video has a transcript in its language: a built-in style's look, or
 * the workspace's own style read from its row (the default look otherwise).
 */
async function captionsFor(
  run: HighlightsRun,
  setup: ClipSetup,
): Promise<ReturnType<typeof createCaptionsTrack> | null> {
  if (!setup.captions.on) return null;
  const assets = await run.rows.videoAssets(run.organizationId, run.video.id);
  const transcripts = assets
    .filter((row) => row.kind === 'TRANSCRIPT')
    .map((row) => ({ row, meta: readTranscriptAssetMeta(row.meta) }))
    .filter((item) => item.meta !== null && item.meta.source === 'listened');
  const found =
    setup.language === 'auto'
      ? transcripts[0]
      : transcripts.find((item) => item.meta?.language === setup.language);
  if (!found?.meta) return null;
  let styleId = setup.captions.styleId;
  let look = builtInCaptionStyle(styleId)?.look ?? null;
  if (!look && run.rows.captionStyle) {
    const own = await run.rows.captionStyle(run.organizationId, styleId);
    const parsed = own ? captionLookSchema.safeParse(own.look) : null;
    look = parsed?.success ? parsed.data : null;
  }
  if (!look) {
    styleId = DEFAULT_CAPTION_STYLE;
    look = builtInCaptionStyle(DEFAULT_CAPTION_STYLE)?.look ?? null;
  }
  if (!look) return null;
  return createCaptionsTrack({
    transcriptAssetId: found.row.id,
    language: found.meta.language,
    styleId,
    look,
  });
}

/** The clips of a run with a setup: its shape, its captions, the AI's titles. */
export function setupClips(
  video: Pick<VideoRow, 'id' | 'title'>,
  link: Pick<VideoLinkRow, 'width' | 'height'>,
  blended: readonly BlendedClip[],
  setup: ClipSetup,
  captions: ReturnType<typeof createCaptionsTrack> | null,
): NewHighlightClip[] {
  return blended.map((clip, index) => {
    const base = createClipDocument({
      videoId: video.id,
      fromMs: clip.fromMs,
      toMs: clip.toMs,
      ratio: setup.ratio,
      fps: 30,
      ...(link.width && link.height ? { sourceAspect: link.width / link.height } : {}),
    });
    const document = captions ? withCaptionsTrack(base, captions) : base;
    return {
      id: randomUUID(),
      title: clip.title?.trim()
        ? clip.title.trim().slice(0, MAX_TITLE)
        : highlightTitle(video.title, index + 1),
      range: { fromMs: clip.fromMs, toMs: clip.toMs },
      document: document as unknown as Record<string, unknown>,
      ratio: document.canvas.ratio,
      durationMs: outputDuration(document),
      score: clip.score,
      reasons: [...clip.reasons],
      origin: clip.origin,
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

  // --- listening and reading (Sprint 13, a run with a setup) ------------------------------
  const chosen = readRunSetup(run.run.params);
  let picked: { moments: ClipPickedMoment[]; noSpeech: boolean; asked: boolean } | null = null;
  if (chosen) {
    started = clock();
    await run.progress.report({ stage: 'listening', progress: 80 });
    if (chosen.listenJobId) await waitForListening(run, chosen.listenJobId);
    timings.listening = clock() - started;

    started = clock();
    await run.progress.report({ stage: 'reading', progress: 86 });
    if (!run.internal) throw new ClipStepError('highlights_failed', { retryable: false });
    picked = await run.internal.pickMoments(run.jobId, { organizationId: run.organizationId });
    run.heartbeat();
    throwIfCancelled(signal);
    timings.reading = clock() - started;
  }

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
  let clips: NewHighlightClip[];
  let ai: { read: boolean; noSpeech: boolean; asked: boolean; matched: number } | undefined;
  if (chosen && picked) {
    const { range } = chosen.setup;
    // Only the signal moments inside the chosen stretch take part.
    const inside = result.ranges.filter((one) => {
      const middle = (one.fromMs + one.toMs) / 2;
      return middle >= range.fromMs && middle < range.toMs;
    });
    const blended = blendWithSignals(
      asCandidates(picked.moments),
      inside,
      genreTuning(chosen.setup.genre),
    );
    clips = setupClips(
      video,
      run.link,
      blended,
      chosen.setup,
      await captionsFor(run, chosen.setup),
    );
    ai = {
      read: !picked.noSpeech,
      noSpeech: picked.noSpeech,
      asked: picked.asked,
      matched: blended.filter((clip) => clip.matchesRequest).length,
    };
  } else {
    clips = highlightClips(video, run.link, result.ranges);
  }
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

  const output = highlightsOutputSchema.parse({
    found: clips.length,
    used: result.used,
    ...(ai ? { ai } : {}),
  });
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
