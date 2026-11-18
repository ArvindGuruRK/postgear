/**
 * What a video file really is, read by ffprobe before anything else opens it.
 *
 * Uploads are untrusted: a text file named `video.mp4`, an HLS playlist that
 * points at other files, or an audio file with cover art must never reach
 * FFmpeg. So ffprobe reads with a demuxer allowlist (MP4 and MOV, Matroska
 * and WebM) and file access only, its JSON is mapped through a zod
 * allowlist that keeps only the fields we use, and anything without a real
 * video stream is refused as `upload_not_video`.
 */
import * as path from 'node:path';
import { z } from 'zod';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';

/** The facts the import and the render read about a file. Dimensions are as displayed (rotation applied). */
export interface MediaFacts {
  durationMs: number;
  /** Displayed width and height: swapped from the coded size when the file says to turn it 90 degrees. */
  width: number;
  height: number;
  /** Frames a second as a number (29.97, 30, 60), three decimals at most. */
  fps: number;
  /** False when the average and the nominal rate differ by more than 1 percent (a variable rate). */
  constantFrameRate: boolean;
  /** Clockwise turn the player applies, 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
  videoCodec: string;
  pixelFormat: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  sampleRate: number | null;
  audioChannels: number | null;
  /** Bits a second for the whole file, when the container says. */
  bitRate: number | null;
  container: MediaContainer;
}

export type MediaContainer = 'mp4' | 'mov' | 'matroska';

/** Demuxers ffprobe and FFmpeg may use on an imported file. Everything else is refused unread. */
export const INPUT_FORMAT_ALLOWLIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm';
/** Only plain files: no network, no `concat:`, no `subfile:`. */
export const INPUT_PROTOCOL_ALLOWLIST = 'file';

/** The input options every FFmpeg and ffprobe call on a video file starts with. */
export const SAFE_INPUT_ARGS: readonly string[] = [
  '-format_whitelist',
  INPUT_FORMAT_ALLOWLIST,
  '-protocol_whitelist',
  INPUT_PROTOCOL_ALLOWLIST,
];

/** Video codecs we accept. */
export const VIDEO_CODEC_ALLOWLIST: readonly string[] = [
  'h264',
  'hevc',
  'vp8',
  'vp9',
  'av1',
  'mpeg4',
  'mpeg2video',
  'prores',
];

/** Sound codecs we keep. Any other sound is dropped (the video is still accepted, without sound). */
export const AUDIO_CODEC_ALLOWLIST: readonly string[] = [
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'ac3',
  'eac3',
  'flac',
  'alac',
  'mp2',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_f32le',
];

/** Longest video ffprobe facts are accepted for (the plan limit is checked elsewhere). */
const MAX_DURATION_MS = 48 * 60 * 60 * 1000;
const MAX_SIDE = 8192;

export type ProbeErrorCode = 'upload_not_video' | 'cancelled' | 'tool_failed';

/** Probing failed. `code` is one of ours; the message never holds a path or ffprobe's text. */
export class ProbeError extends Error {
  readonly code: ProbeErrorCode;

  constructor(code: ProbeErrorCode, options: { cause?: unknown } = {}) {
    super(`probe failed: ${code}`);
    this.name = 'ProbeError';
    this.code = code;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** A path as an FFmpeg input: the `file:` protocol, so a name can never read as an option or a URL. */
export function fileInput(filePath: string): string {
  return `file:${filePath.split(path.sep).join('/')}`;
}

/** The ffprobe arguments for `probeFile`. */
export function buildProbeArgs(filePath: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    ...SAFE_INPUT_ARGS,
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    fileInput(filePath),
  ];
}

export interface ProbeOptions {
  /** Working folder for ffprobe; defaults to the file's folder. */
  cwd?: string;
  /** Default 60 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Runs ffprobe on `file` and returns its `MediaFacts`. Throws `ProbeError`:
 * `upload_not_video` when the file cannot be read as an allowed video,
 * `cancelled` on abort, `tool_failed` on a timeout or a missing ffprobe.
 */
export async function probeFile(
  runTool: RunTool,
  file: string,
  options: ProbeOptions = {},
): Promise<MediaFacts> {
  let stdout: string;
  try {
    const result = await runTool('ffprobe', buildProbeArgs(file), {
      cwd: options.cwd ?? path.dirname(file),
      timeoutMs: options.timeoutMs ?? 60_000,
      signal: options.signal,
      maxStdoutBytes: 4 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.aborted) throw new ProbeError('cancelled', { cause: error });
      // ffprobe ran and said no: the file is not something we can read.
      if (error.exitCode !== null && !error.timedOut) {
        throw new ProbeError('upload_not_video', { cause: error });
      }
    }
    throw new ProbeError('tool_failed', { cause: error });
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new ProbeError('upload_not_video', { cause: error });
  }
  return mediaFactsFromProbe(json);
}

// --- The allowlist mapping ------------------------------------------------------

const numberish = z.union([z.string(), z.number()]).optional();

const streamSchema = z.object({
  index: z.number().int().optional(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  pix_fmt: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  sample_rate: numberish,
  channels: z.number().int().optional(),
  duration: numberish,
  disposition: z.object({ attached_pic: z.number().optional() }).partial().optional(),
  tags: z.object({ rotate: numberish }).partial().optional(),
  side_data_list: z
    .array(z.object({ side_data_type: z.string().optional(), rotation: numberish }))
    .optional(),
});

const probeSchema = z.object({
  streams: z.array(streamSchema).max(64).default([]),
  format: z.object({
    format_name: z.string(),
    duration: numberish,
    bit_rate: numberish,
    tags: z.object({ major_brand: z.string().optional() }).partial().optional(),
  }),
});

type ProbeStream = z.infer<typeof streamSchema>;

/**
 * Maps ffprobe's JSON to `MediaFacts`, keeping only the allowlisted fields.
 * Throws `ProbeError('upload_not_video')` for anything that is not a video
 * we can work with: a disallowed container, no video stream (cover art does
 * not count), an unknown video codec, no length, or an absurd size.
 */
export function mediaFactsFromProbe(json: unknown): MediaFacts {
  const parsed = probeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProbeError('upload_not_video');
  }
  const { streams, format } = parsed.data;

  const container = containerFor(format.format_name, format.tags?.major_brand);
  if (!container) {
    throw new ProbeError('upload_not_video');
  }

  const video = streams.find(
    (s) => s.codec_type === 'video' && (s.disposition?.attached_pic ?? 0) === 0,
  );
  if (!video?.codec_name || !VIDEO_CODEC_ALLOWLIST.includes(video.codec_name)) {
    throw new ProbeError('upload_not_video');
  }
  const codedWidth = video.width ?? 0;
  const codedHeight = video.height ?? 0;
  if (codedWidth < 2 || codedHeight < 2 || codedWidth > MAX_SIDE || codedHeight > MAX_SIDE) {
    throw new ProbeError('upload_not_video');
  }

  const nominal = parseRate(video.r_frame_rate);
  const average = parseRate(video.avg_frame_rate);
  const rate = average ?? nominal;
  if (rate === null || rate > 1000) {
    throw new ProbeError('upload_not_video');
  }
  const constantFrameRate =
    nominal !== null && average !== null && Math.abs(nominal - average) / nominal <= 0.01;

  const durationSeconds = toNumber(format.duration) ?? toNumber(video.duration);
  if (durationSeconds === null || durationSeconds <= 0) {
    throw new ProbeError('upload_not_video');
  }
  const durationMs = Math.round(durationSeconds * 1000);
  if (durationMs > MAX_DURATION_MS) {
    throw new ProbeError('upload_not_video');
  }

  const rotation = rotationOf(video);
  const turned = rotation === 90 || rotation === 270;

  const audio = streams.find(
    (s) =>
      s.codec_type === 'audio' &&
      s.codec_name !== undefined &&
      AUDIO_CODEC_ALLOWLIST.includes(s.codec_name),
  );
  const sampleRate = audio ? toNumber(audio.sample_rate) : null;

  return {
    durationMs,
    width: turned ? codedHeight : codedWidth,
    height: turned ? codedWidth : codedHeight,
    fps: Math.round(rate * 1000) / 1000,
    constantFrameRate,
    rotation,
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt ?? null,
    hasAudio: audio !== undefined,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: sampleRate !== null ? Math.round(sampleRate) : null,
    audioChannels: audio?.channels ?? null,
    bitRate: wholeOrNull(toNumber(format.bit_rate)),
    container,
  };
}

function containerFor(formatName: string, brand: string | undefined): MediaContainer | null {
  const names = formatName.split(',');
  if (names.includes('mov') || names.includes('mp4')) {
    return brand?.trim() === 'qt' ? 'mov' : 'mp4';
  }
  if (names.includes('matroska') || names.includes('webm')) {
    return 'matroska';
  }
  return null;
}

/** "30000/1001" is 29.97; "0/0" and nonsense are null. */
function parseRate(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const num = Number(match[1]);
  const den = match[2] === undefined ? 1 : Number(match[2]);
  if (num <= 0 || den <= 0) return null;
  const rate = num / den;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function rotationOf(stream: ProbeStream): 0 | 90 | 180 | 270 {
  // The display matrix counts counter-clockwise; the old `rotate` tag counts clockwise.
  const fromMatrix = stream.side_data_list?.find((d) => d.side_data_type === 'Display Matrix');
  const matrix = toNumber(fromMatrix?.rotation);
  const clockwise = matrix !== null ? -matrix : (toNumber(stream.tags?.rotate) ?? 0);
  const quarter = (((Math.round(clockwise / 90) * 90) % 360) + 360) % 360;
  return quarter as 0 | 90 | 180 | 270;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function wholeOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? Math.round(value) : null;
}
