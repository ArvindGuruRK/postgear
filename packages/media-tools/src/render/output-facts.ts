/**
 * What a finished render really is (Module 15 section 6), read before it is
 * stored: `ffprobe` for the picture stream and its key frames, and a look
 * at the MP4's top-level boxes for `moov` before `mdat`. The judging is
 * `verifyOutput` in `@postgear/video-engine`; this only reads.
 *
 * ffprobe runs through the runner like every other program: an argument
 * array, the demuxer allowlist, `file:` input only. Packets are read, not
 * decoded, so a ten minute export is checked in a second or two.
 */
import { open, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { RenderedFileFacts } from '@postgear/video-engine';
import { z } from 'zod';
import { fileInput, SAFE_INPUT_ARGS } from '../ffmpeg/probe';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';
import { RenderError } from './execute';

/** The ffprobe arguments for `readOutputFacts`: the first picture stream, its packets' times and flags. */
export function buildOutputFactsArgs(filePath: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    ...SAFE_INPUT_ARGS,
    '-select_streams',
    'v:0',
    '-print_format',
    'json=compact=1',
    '-show_entries',
    'stream=codec_name,profile,pix_fmt,width,height,avg_frame_rate,duration,start_time:format=duration:packet=pts_time,flags',
    fileInput(filePath),
  ];
}

export interface OutputFactsOptions {
  /** Working folder for ffprobe; the file's folder by default. */
  cwd?: string;
  signal?: AbortSignal;
  /** Default 2 minutes. */
  timeoutMs?: number;
  /** `'low'` for a preview (see `RunToolOptions.priority`). */
  priority?: 'normal' | 'low';
}

/**
 * Reads the facts `verifyOutput` judges. A file ffprobe cannot read comes
 * back with empty facts (so the check names what is wrong, and the job
 * fails as `render_output_invalid`); a stop is `RenderError('cancelled')`
 * and a missing or stuck ffprobe is `RenderError('tool_failed')`.
 */
export async function readOutputFacts(
  runTool: RunTool,
  file: string,
  options: OutputFactsOptions = {},
): Promise<RenderedFileFacts> {
  const info = await stat(file).catch(() => null);
  const bytes = info?.isFile() ? info.size : 0;
  const empty = emptyFacts(bytes);
  if (bytes === 0) return empty;

  let stdout: string;
  try {
    const result = await runTool('ffprobe', buildOutputFactsArgs(file), {
      cwd: options.cwd ?? path.dirname(file),
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: options.signal,
      maxStdoutBytes: 64 * 1024 * 1024,
      ...(options.priority === 'low' ? { priority: 'low' as const } : {}),
    });
    stdout = result.stdout;
  } catch (error) {
    if (options.signal?.aborted || (error instanceof ToolError && error.aborted)) {
      throw new RenderError('cancelled', { cause: error });
    }
    if (error instanceof ToolError && error.exitCode !== null && !error.timedOut) {
      // ffprobe ran and could not read it: the file is broken.
      return { ...empty, moovFirst: await moovBeforeMdat(file) };
    }
    throw new RenderError('tool_failed', { cause: error });
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ...empty, moovFirst: await moovBeforeMdat(file) };
  }
  return { ...outputFactsFromProbe(json, bytes), moovFirst: await moovBeforeMdat(file) };
}

function emptyFacts(bytes: number): RenderedFileFacts {
  return {
    durationMs: null,
    width: null,
    height: null,
    fps: null,
    codec: null,
    profile: null,
    pixFmt: null,
    keyframesMs: [],
    moovFirst: null,
    bytes,
  };
}

// --- The allowlist mapping ------------------------------------------------------

const numberish = z.union([z.string(), z.number()]).optional();

const factsSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_name: z.string().optional(),
        profile: z.string().optional(),
        pix_fmt: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        avg_frame_rate: z.string().optional(),
        duration: numberish,
        start_time: numberish,
      }),
    )
    .max(4)
    .default([]),
  packets: z.array(z.object({ pts_time: numberish, flags: z.string().optional() })).default([]),
  format: z.object({ duration: numberish }).partial().default({}),
});

/**
 * Maps ffprobe's JSON to the facts (without `moovFirst`, which comes from
 * the file's boxes). Key frame times are from the stream's start, sorted,
 * so B-frames' decode order and a non-zero start do not matter. Exported for tests.
 */
export function outputFactsFromProbe(json: unknown, bytes: number): RenderedFileFacts {
  const parsed = factsSchema.safeParse(json);
  if (!parsed.success) return emptyFacts(bytes);
  const { streams, packets, format } = parsed.data;
  const stream = streams[0];
  if (!stream) return emptyFacts(bytes);

  const times = packets
    .map((packet) => ({ at: toNumber(packet.pts_time), key: (packet.flags ?? '').includes('K') }))
    .filter((packet): packet is { at: number; key: boolean } => packet.at !== null);
  const startSeconds =
    toNumber(stream.start_time) ??
    (times.length > 0 ? Math.min(...times.map((packet) => packet.at)) : 0);
  const keyframesMs = times
    .filter((packet) => packet.key)
    .map((packet) => Math.round((packet.at - startSeconds) * 1000))
    .sort((a, b) => a - b);

  const durationSeconds = toNumber(stream.duration) ?? toNumber(format.duration);
  return {
    durationMs: durationSeconds !== null ? Math.round(durationSeconds * 1000) : null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps: parseRate(stream.avg_frame_rate),
    codec: stream.codec_name ?? null,
    profile: stream.profile ?? null,
    pixFmt: stream.pix_fmt ?? null,
    keyframesMs,
    moovFirst: null,
    bytes,
  };
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [top, bottom] = rate.split('/');
  const numerator = Number(top);
  const denominator = bottom === undefined ? 1 : Number(bottom);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const value = numerator / denominator;
  return value > 0 ? Math.round(value * 1000) / 1000 : null;
}

// --- The MP4 box look -----------------------------------------------------------

/** Top-level boxes read before giving up (a real MP4 has about four). */
const MAX_TOP_BOXES = 64;

/**
 * Whether `moov` comes before `mdat` among the file's top-level boxes:
 * true when it does (`+faststart`), false when `mdat` comes first, null
 * when neither was found (not an MP4, or a broken one). Reads only the
 * 8 or 16 byte box headers, never the media.
 */
export async function moovBeforeMdat(file: string): Promise<boolean | null> {
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const size = (await handle.stat()).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    for (let index = 0; index < MAX_TOP_BOXES && offset + 8 <= size; index += 1) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) return null;
      const box = readBoxHeader(header.subarray(0, bytesRead), size - offset);
      if (!box) return null;
      if (box.type === 'moov') return true;
      if (box.type === 'mdat') return false;
      offset += box.size;
    }
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * One box header: a 32-bit size and a four letter type, the size 1 meaning
 * a 64-bit size follows and 0 meaning "to the end of the file". Null for a
 * size that cannot be right. Exported for tests.
 */
export function readBoxHeader(
  header: Buffer,
  bytesLeft: number,
): { type: string; size: number } | null {
  if (header.length < 8) return null;
  const small = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let size: number;
  let headerSize = 8;
  if (small === 1) {
    if (header.length < 16) return null;
    const large = header.readBigUInt64BE(8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (small === 0) {
    size = bytesLeft;
  } else {
    size = small;
  }
  if (size < headerSize || size > bytesLeft) return null;
  return { type, size };
}
