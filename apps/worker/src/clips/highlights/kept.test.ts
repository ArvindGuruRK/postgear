import { createClipDocument } from '@postgear/video-engine';
import { KEPT_COVER_SHARE, storedRange, withoutKept } from './kept';

const VIDEO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pick = (fromMs: number, toMs: number) => ({ id: `${fromMs}`, range: { fromMs, toMs } });

describe('storedRange', () => {
  it('reads a stored document, edited or not, and nothing from one that does not read', () => {
    const document = createClipDocument({
      videoId: VIDEO,
      fromMs: 40_000,
      toMs: 70_000,
      ratio: '9:16',
    });
    expect(storedRange(document)).toEqual({ fromMs: 40_000, toMs: 70_000 });
    expect(storedRange(null)).toBeNull();
    expect(storedRange({ segments: 'no' })).toBeNull();
    expect(storedRange({ segments: [{ sourceIn: 'a', sourceOut: 3 }] })).toBeNull();
  });
});

describe('withoutKept', () => {
  it('leaves out a pick a kept clip covers by half or more, in order', () => {
    const picks = [pick(0, 30_000), pick(60_000, 90_000), pick(120_000, 150_000)];
    expect(KEPT_COVER_SHARE).toBe(0.5);
    // The first is covered by exactly half, the second by a sliver, the third not at all.
    const kept = [{ fromMs: 15_000, toMs: 60_000 }, { fromMs: 85_000, toMs: 100_000 }, null];
    expect(withoutKept(picks, kept).map((one) => one.id)).toEqual(['60000', '120000']);
  });

  it('keeps everything when nobody kept a clip', () => {
    const picks = [pick(0, 30_000), pick(60_000, 90_000)];
    expect(withoutKept(picks, [])).toEqual(picks);
  });

  it('a trimmed kept clip still covers the moment it was cut from', () => {
    expect(withoutKept([pick(43_500, 79_000)], [{ fromMs: 55_000, toMs: 75_000 }])).toEqual([]);
  });
});
