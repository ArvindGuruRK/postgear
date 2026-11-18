/**
 * Reads FFmpeg's `-progress pipe:1` output.
 *
 * FFmpeg prints blocks of `key=value` lines ending in `progress=continue`
 * (or `progress=end`). Only `frame`, `out_time_us`, `speed` and `progress`
 * are read: `out_time_ms` holds microseconds too, despite its name. The
 * time is not monotonic while picture and sound interleave (a run went 96,
 * 90, 93, 100 percent), so the parser keeps the largest value seen and the
 * percent never goes backwards (research 09, section 11).
 */

/** One finished block, turned into numbers. */
export interface FfmpegProgress {
  /** The furthest output time reached, in milliseconds (a running maximum). */
  outTimeMs: number;
  /** 0 to 100 of the known length, never lower than the block before. */
  percent: number;
  /** Encoding speed as a multiple of real time (`1.28x` is 1.28), or null when FFmpeg did not say. */
  speed: number | null;
  /** Frames written, or null. */
  frame: number | null;
  /** Seconds left at the current speed, or null when there is no speed yet. */
  etaSeconds: number | null;
  /** True on the last block (`progress=end`). */
  done: boolean;
}

/** The FFmpeg arguments that turn progress reporting on and the noisy stats line off. */
export const PROGRESS_ARGS: readonly string[] = ['-progress', 'pipe:1', '-nostats'];

/**
 * A line-by-line parser for one FFmpeg run. Feed it every stdout line; it
 * calls `onProgress` once per finished block. `durationMs` is the length of
 * what FFmpeg is writing (the clip, or the video being prepared).
 */
export class FfmpegProgressParser {
  private maxOutTimeUs = 0;
  private lastPercent = 0;
  private frame: number | null = null;
  private speed: number | null = null;
  private sawEnd = false;

  constructor(
    private readonly durationMs: number,
    private readonly onProgress?: (progress: FfmpegProgress) => void,
  ) {}

  /** True once a `progress=end` block arrived: FFmpeg finished writing. */
  get ended(): boolean {
    return this.sawEnd;
  }

  /** The latest state, for a caller that polls instead of listening. */
  snapshot(): FfmpegProgress {
    return this.build(this.sawEnd);
  }

  /** Reads one line. Returns the block's progress when the line ended a block, else null. */
  push(rawLine: string): FfmpegProgress | null {
    const line = rawLine.trim();
    const eq = line.indexOf('=');
    if (eq <= 0) {
      return null;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    switch (key) {
      case 'out_time_us': {
        const us = parseWhole(value);
        if (us !== null && us > this.maxOutTimeUs) {
          this.maxOutTimeUs = us;
        }
        return null;
      }
      case 'frame': {
        const frame = parseWhole(value);
        if (frame !== null) this.frame = frame;
        return null;
      }
      case 'speed': {
        this.speed = parseSpeed(value);
        return null;
      }
      case 'progress': {
        const done = value === 'end';
        if (done) this.sawEnd = true;
        const progress = this.build(done);
        this.lastPercent = progress.percent;
        this.onProgress?.(progress);
        return progress;
      }
      default:
        return null;
    }
  }

  private build(done: boolean): FfmpegProgress {
    const outTimeMs = Math.floor(this.maxOutTimeUs / 1000);
    let percent = this.durationMs > 0 ? (outTimeMs / this.durationMs) * 100 : 0;
    if (done) percent = 100;
    percent = Math.max(this.lastPercent, clamp(percent, 0, 100));
    const leftMs = Math.max(0, this.durationMs - outTimeMs);
    const etaSeconds = done
      ? 0
      : this.speed !== null && this.speed > 0
        ? Math.ceil(leftMs / 1000 / this.speed)
        : null;
    return {
      outTimeMs,
      percent: Math.round(percent * 10) / 10,
      speed: this.speed,
      frame: this.frame,
      etaSeconds,
      done,
    };
  }
}

/** Maps a 0 to 100 percent into a stage's share of the whole job (`10..90` for the render step). */
export function mapPercent(percent: number, from: number, to: number): number {
  return Math.round((from + (clamp(percent, 0, 100) / 100) * (to - from)) * 10) / 10;
}

function parseWhole(value: string): number | null {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** `1.28x` is 1.28; `N/A` and anything odd is null. */
function parseSpeed(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)x$/i.exec(value);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
