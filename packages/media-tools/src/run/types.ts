/**
 * The one way an outside program is started (Sprint 12).
 *
 * Every call to yt-dlp, FFmpeg or ffprobe goes through a `RunTool`: an
 * argument array, never a shell string; a working directory inside the job's
 * scratch folder; a minimal environment; a timeout; capped output; and an
 * abort that kills the whole process tree. `runner.ts` implements it; tests
 * hand a fake one to everything that uses it.
 */

/** The programs Clips may start. Nothing else can be named. */
export type ToolName = 'ffmpeg' | 'ffprobe' | 'yt-dlp';

/** Where each program is, from `toolPaths(env)`: an absolute path or a name on PATH. */
export interface ToolPaths {
  ffmpeg: string;
  ffprobe: string;
  ytDlp: string;
  /** The JavaScript runtime yt-dlp uses for YouTube (Deno by default); null when none is set. */
  jsRuntime: string | null;
}

export interface RunToolOptions {
  /** Working directory. Must already exist; for jobs, the job's scratch folder. */
  cwd: string;
  /** The process is killed after this long, and the call rejects with `timedOut`. */
  timeoutMs: number;
  /** Aborting kills the whole process tree and rejects with `aborted`. */
  signal?: AbortSignal;
  /** Added to the minimal environment the runner builds (PATH, SYSTEMROOT, TEMP and so on). */
  env?: Record<string, string>;
  /** Each complete stdout line, as it arrives (FFmpeg `-progress pipe:1`, yt-dlp progress). */
  onStdoutLine?: (line: string) => void;
  /** Each complete stderr line, as it arrives. */
  onStderrLine?: (line: string) => void;
  /**
   * How much stdout to keep for the result (yt-dlp `-J` can be large).
   * Past the cap the process is killed and the call rejects. Default 16 MB.
   */
  maxStdoutBytes?: number;
  /**
   * A watcher run every `everyMs` while the process lives. If `check` throws,
   * the process tree is killed and the call rejects with that error. Used to
   * stop a download past its size cap (`--max-filesize` is ignored for HLS).
   */
  watch?: { everyMs: number; check: () => void | Promise<void> };
}

export interface RunToolResult {
  exitCode: number;
  stdout: string;
  /** The last 8 KB of stderr, for the log only, never for a person. */
  stderrTail: string;
  durationMs: number;
}

export type RunTool = (
  tool: ToolName,
  args: readonly string[],
  options: RunToolOptions,
) => Promise<RunToolResult>;

/**
 * A program failed, timed out or was stopped. `message` never holds the
 * program's output (it can carry paths and platform text); `stderrTail` is
 * there for the log and for mapping a cause to one of our codes.
 */
export class ToolError extends Error {
  readonly tool: ToolName;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly stderrTail: string;
  readonly stdoutTail: string;

  constructor(params: {
    tool: ToolName;
    exitCode: number | null;
    timedOut?: boolean;
    aborted?: boolean;
    stderrTail?: string;
    stdoutTail?: string;
    reason?: string;
  }) {
    const what = params.aborted
      ? 'was stopped'
      : params.timedOut
        ? 'took too long'
        : (params.reason ?? `exited with code ${params.exitCode}`);
    super(`${params.tool} ${what}`);
    this.name = 'ToolError';
    this.tool = params.tool;
    this.exitCode = params.exitCode;
    this.timedOut = params.timedOut ?? false;
    this.aborted = params.aborted ?? false;
    this.stderrTail = params.stderrTail ?? '';
    this.stdoutTail = params.stdoutTail ?? '';
  }
}
