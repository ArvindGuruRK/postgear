/**
 * The timeline's scale: how milliseconds become pixels, and how zooming and
 * scrolling move them.
 *
 * ## The zoom model
 *
 * Zoom is one number that scales a fixed base: `pxPerMs = basePxPerMs x
 * zoom`, with `BASE_PX_PER_MS` (100 pixels a second) at zoom 1. The base is
 * fixed rather than "1 = fit" on purpose: trimming a clip changes its length,
 * and a scale tied to the length would rescale every bar after each trim.
 *
 * The smallest zoom fits the whole clip (or video) in the view (`fitZoom`);
 * the largest shows one frame `MAX_FRAME_PX` wide, so single frames can be
 * picked (`zoomBounds`). The zoom slider is exponential between the two, so
 * each step of it zooms by the same factor whether the video is 20 seconds
 * or 6 hours long.
 *
 * Scrolling is in pixels from the clip's start, never negative and never past
 * the point where the clip's end sits at the view's right edge.
 *
 * Every function is total: a time, a width or a zoom that is not a finite
 * positive number is read as the nearest sensible value, so the screen never
 * draws `NaN`.
 */

/** Pixels per millisecond at zoom 1: 100 pixels a second. */
export const BASE_PX_PER_MS = 0.1;

/** At the largest zoom one frame is this many pixels wide (about two dozen frames in a 600 px dock). */
export const MAX_FRAME_PX = 24;

/** What the + and - keys and buttons multiply or divide the zoom by. */
export const ZOOM_STEP = 1.25;

/** The frame rate assumed when none (or a nonsense one) is given. */
const FALLBACK_FPS = 30;

/** The shortest duration the scale works with, so an empty clip still has a scale. */
const MIN_DURATION_MS = 1;

/** A view of the timeline: what the scale functions need to place things. */
export interface TimelineView {
  zoom: number;
  /** Pixels scrolled from the clip's start. */
  scrollPx: number;
  /** The clip's (or video's) length, in ms. */
  durationMs: number;
  /** The view's width in pixels (leave out any padding before passing it). */
  widthPx: number;
  /** Frames a second, for the largest zoom. */
  fps: number;
  /** Defaults to `BASE_PX_PER_MS`. */
  basePxPerMs?: number;
}

export interface ZoomBounds {
  min: number;
  max: number;
}

export interface ZoomedView {
  zoom: number;
  scrollPx: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Pixels per millisecond at a zoom. */
export function pxPerMs(zoom: number, basePxPerMs: number = BASE_PX_PER_MS): number {
  const base = positive(basePxPerMs, BASE_PX_PER_MS);
  const scale = positive(zoom, 1);
  const result = base * scale;
  return Number.isFinite(result) && result > 0 ? result : base;
}

/** Where a time sits, in pixels from the clip's start (not counting the scroll). */
export function msToPx(ms: number, pxPerMsValue: number): number {
  const result = finite(ms) * positive(pxPerMsValue, BASE_PX_PER_MS);
  return Number.isFinite(result) ? result : 0;
}

/** The time at a pixel from the clip's start (not counting the scroll). */
export function pxToMs(px: number, pxPerMsValue: number): number {
  const result = finite(px) / positive(pxPerMsValue, BASE_PX_PER_MS);
  return Number.isFinite(result) ? result : 0;
}

/** The zoom at which `durationMs` exactly fills `widthPx`: the smallest zoom. */
export function fitZoom(
  durationMs: number,
  widthPx: number,
  basePxPerMs: number = BASE_PX_PER_MS,
): number {
  const duration = positive(durationMs, MIN_DURATION_MS);
  const width = positive(widthPx, 1);
  const base = positive(basePxPerMs, BASE_PX_PER_MS);
  const zoom = width / (duration * base);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * The zoom range: `min` fits the whole length in the view, `max` shows one
 * frame `MAX_FRAME_PX` wide. A clip so short that it fits at more than that
 * gets `max === min` (nothing to zoom into).
 */
export function zoomBounds(
  durationMs: number,
  widthPx: number,
  fps: number,
  basePxPerMs: number = BASE_PX_PER_MS,
): ZoomBounds {
  const base = positive(basePxPerMs, BASE_PX_PER_MS);
  const min = fitZoom(durationMs, widthPx, base);
  const frameMs = 1000 / positive(fps, FALLBACK_FPS);
  const max = MAX_FRAME_PX / frameMs / base;
  return { min, max: Math.max(min, max) };
}

/** A zoom kept inside the bounds (a nonsense zoom becomes the fit). */
export function clampZoom(zoom: number, bounds: ZoomBounds): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return bounds.min;
  }
  return clamp(zoom, bounds.min, bounds.max);
}

/** The view's bounds, from its length, width and frame rate. */
export function viewBounds(view: TimelineView): ZoomBounds {
  return zoomBounds(view.durationMs, view.widthPx, view.fps, view.basePxPerMs);
}

/** The furthest the view can scroll at a zoom: the clip's end at the right edge. */
export function maxScrollPx(view: Omit<TimelineView, 'scrollPx'>): number {
  const scale = pxPerMs(view.zoom, view.basePxPerMs);
  const content = positive(view.durationMs, MIN_DURATION_MS) * scale;
  const width = positive(view.widthPx, 1);
  const result = content - width;
  return Number.isFinite(result) && result > 0 ? result : 0;
}

/** A scroll kept between 0 and `maxScrollPx`. */
export function clampScroll(view: TimelineView): number {
  return clamp(finite(view.scrollPx), 0, maxScrollPx(view));
}

/**
 * Zooms to `nextZoom` (clamped to the bounds) and scrolls so that `anchorMs`
 * stays at the same x on screen: the playhead (or the pointer, for Ctrl and
 * the wheel) does not move while everything around it grows or shrinks. When
 * the clamp on the scroll cannot keep it (near the start or the end), the
 * scroll is clamped and the anchor moves as little as it can.
 */
export function zoomToAround(view: TimelineView, nextZoom: number, anchorMs: number): ZoomedView {
  const bounds = viewBounds(view);
  const fromZoom = clampZoom(view.zoom, bounds);
  const zoom = clampZoom(nextZoom, bounds);
  const anchor = clamp(finite(anchorMs), 0, positive(view.durationMs, MIN_DURATION_MS));
  const before = pxPerMs(fromZoom, view.basePxPerMs);
  const after = pxPerMs(zoom, view.basePxPerMs);
  const screenX = anchor * before - finite(view.scrollPx);
  const scrollPx = clamp(anchor * after - screenX, 0, maxScrollPx({ ...view, zoom }));
  return { zoom, scrollPx: Number.isFinite(scrollPx) ? scrollPx : 0 };
}

/** `zoomToAround` by a factor: `ZOOM_STEP` zooms in one step, `1 / ZOOM_STEP` out. */
export function zoomAround(view: TimelineView, factor: number, anchorMs: number): ZoomedView {
  const bounds = viewBounds(view);
  const from = clampZoom(view.zoom, bounds);
  return zoomToAround(view, from * positive(factor, 1), anchorMs);
}

/**
 * The scroll that brings `ms` into view with `marginPx` to spare, or the
 * current scroll when it is already in view. The dock calls it while playing
 * so the playhead never runs off the right edge.
 */
export function scrollToShow(view: TimelineView, ms: number, marginPx = 32): number {
  const scale = pxPerMs(view.zoom, view.basePxPerMs);
  const width = positive(view.widthPx, 1);
  const margin = clamp(finite(marginPx), 0, width / 2);
  const x = finite(ms) * scale;
  let scroll = finite(view.scrollPx);
  if (x < scroll + margin) {
    scroll = x - margin;
  } else if (x > scroll + width - margin) {
    scroll = x - width + margin;
  }
  return clamp(scroll, 0, maxScrollPx(view));
}

/**
 * The zoom slider's position, 0 (fit) to 1 (largest), on an exponential
 * scale: the same slider distance always zooms by the same factor.
 */
export function zoomToSlider(zoom: number, bounds: ZoomBounds): number {
  if (!(bounds.max > bounds.min) || !(bounds.min > 0)) {
    return 0;
  }
  const value = clampZoom(zoom, bounds);
  const t = Math.log(value / bounds.min) / Math.log(bounds.max / bounds.min);
  return Number.isFinite(t) ? clamp(t, 0, 1) : 0;
}

/** The zoom at a slider position, 0 to 1: the inverse of `zoomToSlider`. */
export function sliderToZoom(slider: number, bounds: ZoomBounds): number {
  if (!(bounds.max > bounds.min) || !(bounds.min > 0)) {
    return positive(bounds.min, 1);
  }
  const t = clamp(finite(slider), 0, 1);
  const zoom = bounds.min * (bounds.max / bounds.min) ** t;
  return clampZoom(zoom, bounds);
}
