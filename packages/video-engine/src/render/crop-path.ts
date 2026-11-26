/**
 * A crop that moves (Sprint 13, Module 08, Follow The Speaker): its keys in
 * the plan, and the `sendcmd` command file the compiler writes for it
 * (Sprint 12 cookbook section 3, verified on FFmpeg 9.0.2).
 *
 * The recipe, per segment and per moving area:
 *
 *   trim=start=S:end=E,sendcmd=f=crop-s<n>-a<k>.txt,
 *   crop@s<n>a<k>=w=W:h=H:x=X0:y=Y0:exact=1,...,setpts=...
 *
 * - One line per interval between two keys, `x` (and `y`) as ONE linear
 *   expression of `t`: `x0+slope*(t-t0)`. Never a flat chain or a nested
 *   `if` of all the keys in the graph: FFmpeg's expression parser refuses
 *   those at about 95 terms (Sprint 13 research 09 section 9).
 * - The last line is a constant at the last key: an expression set by
 *   `sendcmd` keeps running after its interval ends.
 * - `t` is the frame's time in the run input's own clock (after `-ss`), the
 *   clock `trim=start=` reads: the crop sits after `trim` and before
 *   `setpts`, so a speed change needs no conversion, and below 1x each
 *   source frame keeps the crop of its own time (as `frameState` reads it).
 * - The commands name the crop's own instance (`crop@s<n>a<k>`): `sendcmd`
 *   hands a command to the first filter that answers to its target, so a
 *   bare `crop` would move the wrong area, or another segment's.
 * - FFmpeg rounds `x` and `y` to the nearest whole pixel (`lrint`), the
 *   same rounding the plan uses for a still crop, so fractional positions
 *   go into the file as they are.
 *
 * Only the position moves: a crop whose size changes is refused by the plan
 * (`crop_keyframes_unsupported`). Strings in, strings out.
 */
import type { CropKeyframe, LayoutArea } from '../document/schema';
import { cropAt, placeArea } from './frame-state';
import { formatNumber } from './filter-text';
import type { PixelRect } from './plan';
import { msToSeconds } from './types';

/** One key of a moving crop: a moment of the run input's clock and the crop's corner there. */
export interface PlanCropKey {
  /** Whole ms of the run input's own time (the clock `trim=start=` uses). */
  ms: number;
  /** The crop's top left corner in source pixels; fractional (FFmpeg rounds to the nearest pixel). */
  x: number;
  y: number;
}

/** How one area's crop moves during one segment. */
export interface PlanCropPath {
  /** The command file's plain name in the scratch folder: `crop-s<segment>-a<area>.txt`. */
  file: string;
  /** The `crop` filter's instance name the commands address: `crop@s<segment>a<area>`. */
  target: string;
  /** At least two keys, strictly later one after another, not all at one position. */
  keys: PlanCropKey[];
}

/** A command file the graph names, written beside `graph.txt` by the executor. */
export interface CompiledCommandFile {
  name: string;
  content: string;
}

/** The command file's name for a segment's area. */
export function cropCommandFileName(segmentIndex: number, areaIndex: number): string {
  return `crop-s${segmentIndex}-a${areaIndex}.txt`;
}

/** The instance name of a segment's area's moving `crop` filter. */
export function cropTargetName(segmentIndex: number, areaIndex: number): string {
  return `crop@s${segmentIndex}a${areaIndex}`;
}

/** Whether every key holds the same crop size (only the position moves). */
export function cropSizeIsConstant(keyframes: readonly CropKeyframe[]): boolean {
  const first = keyframes[0];
  return (
    first === undefined ||
    keyframes.every((k) => k.rect.w === first.rect.w && k.rect.h === first.rect.h)
  );
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface CropPathInput {
  /** The document's area (its frame, fit and crop keys in source ms). */
  area: Pick<LayoutArea, 'frame' | 'fit' | 'crop'>;
  /** The area's place in the layout (names the file). */
  areaIndex: number;
  /** The segment's place in the clip (names the file). */
  segmentIndex: number;
  /** The segment's stretch of the video, in source ms (`sourceOut` exclusive). */
  sourceIn: number;
  sourceOut: number;
  /** Source ms minus run input ms: the file's `sourceOffsetMs` plus the run's seek. */
  clockOffsetMs: number;
  /** The source picture's size in pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** The canvas's width over its height. */
  canvasAspect: number;
  /** The crop size the plan worked out (even, inside the picture); constant for the whole path. */
  size: Pick<PixelRect, 'w' | 'h'>;
}

/**
 * The path of one area's crop during one segment, or null when it does not
 * move there (before the first key, after the last, or every key in the
 * segment at one place): then the plan's plain constant crop is drawn.
 *
 * The keys are the segment's start (when a key lies at or before it), every
 * key strictly inside the segment, and its end (when a key lies at or after
 * it), each read with `cropAt` and narrowed to the frame's shape with
 * `placeArea` exactly as `frameState` does, so the value at each segment
 * edge is the document's crop at that moment. Before the first key the
 * crop's own `x`, `y` (the first key's place) holds without a command.
 */
export function planCropPath(input: CropPathInput): PlanCropPath | null {
  const keys = input.area.crop;
  if (keys.length < 2) return null;
  const { sourceIn, sourceOut } = input;
  const sourceAspect =
    input.sourceWidth > 0 && input.sourceHeight > 0 ? input.sourceWidth / input.sourceHeight : null;
  const maxX = Math.max(0, input.sourceWidth - input.size.w);
  const maxY = Math.max(0, input.sourceHeight - input.size.h);
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

  const at = (sourceMs: number): PlanCropKey => {
    const { visibleCrop } = placeArea(
      input.area,
      cropAt(keys, sourceMs),
      sourceAspect,
      input.canvasAspect,
    );
    return {
      ms: sourceMs - input.clockOffsetMs,
      x: roundTo3(clamp(visibleCrop.x * input.sourceWidth, maxX)),
      y: roundTo3(clamp(visibleCrop.y * input.sourceHeight, maxY)),
    };
  };

  const moments: number[] = [];
  if ((keys[0] as CropKeyframe).at <= sourceIn) moments.push(sourceIn);
  for (const key of keys) {
    if (key.at > sourceIn && key.at < sourceOut) moments.push(key.at);
  }
  if ((keys[keys.length - 1] as CropKeyframe).at >= sourceOut) moments.push(sourceOut);

  // Strictly later one after another (whole ms of source time already are; kept as a guard).
  const path: PlanCropKey[] = [];
  for (const moment of moments) {
    const key = at(moment);
    const last = path[path.length - 1];
    if (last && key.ms <= last.ms) continue;
    path.push(key);
  }
  if (path.length < 2) return null;
  const first = path[0] as PlanCropKey;
  if (path.every((k) => k.x === first.x && k.y === first.y)) return null;

  return {
    file: cropCommandFileName(input.segmentIndex, input.areaIndex),
    target: cropTargetName(input.segmentIndex, input.areaIndex),
    keys: path,
  };
}

/** `v0+slope*(t-t0)` from one key to the next (a constant when the value holds). */
function linear(v0: number, v1: number, t0: number, t1: number): string {
  if (v0 === v1) return formatNumber(v0);
  const slope = ((v1 - v0) * 1000) / (t1 - t0);
  const sign = slope < 0 ? '-' : '+';
  return `${formatNumber(v0)}${sign}${formatNumber(Math.abs(slope))}*(t-${msToSeconds(t0)})`;
}

/**
 * A gap of at most this long between two keys is a jump cut, not a pan: no
 * source frame is ever drawn part of the way across it.
 */
export const JUMP_MAX_MS = 1;

/**
 * The `sendcmd` command file for a path: one line per interval with a
 * linear expression for `x` and `y` (a coordinate that never moves in the
 * whole path is left to the filter's own value), and a constant last line
 * at the last key.
 *
 * A jump (two keys at most `JUMP_MAX_MS` apart) gets no line of its own:
 * the line after it starts a microsecond after the earlier key. A frame at
 * that key still shows the old place (the expression before keeps running
 * and ends there), and any later frame the new one, as `frameState` reads
 * it (`cropAt` at the frame's time rounded up to a whole ms). A frame
 * inside a 1 ms ramp would otherwise be drawn part of the way across.
 */
export function cropCommandText(path: PlanCropPath): string {
  const first = path.keys[0];
  if (!first || path.keys.length < 2) {
    throw new Error(`A moving crop needs at least two keys (${path.target})`);
  }
  const movesX = path.keys.some((k) => k.x !== first.x);
  const movesY = path.keys.some((k) => k.y !== first.y);
  const command = (x: string, y: string): string =>
    [movesX ? `${path.target} x '${x}'` : null, movesY ? `${path.target} y '${y}'` : null]
      .filter((part): part is string => part !== null)
      .join(', ');

  const lines: string[] = [];
  // Where the next line starts when a jump came just before it (a microsecond after the jump's first key).
  let start: string | null = null;
  for (let i = 0; i + 1 < path.keys.length; i += 1) {
    const a = path.keys[i] as PlanCropKey;
    const b = path.keys[i + 1] as PlanCropKey;
    if (!(b.ms > a.ms)) continue;
    if (b.ms - a.ms <= JUMP_MAX_MS) {
      start ??= `${msToSeconds(a.ms)}001`;
      continue;
    }
    const span = `${start ?? msToSeconds(a.ms)}-${msToSeconds(b.ms)}`;
    start = null;
    lines.push(`${span} ${command(linear(a.x, b.x, a.ms, b.ms), linear(a.y, b.y, a.ms, b.ms))};`);
  }
  const last = path.keys[path.keys.length - 1] as PlanCropKey;
  lines.push(
    `${start ?? msToSeconds(last.ms)} ${command(formatNumber(last.x), formatNumber(last.y))};`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The filters of a moving crop: `sendcmd` reading its file, then the named
 * `crop` at its first position (the segment's start), exact to the pixel.
 */
export function movingCropFilter(rect: PixelRect, path: PlanCropPath): string {
  return (
    `sendcmd=f=${path.file},` +
    `${path.target}=w=${rect.w}:h=${rect.h}:x=${rect.x}:y=${rect.y}:exact=1`
  );
}
