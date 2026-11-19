/**
 * The render executor: runs one compiled plan through FFmpeg (Module 05).
 *
 * The compiler (`@postgear/video-engine`) is pure and hands over strings;
 * this is the Node half. It writes the graph and the ASS files into the
 * job's scratch folder, runs FFmpeg there with the graph passed by file,
 * and writes to `<name>.part` so a killed run never leaves a file that looks
 * finished (a killed MP4 has no index and no player can open it). The part
 * file is renamed only after `progress=end` and exit code 0.
 */
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type CompiledFfmpeg,
  GRAPH_FILE,
  ffmpegArgsFor,
  isSafeRelativeName,
} from '@postgear/video-engine';
import { FfmpegProgressParser } from '../ffmpeg/progress';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';

export type RenderErrorCode = 'tool_failed' | 'cancelled' | 'font_missing';

/**
 * A render did not produce a file. `code` maps to a sentence in
 * `CLIP_ERROR_MESSAGES`; FFmpeg's text stays in `stderrTail`, for the log.
 */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly timedOut: boolean;
  readonly stderrTail: string;

  constructor(
    code: RenderErrorCode,
    options: { timedOut?: boolean; stderrTail?: string; cause?: unknown } = {},
  ) {
    super(`render failed: ${code}`);
    this.name = 'RenderError';
    this.code = code;
    this.timedOut = options.timedOut ?? false;
    this.stderrTail = options.stderrTail ?? '';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** What the render reports while it runs. */
export interface RenderProgress {
  /** 0 to 100 of the clip, never going backwards. */
  percent: number;
  /** Seconds left at the current speed, or null before FFmpeg reports a speed. */
  etaSeconds: number | null;
  /** Multiple of real time, or null. */
  speed: number | null;
}

export interface RenderClipInput {
  runTool: RunTool;
  /** The job's scratch folder (absolute). Inputs named by the plan must already be in it. */
  scratchDir: string;
  compiled: CompiledFfmpeg;
  /** The finished file's name inside the scratch folder (`render.mp4`), or an absolute path inside it. */
  outFile: string;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  /** Default: 15 minutes plus ten times the clip's length. */
  timeoutMs?: number;
  /** `'low'` for a preview, so it never slows an export (see `RunToolOptions.priority`). */
  priority?: 'normal' | 'low';
}

export interface RenderClipResult {
  /** Absolute path of the finished file. */
  file: string;
  bytes: number;
  /** Wall time of the FFmpeg run. */
  elapsedMs: number;
  /** For the log only. */
  stderrTail: string;
}

/** Output extensions the executor knows the FFmpeg muxer for (the `.part` name hides it from FFmpeg). */
const MUXERS: Record<string, string> = {
  '.mp4': 'mp4',
  '.m4a': 'ipod',
  '.mov': 'mov',
  '.webm': 'webm',
  '.mkv': 'matroska',
};

/** libass says this when a font file cannot be opened or a family has no usable face. */
const FONT_TROUBLE =
  /error opening (memory )?font|no usable fontconfig|font(select)?:? .*not found|failed to (open|load) font/i;

/**
 * libass's choice for each font request, at `-loglevel info`:
 * `fontselect: (PGF f04607 800, 800, 0) -> PGF-f04607-800, 0, PGF-f04607-800`.
 * The name after the arrow is the PostScript name of the face it chose.
 */
const FONT_SELECTED = /fontselect: \(.*\) -> ([^,\s]+),/;
/** libass found no font with a glyph at all. */
const FONT_NO_FALLBACK = /fontselect: failed to find any fallback/i;

/**
 * The font libass chose when it is not one of `expected` (a silent fallback),
 * or null when the line is fine or is not a font choice. Exported for tests.
 */
export function unexpectedFont(line: string, expected: ReadonlySet<string>): string | null {
  if (FONT_NO_FALLBACK.test(line)) {
    return 'none';
  }
  const match = FONT_SELECTED.exec(line);
  if (!match) {
    return null;
  }
  const chosen = match[1] as string;
  return expected.has(chosen) ? null : chosen;
}

/**
 * Runs one render. Writes `graph.txt` and the ASS files, runs FFmpeg with
 * the scratch folder as its working directory, reports progress against
 * `compiled.durationMs`, and renames `<name>.part` to the final name only
 * when FFmpeg finished cleanly. On failure or cancel the partial output is
 * removed and a `RenderError` is thrown.
 */
export async function renderClip(input: RenderClipInput): Promise<RenderClipResult> {
  const scratchDir = path.resolve(input.scratchDir);
  const finalPath = insideScratch(scratchDir, input.outFile);
  const finalName = path.relative(scratchDir, finalPath).split(path.sep).join('/');
  const partName = `${finalName}.part`;
  const partPath = `${finalPath}.part`;
  const muxer = MUXERS[path.extname(finalPath).toLowerCase()];
  if (!muxer) {
    throw new RenderError('tool_failed');
  }

  if (input.signal?.aborted) {
    throw new RenderError('cancelled');
  }

  try {
    await writeRenderFiles(scratchDir, input.compiled);
    await assertInputsPresent(scratchDir, input.compiled);
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('tool_failed', { cause: error });
  }

  const parser = new FfmpegProgressParser(input.compiled.durationMs, (progress) => {
    input.onProgress?.({
      percent: progress.percent,
      etaSeconds: progress.etaSeconds,
      speed: progress.speed,
    });
  });

  const hasFormat = input.compiled.outputArgs.includes('-f');
  const compiled: CompiledFfmpeg = hasFormat
    ? input.compiled
    : { ...input.compiled, outputArgs: [...input.compiled.outputArgs, '-f', muxer] };
  const args = ffmpegArgsFor(compiled, partName);

  // A text render is watched for fonts libass chose on its own: the run stops at the first one.
  const fonts = input.compiled.fonts;
  const expected = new Set(fonts?.psNames ?? []);
  const stopper = new AbortController();
  let fellBack: string | null = null;
  const onAbort = () => stopper.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  // A stop that came while the files were written fired before the listener
  // was there, and a signal fires only once: pass it on now, or FFmpeg would
  // run the whole render for a job that was cancelled.
  if (input.signal?.aborted) stopper.abort();

  await rm(partPath, { force: true });
  try {
    const result = await input.runTool('ffmpeg', args, {
      cwd: scratchDir,
      timeoutMs: input.timeoutMs ?? 15 * 60_000 + input.compiled.durationMs * 10,
      signal: stopper.signal,
      maxStdoutBytes: 64 * 1024 * 1024,
      ...(input.priority === 'low' ? { priority: 'low' as const } : {}),
      onStdoutLine: (line) => {
        parser.push(line);
      },
      onStderrLine: fonts
        ? (line) => {
            if (fellBack !== null) return;
            const chosen = unexpectedFont(line, expected);
            if (chosen !== null) {
              fellBack = chosen;
              stopper.abort();
            }
          }
        : undefined,
    });
    if (fellBack !== null) {
      throw new RenderError('font_missing', { stderrTail: result.stderrTail });
    }
    if (!parser.ended) {
      throw new RenderError('tool_failed', { stderrTail: result.stderrTail });
    }
    const info = await stat(partPath).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new RenderError('tool_failed', { stderrTail: result.stderrTail });
    }
    await rm(finalPath, { force: true });
    await rename(partPath, finalPath);
    return {
      file: finalPath,
      bytes: info.size,
      elapsedMs: result.durationMs,
      stderrTail: result.stderrTail,
    };
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    if (fellBack !== null) {
      throw new RenderError('font_missing', {
        stderrTail: error instanceof ToolError ? error.stderrTail : '',
        cause: error,
      });
    }
    throw toRenderError(error, input.signal);
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
  }
}

/** Resolves the output inside the scratch folder; anything outside is refused. */
function insideScratch(scratchDir: string, outFile: string): string {
  const resolved = path.resolve(scratchDir, outFile);
  const relative = path.relative(scratchDir, resolved);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RenderError('tool_failed');
  }
  return resolved;
}

/** A plain file name: no folders, nothing hidden, nothing that reads as an option. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Writes `graph.txt` and the ASS files into the scratch folder (also used by the loudness measure). */
export async function writeRenderFiles(scratchDir: string, compiled: CompiledFfmpeg): Promise<void> {
  await writeFile(path.join(scratchDir, GRAPH_FILE), compiled.filterComplexScript, 'utf8');
  for (const ass of compiled.assFiles) {
    if (!PLAIN_NAME.test(ass.name) || ass.name === GRAPH_FILE) {
      throw new RenderError('tool_failed');
    }
    await writeFile(path.join(scratchDir, ass.name), ass.content, 'utf8');
  }
}

/**
 * Every input the plan names must be a file inside the scratch folder, or
 * the render would guess. The name itself must be the plan's kind of name
 * (`isSafeRelativeName`: letters, digits, `.`, `_`, `-`, folders by `/`), so
 * no absolute path, protocol or dash-led name ever reaches `-i`, even if the
 * plan's own check were bypassed (security sweep, Module 20).
 */
export async function assertInputsPresent(scratchDir: string, compiled: CompiledFfmpeg): Promise<void> {
  for (const input of compiled.inputs) {
    if (!isSafeRelativeName(input.file)) {
      throw new RenderError('tool_failed');
    }
    const resolved = path.resolve(scratchDir, input.file);
    const relative = path.relative(scratchDir, resolved);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new RenderError('tool_failed');
    }
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) {
      throw new RenderError('tool_failed');
    }
  }
  // Every twin the text uses must be in the fonts folder, or libass would quietly pick another face.
  const fonts = compiled.fonts;
  if (fonts) {
    if (!PLAIN_NAME.test(fonts.dir)) {
      throw new RenderError('tool_failed');
    }
    for (const file of fonts.files) {
      const info = PLAIN_NAME.test(file)
        ? await stat(path.join(scratchDir, fonts.dir, file)).catch(() => null)
        : null;
      if (!info?.isFile()) {
        throw new RenderError('font_missing');
      }
    }
  }
}

export function toRenderError(error: unknown, signal?: AbortSignal): RenderError {
  if (error instanceof RenderError) {
    return error;
  }
  if (error instanceof ToolError) {
    if (error.aborted) {
      return new RenderError('cancelled', { stderrTail: error.stderrTail, cause: error });
    }
    const code: RenderErrorCode = FONT_TROUBLE.test(error.stderrTail)
      ? 'font_missing'
      : 'tool_failed';
    return new RenderError(code, {
      timedOut: error.timedOut,
      stderrTail: error.stderrTail,
      cause: error,
    });
  }
  return new RenderError(signal?.aborted ? 'cancelled' : 'tool_failed', { cause: error });
}
