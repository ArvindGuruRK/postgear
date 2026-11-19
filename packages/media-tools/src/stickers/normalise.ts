/**
 * `normaliseSticker` (Module 12 section 3, step 4): any picture we accept as
 * a sticker becomes one of two files the render and the preview both read,
 * plus a small picture for the grid. The ingest and a workspace upload use
 * the same function, so a sticker behaves the same wherever it came from.
 *
 * - **Still** (PNG, a one-frame GIF or WebP): a PNG, its longest side at most
 *   `targetPx` (never made bigger), at most 300 KB.
 * - **Moving** (animated WebP, GIF or APNG): an APNG with full alpha and a
 *   constant frame rate (`fps` at most 20), at most 6 seconds and 120 frames,
 *   at most 2 MB. If it is over, it is made once more at 192 px and 15 fps,
 *   and refused with `sticker_too_large` if still over.
 * - **The grid picture**: a 128 px WebP (moving for a moving sticker).
 * - Metadata is dropped (`-map_metadata -1`).
 *
 * The file is read by ffprobe first, with only the picture demuxers allowed
 * and file access only; anything else is `sticker_unusable`. The first read
 * takes only the kind and size from the header, so a picture too big on a
 * side is refused before the second read decodes every frame to count them;
 * both reads refuse to decode a frame of more than `STICKER_MAX_PIXELS`, so a
 * header that lies about its size cannot make FFmpeg build a giant frame.
 * Every program runs through the runner with an argument array.
 */
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { STICKER_FRAMES_MAX } from '@postgear/video-engine';
import { z } from 'zod';
import { fileInput } from '../ffmpeg/probe';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';

/** The picture demuxers a sticker may be read with. */
export const STICKER_FORMAT_ALLOWLIST = 'png_pipe,apng,gif,webp_pipe,webp_anim';
const SAFE_STICKER_INPUT = [
  '-format_whitelist',
  STICKER_FORMAT_ALLOWLIST,
  '-protocol_whitelist',
  'file',
];
const STICKER_CODECS = new Set(['png', 'apng', 'gif', 'webp', 'webp_anim']);

/** The caps research 10 section 8.2 sets; the doc marks them advised, so they are named here. */
export const STICKER_LIMITS = Object.freeze({
  stillMaxBytes: 300 * 1024,
  movingMaxBytes: 2 * 1024 * 1024,
  /** The render keeps a looping sticker's frames in memory, so the engine caps them too. */
  maxFrames: STICKER_FRAMES_MAX,
  maxMs: 6_000,
  maxFps: 20,
  /** The one step down a moving picture that is too big gets. */
  stepDownPx: 192,
  stepDownFps: 15,
  previewPx: 128,
  /** Anything bigger than this on a side, or with more frames, is not read at all. */
  maxSourceSide: 4_096,
  maxSourceFrames: 2_000,
});

/** The most pixels FFmpeg may decode in one frame while a sticker is read: the biggest square we accept. */
export const STICKER_MAX_PIXELS = STICKER_LIMITS.maxSourceSide ** 2;
const DECODE_CAP = ['-max_pixels', String(STICKER_MAX_PIXELS)];

export type StickerErrorCode =
  | 'sticker_unusable'
  | 'sticker_too_large'
  | 'cancelled'
  | 'tool_failed';

/** The picture types a sticker file may be, read from its first bytes. */
export type StickerFileType = 'png' | 'gif' | 'webp';

/**
 * What a file really is, from its magic bytes (an APNG is a PNG), or null
 * for anything else. A file's name and its stated type are never trusted.
 */
export function sniffStickerType(head: Uint8Array): StickerFileType | null {
  const at = (offset: number, bytes: readonly number[]) => bytes.every((byte, k) => head[offset + k] === byte);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // "GIF87a" or "GIF89a".
  if (at(0, [0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) return 'gif';
  // "RIFF" <size> "WEBP".
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  return null;
}

/** Normalising failed. `code` is one of ours; the message never holds a path or FFmpeg's text. */
export class StickerError extends Error {
  readonly code: StickerErrorCode;
  constructor(code: StickerErrorCode, options: { cause?: unknown } = {}) {
    super(`sticker failed: ${code}`);
    this.name = 'StickerError';
    this.code = code;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** What ffprobe says about a picture. */
export interface StickerFacts {
  format: string;
  width: number;
  height: number;
  frames: number;
  /**
   * Frames a second: one over the shortest frame's duration when the frames
   * say, else the stream's rate (25 for a still PNG, which means nothing).
   */
  fps: number;
  animated: boolean;
}

const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        avg_frame_rate: z.string().optional(),
        r_frame_rate: z.string().optional(),
        nb_read_frames: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .max(8)
    .default([]),
  /** Each frame's own duration: a GIF or WebP folds a held frame into one long one. */
  frames: z
    .array(z.object({ duration_time: z.string().optional() }))
    .max(STICKER_LIMITS.maxSourceFrames + 1)
    .optional(),
  format: z.object({ format_name: z.string() }),
});

/**
 * One over the shortest frame's duration, or 0 when no frame says. A moving
 * picture made at this rate repeats a held frame instead of slowing the whole
 * loop down to the average (a 12 fps pop that holds for nine frames averages
 * 9 fps, and would play choppy at that).
 */
function shortestFrameFps(frames: ReadonlyArray<{ duration_time?: string }> | undefined): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (const frame of frames ?? []) {
    const seconds = Number(frame.duration_time);
    if (Number.isFinite(seconds) && seconds > 0 && seconds < shortest) shortest = seconds;
  }
  return Number.isFinite(shortest) ? 1 / shortest : 0;
}

function rate(text: string | undefined): number {
  if (!text) return 0;
  const [num, den] = text.split('/').map(Number);
  if (!num || !den || !Number.isFinite(num / den)) return 0;
  return num / den;
}

/**
 * The ffprobe arguments for `probeSticker`'s first read: picture demuxers
 * only, the kind and size from the header, no frame counted.
 */
export function buildStickerHeaderProbeArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    ...SAFE_STICKER_INPUT,
    ...DECODE_CAP,
    '-select_streams',
    'v:0',
    '-print_format',
    'json',
    '-show_entries',
    'format=format_name:stream=codec_type,codec_name,width,height',
    fileInput(file),
  ];
}

/** The ffprobe arguments for `probeSticker`'s second read: picture demuxers only, every frame counted. */
export function buildStickerProbeArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    ...SAFE_STICKER_INPUT,
    ...DECODE_CAP,
    '-count_frames',
    '-select_streams',
    'v:0',
    '-print_format',
    'json',
    '-show_entries',
    'format=format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames:frame=duration_time',
    fileInput(file),
  ];
}

type ProbeJson = z.infer<typeof probeSchema>;

/** The picture stream of a probe, when it is a kind we use at a size we read; else `sticker_unusable`. */
function readablePicture(json: unknown): { probe: ProbeJson; video: ProbeJson['streams'][number] } {
  const parsed = probeSchema.safeParse(json);
  if (!parsed.success) throw new StickerError('sticker_unusable');
  const video = parsed.data.streams.find((stream) => stream.codec_type === 'video');
  if (!video?.codec_name || !STICKER_CODECS.has(video.codec_name)) {
    throw new StickerError('sticker_unusable');
  }
  const width = video.width ?? 0;
  const height = video.height ?? 0;
  if (
    width < 1 ||
    height < 1 ||
    width > STICKER_LIMITS.maxSourceSide ||
    height > STICKER_LIMITS.maxSourceSide
  ) {
    throw new StickerError('sticker_unusable');
  }
  return { probe: parsed.data, video };
}

/** Checks the first read's JSON (`buildStickerHeaderProbeArgs`): a picture we use, at a size we read. */
export function checkStickerHeader(json: unknown): void {
  readablePicture(json);
}

/** Maps ffprobe's JSON to `StickerFacts`, refusing anything that is not a picture we use. */
export function stickerFactsFromProbe(json: unknown): StickerFacts {
  const { probe, video } = readablePicture(json);
  const width = video.width ?? 0;
  const height = video.height ?? 0;
  const frames = Number(video.nb_read_frames ?? 0);
  if (!Number.isInteger(frames) || frames < 1 || frames > STICKER_LIMITS.maxSourceFrames) {
    throw new StickerError('sticker_unusable');
  }
  const fps =
    shortestFrameFps(probe.frames) || rate(video.avg_frame_rate) || rate(video.r_frame_rate);
  return { format: probe.format.format_name, width, height, frames, fps, animated: frames > 1 };
}

async function runOrMap(
  runTool: RunTool,
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    const result = await runTool(tool, args, {
      cwd,
      timeoutMs: 120_000,
      signal,
      maxStdoutBytes: 4 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.aborted) throw new StickerError('cancelled', { cause: error });
      // The program ran and said no: the file is not a picture it can read.
      if (error.exitCode !== null && !error.timedOut) {
        throw new StickerError('sticker_unusable', { cause: error });
      }
    }
    throw new StickerError('tool_failed', { cause: error });
  }
}

async function probeJson(
  runTool: RunTool,
  args: string[],
  options: { cwd: string; signal?: AbortSignal },
): Promise<unknown> {
  const stdout = await runOrMap(runTool, 'ffprobe', args, options.cwd, options.signal);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new StickerError('sticker_unusable', { cause: error });
  }
}

/**
 * Reads `file` with ffprobe (picture demuxers only): the header first, and
 * only a picture that passes it is decoded frame by frame to be counted.
 */
export async function probeSticker(
  runTool: RunTool,
  file: string,
  options: { cwd: string; signal?: AbortSignal },
): Promise<StickerFacts> {
  checkStickerHeader(await probeJson(runTool, buildStickerHeaderProbeArgs(file), options));
  return stickerFactsFromProbe(await probeJson(runTool, buildStickerProbeArgs(file), options));
}

/** The size a picture is made at: its longest side at most `targetPx`, never bigger, even, at least 2. */
export function fitSize(
  width: number,
  height: number,
  targetPx: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > targetPx ? targetPx / longest : 1;
  const even = (value: number) => Math.max(2, 2 * Math.round((value * scale) / 2));
  return { width: even(width), height: even(height) };
}

/** The frame rate a moving sticker is made at: the source's, whole, between 1 and `maxFps`. */
export function stickerFps(sourceFps: number, maxFps: number = STICKER_LIMITS.maxFps): number {
  if (!(sourceFps > 0) || !Number.isFinite(sourceFps)) return Math.min(10, maxFps);
  return Math.max(1, Math.min(maxFps, Math.round(sourceFps)));
}

const HEAD = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];

/** FFmpeg arguments for a still sticker: one frame, scaled, RGBA, as PNG. */
export function stillStickerArgs(
  input: string,
  output: string,
  size: { width: number; height: number },
): string[] {
  return [
    ...HEAD,
    ...SAFE_STICKER_INPUT,
    '-i',
    fileInput(input),
    '-frames:v',
    '1',
    '-vf',
    `scale=${size.width}:${size.height}:flags=lanczos,format=rgba`,
    '-map_metadata',
    '-1',
    '-c:v',
    'png',
    '-f',
    'image2',
    output,
  ];
}

/** FFmpeg arguments for a moving sticker: a constant rate, scaled, RGBA, at most 6 s, as an endless APNG. */
export function movingStickerArgs(
  input: string,
  output: string,
  size: { width: number; height: number },
  fps: number,
): string[] {
  return [
    ...HEAD,
    ...SAFE_STICKER_INPUT,
    '-i',
    fileInput(input),
    '-t',
    (STICKER_LIMITS.maxMs / 1000).toFixed(3),
    '-vf',
    `fps=${fps},scale=${size.width}:${size.height}:flags=lanczos,format=rgba`,
    '-frames:v',
    String(STICKER_LIMITS.maxFrames),
    '-map_metadata',
    '-1',
    '-plays',
    '0',
    '-f',
    'apng',
    output,
  ];
}

/** FFmpeg arguments for the grid picture: 128 px WebP, moving when the sticker moves. */
export function previewStickerArgs(
  input: string,
  output: string,
  animated: boolean,
  fps: number,
): string[] {
  const px = STICKER_LIMITS.previewPx;
  const fit = `scale=${px}:${px}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba`;
  return [
    ...HEAD,
    ...SAFE_STICKER_INPUT,
    '-i',
    fileInput(input),
    ...(animated
      ? ['-vf', `fps=${fps},${fit}`, '-c:v', 'libwebp_anim', '-loop', '0']
      : ['-frames:v', '1', '-vf', fit, '-c:v', 'libwebp']),
    '-quality',
    '75',
    '-map_metadata',
    '-1',
    '-f',
    'webp',
    output,
  ];
}

export interface NormaliseStickerOptions {
  runTool: RunTool;
  /** The working folder: `input` and the outputs are names inside it. */
  cwd: string;
  /** A plain name inside `cwd`. */
  input: string;
  /** Output base name inside `cwd`, without an extension: `<base>.png` or `<base>.apng`, `<base>.preview.webp`. */
  outputBase: string;
  /** The longest side: 256 for emoji-like art, 512 for the rest. */
  targetPx: number;
  signal?: AbortSignal;
}

export interface NormalisedSticker {
  /** The sticker file's name inside `cwd`. */
  file: string;
  /** The grid picture's name inside `cwd`. */
  preview: string;
  animated: boolean;
  width: number;
  height: number;
  /** Moving only: the constant rate, the frame count and the length. */
  fps: number | null;
  frames: number | null;
  durationMs: number | null;
  bytes: number;
  previewBytes: number;
}

async function sizeOf(cwd: string, name: string): Promise<number> {
  return (await stat(path.join(cwd, name))).size;
}

/** Turns an accepted picture into the sticker and grid files (see the top of this file). */
export async function normaliseSticker(
  options: NormaliseStickerOptions,
): Promise<NormalisedSticker> {
  const { runTool, cwd, input, outputBase, signal } = options;
  const facts = await probeSticker(runTool, input, { cwd, signal });
  const preview = `${outputBase}.preview.webp`;

  if (!facts.animated) {
    const file = `${outputBase}.png`;
    let size = fitSize(facts.width, facts.height, options.targetPx);
    await runOrMap(runTool, 'ffmpeg', stillStickerArgs(input, file, size), cwd, signal);
    let bytes = await sizeOf(cwd, file);
    if (bytes > STICKER_LIMITS.stillMaxBytes) {
      size = fitSize(
        facts.width,
        facts.height,
        Math.round(Math.max(size.width, size.height) * 0.75),
      );
      await runOrMap(runTool, 'ffmpeg', stillStickerArgs(input, file, size), cwd, signal);
      bytes = await sizeOf(cwd, file);
      if (bytes > STICKER_LIMITS.stillMaxBytes) throw new StickerError('sticker_too_large');
    }
    await runOrMap(runTool, 'ffmpeg', previewStickerArgs(file, preview, false, 1), cwd, signal);
    return {
      file,
      preview,
      animated: false,
      ...size,
      fps: null,
      frames: null,
      durationMs: null,
      bytes,
      previewBytes: await sizeOf(cwd, preview),
    };
  }

  const file = `${outputBase}.apng`;
  const attempt = async (targetPx: number, maxFps: number) => {
    const size = fitSize(facts.width, facts.height, targetPx);
    const fps = stickerFps(facts.fps, maxFps);
    await runOrMap(runTool, 'ffmpeg', movingStickerArgs(input, file, size, fps), cwd, signal);
    const made = await probeSticker(runTool, file, { cwd, signal });
    return { size, fps, frames: made.frames, bytes: await sizeOf(cwd, file) };
  };
  const fits = (made: { frames: number; bytes: number }) =>
    made.frames <= STICKER_LIMITS.maxFrames && made.bytes <= STICKER_LIMITS.movingMaxBytes;

  let made = await attempt(options.targetPx, STICKER_LIMITS.maxFps);
  if (!fits(made)) {
    made = await attempt(
      Math.min(options.targetPx, STICKER_LIMITS.stepDownPx),
      STICKER_LIMITS.stepDownFps,
    );
    if (!fits(made)) throw new StickerError('sticker_too_large');
  }
  await runOrMap(runTool, 'ffmpeg', previewStickerArgs(file, preview, true, made.fps), cwd, signal);
  return {
    file,
    preview,
    animated: true,
    ...made.size,
    fps: made.fps,
    frames: made.frames,
    durationMs: Math.round((made.frames * 1000) / made.fps),
    bytes: made.bytes,
    previewBytes: await sizeOf(cwd, preview),
  };
}
