/**
 * Where the outside programs live, read once from the environment.
 *
 * Each value is either an absolute path or a bare program name found on
 * PATH. A relative path with folders in it is refused: the runner starts
 * every program inside a job's scratch folder, so `./bin/ffmpeg` would point
 * somewhere different for every job.
 */
import * as path from 'node:path';
import type { ToolPaths } from './types';

/** The environment variables `toolPaths` reads. */
export const TOOL_PATH_ENV = {
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
  ytDlp: 'YTDLP_PATH',
  jsRuntime: 'YTDLP_JS_RUNTIME',
} as const;

/** The names used when a variable is not set. */
export const DEFAULT_TOOL_NAMES = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  ytDlp: 'yt-dlp',
  jsRuntime: 'deno',
} as const;

/** Values of `YTDLP_JS_RUNTIME` that switch the JavaScript runtime off. */
const RUNTIME_OFF = new Set(['none', 'off', 'false', '0']);

/** The runtimes yt-dlp's `--js-runtimes` understands, for the `name:path` form. */
const RUNTIME_NAMES = ['deno', 'node', 'bun', 'quickjs'] as const;

/** A setting in the environment cannot be used. The message names the variable, never its value. */
export class ToolPathError extends Error {
  constructor(variable: string) {
    super(`${variable} must be an absolute path or a program name on PATH.`);
    this.name = 'ToolPathError';
  }
}

/**
 * Reads `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` and `YTDLP_JS_RUNTIME`.
 * Unset or blank values fall back to the program names on PATH (`deno` for
 * the runtime); `YTDLP_JS_RUNTIME=none` turns the runtime off (null).
 */
export function toolPaths(env: Record<string, string | undefined>): ToolPaths {
  const runtimeRaw = env[TOOL_PATH_ENV.jsRuntime]?.trim() ?? '';
  return {
    ffmpeg: readProgram(env, TOOL_PATH_ENV.ffmpeg, DEFAULT_TOOL_NAMES.ffmpeg, false),
    ffprobe: readProgram(env, TOOL_PATH_ENV.ffprobe, DEFAULT_TOOL_NAMES.ffprobe, false),
    ytDlp: readProgram(env, TOOL_PATH_ENV.ytDlp, DEFAULT_TOOL_NAMES.ytDlp, false),
    jsRuntime: RUNTIME_OFF.has(runtimeRaw.toLowerCase())
      ? null
      : readProgram(env, TOOL_PATH_ENV.jsRuntime, DEFAULT_TOOL_NAMES.jsRuntime, true),
  };
}

/**
 * The value yt-dlp's `--js-runtimes` takes: `deno:<path>` for a bare path or
 * name, or the `name:path` form as written when it already names a runtime.
 */
export function jsRuntimeArg(jsRuntime: string): string {
  for (const name of RUNTIME_NAMES) {
    if (jsRuntime === name || jsRuntime.startsWith(`${name}:`)) {
      return jsRuntime === name ? `${name}:${name}` : jsRuntime;
    }
  }
  return `deno:${jsRuntime}`;
}

function readProgram(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: string,
  isRuntime: boolean,
): string {
  const value = env[variable]?.trim() ?? '';
  if (value.length === 0) {
    return fallback;
  }
  if (/[\0\r\n]/.test(value)) {
    throw new ToolPathError(variable);
  }
  const named = isRuntime ? withoutRuntimePrefix(value) : value;
  const hasFolder = named.includes('/') || named.includes('\\');
  if (hasFolder && !path.isAbsolute(named)) {
    throw new ToolPathError(variable);
  }
  return value;
}

/** `node:/usr/bin/node` is checked as `/usr/bin/node`. */
function withoutRuntimePrefix(value: string): string {
  for (const name of RUNTIME_NAMES) {
    if (value.startsWith(`${name}:`)) {
      return value.slice(name.length + 1);
    }
  }
  return value;
}
