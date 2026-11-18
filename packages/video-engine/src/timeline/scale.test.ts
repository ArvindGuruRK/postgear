import { rulerTicks } from './ruler';
import {
  BASE_PX_PER_MS,
  clampScroll,
  clampZoom,
  fitZoom,
  MAX_FRAME_PX,
  maxScrollPx,
  msToPx,
  pxPerMs,
  pxToMs,
  scrollToShow,
  sliderToZoom,
  type TimelineView,
  ZOOM_STEP,
  zoomAround,
  zoomBounds,
  zoomToAround,
  zoomToSlider,
} from './scale';
import { visibleRange } from './visible';

const SIX_HOURS = 6 * 60 * 60 * 1000;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function view(overrides: Partial<TimelineView> = {}): TimelineView {
  return { zoom: 1, scrollPx: 0, durationMs: 60_000, widthPx: 1000, fps: 30, ...overrides };
}

describe('pxPerMs, msToPx, pxToMs', () => {
  it('scales a fixed base by the zoom, and converts both ways', () => {
    expect(pxPerMs(1)).toBe(BASE_PX_PER_MS);
    expect(pxPerMs(2)).toBeCloseTo(0.2);
    expect(pxPerMs(2, 0.05)).toBeCloseTo(0.1);
    expect(msToPx(1_000, 0.1)).toBeCloseTo(100);
    expect(pxToMs(100, 0.1)).toBeCloseTo(1_000);
    expect(pxToMs(msToPx(12_345, 0.37), 0.37)).toBeCloseTo(12_345, 6);
  });

  it('never returns a number that is not finite', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(Number.isFinite(pxPerMs(bad))).toBe(true);
      expect(pxPerMs(bad)).toBeGreaterThan(0);
      expect(Number.isFinite(pxPerMs(1, bad))).toBe(true);
      expect(Number.isFinite(msToPx(bad, 0.1))).toBe(true);
      expect(Number.isFinite(pxToMs(100, bad))).toBe(true);
      expect(Number.isFinite(fitZoom(bad, bad))).toBe(true);
    }
    expect(pxPerMs(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
  });
});

describe('fitZoom and zoomBounds', () => {
  it('fits a 6 hour video in the view at the smallest zoom', () => {
    const bounds = zoomBounds(SIX_HOURS, 1200, 30);
    const scale = pxPerMs(bounds.min);
    expect(msToPx(SIX_HOURS, scale)).toBeCloseTo(1200, 6);
    expect(maxScrollPx({ zoom: bounds.min, durationMs: SIX_HOURS, widthPx: 1200, fps: 30 })).toBe(
      0,
    );

    const range = visibleRange(0, 1200, scale);
    expect(range.fromMs).toBe(0);
    expect(range.toMs).toBeCloseTo(SIX_HOURS, 0);

    // The ruler at that scale: 30 minute labels, never closer than 64 px.
    const ruler = rulerTicks(range.fromMs, range.toMs, scale, { fps: 30 });
    expect(ruler.stepMs).toBe(1_800_000);
    const labels = ruler.ticks.filter((t) => t.major).map((t) => t.label);
    expect(labels.slice(0, 4)).toEqual(['0:00', '30:00', '1:00:00', '1:30:00']);
    expect(labels).toContain('6:00:00');
  });

  it('shows a frame MAX_FRAME_PX wide on a 20 second clip at the largest zoom', () => {
    const bounds = zoomBounds(20_000, 1000, 30);
    const scale = pxPerMs(bounds.max);
    expect(msToPx(1000 / 30, scale)).toBeCloseTo(MAX_FRAME_PX, 6);
    expect(msToPx(20_000, scale)).toBeCloseTo(14_400, 6);
    expect(
      maxScrollPx({ zoom: bounds.max, durationMs: 20_000, widthPx: 1000, fps: 30 }),
    ).toBeCloseTo(13_400, 6);
    // At 60 fps a frame is half as long, so the largest zoom doubles.
    expect(zoomBounds(20_000, 1000, 60).max).toBeCloseTo(bounds.max * 2, 9);

    // Labels every five frames, the clock on whole seconds.
    const ruler = rulerTicks(0, 1_400, scale, { fps: 30 });
    expect(ruler.stepMs).toBeCloseTo(500 / 3, 9);
    expect(ruler.ticks.filter((t) => t.major).map((t) => t.label)).toEqual([
      '0:00',
      '5f',
      '10f',
      '15f',
      '20f',
      '25f',
      '0:01',
      '5f',
      '10f',
      '15f',
      // One step of margin past the view.
      '20f',
    ]);
  });

  it('gives a clip too short to zoom into one zoom', () => {
    const bounds = zoomBounds(3_000, 5_000, 30);
    expect(bounds.max).toBe(bounds.min);
    expect(zoomToSlider(bounds.min, bounds)).toBe(0);
    expect(sliderToZoom(0.7, bounds)).toBe(bounds.min);
  });

  it('clamps a zoom to the bounds, and reads nonsense as the fit', () => {
    const bounds = zoomBounds(60_000, 1000, 30);
    expect(clampZoom(1e9, bounds)).toBe(bounds.max);
    expect(clampZoom(1e-9, bounds)).toBe(bounds.min);
    expect(clampZoom(Number.NaN, bounds)).toBe(bounds.min);
    expect(clampZoom(-3, bounds)).toBe(bounds.min);
  });
});

describe('zoomAround', () => {
  it('keeps the anchor at the same x on screen', () => {
    const random = seeded(7);
    for (let run = 0; run < 200; run += 1) {
      const durationMs = 20_000 + Math.floor(random() * SIX_HOURS);
      const widthPx = 400 + Math.floor(random() * 1600);
      const bounds = zoomBounds(durationMs, widthPx, 30);
      const zoom = sliderToZoom(random(), bounds);
      const v: TimelineView = { zoom, scrollPx: 0, durationMs, widthPx, fps: 30 };
      v.scrollPx = random() * maxScrollPx(v);
      const visible = visibleRange(v.scrollPx, widthPx, pxPerMs(zoom));
      const anchor = visible.fromMs + random() * (visible.toMs - visible.fromMs);
      const factor = random() < 0.5 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = zoomAround(v, factor, anchor);

      expect(next.zoom).toBeGreaterThanOrEqual(bounds.min);
      expect(next.zoom).toBeLessThanOrEqual(bounds.max);
      expect(next.scrollPx).toBeGreaterThanOrEqual(0);
      expect(next.scrollPx).toBeLessThanOrEqual(maxScrollPx({ ...v, zoom: next.zoom }) + 1e-6);

      const before = anchor * pxPerMs(zoom) - v.scrollPx;
      const after = anchor * pxPerMs(next.zoom) - next.scrollPx;
      const unclamped = anchor * pxPerMs(next.zoom) - before;
      if (unclamped >= 0 && unclamped <= maxScrollPx({ ...v, zoom: next.zoom })) {
        expect(after).toBeCloseTo(before, 6);
      }
    }
  });

  it('zooms in by a step around the playhead in the middle of the view', () => {
    const v = view({ zoom: 1, scrollPx: 2_000 });
    // The playhead at 25 s sits at 2500 - 2000 = 500 px.
    const next = zoomAround(v, 2, 25_000);
    expect(next.zoom).toBe(2);
    expect(25_000 * pxPerMs(2) - next.scrollPx).toBeCloseTo(500, 9);
  });

  it('clamps the zoom and the scroll', () => {
    const v = view({ zoom: 1, scrollPx: 2_000 });
    const bounds = zoomBounds(v.durationMs, v.widthPx, v.fps);
    const out = zoomToAround(v, 1e-9, 59_000);
    expect(out.zoom).toBe(bounds.min);
    expect(out.scrollPx).toBe(0);
    const inward = zoomToAround({ ...v, scrollPx: 0 }, 1e9, 0);
    expect(inward.zoom).toBe(bounds.max);
    expect(inward.scrollPx).toBe(0);
    const atEnd = zoomToAround({ ...v, scrollPx: 5_000 }, 4, 60_000);
    expect(atEnd.scrollPx).toBeCloseTo(maxScrollPx({ ...v, zoom: 4 }), 9);
  });

  it('survives nonsense', () => {
    const bad = view({ zoom: Number.NaN, scrollPx: Number.NaN, widthPx: -5, durationMs: 0 });
    const out = zoomAround(bad, Number.NaN, Number.NaN);
    expect(Number.isFinite(out.zoom)).toBe(true);
    expect(Number.isFinite(out.scrollPx)).toBe(true);
    expect(out.scrollPx).toBeGreaterThanOrEqual(0);
  });
});

describe('scroll', () => {
  it('clamps the scroll between 0 and the clip end at the right edge', () => {
    expect(clampScroll(view({ scrollPx: -50 }))).toBe(0);
    expect(clampScroll(view({ scrollPx: 1e9 }))).toBeCloseTo(5_000, 9);
    expect(clampScroll(view({ scrollPx: Number.NaN }))).toBe(0);
  });

  it('follows the playhead off the right edge and back from the left', () => {
    const v = view({ scrollPx: 0 });
    expect(scrollToShow(v, 5_000)).toBe(0);
    expect(scrollToShow(v, 20_000, 32)).toBeCloseTo(2_000 - 1_000 + 32, 9);
    expect(scrollToShow(view({ scrollPx: 3_000 }), 10_000, 32)).toBeCloseTo(1_000 - 32, 9);
    expect(scrollToShow(v, 60_000, 32)).toBeCloseTo(5_000, 9);
  });
});

describe('the zoom slider', () => {
  it('is exponential, monotonic and round trips', () => {
    const bounds = zoomBounds(SIX_HOURS, 1200, 30);
    expect(sliderToZoom(0, bounds)).toBeCloseTo(bounds.min, 12);
    expect(sliderToZoom(1, bounds)).toBeCloseTo(bounds.max, 9);
    // Halfway is the geometric middle, not the arithmetic one.
    expect(sliderToZoom(0.5, bounds)).toBeCloseTo(Math.sqrt(bounds.min * bounds.max), 9);
    let previous = 0;
    for (let i = 0; i <= 100; i += 1) {
      const zoom = sliderToZoom(i / 100, bounds);
      expect(zoom).toBeGreaterThanOrEqual(previous);
      expect(zoomToSlider(zoom, bounds)).toBeCloseTo(i / 100, 9);
      previous = zoom;
    }
    expect(sliderToZoom(-1, bounds)).toBeCloseTo(bounds.min, 12);
    expect(sliderToZoom(Number.NaN, bounds)).toBeCloseTo(bounds.min, 12);
    expect(zoomToSlider(1e12, bounds)).toBe(1);
  });
});
