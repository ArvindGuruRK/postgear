/**
 * The loudness producer (Module 16 section 3; research 06 section 3).
 *
 * FFmpeg's `ebur128` over the video's analysis sound (the 16 kHz mono WAV the
 * import made), in 100 ms frames with the metadata printed to a file in the
 * job's scratch folder (progress keeps stdout). We keep the short-term
 * loudness (`lavfi.r128.S`, a 3 second window, LUFS) and the loudest value in
 * each half second. The filter reads -120.7 until its first 3 seconds are
 * filled, so those are left as no data rather than read as silence.
 *
 * A video with no sound has no analysis file: no track (the run says "This
 * video has no sound, so we looked at the picture only.").
 */
import { readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { binTrack, type SignalTrack } from '@postgear/video-engine';
import { INPUT_PROTOCOL_ALLOWLIST } from '../ffmpeg/probe';
import { defaultTimeoutMs, FFMPEG_HEAD, runFfmpeg } from '../ffmpeg/run';
import type { RunTool } from '../run/types';
import { parseMetadataPrint } from './metadata';

/** The file the metadata is printed to, inside the scratch folder. */
export const LOUDNESS_PRINT_FILE = 'signals-loudness.txt';
/** `ebur128`'s short-term window: values before it is filled are not real. */
const SHORT_TERM_WINDOW_SEC = 3;
const KEY = 'lavfi.r128.S';

/** The FFmpeg arguments: the analysis sound in, the metadata print out, nothing written. */
export function loudnessArgs(audioFile: string): string[] {
  return [
    ...FFMPEG_HEAD,
    '-protocol_whitelist',
    INPUT_PROTOCOL_ALLOWLIST,
    '-i',
    audioFile,
    '-vn',
    '-af',
    `ebur128=metadata=1,ametadata=mode=print:key=${KEY}:file=${LOUDNESS_PRINT_FILE}`,
    '-f',
    'null',
    '-',
  ];
}

/** The loudness track from the printed metadata. */
export function loudnessTrackFrom(text: string, durationMs: number): SignalTrack {
  const points = parseMetadataPrint(text, KEY).filter(
    (point) => point.sec >= SHORT_TERM_WINDOW_SEC - 0.15,
  );
  return binTrack('loudness', points, durationMs, { combine: 'max', empty: 'null' });
}

export interface ProduceInput {
  runTool: RunTool;
  /** The job's scratch folder (absolute); the print file is written here. */
  cwd: string;
  durationMs: number;
  signal?: AbortSignal;
  /** 0 to 100. */
  onProgress?: (percent: number) => void;
}

/** Measures the loudness of `audioFile` (inside `cwd`). Null for no file. Throws `FfmpegError` when FFmpeg fails. */
export async function produceLoudness(
  input: ProduceInput & { audioFile: string | null },
): Promise<SignalTrack | null> {
  if (!input.audioFile) return null;
  const print = path.join(input.cwd, LOUDNESS_PRINT_FILE);
  await rm(print, { force: true });
  await runFfmpeg({
    runTool: input.runTool,
    cwd: input.cwd,
    signal: input.signal,
    onProgress: input.onProgress,
    // Sound only: hundreds of times faster than real time; the default is generous.
    timeoutMs: defaultTimeoutMs(input.durationMs),
    args: loudnessArgs(input.audioFile),
    durationMs: input.durationMs,
  });
  const text = await readFile(print, 'utf8').catch(() => '');
  await rm(print, { force: true });
  return loudnessTrackFrom(text, input.durationMs);
}
