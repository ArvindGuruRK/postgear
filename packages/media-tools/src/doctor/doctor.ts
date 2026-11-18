/**
 * The doctor: checks the outside programs Clips needs and says, in plain
 * words, what is missing.
 *
 * The worker runs it at boot (a missing FFmpeg stops a media or render
 * worker), `clipRuntimeCheckWorkflow` runs it for `GET /clips/status`, and
 * `npm run clips:doctor` prints it. It never throws for a missing program:
 * everything is reported as a line with `ok` and a reason.
 *
 * What it checks (module 02, research 09 and 04):
 * - FFmpeg and ffprobe versions; FFmpeg 9.0.2 is the build the render was
 *   verified on.
 * - That FFmpeg reads a graph from a file (`-/filter_complex <file>`), which
 *   the render depends on, by running a one-line graph into the null muxer.
 * - libass, libharfbuzz and libx264 in `-buildconf` (text, shaping, H.264).
 * - yt-dlp's version and age, its JavaScript runtime (for YouTube) and its
 *   browser impersonation extra (for Kick; a warning, not a stop).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { jsRuntimeArg } from '../run/paths';
import { ToolMissingError } from '../run/runner';
import { removeQuietly } from '../run/scratch';
import { type RunTool, ToolError, type ToolPaths } from '../run/types';

/** The oldest FFmpeg the render accepts. */
export const MIN_FFMPEG_VERSION = '9.0.0';
/** The build every recipe in research 09 was verified on; any other version is a warning. */
export const VERIFIED_FFMPEG_VERSION = '9.0.2';
/** The oldest yt-dlp accepted (research 04, section 11). */
export const MIN_YTDLP_VERSION = '2026.10.26';
/** yt-dlp warns itself at 90 days; we warn earlier. */
export const YTDLP_STALE_DAYS = 60;
/** The oldest Deno yt-dlp's YouTube solver supports. */
export const MIN_DENO_VERSION = '2.3.0';

const VERSION_TIMEOUT_MS = 20_000;
const SMOKE_TIMEOUT_MS = 30_000;

/** One checked item: a yes or no and, when no (or a warning), one plain sentence. */
export interface DoctorLine {
  ok: boolean;
  reason: string | null;
}

export interface ToolStatus {
  /** Usable for its job. */
  ok: boolean;
  /** The program started at all. */
  found: boolean;
  version: string | null;
  /** Why it is not ok, in plain words. */
  reason: string | null;
  /** Something to fix soon that does not stop work. */
  warning: string | null;
}

export interface FfmpegStatus extends ToolStatus {
  render: {
    filterComplexFile: DoctorLine;
    libass: DoctorLine;
    libharfbuzz: DoctorLine;
    libx264: DoctorLine;
  };
}

export interface YtDlpStatus extends ToolStatus {
  /** Browser impersonation (curl_cffi), which Kick needs. Never a stop: without it Kick is paused. */
  impersonation: DoctorLine;
}

export interface DoctorReport {
  ffmpeg: FfmpegStatus;
  ffprobe: ToolStatus;
  ytDlp: YtDlpStatus;
  jsRuntime: ToolStatus;
  /** FFmpeg and ffprobe usable and FFmpeg passing every render check: video work can run. */
  ok: boolean;
  /** Link import can run: yt-dlp is usable too. */
  linksOk: boolean;
  checkedAt: string;
}

export interface DoctorOptions {
  /** For the yt-dlp age warning; defaults to now. */
  now?: Date;
  /** Where the graph smoke test writes its file; defaults to the system temp folder. */
  tempDir?: string;
  signal?: AbortSignal;
}

/**
 * Checks every program and returns the report. Never throws for a missing
 * or broken program; only a programming error escapes.
 */
export async function runDoctor(
  runTool: RunTool,
  paths: ToolPaths,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const now = options.now ?? new Date();
  const cwd = options.tempDir ?? os.tmpdir();

  const [ffmpeg, ffprobe, ytDlpBase] = await Promise.all([
    checkFfmpeg(runTool, cwd, options.signal),
    checkFfprobe(runTool, cwd, options.signal),
    checkYtDlpVersion(runTool, cwd, now, options.signal),
  ]);

  const [impersonation, jsRuntime] = ytDlpBase.found
    ? await Promise.all([
        checkImpersonation(runTool, cwd, options.signal),
        checkJsRuntime(runTool, cwd, paths.jsRuntime, options.signal),
      ])
    : [{ ok: false, reason: 'Not checked: yt-dlp is not installed.' }, notChecked(paths.jsRuntime)];

  const ytDlp: YtDlpStatus = { ...ytDlpBase, impersonation };
  const ok = ffmpeg.ok && ffprobe.ok;
  return {
    ffmpeg,
    ffprobe,
    ytDlp,
    jsRuntime,
    ok,
    linksOk: ok && ytDlp.ok,
    checkedAt: now.toISOString(),
  };
}

// --- FFmpeg -------------------------------------------------------------------------

async function checkFfmpeg(
  runTool: RunTool,
  cwd: string,
  signal?: AbortSignal,
): Promise<FfmpegStatus> {
  const notRun: DoctorLine = { ok: false, reason: 'Not checked: FFmpeg did not start.' };
  const base = await versionOf(runTool, 'ffmpeg', ['-hide_banner', '-version'], cwd, signal);
  if (!base.found) {
    return {
      ...strip(base),
      render: { filterComplexFile: notRun, libass: notRun, libharfbuzz: notRun, libx264: notRun },
    };
  }

  const version = parseFfmpegVersion(base.stdout);
  const [buildconf, filterComplexFile] = await Promise.all([
    buildConfOf(runTool, cwd, signal),
    checkGraphFromFile(runTool, signal),
  ]);
  const flag = (name: string, missing: string): DoctorLine =>
    buildconf === null
      ? { ok: false, reason: 'Could not read how this FFmpeg was built.' }
      : buildconf.includes(`--enable-${name}`)
        ? { ok: true, reason: null }
        : { ok: false, reason: missing };

  const render = {
    filterComplexFile,
    libass: flag('libass', 'This FFmpeg cannot draw text: it has no libass.'),
    libharfbuzz: flag(
      'libharfbuzz',
      'This FFmpeg cannot join letters in Hindi or Tamil: it has no libharfbuzz.',
    ),
    libx264: flag('libx264', 'This FFmpeg cannot write H.264 video: it has no libx264.'),
  };

  const versionOk = version !== null && compareVersions(version, MIN_FFMPEG_VERSION) >= 0;
  const renderOk = Object.values(render).every((line) => line.ok);
  let reason: string | null = null;
  if (version !== null && !versionOk) {
    reason = `FFmpeg ${version} is too old. Install FFmpeg ${VERIFIED_FFMPEG_VERSION}.`;
  } else if (!renderOk) {
    reason = 'This FFmpeg is missing something the export needs (see the lines below).';
  }
  const warning =
    version === null
      ? `Could not read the FFmpeg version. Exports were checked on FFmpeg ${VERIFIED_FFMPEG_VERSION}.`
      : version !== VERIFIED_FFMPEG_VERSION && versionOk
        ? `Exports were checked on FFmpeg ${VERIFIED_FFMPEG_VERSION}; this is ${version}. Run the parity tests.`
        : null;

  return {
    ok: renderOk && (version === null || versionOk),
    found: true,
    version,
    reason,
    warning,
    render,
  };
}

async function buildConfOf(
  runTool: RunTool,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await runTool('ffmpeg', ['-hide_banner', '-buildconf'], {
      cwd,
      timeoutMs: VERSION_TIMEOUT_MS,
      signal,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

/** The graph the smoke test reads from a file: a tiny blank picture, no input file at all. */
export const SMOKE_GRAPH = 'nullsrc=s=64x36:r=10:d=0.5,format=yuv420p[v]';

/** The arguments of the smoke test, run with the temp folder as the working directory. */
export function buildSmokeArgs(graphFile: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-/filter_complex',
    graphFile,
    '-map',
    '[v]',
    '-frames:v',
    '5',
    '-f',
    'null',
    '-',
  ];
}

async function checkGraphFromFile(runTool: RunTool, signal?: AbortSignal): Promise<DoctorLine> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'postgear-doctor-'));
    await writeFile(path.join(dir, 'graph.txt'), SMOKE_GRAPH, 'utf8');
    await runTool('ffmpeg', buildSmokeArgs('graph.txt'), {
      cwd: dir,
      timeoutMs: SMOKE_TIMEOUT_MS,
      signal,
    });
    return { ok: true, reason: null };
  } catch {
    return {
      ok: false,
      reason:
        'This FFmpeg cannot read a filter graph from a file (-/filter_complex). Install FFmpeg 9.0.2.',
    };
  } finally {
    if (dir) await removeQuietly(dir);
  }
}

/** "ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright ..." is "9.0.2". */
export function parseFfmpegVersion(output: string): string | null {
  const match = /(?:ffmpeg|ffprobe) version n?(\d+\.\d+(?:\.\d+)?)/i.exec(output);
  return match ? normaliseVersion(match[1]) : null;
}

// --- ffprobe ------------------------------------------------------------------------

async function checkFfprobe(
  runTool: RunTool,
  cwd: string,
  signal?: AbortSignal,
): Promise<ToolStatus> {
  const base = await versionOf(runTool, 'ffprobe', ['-hide_banner', '-version'], cwd, signal);
  if (!base.found) return strip(base);
  const version = parseFfmpegVersion(base.stdout);
  const tooOld = version !== null && compareVersions(version, MIN_FFMPEG_VERSION) < 0;
  return {
    ok: !tooOld,
    found: true,
    version,
    reason: tooOld
      ? `ffprobe ${version} is too old. Install it with FFmpeg ${VERIFIED_FFMPEG_VERSION}.`
      : null,
    warning: version === null ? 'Could not read the ffprobe version.' : null,
  };
}

// --- yt-dlp -------------------------------------------------------------------------

async function checkYtDlpVersion(
  runTool: RunTool,
  cwd: string,
  now: Date,
  signal?: AbortSignal,
): Promise<ToolStatus> {
  const base = await versionOf(runTool, 'yt-dlp', ['--ignore-config', '--version'], cwd, signal, {
    missing: 'yt-dlp is not installed, so links cannot be imported. Uploads still work.',
  });
  if (!base.found) return strip(base);
  const version = parseYtDlpVersion(base.stdout);
  if (version === null) {
    return {
      ok: true,
      found: true,
      version: null,
      reason: null,
      warning: 'Could not read the yt-dlp version.',
    };
  }
  if (compareVersions(version, MIN_YTDLP_VERSION) < 0) {
    return {
      ok: false,
      found: true,
      version,
      reason: `yt-dlp ${version} is too old. Update it to ${MIN_YTDLP_VERSION} or newer.`,
      warning: null,
    };
  }
  const age = ageInDays(version, now);
  return {
    ok: true,
    found: true,
    version,
    reason: null,
    warning:
      age !== null && age > YTDLP_STALE_DAYS
        ? `yt-dlp ${version} is ${age} days old. Update it soon: platforms change often.`
        : null,
  };
}

/** "2026.10.26" or "2026.10.26.233115" (nightly) is kept as printed. */
export function parseYtDlpVersion(output: string): string | null {
  const match = /(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(output);
  return match ? match[1] : null;
}

function ageInDays(version: string, now: Date): number | null {
  const [y, m, d] = version.split('.').map(Number);
  if (!y || !m || !d) return null;
  const released = Date.UTC(y, m - 1, d);
  return Math.max(0, Math.floor((now.getTime() - released) / 86_400_000));
}

async function checkImpersonation(
  runTool: RunTool,
  cwd: string,
  signal?: AbortSignal,
): Promise<DoctorLine> {
  try {
    const result = await runTool('yt-dlp', ['--ignore-config', '--list-impersonate-targets'], {
      cwd,
      timeoutMs: VERSION_TIMEOUT_MS,
      signal,
    });
    return impersonationFrom(`${result.stdout}\n${result.stderrTail}`);
  } catch {
    return {
      ok: false,
      reason: 'Could not ask yt-dlp about browser impersonation. Kick links are paused.',
    };
  }
}

/**
 * Reads `--list-impersonate-targets`: a target row naming `curl_cffi`
 * without "unavailable" means impersonation works.
 */
export function impersonationFrom(output: string): DoctorLine {
  const usable = output
    .split(/\r?\n/)
    .some((line) => /curl_cffi/i.test(line) && !/unavailable/i.test(line));
  return usable
    ? { ok: true, reason: null }
    : {
        ok: false,
        reason:
          'yt-dlp has no browser impersonation (curl_cffi), so Kick links are paused. Use the standalone yt-dlp build.',
      };
}

/**
 * The runner may start only FFmpeg, ffprobe and yt-dlp, so the JavaScript
 * runtime is checked through yt-dlp: its verbose header names the runtimes it
 * found ("[debug] JS runtimes: deno-2.3.1").
 */
async function checkJsRuntime(
  runTool: RunTool,
  cwd: string,
  jsRuntime: string | null,
  signal?: AbortSignal,
): Promise<ToolStatus> {
  if (jsRuntime === null) {
    return {
      ok: false,
      found: false,
      version: null,
      reason: 'No JavaScript runtime is set (YTDLP_JS_RUNTIME), so YouTube links may fail.',
      warning: null,
    };
  }
  let output = '';
  try {
    const result = await runTool(
      'yt-dlp',
      ['--ignore-config', '--verbose', '--js-runtimes', jsRuntimeArg(jsRuntime)],
      { cwd, timeoutMs: VERSION_TIMEOUT_MS, signal },
    );
    output = `${result.stdout}\n${result.stderrTail}`;
  } catch (error) {
    // With no link yt-dlp prints its header, then exits with a usage error: read the header anyway.
    output = error instanceof ToolError ? error.stderrTail : '';
  }
  return jsRuntimeFrom(output);
}

/** Reads "[debug] JS runtimes: deno-2.3.1" (or "none") from yt-dlp's verbose header. */
export function jsRuntimeFrom(output: string): ToolStatus {
  const line = /JS runtimes:\s*([^\r\n]*)/i.exec(output);
  if (!line) {
    return {
      ok: false,
      found: false,
      version: null,
      reason:
        'Could not tell whether yt-dlp found its JavaScript runtime, so YouTube links may fail.',
      warning: null,
    };
  }
  const deno = /deno-(\d+\.\d+(?:\.\d+)?)/i.exec(line[1]);
  const other = /(node|bun|quickjs)-(\d+\.\d+(?:\.\d+)?)/i.exec(line[1]);
  if (deno) {
    const version = normaliseVersion(deno[1]);
    const tooOld = compareVersions(version, MIN_DENO_VERSION) < 0;
    return {
      ok: !tooOld,
      found: true,
      version: `deno ${version}`,
      reason: tooOld
        ? `Deno ${version} is too old for YouTube. Install Deno ${MIN_DENO_VERSION} or newer.`
        : null,
      warning: null,
    };
  }
  if (other) {
    return {
      ok: true,
      found: true,
      version: `${other[1]} ${other[2]}`,
      reason: null,
      warning: null,
    };
  }
  return {
    ok: false,
    found: false,
    version: null,
    reason: 'yt-dlp found no JavaScript runtime (Deno), so YouTube links may fail.',
    warning: null,
  };
}

function notChecked(jsRuntime: string | null): ToolStatus {
  return {
    ok: false,
    found: false,
    version: null,
    reason:
      jsRuntime === null
        ? 'No JavaScript runtime is set (YTDLP_JS_RUNTIME).'
        : 'Not checked: yt-dlp is not installed.',
    warning: null,
  };
}

// --- Shared ---------------------------------------------------------------------------

interface VersionProbe extends ToolStatus {
  stdout: string;
}

async function versionOf(
  runTool: RunTool,
  tool: 'ffmpeg' | 'ffprobe' | 'yt-dlp',
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  words: { missing?: string } = {},
): Promise<VersionProbe> {
  const label = tool === 'ffmpeg' ? 'FFmpeg' : tool;
  try {
    const result = await runTool(tool, args, { cwd, timeoutMs: VERSION_TIMEOUT_MS, signal });
    return {
      ok: true,
      found: true,
      version: null,
      reason: null,
      warning: null,
      stdout: result.stdout,
    };
  } catch (error) {
    const missing = error instanceof ToolMissingError;
    return {
      ok: false,
      found: false,
      version: null,
      reason: missing
        ? (words.missing ?? `${label} is not installed or not on PATH. Video work cannot run.`)
        : `${label} did not start properly.`,
      warning: null,
      stdout: '',
    };
  }
}

function strip(probe: VersionProbe): ToolStatus {
  const { stdout: _stdout, ...status } = probe;
  return status;
}

/** "9.0" is "9.0.0". */
function normaliseVersion(version: string): string {
  const parts = version.split('.');
  while (parts.length < 3) parts.push('0');
  return parts.join('.');
}

/** Compares dotted numeric versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
