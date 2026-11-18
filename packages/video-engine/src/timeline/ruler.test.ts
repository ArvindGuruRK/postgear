import { RULER_MIN_GAP_PX, RULER_STEPS_MS, rulerStep, rulerSteps, rulerTicks } from './ruler';
import { pxPerMs, sliderToZoom, zoomBounds } from './scale';

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

function majors(fromMs: number, toMs: number, scale: number, fps = 30) {
  return rulerTicks(fromMs, toMs, scale, { fps }).ticks.filter((t) => t.major);
}

describe('rulerSteps', () => {
  it('starts with frame steps that divide the frame rate, then the fixed ladder', () => {
    expect(rulerSteps(30).map((s) => s.frames ?? null)).toEqual([
      1,
      2,
      5,
      10,
      ...RULER_STEPS_MS.map(() => null),
    ]);
    expect(
      rulerSteps(60)
        .filter((s) => s.frames)
        .map((s) => s.frames),
    ).toEqual([1, 2, 5, 10]);
    expect(rulerSteps(30)[0]?.ms).toBeCloseTo(1000 / 30, 9);
    expect(rulerSteps(Number.NaN)[0]?.ms).toBeCloseTo(1000 / 30, 9);
    expect(RULER_STEPS_MS[RULER_STEPS_MS.length - 1]).toBe(3_600_000);
  });

  it('picks the first step at least the minimum gap wide', () => {
    expect(rulerStep(0.1, { fps: 30 }).ms).toBe(1_000);
    expect(rulerStep(0.15, { fps: 30 }).ms).toBe(500);
    expect(rulerStep(0.2, { fps: 30 }).frames).toBe(10);
    expect(rulerStep(1, { fps: 30 }).frames).toBe(2);
    expect(rulerStep(0.1, { fps: 30, minGapPx: 150 }).ms).toBe(2_000);
    // Past an hour: whole hours.
    expect(rulerStep(1e-6, { fps: 30 }).ms).toBe(18 * 3_600_000);
    expect(rulerStep(Number.NaN, { fps: 30 }).ms).toBe(3_600_000);
  });
});

describe('rulerTicks', () => {
  it('labels seconds, minutes and hours as a clock', () => {
    // 100 px a second: a label every second.
    expect(majors(0, 3_000, 0.1).map((t) => t.label)).toEqual([
      '0:00',
      '0:01',
      '0:02',
      '0:03',
      '0:04',
    ]);
    // 64 px over 30 s at about 2 px a second.
    expect(majors(60_000, 120_000, 0.0025).map((t) => t.label)).toEqual([
      '0:30',
      '1:00',
      '1:30',
      '2:00',
      '2:30',
    ]);
    const hours = majors(3_000_000, 4_000_000, 64 / 600_000).map((t) => t.label);
    expect(hours).toContain('1:00:00');
    expect(hours).toContain('1:10:00');
  });

  it('labels half seconds and frames when zoomed in', () => {
    expect(majors(0, 1_000, 0.15).map((t) => t.label)).toEqual([
      '0:00',
      '0:00.5',
      '0:01',
      '0:01.5',
    ]);
    const frames = majors(0, 1_000, 1);
    expect(frames.map((t) => t.label).slice(0, 4)).toEqual(['0:00', '2f', '4f', '6f']);
    expect(frames.map((t) => t.label)).toContain('0:01');
    expect(frames[1]?.ms).toBeCloseTo(2000 / 30, 9);
  });

  it('adds unlabelled minor ticks of a smaller step that divides the label step', () => {
    const ruler = rulerTicks(0, 2_000, 0.1, { fps: 30 });
    expect(ruler.stepMs).toBe(1_000);
    expect(ruler.minorStepMs).toBe(500);
    const minors = ruler.ticks.filter((t) => !t.major);
    expect(minors.map((t) => t.ms)).toEqual([500, 1_500, 2_500]);
    expect(minors.every((t) => t.label === '')).toBe(true);
    // Ticks stay in time order.
    const times = ruler.ticks.map((t) => t.ms);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('returns only the visible range, with one step of margin and nothing before 0', () => {
    const ticks = majors(10_000, 20_000, 0.1);
    expect(ticks[0]?.ms).toBe(9_000);
    expect(ticks[ticks.length - 1]?.ms).toBe(21_000);
    expect(majors(0, 1_000, 0.1)[0]?.ms).toBe(0);
    expect(majors(-500, 1_000, 0.1)[0]?.ms).toBe(0);
  });

  it('never puts two labels closer than the minimum gap, at 200 random zooms', () => {
    const random = seeded(42);
    for (let run = 0; run < 200; run += 1) {
      const fps = random() < 0.5 ? 30 : 60;
      const durationMs = 20_000 + random() * SIX_HOURS;
      const widthPx = 300 + random() * 1700;
      const scale = pxPerMs(sliderToZoom(random(), zoomBounds(durationMs, widthPx, fps)));
      const from = random() * durationMs;
      const to = from + widthPx / scale;
      const minGapPx = random() < 0.2 ? 40 + random() * 100 : RULER_MIN_GAP_PX;
      const ruler = rulerTicks(from, to, scale, { fps, minGapPx });
      const labelled = ruler.ticks.filter((t) => t.major);

      expect(labelled.length).toBeGreaterThan(1);
      expect(labelled.length).toBeLessThan(widthPx / minGapPx + 5);
      expect(labelled[0]?.ms).toBeLessThanOrEqual(from);
      expect(labelled[labelled.length - 1]?.ms).toBeGreaterThanOrEqual(to);
      for (let i = 1; i < labelled.length; i += 1) {
        const gap = ((labelled[i]?.ms ?? 0) - (labelled[i - 1]?.ms ?? 0)) * scale;
        expect(gap).toBeGreaterThanOrEqual(minGapPx - 1e-6);
        expect(labelled[i]?.label).not.toBe('');
      }
    }
  });

  it('survives nonsense', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const ruler = rulerTicks(bad, bad, bad, { fps: bad, minGapPx: bad });
      expect(Number.isFinite(ruler.stepMs)).toBe(true);
      expect(ruler.ticks.every((t) => Number.isFinite(t.ms) && t.ms >= 0)).toBe(true);
    }
    // A huge range at a scale that is not tiny stays capped.
    expect(rulerTicks(0, 1e15, 1, { fps: 30 }).ticks.length).toBeLessThanOrEqual(5_000);
  });
});
