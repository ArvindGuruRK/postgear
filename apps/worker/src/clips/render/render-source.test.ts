import type { AssetRow } from '../rows';
import { pickRenderSource, rangesBySource } from './render-source';

function asset(
  id: string,
  kind: AssetRow['kind'],
  meta: unknown,
  createdAt = new Date('2026-11-18T10:00:00Z'),
): AssetRow {
  return { id, kind, key: `k-${id}`, bytes: 1, videoId: 'v', clipId: 'c', meta, createdAt };
}

const proxy = asset('proxy', 'PROXY', { width: 1280, height: 720, fps: 30 });

describe('rangesBySource', () => {
  it('spans every segment of each source', () => {
    const ranges = rangesBySource({
      segments: [
        { source: 'a', sourceIn: 5_000, sourceOut: 9_000 },
        { source: 'b', sourceIn: 1_000, sourceOut: 2_000 },
        { source: 'a', sourceIn: 12_000, sourceOut: 15_000 },
      ] as never,
    });
    expect(ranges.get('a')).toEqual({ fromMs: 5_000, toMs: 15_000 });
    expect(ranges.get('b')).toEqual({ fromMs: 1_000, toMs: 2_000 });
  });
});

describe('pickRenderSource', () => {
  const range = { fromMs: 10_000, toMs: 30_000 };

  it('takes a sharp range that covers the whole clip, with its start as the offset', () => {
    const seg = asset('s1', 'SEGMENT', { fromMs: 8_000, toMs: 32_000, height: 1080, fps: 30 });
    expect(pickRenderSource(range, [seg], proxy)).toEqual({
      asset: seg,
      sharp: true,
      sourceOffsetMs: 8_000,
    });
  });

  it('ignores a range that misses part of the clip, and falls back to the light copy', () => {
    const short = asset('s1', 'SEGMENT', { fromMs: 12_000, toMs: 32_000, height: 1080, fps: 30 });
    expect(pickRenderSource(range, [short], proxy)).toEqual({
      asset: proxy,
      sharp: false,
      sourceOffsetMs: 0,
    });
  });

  it('prefers the sharpest, then the newest', () => {
    const low = asset('low', 'SEGMENT', { fromMs: 0, toMs: 60_000, height: 720, fps: 30 });
    const highOld = asset(
      'old',
      'SEGMENT',
      { fromMs: 0, toMs: 60_000, height: 1080, fps: 30 },
      new Date('2026-11-18T09:00:00Z'),
    );
    const highNew = asset(
      'new',
      'SEGMENT',
      { fromMs: 5_000, toMs: 40_000, height: 1080, fps: 30 },
      new Date('2026-11-18T11:00:00Z'),
    );
    expect(pickRenderSource(range, [low, highNew, highOld], proxy)?.asset.id).toBe('new');
  });

  it('skips a row whose meta is not a range', () => {
    const broken = asset('b', 'SEGMENT', { fromMs: 'x' });
    expect(pickRenderSource(range, [broken], proxy)?.asset.id).toBe('proxy');
  });

  it('answers null with neither', () => {
    expect(pickRenderSource(range, [], null)).toBeNull();
  });
});
