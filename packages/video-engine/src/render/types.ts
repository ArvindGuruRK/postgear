/**
 * What the compiler hands the executor. Pure data: strings and numbers.
 *
 * File names are relative to the job's scratch folder (the executor runs
 * FFmpeg with that folder as its working directory), so nothing here ever
 * holds a full path, and a plan made on one machine runs on another.
 */

export interface CompiledInput {
  /** A file name inside the scratch folder. */
  file: string;
  /** Input seeking (`-ss` before `-i`), so FFmpeg does not decode from the start of a long file. */
  seekMs: number | null;
  /** Extra input options placed before `-ss` and `-i` (`-stream_loop -1`, `-framerate 30`). */
  options: string[];
}

export interface CompiledFfmpeg {
  inputs: CompiledInput[];
  /** The whole filter graph; written to `graph.txt` and passed as `-/filter_complex graph.txt`. */
  filterComplexScript: string;
  /** ASS subtitle files the graph names, written beside it. */
  assFiles: Array<{ name: string; content: string }>;
  /** Everything after the inputs and the graph: maps, codecs, rate, `-t`. Never the output name. */
  outputArgs: string[];
  /** The output's exact length, for progress. */
  durationMs: number;
  /**
   * The fonts the text needs, or null when the clip has no text. The worker
   * copies `files` into `dir`; the executor runs FFmpeg at a log level that
   * prints libass's `fontselect:` lines and fails with `font_missing` when
   * one names a font outside `psNames` (a silent fallback).
   */
  fonts: { dir: string; files: string[]; psNames: string[] } | null;
  /**
   * The log level when it is not the default (`info` with text, else
   * `error`): the loudness measure runs at `info`, where `loudnorm` prints
   * its JSON block.
   */
  logLevel?: 'info' | 'error';
}

/** The graph's file name inside the scratch folder. */
export const GRAPH_FILE = 'graph.txt';

/**
 * The only protocol a render input may be opened with: a plain file. The
 * inputs are the person's own uploads (videos, stickers, sounds), so a file
 * that is really a playlist or a `concat:` list can never reach the network
 * or another file (security sweep, Module 20).
 */
export const RENDER_INPUT_PROTOCOLS = 'file';

/**
 * The full argument array for one render: fixed head, the inputs (each read
 * with the protocol allowlist), the graph by file (FFmpeg 9.0.2 removed
 * `-filter_complex_script`), the output options and the output name. Never a
 * shell string: the executor spawns FFmpeg with this array.
 */
export function ffmpegArgsFor(compiled: CompiledFfmpeg, outFile: string): string[] {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    // A render with text logs at `info`, where libass prints its `fontselect:` lines (verified on 9.0.2).
    compiled.logLevel ?? (compiled.fonts ? 'info' : 'error'),
    '-progress',
    'pipe:1',
    '-nostats',
  ];

  for (const input of compiled.inputs) {
    args.push(...input.options, '-protocol_whitelist', RENDER_INPUT_PROTOCOLS);
    if (input.seekMs !== null && input.seekMs > 0) {
      args.push('-ss', msToSeconds(input.seekMs));
    }
    args.push('-i', input.file);
  }

  args.push('-/filter_complex', GRAPH_FILE, ...compiled.outputArgs, outFile);
  return args;
}

/** Milliseconds as FFmpeg seconds with three decimals: 1234 is "1.234". */
export function msToSeconds(ms: number): string {
  const whole = Math.round(ms);
  const sign = whole < 0 ? '-' : '';
  const abs = Math.abs(whole);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}
