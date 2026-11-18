/**
 * Sounds (Module 14): what a library sound and a workspace's own sound
 * become before the editor or the export ever plays them. One fixed format
 * keeps both simple: AAC-LC in `.m4a`, 48 kHz, two channels, tags stripped.
 *
 * - **`normaliseSound`** (the operator's library ingest, research 10 section
 *   8.2, step 5 and 6): decode, two channels, 48 kHz, silence trimmed at the
 *   start and the end, 5 ms fades against clicks, then a level. Music and
 *   ambient sounds (and effects of 3 s or more) aim at -16 LUFS integrated
 *   with the true peak kept at or under -1.5 dB, by one straight gain (no
 *   limiter, so a very dynamic track can land a little quieter). Effects
 *   shorter than 3 seconds are peak-normalised to -3 dBFS, because loudness
 *   is unreliable on very short sounds. Effects must last 0.1 to 15 s and
 *   music 5 s to 10 minutes, after the trim.
 * - **`convertUploadedSound`** (a workspace's upload, `clipSoundCheckWorkflow`):
 *   sound only, at most 10 minutes, converted to the same format with its
 *   level left as it is (the export evens the whole mix out).
 * - **Peaks**: 100 values, 0 to 255, the loudest sample in each hundredth of
 *   the sound, read from a 16 kHz decode of the made file.
 *
 * A mono source is duplicated at full level into both channels with `pan`
 * (`c0=c0|c1=c0`): FFmpeg's automatic mono to stereo upmix is 3 dB quieter
 * per channel, while Web Audio duplicates at full level, so the editor and
 * the export would disagree. Every program runs through the runner with an
 * argument array, and every input is read with an audio demuxer allowlist
 * and file access only.
 */
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { SOUND_PEAKS, SOUND_UPLOAD_MAX_MS } from '@postgear/video-engine';
import { z } from 'zod';
import { readWavHeader } from '../ffmpeg/import';
import { fileInput } from '../ffmpeg/probe';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';

/** The audio demuxers a sound may be read with (`mov` covers M4A). */
export const SOUND_FORMAT_ALLOWLIST = 'mp3,wav,mov,mp4,m4a,3gp,3g2,mj2,aac,ogg,flac';
const SAFE_SOUND_INPUT = [
  '-format_whitelist',
  SOUND_FORMAT_ALLOWLIST,
  '-protocol_whitelist',
  'file',
];

/** Sound codecs we decode. */
export const SOUND_CODECS: readonly string[] = [
  'mp3',
  'mp3float',
  'aac',
  'vorbis',
  'opus',
  'flac',
  'alac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_u8',
];

/** The targets and limits of section 3 (step 5). */
export const SOUND_LIMITS = Object.freeze({
  sampleRate: 48_000,
  bitrateKbps: 128,
  /** Music, ambient sounds and long effects. */
  loudnessLufs: -16,
  truePeakDb: -1.5,
  /** Short effects. */
  shortPeakDb: -3,
  shortMs: 3_000,
  sfxMinMs: 100,
  sfxMaxMs: 15_000,
  musicMinMs: 5_000,
  musicMaxMs: 10 * 60_000,
  /** Silence at the ends is anything quieter than this. */
  silenceDb: -60,
  fadeMs: 5,
  uploadMaxMs: SOUND_UPLOAD_MAX_MS,
  /** The decode the peaks are read from. */
  peaksRate: 16_000,
});

/** The file types a sound may be, read from its first bytes. */
export type SoundFileType = 'mp3' | 'wav' | 'm4a' | 'aac' | 'ogg' | 'flac';

/** The types a person may upload (the library ingest also reads OGG and FLAC, Kenney's packs are OGG). */
export const UPLOAD_SOUND_TYPES: readonly SoundFileType[] = ['mp3', 'wav', 'm4a', 'aac'];

/**
 * What a file really is, from its first bytes, or null. A file's name and
 * its stated type are never trusted; ffprobe still has the last word.
 */
export function sniffSoundType(head: Uint8Array): SoundFileType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length < 4) return null;
  if (ascii(0, 4) === 'RIFF' && head.length >= 12 && ascii(8, 12) === 'WAVE') return 'wav';
  if (head.length >= 8 && ascii(4, 8) === 'ftyp') return 'm4a';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 3) === 'ID3') return 'mp3';
  const b0 = head[0] as number;
  const b1 = head[1] as number;
  if (b0 === 0xff) {
    // ADTS AAC: 12 sync bits, then layer 00.
    if ((b1 & 0xf6) === 0xf0) return 'aac';
    // MPEG audio frame: 11 sync bits, a known version, layer III.
    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    if ((b1 & 0xe0) === 0xe0 && version !== 0x01 && layer === 0x01) return 'mp3';
  }
  return null;
}

export type SoundErrorCode =
  | 'sound_unusable'
  | 'sound_too_short'
  | 'sound_too_long'
  | 'cancelled'
  | 'tool_failed';

/** Normalising failed. `code` is one of ours; the message never holds a path or FFmpeg's text. */
export class SoundError extends Error {
  readonly code: SoundErrorCode;
  constructor(code: SoundErrorCode, options: { cause?: unknown } = {}) {
    super(`sound failed: ${code}`);
    this.name = 'SoundError';
    this.code = code;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** What ffprobe says about a sound file. */
export interface SoundFacts {
  format: string;
  codec: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
}

const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        sample_rate: z.union([z.string(), z.number()]).optional(),
        channels: z.number().int().optional(),
        duration: z.string().optional(),
        disposition: z.object({ attached_pic: z.number().optional() }).partial().optional(),
      }),
    )
    .max(16)
    .default([]),
  format: z.object({ format_name: z.string(), duration: z.string().optional() }),
});

/** The ffprobe arguments for `probeSound`: audio demuxers only, from a file. */
export function buildSoundProbeArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    ...SAFE_SOUND_INPUT,
    '-print_format',
    'json',
    '-show_entries',
    'format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels,duration:stream_disposition=attached_pic',
    fileInput(file),
  ];
}

/**
 * Maps ffprobe's JSON to `SoundFacts`. A file with a real picture stream (a
 * video), no sound, a codec we do not decode or no length is refused; a
 * cover picture in an MP3 or M4A is fine (it is never read).
 */
export function soundFactsFromProbe(json: unknown): SoundFacts {
  const parsed = probeSchema.safeParse(json);
  if (!parsed.success) throw new SoundError('sound_unusable');
  const { streams, format } = parsed.data;
  const video = streams.some(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (video || !audio?.codec_name || !SOUND_CODECS.includes(audio.codec_name)) {
    throw new SoundError('sound_unusable');
  }
  const seconds = Number(audio.duration ?? format.duration);
  const sampleRate = Number(audio.sample_rate);
  const channels = audio.channels ?? 0;
  if (!(seconds > 0) || !Number.isFinite(seconds) || !(sampleRate > 0) || channels < 1) {
    throw new SoundError('sound_unusable');
  }
  return {
    format: format.format_name,
    codec: audio.codec_name,
    durationMs: Math.round(seconds * 1000),
    sampleRate,
    channels,
  };
}

async function runOrMap(
  runTool: RunTool,
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  onStderrLine?: (line: string) => void,
): Promise<string> {
  try {
    const result = await runTool(tool, args, {
      cwd,
      timeoutMs: 300_000,
      signal,
      maxStdoutBytes: 4 * 1024 * 1024,
      onStderrLine,
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.aborted) throw new SoundError('cancelled', { cause: error });
      // The program ran and said no: the file is not a sound it can read.
      if (error.exitCode !== null && !error.timedOut) {
        throw new SoundError('sound_unusable', { cause: error });
      }
    }
    throw new SoundError('tool_failed', { cause: error });
  }
}

/** Reads `file` with ffprobe (audio demuxers only). */
export async function probeSound(
  runTool: RunTool,
  file: string,
  options: { cwd: string; signal?: AbortSignal },
): Promise<SoundFacts> {
  const stdout = await runOrMap(
    runTool,
    'ffprobe',
    buildSoundProbeArgs(file),
    options.cwd,
    options.signal,
  );
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new SoundError('sound_unusable', { cause: error });
  }
  return soundFactsFromProbe(json);
}

/** The filter that makes any channel count two channels: mono duplicated at full level, more mixed down. */
export function stereoFilter(channels: number): string | null {
  if (channels === 1) return 'pan=stereo|c0=c0|c1=c0';
  if (channels === 2) return null;
  return 'aformat=channel_layouts=stereo';
}

const HEAD = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
/** The made file says nothing about the tools or the time it was made, so the same sound is the same bytes. */
const BITEXACT = ['-fflags', '+bitexact', '-flags:a', '+bitexact'];

/**
 * FFmpeg arguments for the first step: two channels, 48 kHz, silence trimmed
 * at both ends, a 32-bit float WAV (so a source that peaks over full scale
 * is levelled, not clipped).
 */
export function trimSoundArgs(input: string, output: string, channels: number): string[] {
  const silence = `silenceremove=start_periods=1:start_threshold=${SOUND_LIMITS.silenceDb}dB:start_silence=0.02`;
  const filters = [
    stereoFilter(channels),
    `aresample=${SOUND_LIMITS.sampleRate}`,
    'aformat=sample_fmts=flt',
    silence,
    'areverse',
    silence,
    'areverse',
  ].filter((filter): filter is string => filter !== null);
  return [
    ...HEAD,
    ...SAFE_SOUND_INPUT,
    '-i',
    fileInput(input),
    '-vn',
    '-sn',
    '-dn',
    '-af',
    filters.join(','),
    '-map_metadata',
    '-1',
    '-c:a',
    'pcm_f32le',
    '-f',
    'wav',
    output,
  ];
}

/** FFmpeg arguments that measure a file: the integrated loudness, the sample and the true peak. */
export function measureSoundArgs(input: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    ...SAFE_SOUND_INPUT,
    '-i',
    fileInput(input),
    '-vn',
    '-af',
    'ebur128=peak=sample+true:framelog=verbose',
    '-f',
    'null',
    '-',
  ];
}

function formatDb(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * FFmpeg arguments for the made file: a straight gain in dB, the 5 ms fades
 * (the fade out ends where the sound ends), AAC-LC at 128 kbps, 48 kHz, two
 * channels, `.m4a`, no tags.
 */
export function encodeSoundArgs(
  input: string,
  output: string,
  options: { gainDb: number; durationMs: number; channels?: number },
): string[] {
  const fade = SOUND_LIMITS.fadeMs / 1000;
  const fadeOutStart = Math.max(0, options.durationMs / 1000 - fade).toFixed(3);
  const filters = [
    stereoFilter(options.channels ?? 2),
    `aresample=${SOUND_LIMITS.sampleRate}`,
    ...(Math.abs(options.gainDb) >= 0.01 ? [`volume=${formatDb(options.gainDb)}dB`] : []),
    `afade=t=in:st=0:d=${fade}`,
    `afade=t=out:st=${fadeOutStart}:d=${fade}`,
  ].filter((filter): filter is string => filter !== null);
  return encodeArgs(input, output, filters);
}

/** FFmpeg arguments for an upload: two channels, 48 kHz, its level kept, AAC in `.m4a`, no tags or pictures. */
export function convertSoundArgs(input: string, output: string, channels: number): string[] {
  const filters = [stereoFilter(channels), `aresample=${SOUND_LIMITS.sampleRate}`].filter(
    (filter): filter is string => filter !== null,
  );
  return encodeArgs(input, output, filters);
}

function encodeArgs(input: string, output: string, filters: string[]): string[] {
  return [
    ...HEAD,
    ...SAFE_SOUND_INPUT,
    '-i',
    fileInput(input),
    '-vn',
    '-sn',
    '-dn',
    '-af',
    filters.join(','),
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:a',
    'aac',
    '-b:a',
    `${SOUND_LIMITS.bitrateKbps}k`,
    '-ar',
    String(SOUND_LIMITS.sampleRate),
    '-ac',
    '2',
    ...BITEXACT,
    '-movflags',
    '+faststart',
    '-f',
    'ipod',
    output,
  ];
}

/** FFmpeg arguments for the decode the peaks are read from: one 16 kHz channel, 16-bit WAV. */
export function peaksDecodeArgs(input: string, output: string): string[] {
  return [
    ...HEAD,
    ...SAFE_SOUND_INPUT,
    '-i',
    fileInput(input),
    '-vn',
    '-af',
    `pan=mono|c0=0.5*c0+0.5*c1,aresample=${SOUND_LIMITS.peaksRate}`,
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    output,
  ];
}

/** What `ebur128` measured. Loudness is null when the sound is too short or too quiet to gate. */
export interface SoundLevels {
  loudnessLufs: number | null;
  samplePeakDb: number | null;
  truePeakDb: number | null;
}

/**
 * Reads `ebur128`'s summary (stderr at `info`): the `I:` line under
 * "Integrated loudness", the `Peak:` lines under "Sample peak" and "True
 * peak". `-inf` and `-70` (nothing above the gate) read as null.
 */
export function parseEbur128Summary(lines: readonly string[]): SoundLevels {
  const at = lines.findIndex((line) => /Summary:\s*$/.test(line));
  const tail = at >= 0 ? lines.slice(at + 1) : [];
  let section: 'integrated' | 'sample' | 'true' | null = null;
  const levels: SoundLevels = { loudnessLufs: null, samplePeakDb: null, truePeakDb: null };
  const number = (text: string | undefined): number | null => {
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  };
  for (const line of tail) {
    if (/Integrated loudness:/.test(line)) section = 'integrated';
    else if (/Sample peak:/.test(line)) section = 'sample';
    else if (/True peak:/.test(line)) section = 'true';
    else if (/Loudness range:/.test(line)) section = null;
    const loud = /^\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(line);
    if (loud && section === 'integrated') {
      const value = number(loud[1]);
      levels.loudnessLufs = value !== null && value > -70 ? value : null;
    }
    const peak = /^\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/.exec(line);
    if (peak && section === 'sample') levels.samplePeakDb = number(peak[1]);
    if (peak && section === 'true') levels.truePeakDb = number(peak[1]);
  }
  return levels;
}

/** Measures a file with `ebur128`. */
export async function measureSound(
  runTool: RunTool,
  file: string,
  options: { cwd: string; signal?: AbortSignal },
): Promise<SoundLevels> {
  const lines: string[] = [];
  await runOrMap(runTool, 'ffmpeg', measureSoundArgs(file), options.cwd, options.signal, (line) => {
    lines.push(line);
    // Only the summary is wanted; keep memory flat on a long file.
    if (lines.length > 200) lines.splice(0, lines.length - 200);
  });
  return parseEbur128Summary(lines);
}

/**
 * The gain, in dB, that brings a sound to its target: a short effect's sample
 * peak to -3 dBFS; anything else to -16 LUFS with its true peak kept at or
 * under -1.5 dB (whichever asks less), or by its peak when it is too quiet
 * or short to gate. Null when there is nothing to level (silence).
 */
export function soundGainDb(
  levels: SoundLevels,
  options: { kind: 'sfx' | 'music'; category: string; durationMs: number },
): number | null {
  const short =
    options.kind === 'sfx' &&
    options.category !== 'ambient' &&
    options.durationMs < SOUND_LIMITS.shortMs;
  if (short || levels.loudnessLufs === null) {
    const peak = levels.samplePeakDb ?? levels.truePeakDb;
    if (peak === null || !(peak > -90)) return null;
    const target = short ? SOUND_LIMITS.shortPeakDb : SOUND_LIMITS.truePeakDb;
    return target - peak;
  }
  const toLoudness = SOUND_LIMITS.loudnessLufs - levels.loudnessLufs;
  const peak = levels.truePeakDb ?? levels.samplePeakDb;
  const toPeak = peak === null ? toLoudness : SOUND_LIMITS.truePeakDb - peak;
  return Math.min(toLoudness, toPeak);
}

/** Whether a length is allowed for the kind. */
export function soundLengthProblem(
  kind: 'sfx' | 'music',
  durationMs: number,
): 'sound_too_short' | 'sound_too_long' | null {
  const min = kind === 'music' ? SOUND_LIMITS.musicMinMs : SOUND_LIMITS.sfxMinMs;
  const max = kind === 'music' ? SOUND_LIMITS.musicMaxMs : SOUND_LIMITS.sfxMaxMs;
  if (durationMs < min) return 'sound_too_short';
  if (durationMs > max) return 'sound_too_long';
  return null;
}

function toByte(peak: number): number {
  return Math.min(255, Math.round((peak / 32768) * 255));
}

/**
 * `count` peaks (0 to 255) from a 16-bit PCM WAV: the loudest sample of any
 * channel in each `count`th of the file. Streams the file. A file shorter
 * than `count` samples repeats its samples so there are always `count`.
 */
export async function soundPeaksFromWav(
  wavFile: string,
  count: number = SOUND_PEAKS,
): Promise<number[]> {
  const format = await readWavHeader(wavFile);
  const frameBytes = 2 * format.channels;
  const dataBytes = format.dataBytes ?? (await stat(wavFile)).size - format.dataOffset;
  const frames = Math.floor(dataBytes / frameBytes);
  const peaks = new Array<number>(count).fill(0);
  if (frames === 0) return peaks;
  let frame = 0;
  let carry: Buffer | null = null;
  const stream = createReadStream(wavFile, {
    start: format.dataOffset,
    end: format.dataOffset + frames * frameBytes - 1,
    highWaterMark: 1 << 20,
  });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const buffer: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    const usable = buffer.length - (buffer.length % frameBytes);
    for (let offset = 0; offset < usable; offset += frameBytes) {
      // Every bucket that this frame falls in (several when there are fewer frames than buckets).
      const first = Math.floor((frame * count) / frames);
      const last = Math.max(first, Math.ceil(((frame + 1) * count) / frames) - 1);
      let loudest = 0;
      for (let c = 0; c < format.channels; c += 1) {
        const sample = Math.abs(buffer.readInt16LE(offset + c * 2));
        if (sample > loudest) loudest = sample;
      }
      const value = toByte(loudest);
      for (let bucket = first; bucket <= Math.min(count - 1, last); bucket += 1) {
        if (value > (peaks[bucket] as number)) peaks[bucket] = value;
      }
      frame += 1;
    }
    carry = usable < buffer.length ? buffer.subarray(usable) : null;
  }
  return peaks;
}

/** Decodes a made file and reads its peaks; the decode is removed after. */
export async function soundPeaks(
  runTool: RunTool,
  file: string,
  options: { cwd: string; signal?: AbortSignal; scratchName?: string },
): Promise<number[]> {
  const wav = options.scratchName ?? `${path.basename(file, path.extname(file))}.peaks.wav`;
  try {
    await runOrMap(runTool, 'ffmpeg', peaksDecodeArgs(file, wav), options.cwd, options.signal);
    return await soundPeaksFromWav(path.join(options.cwd, wav));
  } finally {
    await rm(path.join(options.cwd, wav), { force: true });
  }
}

export interface NormaliseSoundOptions {
  runTool: RunTool;
  /** The working folder: `input` and `output` are names inside it. */
  cwd: string;
  input: string;
  /** The `.m4a` to make, inside `cwd`. */
  output: string;
  kind: 'sfx' | 'music';
  /** The category slug (ambient sounds are levelled like music). */
  category: string;
  signal?: AbortSignal;
}

export interface NormalisedSound {
  /** The made file's name inside `cwd`. */
  file: string;
  durationMs: number;
  /** Measured on the made file. */
  loudnessLufs: number;
  truePeakDb: number;
  peaks: number[];
  bytes: number;
}

async function sizeOf(cwd: string, name: string): Promise<number> {
  return (await stat(path.join(cwd, name))).size;
}

/** Turns an accepted library sound into the catalogue's `.m4a` (see the top of this file). */
export async function normaliseSound(options: NormaliseSoundOptions): Promise<NormalisedSound> {
  const { runTool, cwd, input, output, signal } = options;
  const facts = await probeSound(runTool, input, { cwd, signal });
  // A source far past the longest allowed sound is not even decoded.
  if (facts.durationMs > SOUND_LIMITS.musicMaxMs * 2) throw new SoundError('sound_too_long');

  const trimmed = `${path.basename(output, path.extname(output))}.trimmed.wav`;
  try {
    await runOrMap(runTool, 'ffmpeg', trimSoundArgs(input, trimmed, facts.channels), cwd, signal);
    // A file that was all silence trims to nothing, which ffprobe cannot read: unusable either way.
    const durationMs = (await probeSound(runTool, trimmed, { cwd, signal })).durationMs;
    const problem = soundLengthProblem(options.kind, durationMs);
    if (problem) throw new SoundError(problem);

    const levels = await measureSound(runTool, trimmed, { cwd, signal });
    const gainDb = soundGainDb(levels, {
      kind: options.kind,
      category: options.category,
      durationMs,
    });
    if (gainDb === null) throw new SoundError('sound_unusable');
    await runOrMap(
      runTool,
      'ffmpeg',
      encodeSoundArgs(trimmed, output, { gainDb, durationMs }),
      cwd,
      signal,
    );
  } finally {
    await rm(path.join(cwd, trimmed), { force: true });
  }

  const made = await probeSound(runTool, output, { cwd, signal });
  const after = await measureSound(runTool, output, { cwd, signal });
  const peaks = await soundPeaks(runTool, output, { cwd, signal });
  return {
    file: output,
    durationMs: made.durationMs,
    loudnessLufs: after.loudnessLufs ?? -70,
    truePeakDb: after.truePeakDb ?? after.samplePeakDb ?? -90,
    peaks,
    bytes: await sizeOf(cwd, output),
  };
}

export interface ConvertedSound {
  file: string;
  durationMs: number;
  peaks: number[];
  bytes: number;
}

/**
 * A workspace's uploaded sound made the editor's format (see the top of this
 * file): `sound_unusable` for anything that is not a sound we decode (a text
 * file named `.mp3`, a video), `sound_too_long` past 10 minutes.
 */
export async function convertUploadedSound(options: {
  runTool: RunTool;
  cwd: string;
  input: string;
  output: string;
  signal?: AbortSignal;
}): Promise<ConvertedSound> {
  const { runTool, cwd, input, output, signal } = options;
  const facts = await probeSound(runTool, input, { cwd, signal });
  if (facts.durationMs > SOUND_LIMITS.uploadMaxMs) throw new SoundError('sound_too_long');
  await runOrMap(runTool, 'ffmpeg', convertSoundArgs(input, output, facts.channels), cwd, signal);
  const made = await probeSound(runTool, output, { cwd, signal });
  if (made.durationMs > SOUND_LIMITS.uploadMaxMs + 1_000) throw new SoundError('sound_too_long');
  const peaks = await soundPeaks(runTool, output, { cwd, signal });
  return { file: output, durationMs: made.durationMs, peaks, bytes: await sizeOf(cwd, output) };
}
