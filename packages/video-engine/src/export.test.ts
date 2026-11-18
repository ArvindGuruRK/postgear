import type { Ratio } from './canvas';
import { createClipDocument } from './document';
import {
  allowedQualities,
  bestAllowedQuality,
  documentFingerprint,
  estimateBytes,
  exportPlan,
  fitsBitrate,
  formatBytes,
  isSixtyFps,
  qualityLockedSentence,
  shapeLabel,
} from './export';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const doc = (ratio: Ratio = '9:16') =>
  createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 20_000, ratio });

describe('exportPlan', () => {
  it.each([
    ['9:16', '720p', 720, 1280, 30, 5_000],
    ['9:16', '1080p60', 1080, 1920, 60, 12_000],
    ['16:9', '720p60', 1280, 720, 60, 8_000],
    ['1:1', '1080p', 1080, 1080, 30, 8_000],
    ['4:5', '720p', 720, 900, 30, 5_000],
    ['4:5', '1080p', 1080, 1350, 30, 8_000],
  ] as const)(
    '%s at %s is %i by %i, %i fps, %i kbit/s at most',
    (ratio, quality, w, h, fps, kbps) => {
      expect(exportPlan(doc(ratio), quality)).toEqual({
        width: w,
        height: h,
        fps,
        maxrateKbps: kbps,
      });
    },
  );

  it('says which tiles are 60 fps', () => {
    expect(isSixtyFps('720p60')).toBe(true);
    expect(isSixtyFps('1080p')).toBe(false);
  });
});

describe('the plan lock', () => {
  it('allows the tiles at or below the plan value, by the ladder order', () => {
    expect(allowedQualities('720p')).toEqual(['720p']);
    expect(allowedQualities('1080p')).toEqual(['720p', '720p60', '1080p']);
    expect(allowedQualities('1080p60')).toEqual(['720p', '720p60', '1080p', '1080p60']);
    // 4K is reserved: a plan naming it allows nothing here until it has a tile.
    expect(allowedQualities('4k')).toEqual([]);
    expect(allowedQualities(null)).toEqual([]);
  });

  it('preselects the best allowed tile, and says why a locked one is locked', () => {
    expect(bestAllowedQuality('1080p')).toBe('1080p');
    expect(bestAllowedQuality(undefined)).toBe('720p');
    expect(qualityLockedSentence('1080p60')).toBe('1080p 60 fps export needs a higher plan.');
  });
});

describe('the summary', () => {
  it('guesses the size from 60% of the peak bitrate plus the sound', () => {
    // 1080p: 8000 * 0.6 + 128 = 4928 kbit/s; 42 s is 25.872 MB.
    expect(estimateBytes('1080p', 42_000)).toBe(25_872_000);
    expect(estimateBytes('720p', 0)).toBe(0);
  });

  it('reads sizes and shapes in plain words', () => {
    expect(formatBytes(25_872_000)).toBe('26 MB');
    expect(formatBytes(3_240_000)).toBe('3.2 MB');
    expect(formatBytes(800_000)).toBe('800 KB');
    expect(shapeLabel(doc('9:16'))).toBe('Vertical 9:16');
    expect(shapeLabel(doc('4:5'))).toBe('Portrait 4:5');
  });

  it('finds the bitrate that keeps a long clip under a size cap', () => {
    // 300 MB over 10 minutes is 4000 kbit/s in all, 3872 of it for the picture.
    expect(fitsBitrate(600_000, 300_000_000)).toBe(3_872);
    expect(fitsBitrate(3_600_000, 10_000_000)).toBeNull();
  });
});

describe('documentFingerprint', () => {
  it('is stable across key order', () => {
    const one = doc();
    // The same document with every object's keys written in the opposite order.
    const reverse = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverse);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, inner]) => [key, reverse(inner)]),
      );
    };
    const reordered = reverse(one) as typeof one;
    expect(Object.keys(reordered)).toEqual(Object.keys(one).reverse());
    expect(documentFingerprint(reordered)).toBe(documentFingerprint(one));
    expect(documentFingerprint(one)).toMatch(/^v1-[0-9a-f]{28}$/);
  });

  it('changes with any change to the picture or the sound', () => {
    const one = doc();
    const moved = {
      ...one,
      segments: one.segments.map((segment) => ({ ...segment, volume: 0.5 })),
    };
    expect(documentFingerprint(moved)).not.toBe(documentFingerprint(one));
    expect(documentFingerprint(doc('1:1'))).not.toBe(documentFingerprint(one));
  });

  it('ignores the editor-only meta', () => {
    const one = doc();
    expect(documentFingerprint({ ...one, meta: { shapeChosen: true } })).toBe(
      documentFingerprint(one),
    );
  });
});
