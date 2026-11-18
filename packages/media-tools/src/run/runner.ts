/**
 * The process runner: the only file in the repository allowed to start an
 * outside program (a test in `src/guard.test.ts` enforces it).
 *
 * Why it is shaped like this:
 * - An argument array with `shell: false`, so no text a person typed can ever
 *   become a shell command.
 * - A minimal environment, so the API's secrets never reach yt-dlp or FFmpeg.
 * - A timeout, an output cap and an AbortSignal that all kill the whole
 *   process tree (yt-dlp starts FFmpeg of its own), so a stuck or cancelled
 *   job never leaves a program running.
 * - It settles exactly once and clears every timer, so a worker that runs
 *   thousands of jobs never leaks a handle.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  type BuildToolName,
  type RunTool,
  type RunToolOptions,
  type RunToolResult,
  ToolError,
  type ToolName,
  type ToolPaths,
} from './types';

/** Default cap on kept stdout (the contract's default). */
export const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
/** How much of stderr (and stdout, on failure) is kept for the log. */
export const STREAM_TAIL_BYTES = 8 * 1024;
/** After a kill, how long to wait for the process to report its exit before giving up on it. */
const KILL_GRACE_MS = 5_000;

/** Environment variables passed through to a tool. Everything else is left behind. */
const PASSED_ENV = [
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'FONTCONFIG_FILE',
  'FONTCONFIG_PATH',
] as const;

/** The program could not be started at all: it is missing or not executable. */
export class ToolMissingError extends ToolError {
  constructor(tool: ToolName | BuildToolName) {
    super({ tool, exitCode: null, reason: 'is not installed or could not be started' });
    this.name = 'ToolMissingError';
  }
}

/**
 * Builds the `RunTool` every job uses, bound to where the programs are.
 * The worker makes one at boot from `toolPaths(process.env)`.
 */
export function createRunTool(paths: ToolPaths): RunTool {
  return (tool, args, options) => runProcess(tool, executableFor(paths, tool), args, options);
}

/**
 * Starts a build-time program (`BuildToolName`) for a script such as
 * `clips:fonts:build`, with the same rules as every job's tool: an argument
 * array, the minimal environment, a time limit and a kill of the whole tree.
 * `executable` is where the script found the program. Never used by a job.
 */
export function runBuildTool(
  tool: BuildToolName,
  executable: string,
  args: readonly string[],
  options: RunToolOptions,
): Promise<RunToolResult> {
  return runProcess(tool, executable, args, options);
}

function executableFor(paths: ToolPaths, tool: ToolName): string {
  switch (tool) {
    case 'ffmpeg':
      return paths.ffmpeg;
    case 'ffprobe':
      return paths.ffprobe;
    case 'yt-dlp':
      return paths.ytDlp;
  }
}

/** The environment a tool sees: a short allowlist from this process, plus the caller's additions. */
export function minimalEnv(
  source: NodeJS.ProcessEnv,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_ENV) {
    const value = readEnv(source, name);
    if (value !== undefined) {
      env[name] = value;
    }
  }
  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      env[name] = value;
    }
  }
  return env;
}

/** Windows spells some names in mixed case (`Path`, `SystemRoot`); look them up case-insensitively. */
function readEnv(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = source[name];
  if (direct !== undefined) {
    return direct;
  }
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(source)) {
    if (key.toUpperCase() === upper && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Splits a byte stream into lines on `\n`, `\r\n` or a lone `\r` (yt-dlp
 * redraws its progress with `\r`). A `\r` at the end of a chunk is held back
 * in case the next chunk starts with `\n`.
 */
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.feed(this.decoder.write(chunk));
  }

  /** Emits whatever is left as a last line. */
  end(): void {
    this.feed(this.decoder.end());
    const rest = this.pending.endsWith('\r') ? this.pending.slice(0, -1) : this.pending;
    this.pending = '';
    if (rest.length > 0) {
      this.onLine(rest);
    }
  }

  private feed(text: string): void {
    if (text.length === 0) {
      return;
    }
    let buffer = this.pending + text;
    let holdCr = false;
    if (buffer.endsWith('\r')) {
      buffer = buffer.slice(0, -1);
      holdCr = true;
    }
    const parts = buffer.split(/\r\n|\r|\n/);
    const last = parts.pop() ?? '';
    for (const line of parts) {
      this.onLine(line);
    }
    this.pending = holdCr ? `${last}\r` : last;
  }
}

/** Keeps the last `limit` characters of a stream, for the log. */
class Tail {
  private text = '';

  constructor(private readonly limit: number) {}

  add(chunk: string): void {
    this.text = (this.text + chunk).slice(-this.limit);
  }

  value(): string {
    return this.text;
  }
}

async function runProcess(
  tool: ToolName | BuildToolName,
  executable: string,
  args: readonly string[],
  options: RunToolOptions,
): Promise<RunToolResult> {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new ToolError({ tool, exitCode: null, reason: 'was given an invalid argument' });
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ToolError({ tool, exitCode: null, reason: 'was given no time limit' });
  }
  if (options.signal?.aborted) {
    throw new ToolError({ tool, exitCode: null, aborted: true });
  }
  const cwdOk = await stat(options.cwd).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!cwdOk) {
    throw new ToolError({ tool, exitCode: null, reason: 'has no working folder' });
  }
  if (options.signal?.aborted) {
    throw new ToolError({ tool, exitCode: null, aborted: true });
  }

  return new Promise<RunToolResult>((resolve, reject) => {
    const startedAt = Date.now();
    const isWindows = process.platform === 'win32';
    const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const stdoutTail = new Tail(STREAM_TAIL_BYTES);
    const stderrTail = new Tail(STREAM_TAIL_BYTES);
    const stderrDecoder = new StringDecoder('utf8');
    const stdoutDecoder = new StringDecoder('utf8');

    let settled = false;
    let failure: Error | null = null;
    let killed = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let watchTimer: NodeJS.Timeout | null = null;
    let graceTimer: NodeJS.Timeout | null = null;
    let watchRunning = false;

    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: minimalEnv(process.env, options.env),
      shell: false,
      windowsHide: true,
      // Its own process group on POSIX, so a kill reaches the grandchildren too.
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (options.priority === 'low' && child.pid !== undefined) {
      lowerPriority(child.pid);
    }

    const toolErrorFor = (params: {
      exitCode: number | null;
      timedOut?: boolean;
      aborted?: boolean;
      reason?: string;
    }): ToolError =>
      new ToolError({
        tool,
        ...params,
        stderrTail: stderrTail.value(),
        stdoutTail: stdoutTail.value(),
      });

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (watchTimer) clearInterval(watchTimer);
      if (graceTimer) clearTimeout(graceTimer);
      timeoutTimer = null;
      watchTimer = null;
      graceTimer = null;
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (outcome: { ok: RunToolResult } | { error: Error }): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if ('ok' in outcome) {
        resolve(outcome.ok);
      } else {
        reject(outcome.error);
      }
    };

    const fail = (error: Error): void => {
      if (settled || failure) return;
      failure = error;
      killTree();
    };

    const killTree = (): void => {
      if (killed) return;
      killed = true;
      const pid = child.pid;
      if (pid !== undefined) {
        if (isWindows) {
          killWindowsTree(pid, () => child.kill('SIGKILL'));
        } else {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
      // If the exit never arrives (a kill that did not take), settle anyway.
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle({ error: failure ?? toolErrorFor({ exitCode: null, reason: 'did not stop' }) });
      }, KILL_GRACE_MS);
    };

    const callSafely = (callback: ((line: string) => void) | undefined, line: string): void => {
      if (!callback || failure) return;
      try {
        callback(line);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('A line handler failed'));
      }
    };

    const stdoutLines = new LineSplitter((line) => callSafely(options.onStdoutLine, line));
    const stderrLines = new LineSplitter((line) => callSafely(options.onStderrLine, line));

    child.stdout?.on('data', (chunk: Buffer) => {
      if (failure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdout) {
        fail(toolErrorFor({ exitCode: null, reason: 'printed more output than allowed' }));
        return;
      }
      stdoutChunks.push(chunk);
      stdoutTail.add(stdoutDecoder.write(chunk));
      stdoutLines.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail.add(stderrDecoder.write(chunk));
      stderrLines.push(chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (child.pid === undefined) {
        settle({
          error:
            error.code === 'ENOENT' || error.code === 'EACCES'
              ? new ToolMissingError(tool)
              : toolErrorFor({ exitCode: null, reason: 'could not be started' }),
        });
        return;
      }
      fail(toolErrorFor({ exitCode: null, reason: 'failed while running' }));
    });

    child.on('close', (code: number | null) => {
      if (!failure) {
        stdoutLines.end();
        stderrLines.end();
      }
      stderrTail.add(stderrDecoder.end());
      if (failure) {
        settle({ error: failure });
        return;
      }
      if (code === 0) {
        settle({
          ok: {
            exitCode: 0,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderrTail: stderrTail.value(),
            durationMs: Date.now() - startedAt,
          },
        });
        return;
      }
      settle({ error: toolErrorFor({ exitCode: code }) });
    });

    const onAbort = (): void => {
      fail(toolErrorFor({ exitCode: null, aborted: true }));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    timeoutTimer = setTimeout(() => {
      fail(toolErrorFor({ exitCode: null, timedOut: true }));
    }, options.timeoutMs);

    if (options.watch) {
      const { everyMs, check } = options.watch;
      watchTimer = setInterval(
        () => {
          if (watchRunning || failure || settled) return;
          watchRunning = true;
          Promise.resolve()
            .then(check)
            .then(
              () => {
                watchRunning = false;
              },
              (error: unknown) => {
                watchRunning = false;
                fail(error instanceof Error ? error : new Error('The watcher stopped the program'));
              },
            );
        },
        Math.max(50, everyMs),
      );
    }

    // Last, so an abort from inside the callback reaches the listener above.
    if (options.onStart && child.pid !== undefined) {
      try {
        options.onStart(child.pid);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('The start handler failed'));
      }
    }
  });
}

/**
 * Moves a started program below normal priority: `BELOW_NORMAL_PRIORITY_CLASS`
 * on Windows, nice 10 on Linux and macOS (`os.setPriority` maps the one
 * constant to both). What it starts inherits the priority. A refusal (a
 * locked-down host) leaves it at normal priority, which only costs speed.
 */
export function lowerPriority(pid: number): boolean {
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows has no process groups to signal: `taskkill /T /F` ends the process
 * and everything it started. It runs through `spawn` with an argument array
 * like every other program. If it cannot run, the direct child is killed.
 */
function killWindowsTree(pid: number, fallback: () => void): void {
  const systemRoot = readEnv(process.env, 'SYSTEMROOT');
  const taskkill = systemRoot ? path.join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
  try {
    const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: minimalEnv(process.env, undefined),
    });
    killer.on('error', fallback);
    killer.on('close', (code) => {
      if (code !== 0) fallback();
    });
  } catch {
    fallback();
  }
}
