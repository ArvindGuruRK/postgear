/**
 * The ruler above the timeline: which ticks to draw and what they say.
 *
 * The step between labels comes from one fixed ladder, never from maths on
 * the fly: a few frames when zoomed right in, then half a second, 1 s, 2 s,
 * 5 s, 10 s, 30 s, 1 min, 5 min, 10 min, 30 min and 1 h. The first step
 * whose labels sit at least `minGapPx` apart (64 px) wins, so labels never
 * touch on a 20 second clip or a 6 hour video. Past an hour the step grows
 * in whole hours, so even a very long video at a tiny zoom keeps the gap.
 *
 * Only the visible range is returned, plus one step of margin each side so
 * a label half off screen is still drawn while scrolling.
 *
 * Every labelled tick is `major`. Between them, unlabelled `minor` ticks
 * mark the next smaller step of the ladder that divides the label step
 * evenly and still sits `MINOR_MIN_GAP_PX` apart; the ruler draws them
 * shorter. When no smaller step fits, there are no minor ticks.
 *
 * Labels: "0:30", "1:00", "1:00:00" on whole seconds; "0:01.5" on half
 * seconds; and on frame steps, the frame within its second ("12f"), with the
 * clock on the frame that starts a second. Tick times on frame steps are the
 * exact frame starts (`frame x 1000 / fps`, not rounded), so the spacing is
 * exactly even.
 */

/** Labels are at least this far apart, in pixels. */
export const RULER_MIN_GAP_PX = 64;

/** Unlabelled ticks are at least this far apart, in pixels. */
export const MINOR_MIN_GAP_PX = 8;

/** The ladder's frame steps, in frames (kept only when they divide the frame rate). */
export const RULER_FRAME_STEPS = [1, 2, 5, 10] as const;

/** The ladder's time steps, in ms: half a second, then 1 s up to 1 h. */
export const RULER_STEPS_MS = [
  500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 300_000, 600_000, 1_800_000, 3_600_000,
] as const;

const HOUR_MS = 3_600_000;
const FALLBACK_FPS = 30;

/** No ruler ever needs more ticks than this (a guard against a nonsense range). */
const MAX_TICKS = 5_000;

/** One step of the ladder. `frames` is set on the frame steps. */
export interface RulerStep {
  ms: number;
  frames?: number;
}

export interface RulerTick {
  ms: number;
  /** Empty on minor ticks. */
  label: string;
  major: boolean;
}

export interface RulerTicks {
  /** The step between labelled ticks, in ms. */
  stepMs: number;
  /** The step between minor ticks, or null when there are none. */
  minorStepMs: number | null;
  /** In time order. */
  ticks: RulerTick[];
}

export interface RulerOptions {
  fps: number;
  minGapPx?: number;
}

function safeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
}

/** The whole ladder for a frame rate, smallest step first. */
export function rulerSteps(fps: number): RulerStep[] {
  const rate = safeFps(fps);
  const steps: RulerStep[] = [];
  if (Number.isInteger(rate)) {
    for (const frames of RULER_FRAME_STEPS) {
      if (frames < rate && rate % frames === 0) {
        const ms = (frames * 1000) / rate;
        if (ms < RULER_STEPS_MS[0]) {
          steps.push({ ms, frames });
        }
      }
    }
  }
  for (const ms of RULER_STEPS_MS) {
    steps.push({ ms });
  }
  return steps;
}

/**
 * The labelled step for a scale: the first of the ladder at least
 * `minGapPx` wide, or whole hours past the ladder's top.
 */
export function rulerStep(pxPerMs: number, options: RulerOptions): RulerStep {
  const minGap =
    Number.isFinite(options.minGapPx) && (options.minGapPx as number) > 0
      ? (options.minGapPx as number)
      : RULER_MIN_GAP_PX;
  const scale = Number.isFinite(pxPerMs) && pxPerMs > 0 ? pxPerMs : 0;
  if (scale === 0) {
    // No scale to measure a gap against: the ladder's top.
    return { ms: HOUR_MS };
  }
  for (const step of rulerSteps(options.fps)) {
    if (step.ms * scale >= minGap - 1e-9) {
      return step;
    }
  }
  const hours = Math.ceil(minGap / (HOUR_MS * scale));
  return { ms: HOUR_MS * Math.max(1, Number.isFinite(hours) ? hours : MAX_TICKS) };
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** "0:42", "12:05", "1:02:05" from whole seconds. */
function clock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

/** The label of the `index`th tick of a step. */
function labelFor(index: number, step: RulerStep, fps: number): string {
  if (step.frames !== undefined) {
    const frame = index * step.frames;
    const inSecond = frame % fps;
    return inSecond === 0 ? clock(frame / fps) : `${inSecond}f`;
  }
  // Steps at or above the ladder's first are whole ms, so this is exact.
  const ms = Math.round(index * step.ms);
  const seconds = Math.floor(ms / 1000);
  const rest = ms % 1000;
  return rest === 0 ? clock(seconds) : `${clock(seconds)}.${Math.floor(rest / 100)}`;
}

/** The step's position in time for tick `index` (exact frame starts on frame steps). */
function tickMs(index: number, step: RulerStep, fps: number): number {
  return step.frames !== undefined ? (index * step.frames * 1000) / fps : index * step.ms;
}

/** The largest smaller step of the ladder that divides `step` and keeps `MINOR_MIN_GAP_PX`. */
function minorStepFor(step: RulerStep, pxPerMs: number, fps: number): RulerStep | null {
  const ladder = rulerSteps(fps).filter((s) => s.ms < step.ms - 1e-9);
  for (let i = ladder.length - 1; i >= 0; i -= 1) {
    const candidate = ladder[i] as RulerStep;
    const ratio = step.ms / candidate.ms;
    const whole = Math.abs(ratio - Math.round(ratio)) < 1e-6;
    if (whole && candidate.ms * pxPerMs >= MINOR_MIN_GAP_PX - 1e-9) {
      return candidate;
    }
  }
  // Past the ladder's top (whole hours), the hour itself.
  if (step.ms > HOUR_MS && step.ms % HOUR_MS === 0 && HOUR_MS * pxPerMs >= MINOR_MIN_GAP_PX) {
    return { ms: HOUR_MS };
  }
  return null;
}

/**
 * The ticks to draw between `fromMs` and `toMs` (the visible range) at
 * `pxPerMs`, with one step of margin each side and none before 0.
 */
export function rulerTicks(
  fromMs: number,
  toMs: number,
  pxPerMs: number,
  options: RulerOptions,
): RulerTicks {
  const fps = safeFps(options.fps);
  const step = rulerStep(pxPerMs, { ...options, fps });
  const scale = Number.isFinite(pxPerMs) && pxPerMs > 0 ? pxPerMs : 0;
  const from = Number.isFinite(fromMs) ? Math.max(0, fromMs) : 0;
  const to = Number.isFinite(toMs) ? Math.max(from, toMs) : from;

  const ticks: RulerTick[] = [];
  const first = Math.max(0, Math.floor(from / step.ms) - 1);
  const last = Math.min(first + MAX_TICKS, Math.ceil(to / step.ms) + 1);
  const minor = scale > 0 ? minorStepFor(step, scale, fps) : null;
  const perMajor = minor ? Math.round(step.ms / minor.ms) : 1;

  for (let index = first; index <= last; index += 1) {
    ticks.push({ ms: tickMs(index, step, fps), label: labelFor(index, step, fps), major: true });
    if (minor && index < last) {
      for (let k = 1; k < perMajor && ticks.length < MAX_TICKS; k += 1) {
        ticks.push({ ms: tickMs(index * perMajor + k, minor, fps), label: '', major: false });
      }
    }
    if (ticks.length >= MAX_TICKS) {
      break;
    }
  }

  return { stepMs: step.ms, minorStepMs: minor ? minor.ms : null, ticks };
}
