/**
 * The loudness measure (Module 14): the Node half of `loudness.ts` in the
 * video engine. Two runs, each a few seconds of decoding sound only:
 *
 * - `measureLoudness`: the measuring pass `compileMeasure(plan)` built (the
 *   sound graph alone, to `-f null -`), before the main render;
 * - `measureFileLoudness`: the finished file, after it, so the job records
 *   the final loudness from an independent read.
 *
 * Both run at the `info` log level, where `loudnorm` prints its JSON block
 * when it closes, and read it from the last stderr lines. A run that prints
 * no block (the clip measured nothing) answers null.
 */
import * as path from 'node:path';
import {
  type CompiledFfmpeg,
  fileLoudnessArgs,
  ffmpegArgsFor,
  type LoudnessMeasure,
  parseLoudnormJson,
} from '@postgear/video-engine';
import type { RunTool } from '../run/types';
import { assertInputsPresent, RenderError, toRenderError, writeRenderFiles } from './execute';

/** Stderr lines kept for the JSON block (it is about 15 lines, printed last). */
const KEPT_LINES = 200;

export interface MeasureLoudnessInput {
  runTool: RunTool;
  /** The job's scratch folder (absolute), holding every input the measure names. */
  scratchDir: string;
  /** `compileMeasure(plan)`. */
  compiled: CompiledFfmpeg;
  signal?: AbortSignal;
  /** Default: 5 minutes plus twice the clip's length. */
  timeoutMs?: number;
  /** `'low'` for a preview (see `RunToolOptions.priority`). */
  priority?: 'normal' | 'low';
}

/** Keeps the last lines of a stream. */
function lastLines(): { push: (line: string) => void; text: () => string } {
  const lines: string[] = [];
  return {
    push(line) {
      lines.push(line);
      if (lines.length > KEPT_LINES) lines.shift();
    },
    text: () => lines.join('\n'),
  };
}

/** Runs the measuring pass and reads `loudnorm`'s numbers. Throws `RenderError` when FFmpeg fails. */
export async function measureLoudness(input: MeasureLoudnessInput): Promise<LoudnessMeasure | null> {
  const scratchDir = path.resolve(input.scratchDir);
  if (input.signal?.aborted) throw new RenderError('cancelled');
  try {
    await writeRenderFiles(scratchDir, input.compiled);
    await assertInputsPresent(scratchDir, input.compiled);
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('tool_failed', { cause: error });
  }
  const kept = lastLines();
  try {
    await input.runTool('ffmpeg', ffmpegArgsFor(input.compiled, '-'), {
      cwd: scratchDir,
      timeoutMs: input.timeoutMs ?? 5 * 60_000 + input.compiled.durationMs * 2,
      signal: input.signal,
      maxStdoutBytes: 16 * 1024 * 1024,
      ...(input.priority === 'low' ? { priority: 'low' as const } : {}),
      onStderrLine: kept.push,
    });
  } catch (error) {
    throw toRenderError(error, input.signal);
  }
  return parseLoudnormJson(kept.text());
}

export interface MeasureFileInput {
  runTool: RunTool;
  scratchDir: string;
  /** The finished file, a plain name inside the scratch folder. */
  file: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** `'low'` for a preview (see `RunToolOptions.priority`). */
  priority?: 'normal' | 'low';
}

/** Measures a finished file's sound. Throws `RenderError` when FFmpeg fails. */
export async function measureFileLoudness(input: MeasureFileInput): Promise<LoudnessMeasure | null> {
  const scratchDir = path.resolve(input.scratchDir);
  const resolved = path.resolve(scratchDir, input.file);
  const relative = path.relative(scratchDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RenderError('tool_failed');
  }
  const kept = lastLines();
  try {
    await input.runTool('ffmpeg', fileLoudnessArgs(relative.split(path.sep).join('/')), {
      cwd: scratchDir,
      timeoutMs: input.timeoutMs ?? 5 * 60_000,
      signal: input.signal,
      ...(input.priority === 'low' ? { priority: 'low' as const } : {}),
      onStderrLine: kept.push,
    });
  } catch (error) {
    throw toRenderError(error, input.signal);
  }
  return parseLoudnormJson(kept.text());
}
