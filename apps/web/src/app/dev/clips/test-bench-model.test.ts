import {
  benchClipRange,
  CLIP_LENGTH_MS,
  compareMoments,
  formatMoment,
  SAMPLE_LINKS,
} from './test-bench-model';

describe('benchClipRange', () => {
  it('starts 30 seconds in when the video is long enough', () => {
    expect(benchClipRange(600_000)).toEqual({ fromMs: 30_000, toMs: 50_000 });
  });

  it('starts earlier on a short video, so the clip still fits', () => {
    expect(benchClipRange(35_000)).toEqual({ fromMs: 15_000, toMs: 35_000 });
    expect(benchClipRange(CLIP_LENGTH_MS)).toEqual({ fromMs: 0, toMs: CLIP_LENGTH_MS });
  });

  it('is null when the video is shorter than the clip or its length is unknown', () => {
    expect(benchClipRange(19_999)).toBeNull();
    expect(benchClipRange(null)).toBeNull();
    expect(benchClipRange(Number.NaN)).toBeNull();
  });
});

describe('compareMoments', () => {
  it('gives the five moments of a 20 second clip', () => {
    expect(compareMoments(20_000).map((moment) => moment.atMs)).toEqual([
      0, 5_000, 10_000, 15_000, 19_000,
    ]);
  });

  it('never goes below zero on a very short clip', () => {
    expect(compareMoments(500).at(-1)?.atMs).toBe(0);
  });

  it('names every moment in Title Case', () => {
    for (const moment of compareMoments(20_000)) {
      expect(moment.label).toMatch(/^([A-Z][a-z]*)( [A-Z][a-z]*)*$/);
    }
  });
});

describe('formatMoment', () => {
  it('reads minutes, seconds and tenths', () => {
    expect(formatMoment(0)).toBe('0:00.0');
    expect(formatMoment(19_050)).toBe('0:19.0');
    expect(formatMoment(65_400)).toBe('1:05.4');
    expect(formatMoment(-5)).toBe('0:00.0');
  });
});

describe('SAMPLE_LINKS', () => {
  it('holds the three good simulation links, once each', () => {
    expect(new Set(SAMPLE_LINKS.map((sample) => sample.url)).size).toBe(3);
  });
});
