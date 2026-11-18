import { createClipDocument } from '../document/create';
import { CLIP_MAX_MS, ITEM_MIN_MS, SEGMENT_MIN_MS } from '../document/limits';
import {
  type AudioItem,
  type ClipDocument,
  clipDocumentSchema,
  type Segment,
  type StickerItem,
  type TimedItem,
} from '../document/schema';
import { setSpeed, splitAt } from '../time/edits';
import { findItem } from '../time/items';
import { outputDuration, toSource } from '../time/time-map';
import {
  dragMoveItem,
  dragResizeItemEnd,
  dragResizeItemStart,
  dragTrimEnd,
  dragTrimStart,
  type GestureResult,
} from './gestures';
import { snapPoints } from './snap';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const LIBRARY_ITEM = '0b8e7f6a-5d4c-4b3a-8f2e-1d0c9b8a7f6e';
const VIDEO_LENGTH = 600_000;
const HELD = { fromMs: 30_000, toMs: 120_000 };

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
    widthPx: 270,
    heightPx: 270,
    loop: true,
  };
}

function music(id: string, start: number, duration: number): AudioItem {
  return {
    id,
    type: 'music',
    start,
    duration,
    anchor: 'clip',
    ref: { library: 'sound', id: LIBRARY_ITEM },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: true,
  };
}

/**
 * Source 60 s to 90 s of the video, cut at 10 s of the clip: part A plays
 * 60 to 70 s, part B 70 to 90 s. A moment sticker sits on B at 15 s (source
 * 75 s), a short one on A at 2 s, and music (anchored to the clip) at 1 s.
 */
function startDoc(): ClipDocument {
  const base = createClipDocument({ videoId: VIDEO, fromMs: 60_000, toMs: 90_000, ratio: '9:16' });
  const split = splitAt(base, 10_000);
  if (!split.ok) throw new Error(split.code);
  return {
    ...split.doc,
    tracks: [
      {
        id: 'trk_overlay',
        kind: 'overlay',
        items: [sticker('stk_b', 15_000, 2_000), sticker('stk_a', 2_000, 3_000)],
      },
      { id: 'trk_audio', kind: 'audio', items: [music('mus', 1_000, 20_000)] },
    ],
  };
}

function part(doc: ClipDocument, index: number): Segment {
  const segment = doc.segments[index];
  if (!segment) throw new Error(`No part ${index}`);
  return segment;
}

function item(doc: ClipDocument, id: string): TimedItem {
  const found = findItem(doc, id);
  if (!found) throw new Error(`No item ${id}`);
  return found.item;
}

function valid(result: GestureResult): GestureResult {
  const parsed = clipDocumentSchema.safeParse(result.doc);
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.error.issues[0]));
  }
  return result;
}

function trim(doc: ClipDocument, index: number, pointerMs: number, edge: 'start' | 'end') {
  const drag = {
    segmentId: part(doc, index).id,
    pointerMs,
    videoDurationMs: VIDEO_LENGTH,
    held: HELD,
  };
  return valid(edge === 'start' ? dragTrimStart(doc, drag) : dragTrimEnd(doc, drag));
}

describe('dragTrimEnd', () => {
  it('turns the pointer into a source edge and closes the clip up', () => {
    const doc = startDoc();
    const result = trim(doc, 1, 25_000, 'end');
    expect(part(result.doc, 1).sourceOut).toBe(85_000);
    expect(outputDuration(result.doc)).toBe(25_000);
    expect(result.clamped).toBe(false);
    expect(result.needsMoreVideo).toBeUndefined();
  });

  it('brings video back past what we hold and reports it', () => {
    const result = trim(startDoc(), 1, 70_000, 'end');
    expect(part(result.doc, 1).sourceOut).toBe(130_000);
    expect(result.needsMoreVideo).toEqual({ fromMs: 120_000, toMs: 130_000 });
    expect(result.clamped).toBe(false);
  });

  it('stops at the end of the video, at the shortest part and at the neighbour', () => {
    const doc = startDoc();
    const pastEnd = valid(
      dragTrimEnd(doc, { segmentId: part(doc, 1).id, pointerMs: 1e9, videoDurationMs: 100_000 }),
    );
    expect(part(pastEnd.doc, 1).sourceOut).toBe(100_000);
    expect(pastEnd.clamped).toBe(true);

    const shortest = trim(doc, 0, -5_000, 'end');
    expect(part(shortest.doc, 0).sourceOut).toBe(60_000 + SEGMENT_MIN_MS);
    expect(shortest.clamped).toBe(true);

    // A's end cannot run into the video B shows.
    const neighbour = trim(doc, 0, 12_000, 'end');
    expect(part(neighbour.doc, 0).sourceOut).toBe(70_000);
    expect(neighbour.clamped).toBe(true);
  });

  it('stops at the longest clip', () => {
    const base = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 1_790_000, ratio: '9:16' });
    const result = valid(
      dragTrimEnd(base, {
        segmentId: part(base, 0).id,
        pointerMs: 1_900_000,
        videoDurationMs: 3_600_000,
      }),
    );
    expect(outputDuration(result.doc)).toBe(CLIP_MAX_MS);
    expect(result.clamped).toBe(true);
  });

  it('scales the pointer by the speed of the part', () => {
    const doc = startDoc();
    const fast = setSpeed(doc, part(doc, 1).id, 2);
    if (!fast.ok) throw new Error(fast.code);
    // B plays 20 s of video in 10 s: the clip is 20 s long.
    const result = trim(fast.doc, 1, 18_000, 'end');
    expect(part(result.doc, 1).sourceOut).toBe(86_000);
    expect(outputDuration(result.doc)).toBe(18_000);
  });

  it('snaps the edge to the playhead and says so', () => {
    const doc = startDoc();
    const points = snapPoints(doc, { playheadMs: 24_000, exclude: [part(doc, 1).id] });
    const result = valid(
      dragTrimEnd(doc, {
        segmentId: part(doc, 1).id,
        pointerMs: 24_050,
        videoDurationMs: VIDEO_LENGTH,
        snap: { points, pxPerMs: 0.1 },
      }),
    );
    expect(part(result.doc, 1).sourceOut).toBe(84_000);
    expect(result.snappedTo?.kind).toBe('playhead');
    // Snapping off (Alt): the pointer as it is.
    expect(part(trim(doc, 1, 24_050, 'end').doc, 1).sourceOut).toBe(84_050);
  });
});

describe('dragTrimStart', () => {
  it('trims inward and moves the moment sticker with its moment; music stays', () => {
    const doc = startDoc();
    const result = trim(doc, 1, 13_000, 'start');
    expect(part(result.doc, 1).sourceIn).toBe(73_000);
    expect(outputDuration(result.doc)).toBe(27_000);
    // The sticker was on source 75 s, now 2 s into B, which starts at 10 s.
    expect(item(result.doc, 'stk_b').start).toBe(12_000);
    expect(toSource(result.doc, 12_000)?.sourceMs).toBe(75_000);
    expect(item(result.doc, 'mus').start).toBe(1_000);
    expect(item(result.doc, 'stk_a').start).toBe(2_000);
  });

  it('moves a sticker whose moment was trimmed away to the cut', () => {
    const result = trim(startDoc(), 1, 16_000, 'start');
    expect(part(result.doc, 1).sourceIn).toBe(76_000);
    expect(item(result.doc, 'stk_b').start).toBe(10_000);
  });

  it('brings video back outward and reports what we do not hold', () => {
    const doc = startDoc();
    const result = valid(
      dragTrimStart(doc, {
        segmentId: part(doc, 0).id,
        pointerMs: -5_000,
        videoDurationMs: VIDEO_LENGTH,
        held: { fromMs: 58_000, toMs: 120_000 },
      }),
    );
    expect(part(result.doc, 0).sourceIn).toBe(55_000);
    expect(result.needsMoreVideo).toEqual({ fromMs: 55_000, toMs: 58_000 });
    // Clip items keep their place; moment items follow their moments 5 s later.
    expect(item(result.doc, 'mus').start).toBe(1_000);
    expect(item(result.doc, 'stk_a').start).toBe(7_000);
    expect(item(result.doc, 'stk_b').start).toBe(20_000);
  });

  it('stops at the start of the video and at the shortest part', () => {
    const atZero = trim(startDoc(), 0, -1e9, 'start');
    expect(part(atZero.doc, 0).sourceIn).toBe(0);
    expect(atZero.clamped).toBe(true);
    const shortest = trim(startDoc(), 0, 1e9, 'start');
    expect(part(shortest.doc, 0).sourceIn).toBe(70_000 - SEGMENT_MIN_MS);
    expect(shortest.clamped).toBe(true);
  });

  it('works from the start state, so a long drag ends exactly where one step would', () => {
    const doc = startDoc();
    const id = part(doc, 1).id;
    let last: GestureResult | null = null;
    for (let step = 0; step <= 400; step += 1) {
      // A wandering pointer that ends at 13 333.7 ms.
      const pointer = 10_000 + Math.sin(step / 7) * 4_000 + (step / 400) * 3_333.7;
      last = dragTrimStart(doc, {
        segmentId: id,
        pointerMs: pointer,
        videoDurationMs: VIDEO_LENGTH,
      });
    }
    const once = dragTrimStart(doc, {
      segmentId: id,
      pointerMs: 10_000 + Math.sin(400 / 7) * 4_000 + 3_333.7,
      videoDurationMs: VIDEO_LENGTH,
    });
    expect(last?.doc).toEqual(once.doc);
    // Dragging back to where it began gives the start document's numbers.
    const back = dragTrimStart(doc, {
      segmentId: id,
      pointerMs: 10_000,
      videoDurationMs: VIDEO_LENGTH,
    });
    expect(back.doc.segments).toEqual(doc.segments);
    expect(back.doc.tracks).toEqual(doc.tracks);
  });

  it('refuses an unknown part or a pointer that is not a number, keeping the start document', () => {
    const doc = startDoc();
    const unknown = dragTrimStart(doc, { segmentId: 'nope', pointerMs: 0, videoDurationMs: 1 });
    expect(unknown).toMatchObject({ refused: 'segment_not_found', doc });
    const nan = dragTrimEnd(doc, {
      segmentId: part(doc, 0).id,
      pointerMs: Number.NaN,
      videoDurationMs: VIDEO_LENGTH,
    });
    expect(nan).toMatchObject({ refused: 'invalid_time', doc });
    const badVideo = dragTrimEnd(doc, {
      segmentId: part(doc, 0).id,
      pointerMs: 9_000,
      videoDurationMs: Number.NaN,
    });
    expect(badVideo.refused).toBe('invalid_time');
    expect(badVideo.doc).toBe(doc);
  });
});

describe('dragMoveItem', () => {
  it('moves by how far the pointer went, rounding once', () => {
    const doc = startDoc();
    const result = valid(dragMoveItem(doc, { itemId: 'stk_a', grabMs: 3_000, pointerMs: 8_000 }));
    expect(item(result.doc, 'stk_a')).toMatchObject({ start: 7_000, duration: 3_000 });
    expect(result.clamped).toBe(false);
    const rounded = dragMoveItem(doc, { itemId: 'stk_a', grabMs: 3_000, pointerMs: 3_000.6 });
    expect(item(rounded.doc, 'stk_a').start).toBe(2_001);
    // Nothing else moved.
    expect(item(result.doc, 'stk_b')).toBe(item(doc, 'stk_b'));
  });

  it('keeps the item inside the clip', () => {
    const doc = startDoc();
    const right = valid(dragMoveItem(doc, { itemId: 'stk_a', grabMs: 0, pointerMs: 1e9 }));
    expect(item(right.doc, 'stk_a').start).toBe(27_000);
    expect(right.clamped).toBe(true);
    const left = valid(dragMoveItem(doc, { itemId: 'stk_a', grabMs: 0, pointerMs: -1e9 }));
    expect(item(left.doc, 'stk_a').start).toBe(0);
    expect(left.clamped).toBe(true);
  });

  it('snaps whichever edge is nearer a point', () => {
    const doc = startDoc();
    const points = snapPoints(doc, { exclude: ['stk_a'] });
    // The end lands at 9 960, 40 ms from the cut at 10 s.
    const result = dragMoveItem(doc, {
      itemId: 'stk_a',
      grabMs: 3_000,
      pointerMs: 7_960,
      snap: { points, pxPerMs: 0.1 },
    });
    expect(item(result.doc, 'stk_a').start).toBe(7_000);
    expect(result.snappedTo?.kind).toBe('segment');
  });

  it('works from the start state and refuses an unknown item', () => {
    const doc = startDoc();
    for (let pointer = 0; pointer < 20_000; pointer += 777.3) {
      dragMoveItem(doc, { itemId: 'mus', grabMs: 0, pointerMs: pointer });
    }
    expect(item(doc, 'mus').start).toBe(1_000);
    const back = dragMoveItem(doc, { itemId: 'mus', grabMs: 500, pointerMs: 500 });
    expect(back.doc).toBe(doc);
    expect(dragMoveItem(doc, { itemId: 'nope', grabMs: 0, pointerMs: 1 })).toMatchObject({
      refused: 'item_not_found',
      doc,
    });
  });
});

describe('dragResizeItemStart and dragResizeItemEnd', () => {
  it('resizes from either edge, keeping the other where it was', () => {
    const doc = startDoc();
    const start = valid(dragResizeItemStart(doc, { itemId: 'stk_a', pointerMs: 1_000.4 }));
    expect(item(start.doc, 'stk_a')).toMatchObject({ start: 1_000, duration: 4_000 });
    const end = valid(dragResizeItemEnd(doc, { itemId: 'stk_a', pointerMs: 9_000 }));
    expect(item(end.doc, 'stk_a')).toMatchObject({ start: 2_000, duration: 7_000 });
  });

  it('keeps ITEM_MIN_MS and the clip bounds', () => {
    const doc = startDoc();
    const tooFar = valid(dragResizeItemStart(doc, { itemId: 'stk_a', pointerMs: 1e9 }));
    expect(item(tooFar.doc, 'stk_a')).toMatchObject({
      start: 5_000 - ITEM_MIN_MS,
      duration: ITEM_MIN_MS,
    });
    expect(tooFar.clamped).toBe(true);
    const beforeZero = valid(dragResizeItemStart(doc, { itemId: 'stk_a', pointerMs: -50 }));
    expect(item(beforeZero.doc, 'stk_a')).toMatchObject({ start: 0, duration: 5_000 });

    const pastEnd = valid(dragResizeItemEnd(doc, { itemId: 'stk_a', pointerMs: 1e9 }));
    expect(item(pastEnd.doc, 'stk_a')).toMatchObject({ start: 2_000, duration: 28_000 });
    expect(pastEnd.clamped).toBe(true);
    const tooShort = valid(dragResizeItemEnd(doc, { itemId: 'stk_a', pointerMs: 0 }));
    expect(item(tooShort.doc, 'stk_a').duration).toBe(ITEM_MIN_MS);
  });

  it('snaps the dragged edge and refuses nonsense', () => {
    const doc = startDoc();
    const points = snapPoints(doc, { playheadMs: 6_000, exclude: ['stk_a'] });
    const result = dragResizeItemEnd(doc, {
      itemId: 'stk_a',
      pointerMs: 6_070,
      snap: { points, pxPerMs: 0.1 },
    });
    expect(item(result.doc, 'stk_a').duration).toBe(4_000);
    expect(result.snappedTo?.kind).toBe('playhead');
    expect(dragResizeItemEnd(doc, { itemId: 'stk_a', pointerMs: Number.NaN }).refused).toBe(
      'invalid_time',
    );
    expect(dragResizeItemStart(doc, { itemId: 'x', pointerMs: 0 }).refused).toBe('item_not_found');
  });
});
