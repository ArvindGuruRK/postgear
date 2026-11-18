import { SPEEDS } from '../document/limits';
import type { Segment } from '../document/schema';
import {
  frameToMs,
  msToFrame,
  outputDuration,
  placeSegments,
  segmentAt,
  type TimedDocument,
  toOutput,
  toSource,
} from './time-map';

/** A small seeded random source, so a failing case can be replayed. */
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

function seg(
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'] = 1,
  source = 'src_a',
): Segment {
  return { id, source, sourceIn, sourceOut, speed, volume: 1 };
}

/** Parts in rising, non-overlapping source ranges with random speeds, over one or two videos. */
function randomDoc(random: () => number): TimedDocument {
  const count = 1 + Math.floor(random() * 8);
  const segments: Segment[] = [];
  const cursor: Record<string, number> = { src_a: 0, src_b: 0 };
  for (let i = 0; i < count; i += 1) {
    const source = random() < 0.2 ? 'src_b' : 'src_a';
    const speed = SPEEDS[Math.floor(random() * SPEEDS.length)] as Segment['speed'];
    const gap = Math.floor(random() * 5_000);
    const length = Math.ceil(200 * speed) + Math.floor(random() * 20_000);
    const sourceIn = (cursor[source] ?? 0) + gap;
    segments.push(seg(`seg_${i}`, sourceIn, sourceIn + length, speed, source));
    cursor[source] = sourceIn + length;
  }
  return { segments };
}

describe('placeSegments and outputDuration', () => {
  const doc: TimedDocument = {
    segments: [seg('a', 0, 10_000), seg('b', 20_000, 30_000, 2), seg('c', 40_000, 41_000, 0.5)],
  };

  it('places parts end to end with rounded lengths', () => {
    expect(placeSegments(doc).map((p) => [p.outStart, p.outEnd])).toEqual([
      [0, 10_000],
      [10_000, 15_000],
      [15_000, 17_000],
    ]);
    expect(outputDuration(doc)).toBe(17_000);
  });

  it('gives a cut to the part that starts there and the very end to the last part', () => {
    expect(segmentAt(doc, 10_000)?.segment.id).toBe('b');
    expect(segmentAt(doc, 9_999)?.segment.id).toBe('a');
    expect(segmentAt(doc, 17_000)?.segment.id).toBe('c');
    expect(segmentAt(doc, 17_001)).toBeNull();
    expect(segmentAt(doc, -1)).toBeNull();
    expect(segmentAt(doc, Number.NaN)).toBeNull();
  });

  it('maps both ways across speeds', () => {
    expect(toSource(doc, 12_000)).toEqual({ segmentId: 'b', sourceId: 'src_a', sourceMs: 24_000 });
    expect(toOutput(doc, 'src_a', 24_000)).toBe(12_000);
    expect(toOutput(doc, 'src_a', 40_500)).toBe(16_000);
  });

  it('answers null for a moment that was cut out', () => {
    expect(toOutput(doc, 'src_a', 15_000)).toBeNull();
    expect(toOutput(doc, 'src_b', 1_000)).toBeNull();
    expect(toOutput(doc, 'src_a', Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('maps a part end that no part holds to that part end', () => {
    expect(toOutput(doc, 'src_a', 41_000)).toBe(17_000);
  });
});

describe('toSource and toOutput are inverse on kept moments', () => {
  it('holds for random documents (exact at 1x and above, within ceil(1 / speed) below)', () => {
    const random = seeded(20261118);
    for (let run = 0; run < 200; run += 1) {
      const doc = randomDoc(random);
      const total = outputDuration(doc);
      for (let probe = 0; probe < 60; probe += 1) {
        const t = Math.floor(random() * total);
        const moment = toSource(doc, t);
        expect(moment).not.toBeNull();
        if (!moment) {
          continue;
        }
        const back = toOutput(doc, moment.sourceId, moment.sourceMs, moment.segmentId);
        const speed = segmentAt(doc, t)?.segment.speed ?? 1;
        const tolerance = speed >= 1 ? 0 : Math.ceil(1 / speed);
        expect(back).not.toBeNull();
        expect(Math.abs((back ?? Number.NaN) - t)).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('is exact from the video side at 1x', () => {
    const random = seeded(7);
    const doc: TimedDocument = {
      segments: [seg('a', 1_000, 9_000), seg('b', 12_000, 30_000), seg('c', 31_000, 32_000)],
    };
    for (const segment of doc.segments) {
      for (let i = 0; i < 100; i += 1) {
        const ms = segment.sourceIn + Math.floor(random() * (segment.sourceOut - segment.sourceIn));
        const out = toOutput(doc, 'src_a', ms);
        expect(out).not.toBeNull();
        expect(toSource(doc, out ?? 0)?.sourceMs).toBe(ms);
      }
    }
  });

  it('places the sum of part lengths exactly at the clip end', () => {
    const random = seeded(99);
    for (let run = 0; run < 100; run += 1) {
      const doc = randomDoc(random);
      const placed = placeSegments(doc);
      expect(placed[placed.length - 1]?.outEnd).toBe(outputDuration(doc));
    }
  });
});

describe('frames', () => {
  it('turns milliseconds into frames and frames into their start', () => {
    expect(msToFrame(100, 30)).toBe(3);
    expect(msToFrame(99, 30)).toBe(2);
    expect(msToFrame(0, 30)).toBe(0);
    expect(frameToMs(3, 30)).toBe(100);
    for (const fps of [30, 60]) {
      for (let frame = 0; frame < 2_000; frame += 1) {
        // The first whole millisecond inside the frame: never before it, under 1 ms after.
        const exact = (frame * 1000) / fps;
        expect(frameToMs(frame, fps)).toBeGreaterThanOrEqual(exact - 1e-6);
        expect(frameToMs(frame, fps) - exact).toBeLessThan(1);
        // And it lands back on the same frame, exactly.
        expect(msToFrame(frameToMs(frame, fps), fps)).toBe(frame);
      }
    }
  });
});
