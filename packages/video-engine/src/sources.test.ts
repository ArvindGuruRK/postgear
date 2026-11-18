import {
  documentRange,
  heldRange,
  parseSegmentAssetMeta,
  pickSharpSource,
  rangesBySource,
} from './sources';

interface Row {
  id: string;
  kind: string;
  meta: unknown;
  createdAt: Date;
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 10, minute));
const segment = (id: string, fromMs: number, toMs: number, height: number, minute = 0): Row => ({
  id,
  kind: 'SEGMENT',
  meta: { fromMs, toMs, height, fps: 30 },
  createdAt: at(minute),
});
const proxy = (id: string, minute = 0): Row => ({
  id,
  kind: 'PROXY',
  meta: {},
  createdAt: at(minute),
});

const doc = (parts: Array<[string, number, number]>) => ({
  segments: parts.map(([source, sourceIn, sourceOut]) => ({ source, sourceIn, sourceOut })),
});

describe('parseSegmentAssetMeta', () => {
  it('reads a well-formed meta', () => {
    expect(parseSegmentAssetMeta({ fromMs: 0, toMs: 10, height: 1080, fps: 30 })).toEqual({
      fromMs: 0,
      toMs: 10,
      height: 1080,
      fps: 30,
    });
  });

  it.each([
    null,
    [],
    'x',
    { fromMs: 0, toMs: 10, height: 1080 },
    { fromMs: 10, toMs: 10, height: 1080, fps: 30 },
    { fromMs: -1, toMs: 10, height: 1080, fps: 30 },
    { fromMs: 0, toMs: 10, height: 0, fps: 30 },
    { fromMs: 0, toMs: 10, height: 1080, fps: 0 },
    { fromMs: 0.5, toMs: 10, height: 1080, fps: 30 },
  ])('refuses %p', (meta) => {
    expect(parseSegmentAssetMeta(meta)).toBeNull();
  });
});

describe('ranges', () => {
  it('rangesBySource keeps one range per video', () => {
    const ranges = rangesBySource(
      doc([
        ['a', 5_000, 9_000],
        ['b', 1_000, 2_000],
        ['a', 2_000, 6_000],
      ]) as never,
    );
    expect(ranges.get('a')).toEqual({ fromMs: 2_000, toMs: 9_000 });
    expect(ranges.get('b')).toEqual({ fromMs: 1_000, toMs: 2_000 });
  });

  it('documentRange spans every part, and is null with none', () => {
    expect(
      documentRange(
        doc([
          ['a', 5_000, 9_000],
          ['a', 2_000, 3_000],
        ]) as never,
      ),
    ).toEqual({
      fromMs: 2_000,
      toMs: 9_000,
    });
    expect(documentRange({ segments: [] })).toBeNull();
  });
});

describe('pickSharpSource', () => {
  const range = { fromMs: 10_000, toMs: 30_000 };

  it('takes the covering segment, with its offset', () => {
    const picked = pickSharpSource(range, [proxy('p'), segment('s', 8_000, 32_000, 1080)]);
    expect(picked).toMatchObject({ sharp: true, sourceOffsetMs: 8_000, height: 1080 });
    expect(picked?.asset.id).toBe('s');
  });

  it('prefers the tallest, then the newest', () => {
    const picked = pickSharpSource(range, [
      segment('low', 0, 40_000, 720, 9),
      segment('old', 0, 40_000, 1080, 1),
      segment('new', 0, 40_000, 1080, 5),
    ]);
    expect(picked?.asset.id).toBe('new');
  });

  it('falls back to the newest light copy when no segment covers the range', () => {
    const picked = pickSharpSource(range, [
      segment('short', 12_000, 30_000, 1080),
      { ...segment('broken', 0, 40_000, 1080), meta: { nonsense: true } },
      proxy('older', 1),
      proxy('newer', 2),
    ]);
    expect(picked).toMatchObject({ sharp: false, sourceOffsetMs: 0, height: null });
    expect(picked?.asset.id).toBe('newer');
  });

  it('answers the light copy for a document with no parts, and null with nothing stored', () => {
    expect(pickSharpSource(null, [segment('s', 0, 1, 1080), proxy('p')])?.asset.id).toBe('p');
    expect(pickSharpSource(range, [])).toBeNull();
  });
});

describe('heldRange', () => {
  const range = { fromMs: 20_000, toMs: 40_000 };

  it('answers null with no range or nothing sharp near it', () => {
    expect(heldRange(null, [segment('s', 0, 60_000, 1080)])).toBeNull();
    expect(heldRange(range, [proxy('p')])).toBeNull();
    expect(heldRange(range, [segment('far', 50_000, 70_000, 1080)])).toBeNull();
    expect(heldRange(range, [segment('touching', 40_000, 70_000, 1080)])).toBeNull();
  });

  it('answers the covering SEGMENT, the same one an export reads', () => {
    const rows = [segment('low', 0, 60_000, 720, 5), segment('tall', 10_000, 50_000, 1080, 1)];
    expect(heldRange(range, rows)).toEqual({ fromMs: 10_000, toMs: 50_000 });
  });

  it('answers the SEGMENT sharing the most time when none covers the range', () => {
    const rows = [segment('a', 0, 25_000, 1080, 9), segment('b', 28_000, 39_000, 720, 1)];
    expect(heldRange(range, rows)).toEqual({ fromMs: 28_000, toMs: 39_000 });
  });

  it('breaks an equal share by height, then by the newer row', () => {
    const tall = [segment('a', 0, 30_000, 720, 9), segment('b', 30_000, 60_000, 1080, 1)];
    expect(heldRange(range, tall)).toEqual({ fromMs: 30_000, toMs: 60_000 });
    const newer = [segment('a', 0, 30_000, 1080, 1), segment('b', 30_000, 60_000, 1080, 9)];
    expect(heldRange(range, newer)).toEqual({ fromMs: 30_000, toMs: 60_000 });
  });

  it('skips a SEGMENT whose meta does not read', () => {
    const rows = [{ id: 'bad', kind: 'SEGMENT', meta: { fromMs: 'x' }, createdAt: at(0) }];
    expect(heldRange(range, rows)).toBeNull();
  });
});
