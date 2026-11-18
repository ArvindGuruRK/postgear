import type { ClipDocument, Zoom } from '../document/schema';
import { testDocument, testSegment } from '../render/test-docs';
import {
  addZoom,
  removeZoom,
  setZoomRange,
  setZoomTiming,
  sourceAtOutput,
  updateZoom,
  windowsOfZoom,
  ZOOM_DEFAULT_EASE,
  ZOOM_DEFAULT_SCALE,
  zoomAt,
  zoomEaseName,
  zoomedPoint,
  zoomScaleIn,
  zoomWindows,
} from './zooms';

function zoom(id: string, from: number, to: number, overrides: Partial<Zoom> = {}): Zoom {
  return {
    id,
    source: 'src',
    from,
    to,
    scale: 2,
    focus: { x: 0.5, y: 0.5 },
    ease: 300,
    ...overrides,
  };
}

function withZooms(doc: ClipDocument, zooms: Zoom[]): ClipDocument {
  return { ...doc, zooms };
}

/** Source 10 to 20 s at 1x. */
function oneSegment(): ClipDocument {
  return testDocument([testSegment('a', 10_000, 20_000)]);
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('zoomWindows', () => {
  it('maps a zoom inside one part to clip time', () => {
    const doc = withZooms(oneSegment(), [zoom('z', 12_000, 14_000)]);
    expect(zoomWindows(doc)).toEqual([
      {
        zoomId: 'z',
        piece: 0,
        startMs: 2_000,
        endMs: 4_000,
        easeMs: 300,
        scale: 2,
        focus: { x: 0.5, y: 0.5 },
      },
    ]);
  });

  it('joins a split and a change of speed into one window', () => {
    const split = testDocument([
      testSegment('a', 10_000, 15_000),
      testSegment('b', 15_000, 20_000),
    ]);
    expect(zoomWindows(withZooms(split, [zoom('z', 14_000, 16_000)]))).toMatchObject([
      { startMs: 4_000, endMs: 6_000, piece: 0 },
    ]);

    const faster = testDocument([
      testSegment('a', 10_000, 20_000),
      testSegment('b', 20_000, 30_000, 2),
    ]);
    // 18 to 20 s plays at 1x (2 s), 20 to 24 s at 2x (2 s).
    expect(zoomWindows(withZooms(faster, [zoom('z', 18_000, 24_000)]))).toMatchObject([
      { startMs: 8_000, endMs: 12_000, piece: 0 },
    ]);
  });

  it('makes two windows across a cut, each easing on its own', () => {
    const cut = testDocument([testSegment('a', 10_000, 20_000), testSegment('c', 30_000, 40_000)]);
    expect(zoomWindows(withZooms(cut, [zoom('z', 18_000, 32_000)]))).toMatchObject([
      { startMs: 8_000, endMs: 10_000, piece: 0, easeMs: 300 },
      { startMs: 10_000, endMs: 12_000, piece: 1, easeMs: 300 },
    ]);
  });

  it('follows a moved part, in clip order', () => {
    const moved = testDocument([
      testSegment('b', 20_000, 30_000),
      testSegment('a', 10_000, 20_000),
    ]);
    expect(zoomWindows(withZooms(moved, [zoom('z', 18_000, 22_000)]))).toMatchObject([
      { startMs: 0, endMs: 2_000 },
      { startMs: 18_000, endMs: 20_000 },
    ]);
  });

  it('caps the ease at half a short window, so a zoom over a 4x part does not snap', () => {
    const fast = testDocument([testSegment('a', 10_000, 20_000, 4)]);
    expect(zoomWindows(withZooms(fast, [zoom('z', 12_000, 13_000)]))).toMatchObject([
      { startMs: 500, endMs: 750, easeMs: 125 },
    ]);
  });

  it('shows nothing for a zoom on a stretch that was cut out or on another video', () => {
    const doc = withZooms(oneSegment(), [
      zoom('gone', 50_000, 52_000),
      zoom('other', 12_000, 14_000, { source: 'two' }),
    ]);
    expect(zoomWindows(doc)).toEqual([]);
    expect(windowsOfZoom(doc, 'gone')).toEqual([]);
  });

  it('caches by the zooms and segments arrays', () => {
    const doc = withZooms(oneSegment(), [zoom('z', 12_000, 14_000)]);
    expect(zoomWindows(doc)).toBe(zoomWindows({ ...doc }));
    expect(zoomWindows(doc)).not.toBe(zoomWindows({ ...doc, zooms: [...doc.zooms] }));
  });
});

describe('the zoom curve', () => {
  const window = { startMs: 1_000, endMs: 3_000, easeMs: 300, scale: 2 };

  it('eases in and out with smoothstep and holds between', () => {
    expect(zoomScaleIn(window, 999)).toBe(1);
    expect(zoomScaleIn(window, 1_000)).toBe(1);
    expect(zoomScaleIn(window, 1_150)).toBeCloseTo(1.5, 10);
    expect(zoomScaleIn(window, 1_300)).toBe(2);
    expect(zoomScaleIn(window, 2_000)).toBe(2);
    expect(zoomScaleIn(window, 2_850)).toBeCloseTo(1.5, 10);
    expect(zoomScaleIn(window, 3_000)).toBe(1);
  });

  it('snaps with no ease', () => {
    const snap = { ...window, easeMs: 0 };
    expect(zoomScaleIn(snap, 1_000)).toBe(2);
    expect(zoomScaleIn(snap, 2_999)).toBe(2);
  });

  it('reads the zoom at a clip moment, and none outside it', () => {
    const doc = withZooms(oneSegment(), [
      zoom('z', 12_000, 14_000, { focus: { x: 0.25, y: 0.75 } }),
    ]);
    expect(zoomAt(doc, 3_000)).toEqual({ scale: 2, focus: { x: 0.25, y: 0.75 }, zoomId: 'z' });
    expect(zoomAt(doc, 5_000)).toEqual({ scale: 1, focus: { x: 0.5, y: 0.5 }, zoomId: null });
  });

  it('keeps the focus still and pushes other points away from it', () => {
    const z = { scale: 2, focus: { x: 0.25, y: 0.75 } };
    expect(zoomedPoint({ x: 0.25, y: 0.75 }, z)).toEqual({ x: 0.25, y: 0.75 });
    expect(zoomedPoint({ x: 0.5, y: 0.5 }, z)).toEqual({ x: 0.75, y: 0.25 });
  });

  it('names the nearest ease', () => {
    expect(zoomEaseName(0)).toBe('snap');
    expect(zoomEaseName(100)).toBe('snap');
    expect(zoomEaseName(300)).toBe('smooth');
    expect(zoomEaseName(500)).toBe('smooth');
    expect(zoomEaseName(600)).toBe('slow');
    expect(zoomEaseName(2_000)).toBe('slow');
  });
});

describe('addZoom', () => {
  it('adds two seconds at the playhead, 1.5x, Smooth, on the centre', () => {
    const result = ok(addZoom(oneSegment(), 3_000));
    const added = result.doc.zooms.find((z) => z.id === result.zoomId);
    expect(result.zoomId).toMatch(/^zm/);
    expect(added).toEqual({
      id: result.zoomId,
      source: 'src',
      from: 13_000,
      to: 15_000,
      scale: ZOOM_DEFAULT_SCALE,
      focus: { x: 0.5, y: 0.5 },
      ease: ZOOM_DEFAULT_EASE,
    });
  });

  it('moves earlier near the end of the clip so it still lasts two seconds', () => {
    const result = ok(addZoom(oneSegment(), 9_500));
    expect(result.doc.zooms[0]).toMatchObject({ from: 18_000, to: 20_000 });
  });

  it('lasts two seconds of the clip on a faster part', () => {
    const doc = testDocument([
      testSegment('a', 10_000, 20_000),
      testSegment('b', 20_000, 30_000, 2),
    ]);
    const result = ok(addZoom(doc, 12_000));
    expect(result.doc.zooms[0]).toMatchObject({ from: 24_000, to: 28_000 });
    expect(zoomWindows(result.doc)).toMatchObject([{ startMs: 12_000, endMs: 14_000 }]);
  });

  it('runs on through a split', () => {
    const doc = testDocument([testSegment('a', 10_000, 15_000), testSegment('b', 15_000, 20_000)]);
    expect(ok(addZoom(doc, 4_500)).doc.zooms[0]).toMatchObject({ from: 14_500, to: 16_500 });
  });

  it('refuses inside another zoom, with no room, outside the clip and past the limit', () => {
    const taken = withZooms(oneSegment(), [zoom('z', 12_000, 14_000)]);
    expect(addZoom(taken, 3_000)).toEqual({ ok: false, code: 'zoom_no_room' });
    const squeezed = withZooms(oneSegment(), [
      zoom('a', 11_000, 13_000),
      zoom('b', 13_200, 15_000),
    ]);
    expect(addZoom(squeezed, 3_050)).toEqual({ ok: false, code: 'zoom_no_room' });
    expect(addZoom(oneSegment(), -1)).toEqual({ ok: false, code: 'outside_clip' });
    expect(addZoom(oneSegment(), 10_001)).toEqual({ ok: false, code: 'outside_clip' });
    expect(addZoom(oneSegment(), Number.NaN)).toEqual({ ok: false, code: 'invalid_time' });
    const full = withZooms(
      oneSegment(),
      Array.from({ length: 50 }, (_, k) =>
        zoom(`z${k}`, k * 1_000, k * 1_000 + 500, { source: 'two' }),
      ),
    );
    expect(addZoom(full, 3_000)).toEqual({ ok: false, code: 'too_many_zooms' });
  });

  it('fits beside a zoom that ends just before the playhead', () => {
    const doc = withZooms(oneSegment(), [zoom('z', 11_000, 13_000)]);
    expect(ok(addZoom(doc, 3_000)).doc.zooms[1]).toMatchObject({ from: 13_000, to: 15_000 });
  });
});

describe('updateZoom and removeZoom', () => {
  const doc = withZooms(oneSegment(), [zoom('z', 12_000, 14_000)]);

  it('clamps the amount, the focus and the ease', () => {
    expect(ok(updateZoom(doc, 'z', { scale: 5 })).doc.zooms[0]?.scale).toBe(3);
    expect(ok(updateZoom(doc, 'z', { scale: 1 })).doc.zooms[0]?.scale).toBe(1.1);
    expect(ok(updateZoom(doc, 'z', { scale: 1.234 })).doc.zooms[0]?.scale).toBe(1.23);
    expect(ok(updateZoom(doc, 'z', { focus: { x: 1.5, y: -0.2 } })).doc.zooms[0]?.focus).toEqual({
      x: 1,
      y: 0,
    });
    expect(ok(updateZoom(doc, 'z', { focus: { x: 0.123456, y: 0.5 } })).doc.zooms[0]?.focus.x).toBe(
      0.1235,
    );
    expect(ok(updateZoom(doc, 'z', { ease: 5_000 })).doc.zooms[0]?.ease).toBe(2_000);
  });

  it('gives back the same document when nothing changed', () => {
    expect(ok(updateZoom(doc, 'z', { scale: 2, ease: 300 })).doc).toBe(doc);
  });

  it('refuses an unknown zoom and a number that is not finite', () => {
    expect(updateZoom(doc, 'nope', { scale: 2 })).toEqual({ ok: false, code: 'zoom_not_found' });
    expect(updateZoom(doc, 'z', { scale: Number.NaN })).toEqual({
      ok: false,
      code: 'invalid_time',
    });
    expect(removeZoom(doc, 'nope')).toEqual({ ok: false, code: 'zoom_not_found' });
  });

  it('removes a zoom', () => {
    expect(ok(removeZoom(doc, 'z')).doc.zooms).toEqual([]);
  });
});

describe('setZoomRange and setZoomTiming', () => {
  const doc = withZooms(oneSegment(), [zoom('a', 10_000, 12_000), zoom('b', 15_000, 17_000)]);

  it('moves a zoom up to its neighbour, keeping its length', () => {
    expect(ok(setZoomRange(doc, 'b', 11_000, 13_000)).doc.zooms[1]).toMatchObject({
      from: 12_000,
      to: 14_000,
    });
  });

  it('resizes one end, up to the video the clip knows and down to the shortest zoom', () => {
    expect(ok(setZoomRange(doc, 'b', 15_000, 25_000, 'from')).doc.zooms[1]).toMatchObject({
      from: 15_000,
      to: 20_000,
    });
    expect(ok(setZoomRange(doc, 'b', 16_900, 17_000, 'to')).doc.zooms[1]).toMatchObject({
      from: 16_700,
      to: 17_000,
    });
  });

  it('gives back the same document when the range did not change', () => {
    expect(ok(setZoomRange(doc, 'b', 15_000, 17_000)).doc).toBe(doc);
  });

  it('reads a part end as its own end', () => {
    const cut = testDocument([testSegment('a', 10_000, 20_000), testSegment('c', 30_000, 40_000)]);
    expect(sourceAtOutput(cut, 10_000, 'end')).toEqual({ sourceId: 'src', sourceMs: 20_000 });
    expect(sourceAtOutput(cut, 10_000, 'start')).toEqual({ sourceId: 'src', sourceMs: 30_000 });
  });

  it('moves and resizes by clip time through the speed', () => {
    const faster = withZooms(
      testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 20_000, 30_000, 2)]),
      [zoom('z', 12_000, 14_000)],
    );
    expect(ok(setZoomTiming(faster, 'z', 11_000, 1_000)).doc.zooms[0]).toMatchObject({
      from: 22_000,
      to: 24_000,
    });
    expect(ok(setZoomTiming(faster, 'z', 2_000, 4_000, 'from')).doc.zooms[0]).toMatchObject({
      from: 12_000,
      to: 16_000,
    });
    expect(ok(setZoomTiming(faster, 'z', 1_000, 3_000, 'to')).doc.zooms[0]).toMatchObject({
      from: 11_000,
      to: 14_000,
    });
  });

  it('refuses a move onto another video', () => {
    const two = withZooms(
      testDocument([
        testSegment('a', 10_000, 20_000),
        { ...testSegment('t', 0, 10_000), source: 'two' },
      ]),
      [zoom('z', 12_000, 14_000)],
    );
    expect(setZoomTiming(two, 'z', 12_000, 2_000)).toEqual({ ok: false, code: 'zoom_no_room' });
    expect(setZoomTiming(two, 'nope', 0, 2_000)).toEqual({ ok: false, code: 'zoom_not_found' });
  });
});
