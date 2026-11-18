/**
 * The FFmpeg work of an import (Module 04): turn whatever came in into the
 * light copy the editor plays, then derive the small files the video page
 * and the timeline read.
 *
 * - Normalise: H.264 High and AAC in MP4, a constant frame rate, a closed
 *   GOP of two seconds, the index first, the short side at most 720 (or
 *   480), rotation applied. A file that already fits is only remuxed.
 * - Derive, in one decode: the analysis sound (16 kHz mono WAV) and the
 *   filmstrip sheets (160 by 90 tiles, ten by ten a sheet).
 * - Waveform peaks: computed in Node from the analysis WAV (one byte per
 *   twentieth of a second), so no second decode and no binary on stdout.
 * - Poster: one JPEG a tenth of the way in.
 *
 * Builders return argument arrays (never a shell string); runners execute
 * them through the `RunTool`, report progress and honour the AbortSignal.
 */
import { createReadStream } from 'node:fs';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type AnalysisAudioMeta,
  FILMSTRIP_COLUMNS,
  FILMSTRIP_ROWS,
  FILMSTRIP_TILE_HEIGHT,
  FILMSTRIP_TILE_WIDTH,
  type FilmstripMeta,
  filmstripIntervalMs,
  type PosterMeta,
  type ProxyMeta,
  WAVEFORM_PER_SECOND,
  type WaveformMeta,
} from '@postgear/video-engine';
import { fileInput, type MediaFacts, SAFE_INPUT_ARGS } from './probe';
import { FFMPEG_HEAD, FfmpegError, type FfmpegJobOptions, runFfmpeg, toFfmpegError } from './run';

// --- Shared numbers -------------------------------------------------------------

/** Encoder settings for the light copy (research 05, "FFmpeg Roles"). */
export const PROXY_ENCODE = {
  preset: 'veryfast',
  crf: 23,
  audioBitrate: '128k',
  audioRate: 48_000,
  gopSeconds: 2,
  maxFps: 60,
} as const;

/** The analysis sound: small, mono, enough for loudness now and speech in Sprint 13. */
export const ANALYSIS_AUDIO = { sampleRate: 16_000, channels: 1 } as const;

/** The largest even number at or below `n`, at least 2. */
function evenFloor(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/** Output size keeping the aspect, the short side at most `maxShortSide`, both sides even. */
export function targetSize(
  width: number,
  height: number,
  maxShortSide: number,
): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = short > maxShortSide ? maxShortSide / short : 1;
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) };
}

/**
 * The frame rate the light copy is written at, as FFmpeg reads it and as a
 * number: the source rate rounded to a whole number from 1 to 60 (30 when
 * unknown). It must match the sharp range's rule (`normaliseFps` in the
 * downloader), because the light copy and the sharp copy have to show the
 * same frame at the same moment (research 05, section 10).
 */
export function targetRate(fps: number): { arg: string; value: number } {
  if (!Number.isFinite(fps) || fps <= 0) return { arg: '30', value: 30 };
  const whole = Math.min(PROXY_ENCODE.maxFps, Math.max(1, Math.round(fps)));
  return { arg: String(whole), value: whole };
}

/** A whole-frame GOP of about two seconds at this rate. */
function gopFrames(rate: number): number {
  return Math.max(1, Math.round(rate * PROXY_ENCODE.gopSeconds));
}

// --- Normalise ------------------------------------------------------------------

export type NormaliseMode = 'remux' | 'encode';

export interface NormalisePlan {
  mode: NormaliseMode;
  width: number;
  height: number;
  fps: { arg: string; value: number };
  /** False when the file has no sound we keep. */
  audio: boolean;
}

/**
 * Remux or encode. Remux only when the file is already what the editor and
 * the browsers need: H.264 in 4:2:0, AAC or no sound, a constant whole-number rate of at
 * most 60, no rotation flag, even sides and a short side at or under the
 * target. Its keyframe spacing is kept as it is.
 */
export function planNormalise(facts: MediaFacts, maxShortSide: number): NormalisePlan {
  const fps = targetRate(facts.fps);
  const fits =
    facts.videoCodec === 'h264' &&
    facts.pixelFormat === 'yuv420p' &&
    facts.constantFrameRate &&
    facts.fps <= PROXY_ENCODE.maxFps &&
    Math.abs(facts.fps - fps.value) < 0.001 &&
    facts.rotation === 0 &&
    facts.width % 2 === 0 &&
    facts.height % 2 === 0 &&
    Math.min(facts.width, facts.height) <= maxShortSide &&
    (!facts.hasAudio || facts.audioCodec === 'aac') &&
    (facts.container === 'mp4' || facts.container === 'mov');
  if (fits) {
    return { mode: 'remux', width: facts.width, height: facts.height, fps, audio: facts.hasAudio };
  }
  const size = targetSize(facts.width, facts.height, maxShortSide);
  return { mode: 'encode', ...size, fps, audio: facts.hasAudio };
}

function streamMaps(audio: boolean): string[] {
  return audio ? ['-map', '0:v:0', '-map', '0:a:0'] : ['-map', '0:v:0', '-an'];
}

/** Copies the streams into an MP4 with the index first. */
export function buildRemuxArgs(input: string, output: string, plan: NormalisePlan): string[] {
  return [
    ...FFMPEG_HEAD,
    ...SAFE_INPUT_ARGS,
    '-i',
    fileInput(input),
    ...streamMaps(plan.audio),
    '-c',
    'copy',
    '-dn',
    '-sn',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    fileInput(output),
  ];
}

/** Encodes the light copy: H.264 High, constant rate, closed two second GOP, AAC 48 kHz stereo. */
export function buildNormaliseArgs(input: string, output: string, plan: NormalisePlan): string[] {
  const gop = String(gopFrames(plan.fps.value));
  const audio = plan.audio
    ? [
        '-c:a',
        'aac',
        '-b:a',
        PROXY_ENCODE.audioBitrate,
        '-ar',
        String(PROXY_ENCODE.audioRate),
        '-ac',
        '2',
      ]
    : [];
  return [
    ...FFMPEG_HEAD,
    ...SAFE_INPUT_ARGS,
    '-i',
    fileInput(input),
    ...streamMaps(plan.audio),
    '-vf',
    `scale=${plan.width}:${plan.height}:flags=bicubic,fps=${plan.fps.arg},setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    PROXY_ENCODE.preset,
    '-crf',
    String(PROXY_ENCODE.crf),
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-sc_threshold',
    '0',
    '-flags',
    '+cgop',
    '-fps_mode',
    'cfr',
    '-r',
    plan.fps.arg,
    ...audio,
    '-dn',
    '-sn',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    fileInput(output),
  ];
}

export interface NormaliseResult {
  mode: NormaliseMode;
  file: string;
  bytes: number;
  meta: ProxyMeta;
}

/**
 * Makes the light copy at `output` from `input` (both inside `cwd`).
 * `facts` come from `probeFile` on the input; `maxShortSide` is 720, or 480
 * for videos over two hours.
 */
export async function normaliseVideo(
  options: FfmpegJobOptions & {
    input: string;
    output: string;
    facts: MediaFacts;
    maxShortSide: number;
  },
): Promise<NormaliseResult> {
  const plan = planNormalise(options.facts, options.maxShortSide);
  const args =
    plan.mode === 'remux'
      ? buildRemuxArgs(options.input, options.output, plan)
      : buildNormaliseArgs(options.input, options.output, plan);
  try {
    await runFfmpeg({ ...options, args, durationMs: options.facts.durationMs });
    const bytes = await nonEmptyFileBytes(options.output);
    options.onProgress?.(100);
    return {
      mode: plan.mode,
      file: options.output,
      bytes,
      meta: {
        width: plan.width,
        height: plan.height,
        fps: Math.round(plan.fps.value * 1000) / 1000,
      },
    };
  } catch (error) {
    await rm(options.output, { force: true }).catch(() => undefined);
    throw toFfmpegError(error, options.signal);
  }
}

// --- Analysis sound and filmstrip -------------------------------------------------

/** The output options that write the analysis WAV. */
function analysisOutputArgs(output: string): string[] {
  return [
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    String(ANALYSIS_AUDIO.channels),
    '-ar',
    String(ANALYSIS_AUDIO.sampleRate),
    '-c:a',
    'pcm_s16le',
    '-map_metadata',
    '-1',
    '-f',
    'wav',
    fileInput(output),
  ];
}

/** The filter that turns the video into filmstrip sheets. */
export function filmstripFilter(intervalMs: number): string {
  const w = FILMSTRIP_TILE_WIDTH;
  const h = FILMSTRIP_TILE_HEIGHT;
  return [
    `fps=fps=1000/${intervalMs}`,
    `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bilinear`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `tile=${FILMSTRIP_COLUMNS}x${FILMSTRIP_ROWS}`,
  ].join(',');
}

/** The sheet file names: `<prefix>-000.jpg`, `<prefix>-001.jpg` and so on. */
export const FILMSTRIP_PREFIX = 'filmstrip';

function filmstripOutputArgs(outDir: string, intervalMs: number): string[] {
  return [
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    filmstripFilter(intervalMs),
    '-fps_mode',
    'passthrough',
    '-q:v',
    '5',
    '-start_number',
    '0',
    '-f',
    'image2',
    fileInput(path.join(outDir, `${FILMSTRIP_PREFIX}-%03d.jpg`)),
  ];
}

/** Decoding only keyframes makes a long video's filmstrip far faster; the light copy has one every 2 s. */
function inputArgs(input: string, keyframesOnly: boolean): string[] {
  return [
    ...(keyframesOnly ? ['-skip_frame:v', 'nokey'] : []),
    ...SAFE_INPUT_ARGS,
    '-i',
    fileInput(input),
  ];
}

/** Writes the 16 kHz mono WAV used for loudness now and transcription later. */
export function buildAnalysisAudioArgs(input: string, output: string): string[] {
  return [...FFMPEG_HEAD, ...inputArgs(input, false), ...analysisOutputArgs(output)];
}

/** Writes the filmstrip sheets into `outDir`. */
export function buildFilmstripArgs(
  input: string,
  outDir: string,
  intervalMs: number,
  options: { keyframesOnly?: boolean } = {},
): string[] {
  return [
    ...FFMPEG_HEAD,
    ...inputArgs(input, options.keyframesOnly ?? false),
    ...filmstripOutputArgs(outDir, intervalMs),
  ];
}

/** Both in one decode: the analysis WAV (when there is sound) and the filmstrip sheets. */
export function buildDeriveArgs(params: {
  input: string;
  outDir: string;
  intervalMs: number;
  analysisOut: string | null;
  keyframesOnly?: boolean;
}): string[] {
  return [
    ...FFMPEG_HEAD,
    ...inputArgs(params.input, params.keyframesOnly ?? false),
    ...(params.analysisOut ? analysisOutputArgs(params.analysisOut) : []),
    ...filmstripOutputArgs(params.outDir, params.intervalMs),
  ];
}

export interface AnalysisAudioResult {
  file: string;
  bytes: number;
  meta: AnalysisAudioMeta;
}

/** Writes the analysis WAV. Call only when the video has sound. */
export async function extractAnalysisAudio(
  options: FfmpegJobOptions & { input: string; output: string; durationMs: number },
): Promise<AnalysisAudioResult> {
  try {
    await runFfmpeg({
      ...options,
      args: buildAnalysisAudioArgs(options.input, options.output),
    });
    const bytes = await nonEmptyFileBytes(options.output);
    options.onProgress?.(100);
    return { file: options.output, bytes, meta: analysisMeta() };
  } catch (error) {
    await rm(options.output, { force: true }).catch(() => undefined);
    throw toFfmpegError(error, options.signal);
  }
}

export interface FilmstripResult {
  /** Absolute paths of the sheets, in order. */
  files: string[];
  meta: FilmstripMeta;
}

/** Writes the filmstrip sheets for a video of `durationMs` into `outDir`. */
export async function makeFilmstrip(
  options: FfmpegJobOptions & {
    input: string;
    outDir: string;
    durationMs: number;
    keyframesOnly?: boolean;
  },
): Promise<FilmstripResult> {
  const intervalMs = filmstripIntervalMs(options.durationMs);
  try {
    await runFfmpeg({
      ...options,
      args: buildFilmstripArgs(options.input, options.outDir, intervalMs, options),
    });
    const result = await collectFilmstrip(options.outDir, options.durationMs, intervalMs);
    options.onProgress?.(100);
    return result;
  } catch (error) {
    await removeFilmstrip(options.outDir);
    throw toFfmpegError(error, options.signal);
  }
}

export interface DeriveResult {
  analysisAudio: AnalysisAudioResult | null;
  filmstrip: FilmstripResult;
}

/**
 * The analysis WAV and the filmstrip in one decode of the light copy.
 * `facts.hasAudio` false skips the WAV (a silent video is not a failure).
 */
export async function deriveAnalysisAndFilmstrip(
  options: FfmpegJobOptions & {
    input: string;
    outDir: string;
    analysisOut: string;
    facts: Pick<MediaFacts, 'durationMs' | 'hasAudio'>;
    keyframesOnly?: boolean;
  },
): Promise<DeriveResult> {
  const { durationMs, hasAudio } = options.facts;
  const intervalMs = filmstripIntervalMs(durationMs);
  const analysisOut = hasAudio ? options.analysisOut : null;
  try {
    await runFfmpeg({
      ...options,
      durationMs,
      args: buildDeriveArgs({
        input: options.input,
        outDir: options.outDir,
        intervalMs,
        analysisOut,
        keyframesOnly: options.keyframesOnly,
      }),
    });
    const filmstrip = await collectFilmstrip(options.outDir, durationMs, intervalMs);
    const analysisAudio = analysisOut
      ? { file: analysisOut, bytes: await nonEmptyFileBytes(analysisOut), meta: analysisMeta() }
      : null;
    options.onProgress?.(100);
    return { analysisAudio, filmstrip };
  } catch (error) {
    await removeFilmstrip(options.outDir);
    if (analysisOut) await rm(analysisOut, { force: true }).catch(() => undefined);
    throw toFfmpegError(error, options.signal);
  }
}

function analysisMeta(): AnalysisAudioMeta {
  return { sampleRate: ANALYSIS_AUDIO.sampleRate, channels: ANALYSIS_AUDIO.channels };
}

const SHEET_NAME = new RegExp(`^${FILMSTRIP_PREFIX}-(\\d{3})\\.jpg$`);
const TILES_PER_SHEET = FILMSTRIP_COLUMNS * FILMSTRIP_ROWS;

/**
 * Lists the sheets FFmpeg wrote and builds their meta. The expected tile
 * count is one per interval from the start; a stray extra sheet (FFmpeg's
 * rate filter can add one frame at the very end) is removed.
 */
export async function collectFilmstrip(
  outDir: string,
  durationMs: number,
  intervalMs: number,
): Promise<FilmstripResult> {
  const names = (await readdir(outDir)).filter((name) => SHEET_NAME.test(name)).sort();
  const expectedTiles = Math.max(1, Math.ceil(durationMs / intervalMs));
  const expectedSheets = Math.ceil(expectedTiles / TILES_PER_SHEET);
  for (const extra of names.slice(expectedSheets)) {
    await rm(path.join(outDir, extra), { force: true });
  }
  const kept = names.slice(0, expectedSheets);
  if (kept.length === 0) {
    throw new FfmpegError('tool_failed');
  }
  return {
    files: kept.map((name) => path.join(outDir, name)),
    meta: {
      tileWidth: FILMSTRIP_TILE_WIDTH,
      tileHeight: FILMSTRIP_TILE_HEIGHT,
      columns: FILMSTRIP_COLUMNS,
      rows: FILMSTRIP_ROWS,
      intervalMs,
      count: Math.min(expectedTiles, kept.length * TILES_PER_SHEET),
      sheets: kept.length,
    },
  };
}

async function removeFilmstrip(outDir: string): Promise<void> {
  const names = await readdir(outDir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => SHEET_NAME.test(name))
      .map((name) => rm(path.join(outDir, name), { force: true }).catch(() => undefined)),
  );
}

// --- Waveform peaks --------------------------------------------------------------

export interface WaveformResult {
  file: string;
  bytes: number;
  meta: WaveformMeta;
}

/** A WAV this package can read: 16-bit PCM. */
interface WavFormat {
  sampleRate: number;
  channels: number;
  dataOffset: number;
  /** Bytes of sample data, or null when the header does not say (read to the end). */
  dataBytes: number | null;
}

/**
 * The sound's shape from a 16-bit PCM WAV (the analysis sound): for every
 * twentieth of a second, the loudest sample as one byte, 0 to 255. Streams
 * the file, so a six hour video never sits in memory. Writes the bytes to
 * `output`. All channels count towards the peak.
 */
export async function computeWaveformFromWav(options: {
  wavFile: string;
  output: string;
  perSecond?: number;
  signal?: AbortSignal;
}): Promise<WaveformResult> {
  const perSecond = options.perSecond ?? WAVEFORM_PER_SECOND;
  const format = await readWavHeader(options.wavFile);
  const samplesPerPeak = Math.max(1, Math.round(format.sampleRate / perSecond));
  const frameBytes = 2 * format.channels;

  const peaks: number[] = [];
  let peak = 0;
  let inBucket = 0;
  let carry: Buffer | null = null;

  const stream = createReadStream(options.wavFile, {
    start: format.dataOffset,
    end: format.dataBytes !== null ? format.dataOffset + format.dataBytes - 1 : undefined,
    highWaterMark: 1 << 20,
  });
  const onAbort = (): void => {
    stream.destroy(new FfmpegError('cancelled'));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw new FfmpegError('cancelled');
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const buffer: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buffer.length - (buffer.length % frameBytes);
      for (let offset = 0; offset < usable; offset += frameBytes) {
        for (let c = 0; c < format.channels; c += 1) {
          const sample = Math.abs(buffer.readInt16LE(offset + c * 2));
          if (sample > peak) peak = sample;
        }
        inBucket += 1;
        if (inBucket === samplesPerPeak) {
          peaks.push(toByte(peak));
          peak = 0;
          inBucket = 0;
        }
      }
      carry = usable < buffer.length ? buffer.subarray(usable) : null;
    }
  } catch (error) {
    throw error instanceof FfmpegError ? error : new FfmpegError('tool_failed', { cause: error });
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (inBucket > 0) {
    peaks.push(toByte(peak));
  }

  const bytes = Uint8Array.from(peaks);
  await writeFile(options.output, bytes);
  return { file: options.output, bytes: bytes.length, meta: { perSecond, count: bytes.length } };
}

/** A video with no sound still gets a waveform file: empty. */
export async function writeEmptyWaveform(
  output: string,
  perSecond: number = WAVEFORM_PER_SECOND,
): Promise<WaveformResult> {
  await writeFile(output, new Uint8Array(0));
  return { file: output, bytes: 0, meta: { perSecond, count: 0 } };
}

function toByte(peak: number): number {
  return Math.min(255, Math.round((peak / 32768) * 255));
}

/** Reads the RIFF header: the `fmt ` chunk (16-bit PCM only) and where `data` starts. */
export async function readWavHeader(file: string): Promise<WavFormat> {
  const head = await readStart(file, 64 * 1024);
  const bad = (): FfmpegError => new FfmpegError('tool_failed');
  if (
    head.length < 12 ||
    head.toString('ascii', 0, 4) !== 'RIFF' ||
    head.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw bad();
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  while (offset + 8 <= head.length) {
    const id = head.toString('ascii', offset, offset + 4);
    const size = head.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > head.length) throw bad();
      const audioFormat = head.readUInt16LE(body);
      channels = head.readUInt16LE(body + 2);
      sampleRate = head.readUInt32LE(body + 4);
      const bits = head.readUInt16LE(body + 14);
      // 1 is PCM; 0xFFFE is WAVE_FORMAT_EXTENSIBLE, which FFmpeg writes for some layouts.
      if (
        (audioFormat !== 1 && audioFormat !== 0xfffe) ||
        bits !== 16 ||
        channels < 1 ||
        sampleRate < 1
      ) {
        throw bad();
      }
    } else if (id === 'data') {
      if (sampleRate === 0) throw bad();
      const fileBytes = (await stat(file)).size;
      const left = fileBytes - body;
      const declared = size === 0 || size === 0xffffffff || size > left ? null : size;
      return { sampleRate, channels, dataOffset: body, dataBytes: declared };
    }
    offset = body + size + (size % 2);
  }
  throw bad();
}

async function readStart(file: string, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of createReadStream(file, {
    start: 0,
    end: max - 1,
  }) as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    total += chunk.length;
  }
  return Buffer.concat(chunks, total);
}

// --- Poster ------------------------------------------------------------------------

/** The poster is the frame a tenth of the way in (the very start is often black). */
export function posterTimeMs(durationMs: number): number {
  return Math.max(0, Math.floor(durationMs / 10));
}

/** One JPEG frame at `atMs`, sized to `width` by `height`. */
export function buildPosterArgs(params: {
  input: string;
  output: string;
  atMs: number;
  width: number;
  height: number;
}): string[] {
  return [
    ...FFMPEG_HEAD,
    '-ss',
    (Math.max(0, Math.round(params.atMs)) / 1000).toFixed(3),
    ...SAFE_INPUT_ARGS,
    '-i',
    fileInput(params.input),
    '-map',
    '0:v:0',
    '-an',
    '-frames:v',
    '1',
    '-vf',
    `scale=${params.width}:${params.height}:flags=bicubic,setsar=1`,
    '-q:v',
    '3',
    '-update',
    '1',
    '-f',
    'image2',
    fileInput(params.output),
  ];
}

export interface PosterResult {
  file: string;
  bytes: number;
  meta: PosterMeta;
}

/**
 * Writes the poster. `facts` are the light copy's (displayed size, length).
 * If the frame at a tenth of the way in cannot be read, the first frame is used.
 */
export async function makePoster(
  options: FfmpegJobOptions & {
    input: string;
    output: string;
    facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
    maxShortSide?: number;
    atMs?: number;
  },
): Promise<PosterResult> {
  const size = targetSize(options.facts.width, options.facts.height, options.maxShortSide ?? 720);
  const first = options.atMs ?? posterTimeMs(options.facts.durationMs);
  const attempts = first > 0 ? [first, 0] : [0];
  let lastError: unknown = null;
  for (const atMs of attempts) {
    try {
      await runFfmpeg({
        ...options,
        durationMs: 1_000,
        timeoutMs: options.timeoutMs ?? 2 * 60_000,
        onProgress: undefined,
        args: buildPosterArgs({ input: options.input, output: options.output, atMs, ...size }),
      });
      const bytes = await nonEmptyFileBytes(options.output);
      options.onProgress?.(100);
      return { file: options.output, bytes, meta: { atMs, ...size } };
    } catch (error) {
      lastError = error;
      await rm(options.output, { force: true }).catch(() => undefined);
      if (options.signal?.aborted) break;
    }
  }
  throw toFfmpegError(lastError, options.signal);
}

// --- Helpers -------------------------------------------------------------------------

/** The size of a file FFmpeg should have written; a missing or empty file is a failure. */
async function nonEmptyFileBytes(file: string): Promise<number> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    throw new FfmpegError('tool_failed');
  }
  return info.size;
}
