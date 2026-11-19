/**
 * The import, as the five steps of Module 04 section 3, each its own function
 * so each can be tested on its own:
 *
 * | Step              | Stage, progress  | What it does |
 * |-------------------|------------------|--------------|
 * | `importFetch`     | fetching 0-70    | Link: the light copy from the downloader. Upload: the ORIGINAL from private storage |
 * | `importInspect`   | preparing 72     | ffprobe; refuse what is not a video or too long; charge an upload's minutes; write the facts |
 * | `importNormalise` | preparing 72-85  | The light copy (remux when it already fits) |
 * | `importDerive`    | preparing 85-97  | Analysis sound and filmstrip in one decode, the waveform, the poster, a YouTube heat map as the first signal track |
 * | `importStore`     | preparing 97-100 | Recheck the space, store every file, then one transaction: rows, video READY, job DONE, the bell |
 *
 * They all run inside one activity and one scratch folder (`runImport`), so
 * no file has to survive a worker restart: a restart retries the whole
 * import from the start in a fresh folder, and the keys every attempt writes
 * are derived from the job id, so whatever a dead attempt stored is found
 * and removed (`allImportKeys`).
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type DeriveResult,
  type Downloader,
  DownloaderError,
  gzipSignalsFile,
  type MediaFacts,
  mapPercent,
  type NormaliseResult,
  type PosterResult,
  ProbeError,
  SIGNALS_MIME,
} from '@postgear/media-tools';
import {
  CLIP_EXTENSIONS,
  type ClipExtension,
  type PrivateStorage,
  StorageNotFoundError,
} from '@postgear/storage';
import {
  type AnalysisAudioMeta,
  type FilmstripMeta,
  type ImportInput,
  importOutputSchema,
  type PosterMeta,
  type ProxyMeta,
  replayedTrack,
  SIGNALS_FILE_FORMAT,
  type SignalsAssetMeta,
  type WaveformMeta,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { ClipInternalClient } from '../internal-client';
import type { JobProgress } from '../job-progress';
import { importKeys } from '../keys';
import { videoReadyNotification } from '../notifications';
import type { ClipRows, NewAsset, VideoRow } from '../rows';
import { type ImportTools, peaksToJson } from './import.tools';

/** Videos longer than this get a 480 light copy instead of 720 (Module 03, `fetchProxy`). */
export const LONG_VIDEO_MS = 2 * 60 * 60_000;

/** Rough bitrate of a 720 light copy, for the disk estimate when the size is unknown. */
const PROXY_BYTES_PER_SECOND = (2_500_000 / 8) * 1.2;

export interface ImportRun {
  jobId: string;
  organizationId: string;
  input: ImportInput;
  video: VideoRow;
  /** The job's scratch folder (absolute, already made). */
  dir: string;
  signal: AbortSignal;
  tools: ImportTools;
  downloader: Downloader;
  privateStorage: PrivateStorage;
  internal: Pick<ClipInternalClient, 'chargeImport'>;
  rows: ClipRows;
  progress: Pick<JobProgress, 'report' | 'flush'>;
  heartbeat(): void;
  now(): Date;
}

export interface FetchedVideo {
  /** Absolute path of what came in. */
  file: string;
  bytes: number;
}

export interface DerivedFiles {
  analysisAudio: DeriveResult['analysisAudio'];
  filmstrip: DeriveResult['filmstrip'];
  /** The waveform as JSON, ready to store. */
  waveform: { file: string; bytes: number; meta: WaveformMeta };
  poster: PosterResult;
  /**
   * Module 16: the video's first signal track (YouTube's heat map, from the
   * probe), gzipped; absent when the platform gave none.
   */
  signals?: { file: string; bytes: number; meta: SignalsAssetMeta };
}

export interface ImportOutcome {
  /** False when the job (or the video) was closed while it ran: nothing is kept. */
  stored: boolean;
  assets: number;
  durationMs: number;
}

/** 720 for videos up to two hours (or of unknown length), 480 above. */
export function proxyHeightFor(durationMs: number | null | undefined): 720 | 480 {
  return typeof durationMs === 'number' && durationMs > LONG_VIDEO_MS ? 480 : 720;
}

/**
 * What the scratch disk must hold: the incoming file, the light copy and the
 * small files, so about two and a half times the incoming size.
 */
export function scratchBytesNeeded(incomingBytes: number): number {
  return Math.ceil(Math.max(0, incomingBytes) * 2.5);
}

function estimateIncomingBytes(input: ImportInput, video: VideoRow): number {
  if (input.expectedBytes !== null && input.expectedBytes > 0) return input.expectedBytes;
  const seconds = (video.durationMs ?? 0) / 1000;
  return Math.ceil(seconds * PROXY_BYTES_PER_SECOND);
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ClipStepError('cancelled');
}

/** The ORIGINAL's file extension, from its key (always one of the private allowlist). */
export function originalExtension(key: string): ClipExtension {
  const dot = key.lastIndexOf('.');
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : '';
  if (!(CLIP_EXTENSIONS as readonly string[]).includes(ext) || ext.includes('.')) {
    throw new ClipStepError('tool_failed', { retryable: false });
  }
  return ext as ClipExtension;
}

// --- 1. Fetch ----------------------------------------------------------------------

export async function importFetch(run: ImportRun): Promise<FetchedVideo> {
  const { input, dir, signal, progress } = run;
  await progress.report({ stage: 'fetching', progress: 0 });

  if (input.origin.type === 'link') {
    const used = await run.rows.storageUsedBytes(run.organizationId);
    const left = input.limits.storageBytes - used;
    if (left <= 0) throw new ClipStepError('clips_storage_full');
    await run.tools.freeDisk(dir, scratchBytesNeeded(estimateIncomingBytes(input, run.video)));

    try {
      const fetched = await run.downloader.fetchProxy(
        {
          link: input.origin.link,
          maxHeight: proxyHeightFor(run.video.durationMs),
          outFile: path.join(dir, 'incoming.mp4'),
          maxBytes: left,
          maxDurationMs: input.limits.maxVideoMs,
        },
        (update) => {
          if (update.percent !== null) {
            void progress.report({
              stage: 'fetching',
              progress: mapPercent(update.percent, 0, 70),
            });
          }
        },
        signal,
      );
      return { file: fetched.path, bytes: fetched.bytes };
    } catch (error) {
      // Past the space left: the workspace's storage, not a tool fault.
      if (error instanceof DownloaderError && error.code === 'too_big') {
        throw new ClipStepError('clips_storage_full', { cause: error });
      }
      throw error;
    }
  }

  const originalKey = input.origin.originalKey;
  const original = (await run.rows.videoAssets(run.organizationId, run.video.id)).find(
    (asset) => asset.kind === 'ORIGINAL' && asset.key === originalKey,
  );
  await run.tools.freeDisk(dir, scratchBytesNeeded(original?.bytes ?? 0));
  const file = path.join(dir, `original.${originalExtension(originalKey)}`);
  try {
    await run.privateStorage.getToFile(originalKey, file, signal);
  } catch (error) {
    // The uploaded file is gone (deleted, or the upload never completed): no retry brings it back.
    if (error instanceof StorageNotFoundError) {
      throw new ClipStepError('tool_failed', { retryable: false, cause: error });
    }
    throw error;
  }
  throwIfCancelled(signal);
  await progress.report({ stage: 'fetching', progress: 70 });
  return { file, bytes: original?.bytes ?? 0 };
}

// --- 2. Inspect --------------------------------------------------------------------

export async function importInspect(run: ImportRun, fetched: FetchedVideo): Promise<MediaFacts> {
  const { input, progress } = run;
  await progress.report({ stage: 'preparing', progress: 72 });

  let facts: MediaFacts;
  try {
    facts = await run.tools.probe(fetched.file, { cwd: run.dir, signal: run.signal });
  } catch (error) {
    // A fetched light copy that ffprobe cannot read is our fault, not the person's file.
    if (
      input.origin.type === 'link' &&
      error instanceof ProbeError &&
      error.code === 'upload_not_video'
    ) {
      throw new ClipStepError('tool_failed', { retryable: true, cause: error });
    }
    throw error;
  }

  if (facts.durationMs > input.limits.maxVideoMs) {
    throw new ClipStepError('clips_video_too_long');
  }

  // An upload's length is known only now, so its minutes are charged here
  // (key `clips.import:<jobId>`: a retried attempt is charged once).
  if (input.origin.type === 'upload') {
    await run.internal.chargeImport(run.jobId, {
      organizationId: run.organizationId,
      durationMs: facts.durationMs,
    });
  }

  await run.rows.writeVideoFacts(run.organizationId, run.video.id, {
    durationMs: facts.durationMs,
    width: facts.width,
    height: facts.height,
    fps: facts.fps,
    hasAudio: facts.hasAudio,
  });
  run.heartbeat();
  return facts;
}

// --- 3. Normalise ------------------------------------------------------------------

export async function importNormalise(
  run: ImportRun,
  fetched: FetchedVideo,
  facts: MediaFacts,
): Promise<NormaliseResult> {
  const result = await run.tools.normalise({
    cwd: run.dir,
    signal: run.signal,
    input: fetched.file,
    output: path.join(run.dir, 'proxy.mp4'),
    facts,
    maxShortSide: proxyHeightFor(facts.durationMs),
    onProgress: (percent) => {
      void run.progress.report({ stage: 'preparing', progress: mapPercent(percent, 72, 85) });
    },
  });
  // The incoming file is no longer needed (an upload keeps its ORIGINAL in storage).
  if (path.resolve(fetched.file) !== path.resolve(result.file)) {
    await rm(fetched.file, { force: true }).catch(() => undefined);
  }
  await run.progress.report({ stage: 'preparing', progress: 85 });
  return result;
}

// --- 4. Derive ---------------------------------------------------------------------

export async function importDerive(
  run: ImportRun,
  proxy: NormaliseResult,
  facts: MediaFacts,
): Promise<DerivedFiles> {
  const filmstripDir = path.join(run.dir, 'filmstrip');
  await mkdir(filmstripDir, { recursive: true });
  const durationMs = facts.durationMs;

  const derived = await run.tools.derive({
    cwd: run.dir,
    signal: run.signal,
    input: proxy.file,
    outDir: filmstripDir,
    analysisOut: path.join(run.dir, 'analysis.wav'),
    facts: { durationMs, hasAudio: facts.hasAudio },
    // The light copy has a keyframe every two seconds, and no filmstrip
    // interval is shorter, so decoding keyframes only loses nothing.
    keyframesOnly: true,
    onProgress: (percent) => {
      void run.progress.report({ stage: 'preparing', progress: mapPercent(percent, 85, 93) });
    },
  });
  throwIfCancelled(run.signal);

  const peaks = await run.tools.waveform({
    wavFile: derived.analysisAudio?.file ?? null,
    output: path.join(run.dir, 'waveform.bin'),
    signal: run.signal,
  });
  const waveformJson = path.join(run.dir, 'waveform.json');
  const waveformBytes = await peaksToJson(peaks.file, waveformJson);
  await run.progress.report({ stage: 'preparing', progress: 95 });

  const poster = await run.tools.poster({
    cwd: run.dir,
    signal: run.signal,
    input: proxy.file,
    output: path.join(run.dir, 'poster.jpg'),
    facts: { durationMs, width: proxy.meta.width, height: proxy.meta.height },
  });
  await run.progress.report({ stage: 'preparing', progress: 97 });

  const signals = await replayedSignals(run, durationMs);
  return {
    analysisAudio: derived.analysisAudio,
    filmstrip: derived.filmstrip,
    waveform: { file: waveformJson, bytes: waveformBytes, meta: peaks.meta },
    poster,
    ...(signals ? { signals } : {}),
  };
}

/**
 * The heat map the API copied from the probe, as the video's first signal
 * track (Module 16): stored now because the probe is the only time we see
 * it, read by Find Clips later.
 */
export async function replayedSignals(
  run: Pick<ImportRun, 'input' | 'dir'>,
  durationMs: number,
): Promise<DerivedFiles['signals'] | null> {
  const points = run.input.replayed;
  if (!points || points.length === 0) return null;
  const track = replayedTrack(points, durationMs);
  if (!track) return null;
  const file = path.join(run.dir, 'signals.json.gz');
  const bytes = await gzipSignalsFile({ format: SIGNALS_FILE_FORMAT, durationMs, tracks: [track] });
  await writeFile(file, bytes);
  const meta: SignalsAssetMeta = {
    durationMs,
    tracks: [{ name: track.name, version: track.version }],
  };
  return { file, bytes: bytes.length, meta };
}

// --- 5. Store ----------------------------------------------------------------------

interface FileToStore {
  file: string;
  bytes: number;
  asset: NewAsset;
}

/** Every file the import keeps, with the row each gets. */
export function filesToStore(
  run: Pick<ImportRun, 'organizationId' | 'jobId' | 'video'>,
  proxy: NormaliseResult,
  derived: DerivedFiles,
): FileToStore[] {
  const org = run.organizationId;
  const videoId = run.video.id;
  const files: FileToStore[] = [];
  const add = (
    kind: NewAsset['kind'],
    key: string,
    file: string,
    bytes: number,
    mimeType: string,
    meta: Record<string, unknown>,
  ) => {
    files.push({ file, bytes, asset: { videoId, kind, key, bytes, mimeType, meta } });
  };

  const proxyMeta: ProxyMeta = proxy.meta;
  add('PROXY', importKeys.proxy(org, videoId, run.jobId), proxy.file, proxy.bytes, 'video/mp4', {
    ...proxyMeta,
  });

  if (derived.analysisAudio) {
    const meta: AnalysisAudioMeta = derived.analysisAudio.meta;
    add(
      'ANALYSIS_AUDIO',
      importKeys.analysisAudio(org, videoId, run.jobId),
      derived.analysisAudio.file,
      derived.analysisAudio.bytes,
      'audio/wav',
      { ...meta },
    );
  }

  const waveformMeta: WaveformMeta = derived.waveform.meta;
  add(
    'WAVEFORM',
    importKeys.waveform(org, videoId, run.jobId),
    derived.waveform.file,
    derived.waveform.bytes,
    'application/json',
    { ...waveformMeta },
  );

  const posterMeta: PosterMeta = derived.poster.meta;
  add(
    'POSTER',
    importKeys.poster(org, videoId, run.jobId),
    derived.poster.file,
    derived.poster.bytes,
    'image/jpeg',
    { ...posterMeta },
  );

  if (derived.signals) {
    add(
      'SIGNALS',
      importKeys.signals(org, videoId, run.jobId),
      derived.signals.file,
      derived.signals.bytes,
      SIGNALS_MIME,
      { ...derived.signals.meta },
    );
  }

  // One row per sheet, in order: `sheet` says which one (0 first).
  const filmstripMeta: FilmstripMeta = derived.filmstrip.meta;
  derived.filmstrip.files.forEach((file, sheet) => {
    files.push({
      file,
      bytes: 0,
      asset: {
        videoId,
        kind: 'FILMSTRIP',
        key: importKeys.filmstrip(org, videoId, run.jobId, sheet),
        bytes: 0,
        mimeType: 'image/jpeg',
        meta: { ...filmstripMeta, sheet },
      },
    });
  });
  return files;
}

export async function importStore(
  run: ImportRun,
  facts: MediaFacts,
  proxy: NormaliseResult,
  derived: DerivedFiles,
): Promise<ImportOutcome> {
  const { organizationId, input, privateStorage } = run;
  const files = filesToStore(run, proxy, derived);

  // Filmstrip sheet sizes are read from disk (the derive step reports only the list).
  for (const entry of files) {
    if (entry.bytes === 0 && entry.asset.kind === 'FILMSTRIP') {
      const size = (await stat(entry.file)).size;
      entry.bytes = size;
      entry.asset.bytes = size;
    }
  }

  // Two big imports can both pass the start check: the one that stores second loses.
  const total = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const used = await run.rows.storageUsedBytes(organizationId);
  if (used + total > input.limits.storageBytes) {
    throw new ClipStepError('clips_storage_full');
  }

  const stored: string[] = [];
  try {
    for (const [index, entry] of files.entries()) {
      throwIfCancelled(run.signal);
      await privateStorage.putFile(entry.asset.key, entry.file, entry.asset.mimeType);
      stored.push(entry.asset.key);
      run.heartbeat();
      await run.progress.report({
        stage: 'preparing',
        progress: mapPercent(((index + 1) / files.length) * 100, 97, 99),
      });
    }
    throwIfCancelled(run.signal);

    const now = run.now();
    const output = importOutputSchema.parse({ durationMs: facts.durationMs, assets: files.length });
    const finished = await run.rows.finishImport({
      jobId: run.jobId,
      organizationId,
      videoId: run.video.id,
      assets: files.map((entry) => entry.asset),
      output,
      expiresAt: new Date(now.getTime() + input.limits.retentionDays * 24 * 60 * 60_000),
      notification: videoReadyNotification(organizationId, run.video),
      now,
    });
    if (!finished) {
      await deleteQuietly(privateStorage, stored);
      return { stored: false, assets: 0, durationMs: facts.durationMs };
    }
    return { stored: true, assets: files.length, durationMs: facts.durationMs };
  } catch (error) {
    await deleteQuietly(privateStorage, stored);
    throw error;
  }
}

/** Removes stored objects; a failure here is logged by the caller's cleanup, never thrown. */
export async function deleteQuietly(
  storage: Pick<PrivateStorage, 'delete'>,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'clips.storage.delete_failed',
          key,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }
}

// --- The whole import --------------------------------------------------------------

/** The five steps in order, in the run's scratch folder. */
export async function runImport(run: ImportRun): Promise<ImportOutcome> {
  const fetched = await importFetch(run);
  throwIfCancelled(run.signal);
  const facts = await importInspect(run, fetched);
  throwIfCancelled(run.signal);
  const proxy = await importNormalise(run, fetched, facts);
  throwIfCancelled(run.signal);
  const derived = await importDerive(run, proxy, facts);
  throwIfCancelled(run.signal);
  return importStore(run, facts, proxy, derived);
}
