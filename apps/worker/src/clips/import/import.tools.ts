/**
 * The FFmpeg and disk work an import does, as one small interface.
 *
 * The real binding is `@postgear/media-tools` with the worker's `RunTool`
 * (the only place a program is started); tests hand a fake that writes small
 * files, so the import steps are checked for their order, progress, limits,
 * cleanup and cancel without running FFmpeg.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  assertFreeDisk,
  computeWaveformFromWav,
  type DeriveResult,
  deriveAnalysisAndFilmstrip,
  type FfmpegJobOptions,
  type MediaFacts,
  makePoster,
  type NormaliseResult,
  normaliseVideo,
  type PosterResult,
  probeFile,
  type RunTool,
  type WaveformResult,
  writeEmptyWaveform,
} from '@postgear/media-tools';

type JobOptions = Omit<FfmpegJobOptions, 'runTool'>;

export interface ImportTools {
  probe(file: string, options: { cwd: string; signal: AbortSignal }): Promise<MediaFacts>;
  normalise(
    options: JobOptions & {
      input: string;
      output: string;
      facts: MediaFacts;
      maxShortSide: number;
    },
  ): Promise<NormaliseResult>;
  derive(
    options: JobOptions & {
      input: string;
      outDir: string;
      analysisOut: string;
      facts: Pick<MediaFacts, 'durationMs' | 'hasAudio'>;
      keyframesOnly?: boolean;
    },
  ): Promise<DeriveResult>;
  /** Peaks from the analysis WAV, or an empty file for a silent video, as raw bytes. */
  waveform(options: {
    wavFile: string | null;
    output: string;
    signal: AbortSignal;
  }): Promise<WaveformResult>;
  poster(
    options: JobOptions & {
      input: string;
      output: string;
      facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
      atMs?: number;
    },
  ): Promise<PosterResult>;
  /** Throws `DiskSpaceError` unless the scratch disk has room for `bytes` plus the margin. */
  freeDisk(dir: string, bytes: number): Promise<void>;
}

export function mediaImportTools(runTool: RunTool): ImportTools {
  return {
    probe: (file, options) => probeFile(runTool, file, options),
    normalise: (options) => normaliseVideo({ ...options, runTool }),
    derive: (options) => deriveAnalysisAndFilmstrip({ ...options, runTool }),
    waveform: ({ wavFile, output, signal }) =>
      wavFile ? computeWaveformFromWav({ wavFile, output, signal }) : writeEmptyWaveform(output),
    poster: (options) => makePoster({ ...options, runTool }),
    freeDisk: (dir, bytes) => assertFreeDisk(dir, bytes),
  };
}

/**
 * The private space has no raw-bytes extension, so the waveform is stored as
 * a JSON array of whole numbers 0 to 255 (one per twentieth of a second):
 * the web reads it with `response.json()`. A six hour video is about 1.7 MB.
 */
export async function peaksToJson(binFile: string, jsonFile: string): Promise<number> {
  const bytes = await readFile(binFile);
  const text = JSON.stringify(Array.from(bytes));
  await writeFile(jsonFile, text);
  return Buffer.byteLength(text);
}
