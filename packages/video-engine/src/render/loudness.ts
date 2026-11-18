/**
 * The loudness pass (Module 14, cookbook section 8): `amix` sums the layers
 * and never evens out the result, so an export is measured, then corrected
 * to about -14 LUFS with a true peak at or below -1.5 dB.
 *
 * 1. **Measure** (`compileMeasure` in `compile.ts`): the sound graph alone,
 *    ending in `loudnorm=...:print_format=json`, to `-f null -`. FFmpeg
 *    prints the JSON block at the `info` log level, never at `error`.
 * 2. **Decide** (`decideLoudness`): no sound, or silence, skips both
 *    passes; a mix already within 1 LU of the target with its peak at or
 *    under the ceiling skips the correction.
 * 3. **Correct**: the main render with `loudnormApplyFilter(measured)`
 *    appended to the mix, `linear=true`. FFmpeg keeps that linear (one
 *    constant gain, so fades and balance are untouched) only when the
 *    measured range fits; otherwise it falls back to its dynamic mode on its
 *    own. `loudnessModeFor` is FFmpeg's own rule (`af_loudnorm.c`), so the
 *    job records which one ran.
 * 4. **Check**: the finished file is measured again (`fileLoudnessArgs`), so
 *    the job's output holds the final loudness from an independent read.
 *
 * Pure: strings and numbers.
 */

/** The export's target: integrated loudness, true peak ceiling and loudness range. */
export const LOUDNESS_TARGET = Object.freeze({ i: -14, tp: -1.5, lra: 11 });
/** A mix within this many LU of the target, with its peak under the ceiling, is left as it is. */
export const LOUDNESS_SKIP_LU = 1;
/** Quieter than this is silence: nothing is raised (it would only raise noise). */
export const LOUDNESS_SILENCE_LUFS = -70;

/** What the measuring pass printed (`loudnorm`'s JSON block). */
export interface LoudnessMeasure {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

export type LoudnessMode = 'linear' | 'dynamic' | 'skipped';

/** What the render does with the measure. */
export type LoudnessDecision =
  | { apply: false; mode: 'skipped'; measured: LoudnessMeasure | null }
  | { apply: true; mode: 'linear' | 'dynamic'; measured: LoudnessMeasure };

/** What the job's output records (Module 15's result line reads it). */
export interface LoudnessResult {
  inputLufs: number | null;
  inputTp: number | null;
  finalLufs: number | null;
  mode: LoudnessMode;
}

const BASE = `I=${LOUDNESS_TARGET.i}:TP=${LOUDNESS_TARGET.tp}:LRA=${LOUDNESS_TARGET.lra}`;

/** The measuring filter: it passes the sound through and prints the JSON block at the end. */
export function loudnormMeasureFilter(): string {
  return `loudnorm=${BASE}:print_format=json`;
}

/** Two decimals, `-0` written as `0`. */
function fixed(value: number): string {
  const text = value.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
}

/** The correcting filter, with the measured values (each inside the range `loudnorm` accepts). */
export function loudnormApplyFilter(measured: LoudnessMeasure): string {
  const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return (
    `loudnorm=${BASE}` +
    `:measured_I=${fixed(clampTo(measured.inputI, -99, 0))}` +
    `:measured_TP=${fixed(clampTo(measured.inputTp, -99, 99))}` +
    `:measured_LRA=${fixed(clampTo(measured.inputLra, 0, 99))}` +
    `:measured_thresh=${fixed(clampTo(measured.inputThresh, -99, 0))}` +
    `:offset=${fixed(clampTo(measured.targetOffset, -99, 99))}` +
    ':linear=true'
  );
}

/**
 * Which mode FFmpeg's `loudnorm` runs in for these measured values: linear
 * when the gain to the target keeps the peak under the ceiling and the
 * range fits, else dynamic (the rule in `af_loudnorm.c`).
 */
export function loudnessModeFor(measured: LoudnessMeasure): 'linear' | 'dynamic' {
  const offset = LOUDNESS_TARGET.i - measured.inputI;
  const peakAfter = measured.inputTp + offset;
  return peakAfter <= LOUDNESS_TARGET.tp && measured.inputLra <= LOUDNESS_TARGET.lra
    ? 'linear'
    : 'dynamic';
}

/** The skip rules, then the mode. A null measure (no sound) skips both passes. */
export function decideLoudness(measured: LoudnessMeasure | null): LoudnessDecision {
  if (!measured || !Number.isFinite(measured.inputI) || measured.inputI <= LOUDNESS_SILENCE_LUFS) {
    return { apply: false, mode: 'skipped', measured };
  }
  const close = Math.abs(measured.inputI - LOUDNESS_TARGET.i) <= LOUDNESS_SKIP_LU;
  if (close && measured.inputTp <= LOUDNESS_TARGET.tp) {
    return { apply: false, mode: 'skipped', measured };
  }
  return { apply: true, mode: loudnessModeFor(measured), measured };
}

/** A JSON number FFmpeg wrote as a string (`"-27.61"`, `"-inf"`, `"inf"`). */
function jsonNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim().toLowerCase();
  if (text === '-inf') return Number.NEGATIVE_INFINITY;
  if (text === 'inf' || text === '+inf') return Number.POSITIVE_INFINITY;
  return Number(text);
}

/**
 * The last `loudnorm` JSON block in FFmpeg's log, or null when there is none
 * (the run failed, or it measured nothing). Lines may carry FFmpeg's
 * `[Parsed_loudnorm_3 @ 0x...]` prefix only on the line before the block.
 */
export function parseLoudnormJson(log: string): LoudnessMeasure | null {
  const end = log.lastIndexOf('}');
  if (end < 0) return null;
  const start = log.lastIndexOf('{', end);
  if (start < 0) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(log.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!('input_i' in data)) return null;
  const measured: LoudnessMeasure = {
    inputI: jsonNumber(data.input_i),
    inputTp: jsonNumber(data.input_tp),
    inputLra: jsonNumber(data.input_lra),
    inputThresh: jsonNumber(data.input_thresh),
    targetOffset: jsonNumber(data.target_offset),
  };
  if (Number.isNaN(measured.inputI) || Number.isNaN(measured.inputTp)) return null;
  return {
    ...measured,
    inputLra: Number.isFinite(measured.inputLra) ? measured.inputLra : 0,
    inputThresh: Number.isFinite(measured.inputThresh) ? measured.inputThresh : -70,
    targetOffset: Number.isFinite(measured.targetOffset) ? measured.targetOffset : 0,
  };
}

/**
 * Measuring a finished file's sound: its first sound stream through the
 * measuring filter to nowhere, at the `info` log level. Run in the job's
 * scratch folder with a plain relative name.
 */
export function fileLoudnessArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    '-nostats',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    loudnormMeasureFilter(),
    '-f',
    'null',
    '-',
  ];
}

/** Rounds a measured value to a tenth for the job's output (null for silence or nothing). */
export function loudnessValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/** The job's record of a render's loudness. */
export function loudnessResult(
  decision: LoudnessDecision | null,
  finalMeasure: LoudnessMeasure | null,
): LoudnessResult {
  return {
    inputLufs: loudnessValue(decision?.measured?.inputI),
    inputTp: loudnessValue(decision?.measured?.inputTp),
    finalLufs: loudnessValue(finalMeasure?.inputI ?? (decision && !decision.apply ? decision.measured?.inputI : null)),
    mode: decision?.mode ?? 'skipped',
  };
}
