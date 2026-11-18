import type { ClipDocument, Zoom } from '../document/schema';
import { testDocument, testSegment } from '../render/test-docs';
import { windowsOfZoom } from '../time/zooms';
import { dragMoveZoom, dragResizeZoomEnd, dragResizeZoomStart } from './gestures';
import { snapPoints } from './snap';

function zoom(id: string, from: number, to: number): Zoom {
  return { id, source: 'src', from, to, scale: 2, focus: { x: 0.5, y: 0.5 }, ease: 300 };
}

/** Source 10 to 20 s at 1x, then 20 to 30 s at 2x, with a zoom at 12 to 14 s and one at 16 to 18 s. */
function doc(): ClipDocument {
  return {
    ...testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 20_000, 30_000, 2)]),
    zooms: [zoom('z', 12_000, 14_000), zoom('y', 16_000, 18_000)],
  };
}

describe('zoom drags', () => {
  it('moves a zoom by the pointer, keeping its length, and stops at its neighbour', () => {
    const start = doc();
    const moved = dragMoveZoom(start, { zoomId: 'z', grabMs: 3_000, pointerMs: 3_500 });
    expect(moved.doc.zooms[0]).toMatchObject({ from: 12_500, to: 14_500 });
    expect(moved.clamped).toBe(false);

    const blocked = dragMoveZoom(start, { zoomId: 'z', grabMs: 3_000, pointerMs: 9_000 });
    expect(blocked.doc.zooms[0]).toMatchObject({ from: 14_000, to: 16_000 });
    expect(blocked.clamped).toBe(true);
  });

  it('moves through a change of speed in the video time', () => {
    const start = doc();
    // The 16 to 18 s zoom dragged 4 s later: its bar starts at 10 s of the clip, which is 20 s of video.
    const moved = dragMoveZoom(start, { zoomId: 'y', grabMs: 6_000, pointerMs: 10_000 });
    expect(moved.doc.zooms[1]).toMatchObject({ from: 20_000, to: 22_000 });
    expect(windowsOfZoom(moved.doc, 'y')).toMatchObject([{ startMs: 10_000, endMs: 11_000 }]);
  });

  it('snaps the dragged edge to the playhead', () => {
    const start = doc();
    const points = snapPoints(start, { playheadMs: 2_600 });
    const moved = dragMoveZoom(start, {
      zoomId: 'z',
      grabMs: 3_000,
      pointerMs: 3_550,
      snap: { points, pxPerMs: 0.1 },
    });
    expect(moved.snappedTo?.kind).toBe('playhead');
    expect(moved.doc.zooms[0]).toMatchObject({ from: 12_600, to: 14_600 });
  });

  it('resizes either end, keeping the other where it is', () => {
    const start = doc();
    expect(
      dragResizeZoomStart(start, { zoomId: 'z', pointerMs: 1_500 }).doc.zooms[0],
    ).toMatchObject({
      from: 11_500,
      to: 14_000,
    });
    expect(dragResizeZoomEnd(start, { zoomId: 'z', pointerMs: 5_000 }).doc.zooms[0]).toMatchObject({
      from: 12_000,
      to: 15_000,
    });
    // Never shorter than the shortest zoom, never over the next one.
    expect(dragResizeZoomEnd(start, { zoomId: 'z', pointerMs: 2_100 }).doc.zooms[0]?.to).toBe(
      12_300,
    );
    const over = dragResizeZoomEnd(start, { zoomId: 'z', pointerMs: 9_000 });
    expect(over.doc.zooms[0]?.to).toBe(16_000);
    expect(over.clamped).toBe(true);
  });

  it('refuses an unknown zoom and a time that is not a number', () => {
    const start = doc();
    expect(dragMoveZoom(start, { zoomId: 'nope', grabMs: 0, pointerMs: 1 }).refused).toBe(
      'zoom_not_found',
    );
    expect(dragResizeZoomEnd(start, { zoomId: 'z', pointerMs: Number.NaN }).refused).toBe(
      'invalid_time',
    );
    expect(dragResizeZoomStart(start, { zoomId: 'z', pointerMs: Number.NaN }).doc).toBe(start);
  });
});
