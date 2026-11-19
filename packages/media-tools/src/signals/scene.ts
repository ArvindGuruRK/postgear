/**
 * The scene producer (Module 16 section 3; research 06 section 4).
 *
 * FFmpeg's `scdet` over the light copy, decoding keyframes only
 * (`-skip_frame nokey`: research 06 measured that decoding is the cost, and
 * this, not a lower frame rate, is what makes it fast) and scaled to 320
 * wide first. The light copy has a keyframe every 2 seconds (Module 04), so
 * each score says how much the picture changed over that stretch; a score
 * is held until the next keyframe on the two-a-second grid.
 *
 * Capped at a tenth of the video's length (at least 2 minutes): past it the
 * track is dropped and the scorer runs on the sound alone, so a slow host
 * still finds clips. A cancel is never swallowed.
 */
import { readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { binTrack, type SignalTrack } from '@postgear/video-engine';
import { INPUT_PROTOCOL_ALLOWLIST } from '../ffmpeg/probe';
import { FFMPEG_HEAD, FfmpegError, runFfmpeg } from '../ffmpeg/run';
import type { ProduceInput } from './loudness';
import { parseMetadataPrint } from './metadata';

export const SCENE_PRINT_FILE = 'signals-scene.txt';
const KEY = 'lavfi.scd.score';
/** The shortest time the scene pass is ever given. */
export const SCENE_MIN_BUDGET_MS = 2 * 60_000;

/** The FFmpeg arguments: keyframes of the light copy, small, scored, printed, nothing written. */
export function sceneArgs(videoFile: string): string[] {
  return [
    ...FFMPEG_HEAD,
    '-protocol_whitelist',
    INPUT_PROTOCOL_ALLOWLIST,
    '-skip_frame',
    'nokey',
    '-i',
    videoFile,
    '-an',
    '-vf',
    `scale=320:-2,scdet=threshold=10,metadata=mode=print:file=${SCENE_PRINT_FILE}`,
    '-fps_mode',
    'passthrough',
    '-f',
    'null',
    '-',
  ];
}

/** The scene pass's time limit: a tenth of the video, at least two minutes. */
export function sceneBudgetMs(durationMs: number): number {
  return Math.max(SCENE_MIN_BUDGET_MS, Math.ceil(durationMs / 10));
}

/** The scene track from the printed metadata (held between keyframes). */
export function sceneTrackFrom(text: string, durationMs: number): SignalTrack {
  return binTrack('scene', parseMetadataPrint(text, KEY), durationMs, {
    combine: 'max',
    empty: 'hold',
  });
}

/**
 * Scores the picture changes of `videoFile` (inside `cwd`). Null when the
 * pass ran past its budget (logged). Throws `FfmpegError` when FFmpeg fails
 * or is cancelled.
 */
export async function produceScene(
  input: ProduceInput & { videoFile: string; budgetMs?: number },
): Promise<SignalTrack | null> {
  const print = path.join(input.cwd, SCENE_PRINT_FILE);
  await rm(print, { force: true });
  try {
    await runFfmpeg({
      runTool: input.runTool,
      cwd: input.cwd,
      signal: input.signal,
      onProgress: input.onProgress,
      timeoutMs: input.budgetMs ?? sceneBudgetMs(input.durationMs),
      args: sceneArgs(input.videoFile),
      durationMs: input.durationMs,
    });
  } catch (error) {
    if (error instanceof FfmpegError && error.timedOut && !input.signal?.aborted) {
      console.warn(
        JSON.stringify({ event: 'clips.signals.scene_over_budget', durationMs: input.durationMs }),
      );
      await rm(print, { force: true });
      return null;
    }
    throw error;
  }
  const text = await readFile(print, 'utf8').catch(() => '');
  await rm(print, { force: true });
  return sceneTrackFrom(text, input.durationMs);
}
