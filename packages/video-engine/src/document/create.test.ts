import { RATIOS } from '../canvas';
import { ClipRangeError, createClipDocument, newId } from './create';
import { CLIP_MAX_MS, CLIP_MIN_MS } from './limits';
import { clipDocumentSchema, idSchema } from './schema';
import { ClipDocumentError } from './upgrade';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';

describe('createClipDocument', () => {
  it.each(RATIOS)('makes a valid %s document', (ratio) => {
    for (const fps of [30, 60] as const) {
      const doc = createClipDocument({ videoId: VIDEO, fromMs: 12_000, toMs: 42_000, ratio, fps });
      expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
      expect(doc.canvas).toMatchObject({ ratio, fps });
      expect(doc.segments).toEqual([
        expect.objectContaining({ sourceIn: 12_000, sourceOut: 42_000, speed: 1, volume: 1 }),
      ]);
      expect(doc.sources).toEqual([{ id: doc.segments[0]?.source, videoId: VIDEO }]);
      expect(doc.layout.kind).toBe('fullscreen');
      expect(doc.layout.areas).toHaveLength(1);
      expect(doc.layout.areas[0]?.frame).toEqual({ x: 0, y: 0, w: 1, h: 1 });
      expect(doc.layout.areas[0]?.crop).toHaveLength(1);
      expect(doc.tracks).toEqual([]);
      expect(doc.zooms).toEqual([]);
      expect(doc.fades).toEqual({ inMs: 0, outMs: 0 });
      expect(doc.looks.colour).toBe('none');
    }
  });

  it('crops a vertical clip from the middle of a 16:9 video', () => {
    const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' });
    const crop = doc.layout.areas[0]?.crop[0]?.rect;
    const w = 9 / 16 / (16 / 9);
    expect(crop?.h).toBe(1);
    expect(crop?.w).toBeCloseTo(w, 10);
    expect(crop?.x).toBeCloseTo((1 - w) / 2, 10);
    expect(crop?.y).toBe(0);
  });

  it('uses the whole picture when the shapes match, and a given video shape', () => {
    const wide = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '16:9' });
    expect(wide.layout.areas[0]?.crop[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const square = createClipDocument({
      videoId: VIDEO,
      fromMs: 0,
      toMs: 10_000,
      ratio: '1:1',
      sourceAspect: 1,
    });
    expect(square.layout.areas[0]?.crop[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('defaults to 30 fps and rounds times to whole milliseconds once', () => {
    const doc = createClipDocument({
      videoId: VIDEO,
      fromMs: 1_000.4,
      toMs: 9_999.6,
      ratio: '4:5',
    });
    expect(doc.canvas.fps).toBe(30);
    expect(doc.segments[0]).toMatchObject({ sourceIn: 1_000, sourceOut: 10_000 });
  });

  it('refuses a range that is not a clip', () => {
    const make = (fromMs: number, toMs: number) => () =>
      createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' });
    expect(make(0, CLIP_MIN_MS - 1)).toThrow(ClipRangeError);
    expect(make(0, CLIP_MAX_MS + 1)).toThrow(ClipRangeError);
    expect(make(5_000, 1_000)).toThrow(ClipRangeError);
    expect(make(-1_000, 5_000)).toThrow(ClipRangeError);
    expect(make(Number.NaN, 5_000)).toThrow(ClipRangeError);
    expect(make(0, Number.POSITIVE_INFINITY)).toThrow(ClipRangeError);
    expect(make(0, CLIP_MIN_MS)).not.toThrow();
    expect(make(0, CLIP_MAX_MS)).not.toThrow();
    try {
      make(0, 1)();
    } catch (error) {
      expect((error as ClipRangeError).code).toBe('clip_range_invalid');
    }
  });

  it('refuses a video id that is not a UUID', () => {
    expect(() =>
      createClipDocument({ videoId: 'not-a-uuid', fromMs: 0, toMs: 5_000, ratio: '9:16' }),
    ).toThrow(ClipDocumentError);
  });
});

describe('newId', () => {
  it('makes ids the schema accepts, unique and prefixed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const id = newId('seg');
      expect(id).toMatch(/^seg_[0-9a-f]{16}$/);
      expect(idSchema.safeParse(id).success).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(2_000);
    expect(newId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a prefix the schema would not accept', () => {
    expect(() => newId('bad prefix')).toThrow(RangeError);
    expect(() => newId('')).toThrow(RangeError);
    expect(() => newId('a'.repeat(17))).toThrow(RangeError);
  });

  describe('without randomUUID', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

    afterEach(() => {
      if (original) {
        Object.defineProperty(globalThis, 'crypto', original);
      }
    });

    it('falls back to getRandomValues, then to a counter', () => {
      const real = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues: real.getRandomValues.bind(real) },
      });
      expect(newId('area')).toMatch(/^area_[0-9a-f]{16}$/);

      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      const ids = new Set(Array.from({ length: 500 }, () => newId('trk')));
      expect(ids.size).toBe(500);
      for (const id of ids) {
        expect(idSchema.safeParse(id).success).toBe(true);
      }
    });
  });
});
