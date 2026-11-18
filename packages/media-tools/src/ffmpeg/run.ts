/**
 * One FFmpeg run with progress, cancel and a typed failure.
 *
 * Every FFmpeg job (normalise, derive, poster, render) needs the same
 * plumbing: the progress parser on stdout, the abort signal, a timeout that
 * grows with the length of the video, and a failure that says what kind of
 * failure it was without carrying FFmpeg's own text.
 */
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';
import { type FfmpegProgress, FfmpegProgressParser, PROGRESS_ARGS } from './progress';

/** The fixed head of every FFmpeg call: quiet, never reads stdin, overwrites, reports progress. */
export const FFMPEG_HEAD: readonly string[] = [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-loglevel',
  'error',
  // One progress block a second keeps a six hour job's output small.
  '-stats_period',
  '1',
  ...PROGRESS_ARGS,
];

export type FfmpegErrorCode = 'cancelled' | 'tool_failed';

/** An FFmpeg job failed or was stopped. The message never holds FFmpeg's text or a path. */
export class FfmpegError extends Error {
  readonly code: FfmpegErrorCode;
  readonly timedOut: boolean;
  /** For the log only. */
  readonly stderrTail: string;

  constructor(
    code: FfmpegErrorCode,
    options: { timedOut?: boolean; stderrTail?: string; cause?: unknown } = {},
  ) {
    super(code === 'cancelled' ? 'FFmpeg was stopped' : 'FFmpeg failed');
    this.name = 'FfmpegError';
    this.code = code;
    this.timedOut = options.timedOut ?? false;
    this.stderrTail = options.stderrTail ?? '';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** What every FFmpeg runner in this package takes. */
export interface FfmpegJobOptions {
  runTool: RunTool;
  /** Working folder: the job's scratch folder. */
  cwd: string;
  signal?: AbortSignal;
  /** 0 to 100, never going backwards. */
  onProgress?: (percent: number) => void;
  /** Overrides the default, which grows with the video's length. */
  timeoutMs?: number;
}

/** Fifteen minutes plus one and a half times the media's length. */
export function defaultTimeoutMs(durationMs: number): number {
  return 15 * 60_000 + Math.ceil(Math.max(0, durationMs) * 1.5);
}

/** Kept stdout for a progress run: generous, since blocks arrive for as long as FFmpeg runs. */
const PROGRESS_STDOUT_CAP = 64 * 1024 * 1024;

export interface FfmpegRunResult {
  /** True when FFmpeg printed `progress=end` (it finished writing). */
  ended: boolean;
  stderrTail: string;
  last: FfmpegProgress;
}

/**
 * Runs FFmpeg with `args` (which must include the progress arguments for
 * progress to flow), feeding stdout lines to the parser. Maps a failure to
 * `FfmpegError`: `cancelled` on abort, `tool_failed` for everything else.
 */
export async function runFfmpeg(
  options: FfmpegJobOptions & { args: readonly string[]; durationMs: number },
): Promise<FfmpegRunResult> {
  const parser = new FfmpegProgressParser(options.durationMs, (progress) => {
    options.onProgress?.(progress.percent);
  });
  try {
    const result = await options.runTool('ffmpeg', options.args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs(options.durationMs),
      signal: options.signal,
      maxStdoutBytes: PROGRESS_STDOUT_CAP,
      onStdoutLine: (line) => {
        parser.push(line);
      },
    });
    return { ended: parser.ended, stderrTail: result.stderrTail, last: parser.snapshot() };
  } catch (error) {
    throw toFfmpegError(error, options.signal);
  }
}

/** Turns whatever a run threw into an `FfmpegError`. */
export function toFfmpegError(error: unknown, signal?: AbortSignal): FfmpegError {
  if (error instanceof FfmpegError) {
    return error;
  }
  if (error instanceof ToolError) {
    return new FfmpegError(error.aborted ? 'cancelled' : 'tool_failed', {
      timedOut: error.timedOut,
      stderrTail: error.stderrTail,
      cause: error,
    });
  }
  return new FfmpegError(signal?.aborted ? 'cancelled' : 'tool_failed', { cause: error });
}
