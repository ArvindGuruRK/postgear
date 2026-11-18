/**
 * The check every finished export passes before it is stored (Module 15
 * section 6): the file is what the plan asked for, and it plays everywhere
 * the export promises (one file that fits every platform).
 *
 * - The picture's length is within one frame of the plan.
 * - Its size and frame rate are the quality's.
 * - H.264 High, `yuv420p`: what phones, browsers and every platform take.
 *   A proof (Preview Export) is `ultrafast`, which x264 writes as Constrained
 *   Baseline; it only ever plays in our own preview, so any H.264 profile passes.
 * - A key frame about every two seconds (the closed GOP the encode asks
 *   for), so seeking and the platforms' own cutting work.
 * - `moov` before `mdat` (`+faststart`), so it starts playing before it has
 *   all arrived.
 *
 * Pure: `media-tools` reads the facts with `ffprobe` and a look at the top
 * boxes; this only judges them, so the rules are tested without a file.
 */
import type { RenderPlan } from './plan';

/** What `ffprobe` and the box reader found in a finished file. */
export interface RenderedFileFacts {
  /** The picture stream's length (the container's when the stream has none). */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** The average frame rate. */
  fps: number | null;
  /** `codec_name`, e.g. `h264`. */
  codec: string | null;
  /** `profile`, e.g. `High`. */
  profile: string | null;
  /** `pix_fmt`, e.g. `yuv420p`. */
  pixFmt: string | null;
  /** The picture's key frames, in ms from the start, in order. */
  keyframesMs: readonly number[];
  /** Whether `moov` comes before `mdat` at the top level; null when neither was found. */
  moovFirst: boolean | null;
  bytes: number;
}

/** What the plan asked for. */
export interface ExpectedOutput {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** Seconds between key frames. */
  gopSeconds: number;
  /** A proof: any H.264 profile passes (see above). */
  proof?: boolean;
}

export type OutputProblem =
  | 'empty'
  | 'duration'
  | 'size'
  | 'fps'
  | 'codec'
  | 'profile'
  | 'pix_fmt'
  | 'keyframes'
  | 'moov';

export function expectedOutputOf(plan: Pick<RenderPlan, 'output' | 'encode'>): ExpectedOutput {
  return {
    durationMs: plan.output.durationMs,
    width: plan.output.width,
    height: plan.output.height,
    fps: plan.output.fps,
    gopSeconds: plan.encode.gopSeconds,
    proof: plan.encode.id === 'proof',
  };
}

/** How far an average frame rate may sit from the asked one (30000/1001 is not 30). */
const FPS_SLACK = 0.05;

/** The H.264 profiles a proof may carry. */
const PROOF_PROFILES: ReadonlySet<string> = new Set([
  'High',
  'Main',
  'Baseline',
  'Constrained Baseline',
]);

/**
 * Every way the file differs from what was asked, empty when it is right.
 * The order is fixed so a log line reads the same each time.
 */
export function verifyOutput(facts: RenderedFileFacts, expected: ExpectedOutput): OutputProblem[] {
  const problems: OutputProblem[] = [];
  if (!(facts.bytes > 0)) return ['empty'];
  const frameMs = 1000 / expected.fps;

  if (facts.durationMs === null || Math.abs(facts.durationMs - expected.durationMs) > frameMs + 1) {
    problems.push('duration');
  }
  if (facts.width !== expected.width || facts.height !== expected.height) problems.push('size');
  if (facts.fps === null || Math.abs(facts.fps - expected.fps) > FPS_SLACK) problems.push('fps');
  if (facts.codec !== 'h264') problems.push('codec');
  const profileOk = expected.proof
    ? facts.profile !== null && PROOF_PROFILES.has(facts.profile)
    : facts.profile === 'High';
  if (!profileOk) problems.push('profile');
  if (facts.pixFmt !== 'yuv420p') problems.push('pix_fmt');
  if (!keyframesEvery(facts.keyframesMs, expected.gopSeconds * 1000, frameMs)) {
    problems.push('keyframes');
  }
  if (facts.moovFirst !== true) problems.push('moov');
  return problems;
}

/**
 * Whether the key frames start the file and come at most `gopMs` apart (a
 * frame of slack for rounding): a closed GOP never lets one run long.
 */
function keyframesEvery(keyframesMs: readonly number[], gopMs: number, frameMs: number): boolean {
  if (keyframesMs.length === 0) return false;
  const first = keyframesMs[0] ?? Number.POSITIVE_INFINITY;
  if (first > frameMs + 1) return false;
  for (let index = 1; index < keyframesMs.length; index += 1) {
    const gap = (keyframesMs[index] ?? 0) - (keyframesMs[index - 1] ?? 0);
    if (gap > gopMs + frameMs + 1) return false;
  }
  return true;
}
