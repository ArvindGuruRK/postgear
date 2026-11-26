/**
 * The camera path (Sprint 13, Module 08): crop keyframes that keep the
 * subject of each stretch in one area's frame.
 *
 * - One crop size for the whole clip (the export moves only `x` and `y`):
 *   the subjects' typical face (the median of their smoothed face heights)
 *   is `FOLLOW_FACE_SHARE` of the crop's height, the crop has the area's
 *   shape, never zooms in past `FOLLOW_MIN_CROP_SCALE`, and fits the picture
 *   (a big face may take the picture's full height).
 * - The target is centred `FOLLOW_HEAD_ROOM` face heights above the face's
 *   centre, held inside the picture.
 * - Dead zone: the crop holds while the target stays in the middle
 *   `FOLLOW_DEAD_ZONE` of the crop; a move out of it is believed after
 *   `FOLLOW_CONFIRM_PICTURES` pictures in a row, and the crop then trails
 *   the target at the zone's edge for as long as it keeps moving.
 * - The held steps are smoothed forwards and backwards (no lag, since the
 *   whole clip is known), then the speed is capped at `FOLLOW_MAX_SPEED`.
 * - Cuts, never slides, at a change of subject and at every scene cut in the
 *   range: two keyframes `FOLLOW_CUT_MS` apart, the old crop then the new.
 *   A pan is a plain straight segment between two keyframes.
 * - The subject unseen for more than `FOLLOW_HOLD_GAP_MS`, or a stretch
 *   with no subject: the crop holds, and cuts to them when they are back.
 *   Such stretches longer than `FOLLOW_LOST_REPORT_MS` come back as `lost`
 *   (the hand fixes do not change them; the editor marks a fixed one).
 * - Hand fixes (`layout.follow.overrides`) replace the path in their range,
 *   with a cut at each end. Their box keeps its centre and takes the path's
 *   size.
 * - Keyframes a straight line already explains are dropped (within
 *   `FOLLOW_REDUCE_TOLERANCE`, raised until the path fits
 *   `MAX_CROP_KEYFRAMES`), so a minute has tens of keyframes, not hundreds.
 *
 * Times are ms of the video (source time, whole numbers), rects fractions
 * of the picture. Pure.
 */
import { MAX_CROP_KEYFRAMES } from '../document/limits';
import type { CropKeyframe, FollowOverride } from '../document/schema';
import { FULL_RECT, fitRect, type Rect } from '../geometry';
import { FACE_FILE_SAMPLE_FPS } from './face-file';
import { type Person, type PersonBox, smoothBoxes } from './people';
import { type SubjectSpan, soleSubject } from './speaker';
import {
  FOLLOW_CONFIRM_PICTURES,
  FOLLOW_CUT_MS,
  FOLLOW_DEAD_ZONE,
  FOLLOW_FACE_SHARE,
  FOLLOW_HEAD_ROOM,
  FOLLOW_HOLD_GAP_MS,
  FOLLOW_LOST_REPORT_MS,
  FOLLOW_MAX_SPEED,
  FOLLOW_MIN_CROP_SCALE,
  FOLLOW_REDUCE_GROWTH,
  FOLLOW_REDUCE_TOLERANCE,
  FOLLOW_SMOOTH_MS,
} from './tuning';

/** The area a path is made for. */
export interface FollowArea {
  /** The area frame's real width over height on the canvas. */
  aspect: number;
  /** The video's picture size; only its shape is read. */
  video: { width: number; height: number };
}

export interface FollowPathResult {
  keyframes: CropKeyframe[];
  /** Stretches longer than `FOLLOW_LOST_REPORT_MS` with nobody to follow, ms of the video. */
  lost: { from: number; to: number }[];
}

interface Pos {
  x: number;
  y: number;
}

interface Point extends Pos {
  t: number;
  /** This point starts a new crop: the point before it (`FOLLOW_CUT_MS` earlier) holds the old one. */
  cut?: boolean;
}

interface Size {
  w: number;
  h: number;
}

interface Range {
  from: number;
  to: number;
}

const PICTURE_MS = 1000 / FACE_FILE_SAMPLE_FPS;
/** Positions this close are the same crop. */
const SAME = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function videoAspect(video: FollowArea['video']): number {
  const aspect = video.width / video.height;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function samePos(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) <= SAME && Math.abs(a.y - b.y) <= SAME;
}

function boxesIn(person: Person, from: number, to: number): PersonBox[] {
  return person.boxes.filter((b) => b.t >= from && b.t < to);
}

/** The one crop size of the area: the typical subject face a third of its height, the area's shape. */
function cropSize(
  smoothed: ReadonlyMap<string, Person>,
  spans: readonly SubjectSpan[],
  area: FollowArea,
): Size {
  const va = videoAspect(area.video);
  const largest = fitRect(area.aspect > 0 ? area.aspect : 9 / 16, FULL_RECT, va);
  const heights: number[] = [];
  for (const span of spans) {
    const person = span.personId ? smoothed.get(span.personId) : undefined;
    if (person) heights.push(...boxesIn(person, span.from, span.to).map((b) => b.rect.h));
  }
  const face = median(heights);
  if (face === null) return { w: largest.w, h: largest.h };
  const scale = clamp(face / FOLLOW_FACE_SHARE / largest.h, FOLLOW_MIN_CROP_SCALE, 1);
  return { w: largest.w * scale, h: largest.h * scale };
}

function centred(size: Size): Pos {
  return { x: (1 - size.w) / 2, y: (1 - size.h) / 2 };
}

/** The crop's place for a face: centred a little above it, inside the picture. */
function targetFor(face: Rect, size: Size): Pos {
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2 - FOLLOW_HEAD_ROOM * face.h;
  return {
    x: clamp(cx - size.w / 2, 0, 1 - size.w),
    y: clamp(cy - size.h / 2, 0, 1 - size.h),
  };
}

/**
 * The dead zone: the crop holds while the target stays within `half` of it.
 * A target out of it for `FOLLOW_CONFIRM_PICTURES` pictures in a row starts
 * a move, and while it keeps going the crop trails it at the zone's edge
 * (a walk is followed in one smooth pan, not in steps).
 */
function deadZoneAxis(values: readonly number[], half: number): number[] {
  let cam = values[0] as number;
  let streak = 0;
  let moving = false;
  return values.map((target) => {
    const offset = target - cam;
    const outside = Math.abs(offset) > half;
    if (moving) {
      if (Math.abs(offset) >= half * 0.999) {
        cam = target - Math.sign(offset) * half;
      } else {
        moving = false;
      }
    } else {
      streak = outside ? streak + 1 : 0;
      if (streak >= FOLLOW_CONFIRM_PICTURES) {
        moving = true;
        streak = 0;
        cam = target - Math.sign(offset) * half;
      }
    }
    return cam;
  });
}

/** The dead zone across and down: the middle `FOLLOW_DEAD_ZONE` of the crop. */
function deadZone(targets: readonly Pos[], size: Size): Pos[] {
  const xs = deadZoneAxis(
    targets.map((p) => p.x),
    (FOLLOW_DEAD_ZONE * size.w) / 2,
  );
  const ys = deadZoneAxis(
    targets.map((p) => p.y),
    (FOLLOW_DEAD_ZONE * size.h) / 2,
  );
  return xs.map((x, i) => ({ x, y: ys[i] as number }));
}

/** An exponential average run forwards and backwards and averaged: smooth, with no lag. */
function smoothBothWays(points: readonly Point[]): Point[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));
  const ahead: Pos[] = [];
  const behind: Pos[] = new Array(n);
  let acc = { x: (points[0] as Point).x, y: (points[0] as Point).y };
  for (let i = 0; i < n; i += 1) {
    const p = points[i] as Point;
    const dt = i === 0 ? 0 : p.t - (points[i - 1] as Point).t;
    const a = 1 - Math.exp(-dt / FOLLOW_SMOOTH_MS);
    acc =
      i === 0 ? { x: p.x, y: p.y } : { x: acc.x + a * (p.x - acc.x), y: acc.y + a * (p.y - acc.y) };
    ahead.push(acc);
  }
  acc = { x: (points[n - 1] as Point).x, y: (points[n - 1] as Point).y };
  for (let i = n - 1; i >= 0; i -= 1) {
    const p = points[i] as Point;
    const dt = i === n - 1 ? 0 : (points[i + 1] as Point).t - p.t;
    const a = 1 - Math.exp(-dt / FOLLOW_SMOOTH_MS);
    acc =
      i === n - 1
        ? { x: p.x, y: p.y }
        : { x: acc.x + a * (p.x - acc.x), y: acc.y + a * (p.y - acc.y) };
    behind[i] = acc;
  }
  return points.map((p, i) => ({
    t: p.t,
    x: ((ahead[i] as Pos).x + (behind[i] as Pos).x) / 2,
    y: ((ahead[i] as Pos).y + (behind[i] as Pos).y) / 2,
  }));
}

/** No step faster than `FOLLOW_MAX_SPEED` picture widths a second (the same real speed down). */
function capSpeed(points: readonly Point[], va: number): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...p });
      continue;
    }
    const dt = (p.t - prev.t) / 1000;
    const maxX = FOLLOW_MAX_SPEED * dt;
    const maxY = FOLLOW_MAX_SPEED * dt * va;
    out.push({
      t: p.t,
      x: prev.x + clamp(p.x - prev.x, -maxX, maxX),
      y: prev.y + clamp(p.y - prev.y, -maxY, maxY),
    });
  }
  return out;
}

/** One shot (one subject, no scene cut inside) as points, and where the subject was unseen. */
function shotPath(
  person: Person,
  shot: Range,
  size: Size,
  va: number,
): { points: Point[]; lost: Range[] } | null {
  const boxes = boxesIn(person, shot.from, shot.to);
  if (boxes.length === 0) return null;
  const held = deadZone(
    boxes.map((b) => targetFor(b.rect, size)),
    size,
  );
  const lost: Range[] = [];
  // Runs: the subject seen with no long gap. Each is smoothed and capped on its own.
  const runs: Point[][] = [];
  let run: Point[] = [];
  boxes.forEach((box, i) => {
    const prev = boxes[i - 1];
    if (prev && box.t - prev.t > FOLLOW_HOLD_GAP_MS) {
      runs.push(run);
      run = [];
      lost.push({ from: prev.t + PICTURE_MS, to: box.t });
    }
    run.push({ t: box.t, ...(held[i] as Pos) });
  });
  runs.push(run);
  const first = boxes[0] as PersonBox;
  const last = boxes[boxes.length - 1] as PersonBox;
  if (first.t - shot.from > FOLLOW_HOLD_GAP_MS) lost.push({ from: shot.from, to: first.t });
  if (shot.to - (last.t + PICTURE_MS) > FOLLOW_HOLD_GAP_MS) {
    lost.push({ from: last.t + PICTURE_MS, to: shot.to });
  }

  const points: Point[] = [];
  for (const r of runs) {
    const path = capSpeed(smoothBothWays(r), va);
    const before = points[points.length - 1];
    const start = path[0] as Point;
    if (before && !samePos(before, start)) {
      // Back after a long gap: hold, then cut to them.
      points.push({ t: start.t - FOLLOW_CUT_MS, x: before.x, y: before.y });
      path[0] = { ...start, cut: true };
    }
    points.push(...path);
  }
  return { points, lost };
}

/** The shots: the spans, split again at every scene cut inside them. */
function shotsOf(spans: readonly SubjectSpan[], sceneCutsMs: readonly number[]): SubjectSpan[] {
  const cuts = [...new Set(sceneCutsMs.map((c) => Math.round(c)))].sort((a, b) => a - b);
  const shots: SubjectSpan[] = [];
  for (const span of spans) {
    let from = Math.round(span.from);
    const to = Math.round(span.to);
    for (const cut of cuts) {
      if (cut > from && cut < to) {
        shots.push({ from, to: cut, personId: span.personId });
        from = cut;
      }
    }
    if (to > from) shots.push({ from, to, personId: span.personId });
  }
  return shots;
}

/** The value of a point list at `t`: straight between points, held outside (as `cropAt` reads keyframes). */
function valueAt(points: readonly Point[], t: number): Pos {
  const first = points[0] as Point;
  if (t <= first.t) return { x: first.x, y: first.y };
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i] as Point;
    if (t < b.t) {
      const a = points[i - 1] as Point;
      const k = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = points[points.length - 1] as Point;
  return { x: last.x, y: last.y };
}

/** Points in time order with one point per moment (the later one wins). */
function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const t = Math.round(p.t);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      out[out.length - 1] = { ...p, t };
    } else {
      out.push({ ...p, t });
    }
  }
  return out;
}

/** The hand fixes laid over the path: each one's box for its range, a cut at each end. */
function applyOverrides(
  points: Point[],
  overrides: readonly FollowOverride[],
  size: Size,
  range: Range,
): Point[] {
  let out = points;
  for (const o of overrides) {
    const from = Math.max(range.from, Math.round(o.from));
    const to = Math.min(range.to, Math.round(o.to));
    if (to - from < 2) continue;
    const fixed: Pos = {
      x: clamp(o.rect.x + o.rect.w / 2 - size.w / 2, 0, 1 - size.w),
      y: clamp(o.rect.y + o.rect.h / 2 - size.h / 2, 0, 1 - size.h),
    };
    const before = valueAt(out, from - FOLLOW_CUT_MS);
    const after = valueAt(out, to);
    const kept = out.filter((p) => p.t < from - FOLLOW_CUT_MS || p.t > to);
    const added: Point[] = [];
    if (from - FOLLOW_CUT_MS >= range.from) {
      added.push({ t: from - FOLLOW_CUT_MS, ...before });
      added.push({ t: from, ...fixed, cut: !samePos(before, fixed) });
    } else {
      added.push({ t: from, ...fixed });
    }
    added.push({ t: to - FOLLOW_CUT_MS, ...fixed });
    added.push({ t: to, ...after, cut: !samePos(after, fixed) });
    out = tidy([...kept, ...added]);
  }
  return out;
}

/** How far a point is from the straight line between two others, in picture fractions. */
function offLine(p: Point, a: Point, b: Point): number {
  const k = b.t === a.t ? 0 : (p.t - a.t) / (b.t - a.t);
  return Math.max(Math.abs(p.x - (a.x + (b.x - a.x) * k)), Math.abs(p.y - (a.y + (b.y - a.y) * k)));
}

/** Which points to keep: the ends, both sides of every cut, and what a line does not explain within `tolerance`. */
function keepMask(points: readonly Point[], tolerance: number): boolean[] {
  const keep = points.map(() => false);
  const fixed: number[] = [0];
  points.forEach((p, i) => {
    if (p.cut && i > 0) {
      fixed.push(i - 1, i);
    }
  });
  fixed.push(points.length - 1);
  const anchors = [...new Set(fixed)].sort((a, b) => a - b);
  for (const i of anchors) keep[i] = true;
  for (let s = 1; s < anchors.length; s += 1) {
    const stack: Array<[number, number]> = [[anchors[s - 1] as number, anchors[s] as number]];
    while (stack.length > 0) {
      const [lo, hi] = stack.pop() as [number, number];
      if (hi - lo < 2) continue;
      let worst = -1;
      let worstAt = -1;
      for (let i = lo + 1; i < hi; i += 1) {
        const d = offLine(points[i] as Point, points[lo] as Point, points[hi] as Point);
        if (d > worst) {
          worst = d;
          worstAt = i;
        }
      }
      if (worst > tolerance) {
        keep[worstAt] = true;
        stack.push([lo, worstAt], [worstAt, hi]);
      }
    }
  }
  return keep;
}

/** The fewest points within tolerance, never more than `MAX_CROP_KEYFRAMES`. */
function reduce(input: readonly Point[], startTolerance: number): Point[] {
  const fit = (points: readonly Point[]): Point[] | null => {
    // Past 2 every point is on a line (crops move inside 0 to 1), so raising it more changes nothing.
    for (let tolerance = startTolerance; tolerance <= 2; ) {
      const keep = keepMask(points, tolerance);
      const kept = points.filter((_, i) => keep[i]);
      if (kept.length <= MAX_CROP_KEYFRAMES) return kept;
      tolerance = Math.max(tolerance * FOLLOW_REDUCE_GROWTH, 1e-6);
    }
    return null;
  };
  const first = fit(input);
  if (first) return first;
  // Too many cuts to fit even as straight lines (each is two keyframes): the
  // biggest jumps stay cuts, the smaller ones become quick pans.
  const jumps = input
    .map((p, i) => {
      const prev = input[i - 1];
      return p.cut && prev
        ? { i, d: Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) }
        : null;
    })
    .filter((j): j is { i: number; d: number } => j !== null)
    .sort((a, b) => b.d - a.d || a.i - b.i);
  const room = Math.max(0, Math.floor((MAX_CROP_KEYFRAMES - 2) / 2) - 1);
  const dropped = new Set(jumps.slice(room).map((j) => j.i));
  const points = input
    .map((p, i) => (dropped.has(i) ? { ...p, cut: false } : p))
    .filter((_, i) => !dropped.has(i + 1));
  return fit(points) ?? points.slice(0, MAX_CROP_KEYFRAMES);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function mergeRanges(ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      last.to = Math.max(last.to, r.to);
    } else if (r.to > r.from) {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * The crop keyframes that follow `spans` (from `chooseSubjects`) in one area.
 * `people` are the people from `linkPeople` (smoothed here); `sceneCutsMs`
 * are the scene track's cuts, ms of the video. The spans' first `from` and
 * last `to` are the range the path covers.
 */
export function followPath(
  people: readonly Person[],
  spans: readonly SubjectSpan[],
  sceneCutsMs: readonly number[],
  area: FollowArea,
  options?: {
    overrides?: readonly FollowOverride[];
    /** The reducer's first tolerance (default `FOLLOW_REDUCE_TOLERANCE`; 0 keeps every bend). */
    tolerance?: number;
  },
): FollowPathResult {
  const va = videoAspect(area.video);
  const smoothed = new Map(people.map((p) => [p.id, smoothBoxes(p)]));
  const size = cropSize(smoothed, spans, area);
  const ordered = [...spans].sort((a, b) => a.from - b.from);
  const first = ordered[0];
  const lastSpan = ordered[ordered.length - 1];
  if (!first || !lastSpan || !(lastSpan.to > first.from)) {
    const at = Math.max(0, Math.round(first?.from ?? 0));
    return { keyframes: [{ at, rect: { ...centred(size), ...size } }], lost: [] };
  }
  const range: Range = { from: Math.round(first.from), to: Math.round(lastSpan.to) };

  // Each shot's own points, or null for a shot with nobody to follow.
  const shots = shotsOf(ordered, sceneCutsMs);
  const lost: Range[] = [];
  const parts = shots.map((shot) => {
    const person = shot.personId ? smoothed.get(shot.personId) : undefined;
    const part = person ? shotPath(person, shot, size, va) : null;
    if (part) {
      lost.push(...part.lost);
      return part.points;
    }
    lost.push({ from: shot.from, to: shot.to });
    return null;
  });

  let points: Point[] = [];
  let previous: Pos | null = null;
  shots.forEach((shot, s) => {
    const own = parts[s];
    let held: Point[];
    if (own) {
      held = own.filter((p) => p.t > shot.from && p.t < shot.to - FOLLOW_CUT_MS);
      const start = own[0] as Point;
      const end = own[own.length - 1] as Point;
      held.unshift({ t: shot.from, x: start.x, y: start.y });
      held.push({ t: shot.to - FOLLOW_CUT_MS, x: end.x, y: end.y });
    } else {
      // Nobody to follow: hold the last crop, or the next one at the start, or the middle.
      const next = parts.slice(s + 1).find((p) => p !== null)?.[0];
      const hold = previous ?? (next ? { x: next.x, y: next.y } : centred(size));
      held = [
        { t: shot.from, ...hold },
        { t: shot.to - FOLLOW_CUT_MS, ...hold },
      ];
    }
    const head = held[0] as Point;
    if (previous && !samePos(previous, head)) head.cut = true;
    points.push(...held);
    const tail = held[held.length - 1] as Point;
    previous = { x: tail.x, y: tail.y };
  });
  points = tidy(points);
  points = applyOverrides(points, options?.overrides ?? [], size, range);
  const kept = reduce(points, Math.max(0, options?.tolerance ?? FOLLOW_REDUCE_TOLERANCE));

  const keyframes: CropKeyframe[] = kept.map((p) => ({
    at: p.t,
    rect: { x: round6(p.x), y: round6(p.y), w: round6(size.w), h: round6(size.h) },
  }));
  const reported = mergeRanges(lost)
    .map((r) => ({ from: Math.max(range.from, r.from), to: Math.min(range.to, r.to) }))
    .filter((r) => r.to - r.from > FOLLOW_LOST_REPORT_MS);
  return { keyframes, lost: reported };
}

/**
 * Show Both: the two people seen most in the range, ordered left to right by
 * where they sit, each followed through the whole range in its own area
 * (`area` for both, or the top and bottom areas' shapes). Null with fewer
 * than two people.
 */
export function followBoth(
  people: readonly Person[],
  fromMs: number,
  toMs: number,
  sceneCutsMs: readonly number[],
  area: FollowArea | readonly [FollowArea, FollowArea],
): [FollowPathResult, FollowPathResult] | null {
  const from = Math.round(fromMs);
  const to = Math.round(toMs);
  if (!(to > from)) return null;
  const ranked = people
    .map((person) => ({ person, boxes: boxesIn(person, from, to) }))
    .filter((r) => r.boxes.length > 0)
    .sort((a, b) => b.boxes.length - a.boxes.length || a.person.id.localeCompare(b.person.id))
    .slice(0, 2);
  if (ranked.length < 2) return null;
  const placed = ranked
    .map((r) => ({
      person: r.person,
      x: median(r.boxes.map((b) => b.rect.x + b.rect.w / 2)) ?? 0.5,
    }))
    .sort((a, b) => a.x - b.x);
  const areas: readonly [FollowArea, FollowArea] = Array.isArray(area)
    ? (area as readonly [FollowArea, FollowArea])
    : [area as FollowArea, area as FollowArea];
  const one = (i: 0 | 1): FollowPathResult => {
    const person = (placed[i] as { person: Person }).person;
    return followPath(people, soleSubject(person, from, to), sceneCutsMs, areas[i]);
  };
  return [one(0), one(1)];
}
