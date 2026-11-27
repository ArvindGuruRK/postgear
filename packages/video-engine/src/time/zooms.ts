/**
 * Zooms (Module 13): where each one shows in the clip, how far in it is at a
 * moment, and the edits the Effects tab and the Zoom row make.
 *
 * - A zoom lives in the video's own time (`from`, `to`, like crops), so
 *   trimming, splitting or speeding a part never moves it off its moment. A
 *   zoom on a stretch that was cut out stays in the document (undoing the cut
 *   brings it back) and simply never shows.
 * - `zoomWindows(doc)` maps every zoom through the time map into windows of
 *   the clip's time: one window while the clip plays the zoom's stretch
 *   without a jump (a split, or a change of speed, joins up); a cut in the
 *   middle makes two windows, each easing in and out on its own.
 * - The ease is measured in the clip's milliseconds and clamped to half the
 *   window, so a zoom over a 4x part does not snap. The curve is the
 *   cookbook's smoothstep: `u = min(clip((t-a)/d), clip((b-t)/d))`,
 *   `z = 1 + (S - 1) x u x u x (3 - 2u)`. A canvas point `p` shows at
 *   `F + (p - F) x z`, so the focus point never moves.
 * - Zooms on one video never overlap: every edit clamps against the
 *   neighbours.
 *
 * Pure: no clock, no DOM. `frameState`, the preview, the compiler and the
 * timeline all read these windows.
 */
import { newId } from '../document/create';
import { MAX_ZOOMS, ZOOM_MAX } from '../document/limits';
import type { ClipDocument, Zoom } from '../document/schema';
import type { Point } from '../geometry';
import { usedIds } from './items';
import { outputDuration, placeSegments, segmentAt } from './time-map';

/** A new zoom lasts two seconds of the clip. */
export const ZOOM_DEFAULT_MS = 2_000;
export const ZOOM_DEFAULT_SCALE = 1.5;
/** The Amount slider's range (the schema accepts 1 to `ZOOM_MAX` from older clips). */
export const ZOOM_SCALE_MIN = 1.1;
export const ZOOM_SCALE_MAX = 3;
/** The shortest zoom, in the video's time. */
export const ZOOM_MIN_MS = 300;
/** Snap, Smooth and Slow: the time a zoom takes to come in and to go out. */
export const ZOOM_EASES = { snap: 0, smooth: 300, slow: 800 } as const;
export type ZoomEaseName = keyof typeof ZOOM_EASES;
export const ZOOM_DEFAULT_EASE = ZOOM_EASES.smooth;

/** One stretch of the clip where a zoom shows. */
export interface ZoomWindow {
  zoomId: string;
  /** 0 for the first window of a zoom, 1 for the next (after a cut), and so on. */
  piece: number;
  /** Clip time, whole ms; `endMs` is exclusive. */
  startMs: number;
  endMs: number;
  /** The ease in clip ms, at most half the window. */
  easeMs: number;
  scale: number;
  focus: Point;
}

export interface ZoomNow {
  /** 1 when no zoom is on. */
  scale: number;
  focus: Point;
  zoomId: string | null;
}

const NO_ZOOM: ZoomNow = Object.freeze({
  scale: 1,
  focus: Object.freeze({ x: 0.5, y: 0.5 }),
  zoomId: null,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Stands for "no joins" in the cache (a WeakMap needs an object key). */
const NO_JOINS: NonNullable<ClipDocument['joins']> = [];

const windowCache = new WeakMap<
  ClipDocument['zooms'],
  WeakMap<ClipDocument['segments'], WeakMap<NonNullable<ClipDocument['joins']>, ZoomWindow[]>>
>();

type ZoomDocument = Pick<ClipDocument, 'zooms' | 'segments'> & Partial<Pick<ClipDocument, 'joins'>>;

/**
 * Every zoom's windows in the clip, ordered by start. Cached per document
 * (by its `zooms`, `segments` and `joins` arrays, which edits always
 * replace), so the preview can ask on every frame. A Fade join (Module 11)
 * moves every later window earlier, so pass the whole document.
 */
export function zoomWindows(doc: ZoomDocument): ZoomWindow[] {
  const joins = doc.joins ?? NO_JOINS;
  let bySegments = windowCache.get(doc.zooms);
  let byJoins = bySegments?.get(doc.segments);
  const cached = byJoins?.get(joins);
  if (cached) return cached;
  const windows = computeZoomWindows(doc);
  if (!bySegments) {
    bySegments = new WeakMap();
    windowCache.set(doc.zooms, bySegments);
  }
  if (!byJoins) {
    byJoins = new WeakMap();
    bySegments.set(doc.segments, byJoins);
  }
  byJoins.set(joins, windows);
  return windows;
}

function computeZoomWindows(doc: ZoomDocument): ZoomWindow[] {
  if (doc.zooms.length === 0) return [];
  const placed = placeSegments(doc);
  const windows: ZoomWindow[] = [];
  for (const zoom of doc.zooms) {
    let open: { startMs: number; endMs: number; sourceEnd: number } | null = null;
    let piece = 0;
    const close = () => {
      if (open && open.endMs > open.startMs) {
        const length = open.endMs - open.startMs;
        windows.push({
          zoomId: zoom.id,
          piece,
          startMs: open.startMs,
          endMs: open.endMs,
          easeMs: Math.min(Math.max(0, Math.round(zoom.ease)), Math.floor(length / 2)),
          scale: zoom.scale,
          focus: { x: zoom.focus.x, y: zoom.focus.y },
        });
        piece += 1;
      }
      open = null;
    };
    for (const entry of placed) {
      const { segment } = entry;
      if (segment.source !== zoom.source) {
        close();
        continue;
      }
      const from = Math.max(zoom.from, segment.sourceIn);
      const to = Math.min(zoom.to, segment.sourceOut);
      if (from >= to) {
        close();
        continue;
      }
      const startMs = entry.outStart + Math.round((from - segment.sourceIn) / segment.speed);
      const endMs = Math.min(
        entry.outEnd,
        entry.outStart + Math.round((to - segment.sourceIn) / segment.speed),
      );
      // The clip carries straight on from the last piece: same moment of the video, no gap.
      const current = open as { startMs: number; endMs: number; sourceEnd: number } | null;
      if (current && current.endMs === startMs && current.sourceEnd === from) {
        current.endMs = endMs;
        current.sourceEnd = to;
      } else {
        close();
        open = { startMs, endMs, sourceEnd: to };
      }
      // A piece that stops before the part does cannot run on into the next part.
      if (to < segment.sourceOut) close();
    }
    close();
  }
  return windows.sort((a, b) => a.startMs - b.startMs || a.zoomId.localeCompare(b.zoomId));
}

/** The smoothstep amount at `t` for one window: 1 outside it, `scale` while it holds. */
export function zoomScaleIn(
  window: Pick<ZoomWindow, 'startMs' | 'endMs' | 'easeMs' | 'scale'>,
  t: number,
): number {
  if (t < window.startMs || t >= window.endMs) return 1;
  const d = window.easeMs;
  const u =
    d > 0
      ? Math.min(clamp((t - window.startMs) / d, 0, 1), clamp((window.endMs - t) / d, 0, 1))
      : 1;
  return 1 + (window.scale - 1) * u * u * (3 - 2 * u);
}

/** How far in the clip is zoomed at `outputMs`, and about which point. */
export function zoomAt(doc: ZoomDocument, outputMs: number): ZoomNow {
  let best: ZoomNow = NO_ZOOM;
  for (const window of zoomWindows(doc)) {
    if (window.startMs > outputMs) break;
    const scale = zoomScaleIn(window, outputMs);
    if (scale > best.scale) {
      best = { scale, focus: window.focus, zoomId: window.zoomId };
    }
  }
  return best;
}

/** Where a canvas point shows under a zoom (fractions of the canvas): `F + (p - F) x z`. */
export function zoomedPoint(point: Point, zoom: Pick<ZoomNow, 'scale' | 'focus'>): Point {
  return {
    x: zoom.focus.x + (point.x - zoom.focus.x) * zoom.scale,
    y: zoom.focus.y + (point.y - zoom.focus.y) * zoom.scale,
  };
}

/** The windows of one zoom (empty when its moment was cut out). */
export function windowsOfZoom(doc: ZoomDocument, zoomId: string): ZoomWindow[] {
  return zoomWindows(doc).filter((window) => window.zoomId === zoomId);
}

/** The ease name the Effects tab shows for a zoom's ease (the nearest of the three). */
export function zoomEaseName(easeMs: number): ZoomEaseName {
  let best: ZoomEaseName = 'smooth';
  let gap = Number.POSITIVE_INFINITY;
  for (const [name, ms] of Object.entries(ZOOM_EASES) as Array<[ZoomEaseName, number]>) {
    const off = Math.abs(ms - easeMs);
    if (off < gap) {
      gap = off;
      best = name;
    }
  }
  return best;
}

// --- Edits --------------------------------------------------------------------------

export type ZoomRefusalCode =
  /** No zoom has that id. */
  | 'zoom_not_found'
  /** Past `MAX_ZOOMS`. */
  | 'too_many_zooms'
  /** Another zoom already covers that moment, or there is no room for one. */
  | 'zoom_no_room'
  /** A time before the clip's start or past its end. */
  | 'outside_clip'
  /** A time or number that is not finite. */
  | 'invalid_time';

export type ZoomEditResult =
  | { ok: true; doc: ClipDocument; zoomId: string }
  | { ok: false; code: ZoomRefusalCode };

/** The free stretch of a video around `at`, between the zooms either side (excluding `skipId`). */
function roomAround(
  doc: ClipDocument,
  source: string,
  at: number,
  skipId?: string,
): { min: number; max: number } | null {
  let min = 0;
  let max = Number.POSITIVE_INFINITY;
  for (const zoom of doc.zooms) {
    if (zoom.source !== source || zoom.id === skipId) continue;
    if (at >= zoom.from && at < zoom.to) return null;
    if (zoom.to <= at) min = Math.max(min, zoom.to);
    if (zoom.from > at) max = Math.min(max, zoom.from);
  }
  return { min, max };
}

/** The video's end as far as the clip knows it: the furthest any part of that video reaches. */
function sourceReach(doc: ClipDocument, source: string): number {
  let reach = 0;
  for (const segment of doc.segments) {
    if (segment.source === source) reach = Math.max(reach, segment.sourceOut);
  }
  return reach;
}

function withZoom(doc: ClipDocument, zoom: Zoom): ClipDocument {
  const zooms = doc.zooms.some((z) => z.id === zoom.id)
    ? doc.zooms.map((z) => (z.id === zoom.id ? zoom : z))
    : [...doc.zooms, zoom];
  return { ...doc, zooms };
}

/**
 * Add Zoom: two seconds of the clip at the playhead, 1.5x, Smooth, focused
 * on the centre. It starts at the video moment under the playhead and runs
 * on through the part (and any part that carries straight on); near the end
 * of a part it moves earlier so it still lasts its two seconds. It never
 * overlaps another zoom on the same video.
 */
export function addZoom(doc: ClipDocument, atOutputMs: number): ZoomEditResult {
  if (!Number.isFinite(atOutputMs)) return { ok: false, code: 'invalid_time' };
  if (doc.zooms.length >= MAX_ZOOMS) return { ok: false, code: 'too_many_zooms' };
  const total = outputDuration(doc);
  if (atOutputMs < 0 || atOutputMs > total) return { ok: false, code: 'outside_clip' };
  const entry = segmentAt(doc, Math.min(atOutputMs, Math.max(0, total - 1)));
  if (!entry) return { ok: false, code: 'outside_clip' };
  const { segment } = entry;
  const at = Math.min(
    segment.sourceOut - 1,
    segment.sourceIn +
      Math.round((Math.min(atOutputMs, entry.outEnd) - entry.outStart) * segment.speed),
  );

  // How far the video plays on without a jump from this part.
  const placed = placeSegments(doc);
  let runEnd = segment.sourceOut;
  for (let i = entry.index + 1; i < placed.length; i += 1) {
    const next = (placed[i] as (typeof placed)[number]).segment;
    if (next.source !== segment.source || next.sourceIn !== runEnd) break;
    runEnd = next.sourceOut;
  }

  const room = roomAround(doc, segment.source, at);
  if (!room) return { ok: false, code: 'zoom_no_room' };
  const lowest = Math.max(room.min, segment.sourceIn);
  const highest = Math.min(room.max, runEnd);
  const wanted = Math.round(ZOOM_DEFAULT_MS * segment.speed);
  let from = Math.max(lowest, at);
  let to = Math.min(highest, from + wanted);
  if (to - from < wanted) from = Math.max(lowest, to - wanted);
  from = Math.round(from);
  to = Math.round(to);
  if (to - from < ZOOM_MIN_MS) return { ok: false, code: 'zoom_no_room' };

  const taken = usedIds(doc);
  let id = newId('zm');
  while (taken.has(id)) id = newId('zm');
  const zoom: Zoom = {
    id,
    source: segment.source,
    from,
    to,
    scale: ZOOM_DEFAULT_SCALE,
    focus: { x: 0.5, y: 0.5 },
    ease: ZOOM_DEFAULT_EASE,
  };
  return { ok: true, doc: { ...doc, zooms: [...doc.zooms, zoom] }, zoomId: id };
}

/** Changes a zoom's amount, focus or ease (clamped to their ranges); the same doc when nothing changed. */
export function updateZoom(
  doc: ClipDocument,
  zoomId: string,
  change: Partial<Pick<Zoom, 'scale' | 'focus' | 'ease'>>,
): ZoomEditResult {
  const zoom = doc.zooms.find((z) => z.id === zoomId);
  if (!zoom) return { ok: false, code: 'zoom_not_found' };
  const next: Zoom = { ...zoom };
  if (change.scale !== undefined) {
    if (!Number.isFinite(change.scale)) return { ok: false, code: 'invalid_time' };
    next.scale =
      Math.round(clamp(change.scale, ZOOM_SCALE_MIN, Math.min(ZOOM_SCALE_MAX, ZOOM_MAX)) * 100) /
      100;
  }
  if (change.focus !== undefined) {
    if (!Number.isFinite(change.focus.x) || !Number.isFinite(change.focus.y)) {
      return { ok: false, code: 'invalid_time' };
    }
    next.focus = {
      x: Math.round(clamp(change.focus.x, 0, 1) * 10_000) / 10_000,
      y: Math.round(clamp(change.focus.y, 0, 1) * 10_000) / 10_000,
    };
  }
  if (change.ease !== undefined) {
    if (!Number.isFinite(change.ease)) return { ok: false, code: 'invalid_time' };
    next.ease = Math.round(clamp(change.ease, 0, 2_000));
  }
  const same =
    next.scale === zoom.scale &&
    next.ease === zoom.ease &&
    next.focus.x === zoom.focus.x &&
    next.focus.y === zoom.focus.y;
  return { ok: true, doc: same ? doc : withZoom(doc, next), zoomId };
}

/**
 * Sets a zoom's stretch of the video (source ms), kept off its neighbours on
 * the same video, inside the video the clip knows, and at least
 * `ZOOM_MIN_MS` long. `keep` says which end stays put when the stretch has
 * to shrink to fit: a move keeps the length, a resize keeps the other end.
 */
export function setZoomRange(
  doc: ClipDocument,
  zoomId: string,
  fromMs: number,
  toMs: number,
  keep: 'length' | 'from' | 'to' = 'length',
): ZoomEditResult {
  const zoom = doc.zooms.find((z) => z.id === zoomId);
  if (!zoom) return { ok: false, code: 'zoom_not_found' };
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))
    return { ok: false, code: 'invalid_time' };
  let lower = 0;
  let upper = Math.max(sourceReach(doc, zoom.source), zoom.to);
  // The neighbours are the zooms before and after where it sits now.
  for (const other of doc.zooms) {
    if (other.source !== zoom.source || other.id === zoom.id) continue;
    if (other.to <= zoom.from) lower = Math.max(lower, other.to);
    else if (other.from >= zoom.to) upper = Math.min(upper, other.from);
  }
  let from = Math.round(fromMs);
  let to = Math.round(toMs);
  if (keep === 'length') {
    const length = Math.min(Math.max(ZOOM_MIN_MS, to - from), upper - lower);
    from = clamp(from, lower, upper - length);
    to = from + length;
  } else if (keep === 'from') {
    from = zoom.from;
    to = clamp(to, from + ZOOM_MIN_MS, upper);
  } else {
    to = zoom.to;
    from = clamp(from, lower, to - ZOOM_MIN_MS);
  }
  if (to - from < ZOOM_MIN_MS || from < lower || to > upper)
    return { ok: false, code: 'zoom_no_room' };
  if (from === zoom.from && to === zoom.to) return { ok: true, doc, zoomId };
  return { ok: true, doc: withZoom(doc, { ...zoom, from, to }), zoomId };
}

/** The video moment a clip moment shows, reading a part's end as its own end (not the next part's start). */
export function sourceAtOutput(
  doc: Pick<ClipDocument, 'segments'> & Partial<Pick<ClipDocument, 'joins'>>,
  outputMs: number,
  side: 'start' | 'end',
): { sourceId: string; sourceMs: number } | null {
  const placed = placeSegments(doc);
  const total = placed.at(-1)?.outEnd ?? 0;
  const t = clamp(Math.round(outputMs), 0, total);
  const entry =
    side === 'end'
      ? (placed.find((p) => t > p.outStart && t <= p.outEnd) ?? placed[0])
      : (placed.find((p) => t >= p.outStart && t < p.outEnd) ?? placed.at(-1));
  if (!entry) return null;
  const { segment } = entry;
  const sourceMs = clamp(
    segment.sourceIn + Math.round((t - entry.outStart) * segment.speed),
    segment.sourceIn,
    segment.sourceOut,
  );
  return { sourceId: segment.source, sourceMs };
}

/**
 * Sets where a zoom shows in the clip (the From and For fields, a bar's drag):
 * the clip moments are mapped to the video's time and the zoom takes that
 * stretch. A stretch that would jump to another video, or run backwards over
 * a reordered cut, is refused.
 */
export function setZoomTiming(
  doc: ClipDocument,
  zoomId: string,
  startMs: number,
  durationMs: number,
  keep: 'length' | 'from' | 'to' = 'length',
): ZoomEditResult {
  const zoom = doc.zooms.find((z) => z.id === zoomId);
  if (!zoom) return { ok: false, code: 'zoom_not_found' };
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs))
    return { ok: false, code: 'invalid_time' };
  const total = outputDuration(doc);
  const start = clamp(Math.round(startMs), 0, total);
  const end = clamp(Math.round(startMs + durationMs), 0, total);
  const from = sourceAtOutput(doc, start, 'start');
  const to = sourceAtOutput(doc, end, 'end');
  if (!from || !to) return { ok: false, code: 'outside_clip' };
  if (keep !== 'to' && from.sourceId !== zoom.source) return { ok: false, code: 'zoom_no_room' };
  if (keep !== 'from' && to.sourceId !== zoom.source) return { ok: false, code: 'zoom_no_room' };
  if (keep === 'length') {
    return setZoomRange(
      doc,
      zoomId,
      from.sourceMs,
      from.sourceMs + (zoom.to - zoom.from),
      'length',
    );
  }
  if (keep === 'from') return setZoomRange(doc, zoomId, zoom.from, to.sourceMs, 'from');
  return setZoomRange(doc, zoomId, from.sourceMs, zoom.to, 'to');
}

/** Removes a zoom. */
export function removeZoom(doc: ClipDocument, zoomId: string): ZoomEditResult {
  if (!doc.zooms.some((z) => z.id === zoomId)) return { ok: false, code: 'zoom_not_found' };
  return { ok: true, doc: { ...doc, zooms: doc.zooms.filter((z) => z.id !== zoomId) }, zoomId };
}
