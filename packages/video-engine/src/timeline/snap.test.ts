import { createClipDocument } from '../document/create';
import type { ClipDocument, StickerItem } from '../document/schema';
import { splitAt } from '../time/edits';
import { resolveSnap, SNAP_PX, type SnapPoint, snapPoints } from './snap';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const LIBRARY_ITEM = '0b8e7f6a-5d4c-4b3a-8f2e-1d0c9b8a7f6e';

function sticker(id: string, start: number, duration: number): StickerItem {
  return {
    id,
    type: 'sticker',
    start,
    duration,
    anchor: 'moment',
    ref: { library: 'sticker', id: LIBRARY_ITEM },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
  };
}

/** A 30 s clip cut at 10 s and 20 s, with two stickers. */
function doc(): ClipDocument {
  let d = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
  for (const at of [10_000, 20_000]) {
    const result = splitAt(d, at);
    if (!result.ok) throw new Error(result.code);
    d = result.doc;
  }
  return {
    ...d,
    tracks: [
      {
        id: 'trk_overlay',
        kind: 'overlay',
        items: [sticker('stk_a', 2_000, 3_000), sticker('stk_b', 12_500, 1_000)],
      },
    ],
  };
}

function ids(d: ClipDocument): string[] {
  return d.segments.map((s) => s.id);
}

describe('snapPoints', () => {
  it('lists the playhead, the clip ends, the cuts and every item edge, in time order', () => {
    const d = doc();
    const points = snapPoints(d, { playheadMs: 12_500 });
    expect(points.map((p) => [p.ms, p.kind])).toEqual([
      [0, 'start'],
      [2_000, 'item'],
      [5_000, 'item'],
      [10_000, 'segment'],
      [12_500, 'playhead'],
      [12_500, 'item'],
      [13_500, 'item'],
      [20_000, 'segment'],
      [30_000, 'end'],
    ]);
    expect(points.find((p) => p.ms === 10_000)?.id).toBe(ids(d)[1]);
  });

  it('leaves out the dragged part and item, and the clip end of the last part', () => {
    const d = doc();
    const [first, middle, last] = ids(d) as [string, string, string];
    const noMiddle = snapPoints(d, { exclude: [middle] }).map((p) => p.kind);
    expect(noMiddle).not.toContain('segment');
    expect(noMiddle).toContain('start');
    expect(noMiddle).toContain('end');

    const noFirst = snapPoints(d, { exclude: [first] });
    expect(noFirst.some((p) => p.kind === 'start')).toBe(false);
    expect(noFirst.filter((p) => p.kind === 'segment').map((p) => p.ms)).toEqual([20_000]);

    expect(snapPoints(d, { exclude: [last] }).some((p) => p.kind === 'end')).toBe(false);
    expect(snapPoints(d, { exclude: ['stk_a'] }).some((p) => p.id === 'stk_a')).toBe(false);
  });

  it('skips a playhead that is not a number', () => {
    expect(snapPoints(doc(), { playheadMs: Number.NaN }).some((p) => p.kind === 'playhead')).toBe(
      false,
    );
  });
});

describe('resolveSnap', () => {
  const points: SnapPoint[] = [
    { ms: 1_000, kind: 'item', id: 'a' },
    { ms: 1_000, kind: 'playhead' },
    { ms: 1_100, kind: 'segment', id: 's' },
    { ms: 5_000, kind: 'end' },
  ];

  it('snaps inside the tolerance and reports the point', () => {
    // 8 px at 0.1 px/ms is 80 ms.
    const result = resolveSnap(4_930, points, SNAP_PX, 0.1);
    expect(result).toEqual({ ms: 5_000, snappedTo: { ms: 5_000, kind: 'end' } });
    expect(resolveSnap(4_920, points, SNAP_PX, 0.1).ms).toBe(5_000);
  });

  it('leaves the time alone outside the tolerance', () => {
    expect(resolveSnap(4_919, points, SNAP_PX, 0.1)).toEqual({ ms: 4_919, snappedTo: null });
    // The same distance snaps when zoomed out (8 px is 800 ms at 0.01 px/ms).
    expect(resolveSnap(4_500, points, SNAP_PX, 0.01).ms).toBe(5_000);
  });

  it('picks the nearest, and the playhead on a tie', () => {
    expect(resolveSnap(1_060, points, SNAP_PX, 0.1).snappedTo?.kind).toBe('segment');
    expect(resolveSnap(1_040, points, SNAP_PX, 0.1).snappedTo?.kind).toBe('playhead');
    expect(resolveSnap(1_000, points, SNAP_PX, 0.1).snappedTo?.kind).toBe('playhead');
  });

  it('does not snap without a usable scale, and reads a nonsense time as 0', () => {
    expect(resolveSnap(4_990, points, SNAP_PX, 0)).toEqual({ ms: 4_990, snappedTo: null });
    expect(resolveSnap(4_990, points, Number.NaN, 0.1)).toEqual({ ms: 4_990, snappedTo: null });
    expect(resolveSnap(Number.NaN, points, SNAP_PX, 0.1)).toEqual({ ms: 0, snappedTo: null });
    expect(resolveSnap(10, [], SNAP_PX, 0.1)).toEqual({ ms: 10, snappedTo: null });
  });
});
