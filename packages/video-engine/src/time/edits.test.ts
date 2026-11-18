import { createClipDocument } from '../document/create';
import { CLIP_MAX_MS, ITEM_MIN_MS, MAX_SEGMENTS, SEGMENT_MIN_MS, SPEEDS } from '../document/limits';
import {
  type AudioItem,
  type ClipDocument,
  clipDocumentSchema,
  type OverlayItem,
  type Segment,
  type StickerItem,
  segmentOutputMs,
  type TextItem,
  type Zoom,
} from '../document/schema';
import {
  type EditResult,
  removeSegment,
  replaceItems,
  setSpeed,
  splitAt,
  trimSegment,
} from './edits';
import { outputDuration, toOutput } from './time-map';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const LIBRARY_ITEM = '0b8e7f6a-5d4c-4b3a-8f2e-1d0c9b8a7f6e';
const VIDEO_LENGTH = 3_600_000;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sticker(
  id: string,
  start: number,
  duration: number,
  anchor: 'moment' | 'clip' = 'moment',
): StickerItem {
  return {
    id,
    type: 'sticker',
    start,
    duration,
    anchor,
    ref: { library: 'sticker', id: LIBRARY_ITEM },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
  };
}

function text(id: string, start: number, duration: number, anchor: 'moment' | 'clip'): TextItem {
  return {
    id,
    type: 'text',
    start,
    duration,
    anchor,
    text: 'Hello',
    style: {
      font: 'Sora',
      size: 64,
      weight: 600,
      italic: false,
      colour: '#ffffff',
      align: 'center',
      outline: null,
      background: null,
      shadow: false,
      uppercase: false,
    },
    transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0, opacity: 1 },
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

function withItems(
  doc: ClipDocument,
  overlay: OverlayItem[],
  audio: AudioItem[] = [],
): ClipDocument {
  return {
    ...doc,
    tracks: [
      { id: 'trk_overlay', kind: 'overlay', items: overlay },
      { id: 'trk_audio', kind: 'audio', items: audio },
    ],
  };
}

function base(fromMs = 0, toMs = 30_000): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' });
}

function ok(result: EditResult): ClipDocument {
  if (!result.ok) {
    throw new Error(`Edit refused: ${result.code}`);
  }
  return result.doc;
}

function items(doc: ClipDocument): (OverlayItem | AudioItem)[] {
  return doc.tracks.flatMap((track): (OverlayItem | AudioItem)[] =>
    track.kind === 'captions' ? [] : track.items,
  );
}

function item(doc: ClipDocument, id: string): OverlayItem | AudioItem {
  const found = items(doc).find((i) => i.id === id);
  if (!found) {
    throw new Error(`No item ${id}`);
  }
  return found;
}

function firstSource(doc: ClipDocument): string {
  return (doc.sources[0] as { id: string }).id;
}

function segmentAtIndex(doc: ClipDocument, index: number): Segment {
  const segment = doc.segments[index];
  if (!segment) {
    throw new Error(`No segment ${index}`);
  }
  return segment;
}

/** Freezes every object in a document, so an edit that writes into its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** A clip of 0 to 30 s cut into three 10 s parts. */
function threeParts(): ClipDocument {
  const one = ok(splitAt(base(), 10_000));
  return ok(splitAt(one, 20_000));
}

describe('splitAt', () => {
  it('keeps the total length and the time map identity at every speed', () => {
    const random = seeded(42);
    for (const speed of SPEEDS) {
      let doc = base(0, 60_000);
      doc = ok(setSpeed(doc, segmentAtIndex(doc, 0).id, speed));
      for (let i = 0; i < 40; i += 1) {
        const total = outputDuration(doc);
        const result = splitAt(doc, Math.floor(random() * total));
        if (!result.ok) {
          expect(['split_too_close_to_edge', 'too_many_segments']).toContain(result.code);
          continue;
        }
        expect(outputDuration(result.doc)).toBe(total);
        expect(result.doc.segments.length).toBe(doc.segments.length + 1);
        for (const segment of result.doc.segments) {
          expect(segmentOutputMs(segment)).toBeGreaterThanOrEqual(SEGMENT_MIN_MS);
          expect(Number.isInteger(segment.sourceIn) && Number.isInteger(segment.sourceOut)).toBe(
            true,
          );
        }
        expect(clipDocumentSchema.safeParse(result.doc).success).toBe(true);
        doc = result.doc;
      }
    }
  });

  it('cuts at the playhead at 1x and keeps the first id', () => {
    const doc = base(5_000, 35_000);
    const id = segmentAtIndex(doc, 0).id;
    const split = ok(splitAt(doc, 12_345));
    expect(split.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [5_000, 17_345],
      [17_345, 35_000],
    ]);
    expect(segmentAtIndex(split, 0).id).toBe(id);
    expect(segmentAtIndex(split, 1).id).not.toBe(id);
  });

  it('refuses near an edge, on a cut, outside the clip and past the part limit', () => {
    const doc = threeParts();
    expect(splitAt(doc, SEGMENT_MIN_MS - 1)).toEqual({
      ok: false,
      code: 'split_too_close_to_edge',
    });
    expect(splitAt(doc, 10_000 - SEGMENT_MIN_MS + 1)).toEqual({
      ok: false,
      code: 'split_too_close_to_edge',
    });
    expect(splitAt(doc, 10_000)).toEqual({ ok: false, code: 'split_too_close_to_edge' });
    expect(splitAt(doc, 0)).toEqual({ ok: false, code: 'split_too_close_to_edge' });
    expect(splitAt(doc, 30_000)).toEqual({ ok: false, code: 'split_too_close_to_edge' });
    expect(splitAt(doc, 31_000)).toEqual({ ok: false, code: 'outside_clip' });
    expect(splitAt(doc, -5)).toEqual({ ok: false, code: 'outside_clip' });
    expect(splitAt(doc, Number.NaN)).toEqual({ ok: false, code: 'invalid_time' });
    expect(splitAt(doc, SEGMENT_MIN_MS).ok).toBe(true);

    let many = base(0, 600_000);
    for (let i = 1; i < MAX_SEGMENTS; i += 1) {
      many = ok(splitAt(many, i * 1_000));
    }
    expect(many.segments).toHaveLength(MAX_SEGMENTS);
    expect(splitAt(many, 300_000)).toEqual({ ok: false, code: 'too_many_segments' });
  });

  it('moves no item', () => {
    const doc = withItems(
      base(),
      [sticker('st', 4_000, 2_000), text('tx', 15_000, 1_000, 'clip')],
      [music('mu', 0, 30_000)],
    );
    const split = ok(splitAt(doc, 5_000));
    expect(items(split)).toEqual(items(doc));
  });
});

describe('removeSegment', () => {
  it('shortens the clip, leaves crops and zooms alone, and puts items back on their moments', () => {
    const zoom: Zoom = {
      id: 'zm_1',
      source: '',
      from: 22_000,
      to: 24_000,
      scale: 2,
      focus: { x: 0.5, y: 0.5 },
      ease: 300,
    };
    const parts = threeParts();
    const doc = withItems(
      { ...parts, zooms: [{ ...zoom, source: firstSource(parts) }] },
      [
        sticker('after_cut', 25_000, 2_000),
        sticker('in_cut', 15_000, 2_000),
        text('whole', 22_000, 3_000, 'clip'),
      ],
      [music('song', 0, 30_000)],
    );
    const middle = segmentAtIndex(doc, 1).id;
    const removed = ok(removeSegment(doc, middle));

    expect(outputDuration(removed)).toBe(20_000);
    expect(removed.layout).toBe(doc.layout);
    expect(removed.zooms).toBe(doc.zooms);

    // Still on its moment of the video (25 s of video now plays at 15 s).
    expect(item(removed, 'after_cut').start).toBe(15_000);
    expect(toOutput(removed, firstSource(removed), 25_000)).toBe(15_000);
    // Its moment was cut out, so it sits at the cut.
    expect(item(removed, 'in_cut').start).toBe(10_000);
    // Clip items do not move; the song is shortened to the new end.
    expect(item(removed, 'whole').start).toBe(17_000);
    expect(item(removed, 'song')).toMatchObject({ start: 0, duration: 20_000 });
    expect(items(removed)).toHaveLength(items(doc).length);
    expect(clipDocumentSchema.safeParse(removed).success).toBe(true);
  });

  it('refuses the last part and an unknown id', () => {
    const doc = base();
    expect(removeSegment(doc, segmentAtIndex(doc, 0).id)).toEqual({
      ok: false,
      code: 'last_segment',
    });
    expect(removeSegment(threeParts(), 'seg_missing')).toEqual({
      ok: false,
      code: 'segment_not_found',
    });
  });

  it('refuses a result shorter than a clip may be', () => {
    const doc = ok(splitAt(base(0, 4_000), 2_000));
    expect(removeSegment(doc, segmentAtIndex(doc, 0).id)).toEqual({
      ok: false,
      code: 'clip_too_short',
    });
  });
});

describe('setSpeed', () => {
  it('halves a part at 2x and keeps a moment item on its moment', () => {
    const halves = ok(splitAt(base(0, 20_000), 10_000));
    const doc = withItems(halves, [sticker('late', 16_000, 1_000), sticker('early', 2_000, 1_000)]);
    const fast = ok(setSpeed(doc, segmentAtIndex(doc, 1).id, 2));
    expect(segmentOutputMs(segmentAtIndex(fast, 1))).toBe(5_000);
    expect(outputDuration(fast)).toBe(15_000);
    expect(item(fast, 'late').start).toBe(13_000);
    expect(item(fast, 'early').start).toBe(2_000);
  });

  it('refuses a speed that is not offered and lengths out of range', () => {
    const doc = base(0, 4_000);
    const id = segmentAtIndex(doc, 0).id;
    expect(setSpeed(doc, id, 3)).toEqual({ ok: false, code: 'speed_not_allowed' });
    expect(setSpeed(doc, id, Number.NaN)).toEqual({ ok: false, code: 'speed_not_allowed' });
    expect(setSpeed(doc, id, 2)).toEqual({ ok: false, code: 'clip_too_short' });
    expect(setSpeed(doc, 'nope', 2)).toEqual({ ok: false, code: 'segment_not_found' });
    const long = base(0, CLIP_MAX_MS);
    expect(setSpeed(long, segmentAtIndex(long, 0).id, 0.5)).toEqual({
      ok: false,
      code: 'clip_too_long',
    });
  });
});

describe('trimSegment', () => {
  it('trims inward and stops at the shortest part and the shortest clip', () => {
    const doc = threeParts();
    const first = segmentAtIndex(doc, 0);
    const trimmed = ok(
      trimSegment(doc, {
        segmentId: first.id,
        edge: 'end',
        sourceMs: 9_950,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(segmentAtIndex(trimmed, 0).sourceOut).toBe(9_950);

    const tiny = ok(
      trimSegment(doc, {
        segmentId: first.id,
        edge: 'end',
        sourceMs: 50,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(segmentOutputMs(segmentAtIndex(tiny, 0))).toBe(SEGMENT_MIN_MS);

    const single = base(0, 10_000);
    const shortest = ok(
      trimSegment(single, {
        segmentId: segmentAtIndex(single, 0).id,
        edge: 'start',
        sourceMs: 9_999,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(outputDuration(shortest)).toBe(3_000);
    expect(segmentAtIndex(shortest, 0).sourceIn).toBe(7_000);
  });

  it('stops at the neighbour, the start and the end of the video', () => {
    const doc = threeParts();
    const first = segmentAtIndex(doc, 0);
    const into = ok(
      trimSegment(doc, {
        segmentId: first.id,
        edge: 'end',
        sourceMs: 15_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(segmentAtIndex(into, 0).sourceOut).toBe(10_000);

    const late = base(100_000, 130_000);
    const id = segmentAtIndex(late, 0).id;
    const back = ok(
      trimSegment(late, {
        segmentId: id,
        edge: 'start',
        sourceMs: -50_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(segmentAtIndex(back, 0).sourceIn).toBe(0);
    const past = ok(
      trimSegment(late, {
        segmentId: id,
        edge: 'end',
        sourceMs: 140_000,
        videoDurationMs: 135_500,
      }),
    );
    expect(segmentAtIndex(past, 0).sourceOut).toBe(135_500);
  });

  it('stops at the longest clip', () => {
    const doc = base(0, CLIP_MAX_MS - 1_000);
    const id = segmentAtIndex(doc, 0).id;
    const longest = ok(
      trimSegment(doc, {
        segmentId: id,
        edge: 'end',
        sourceMs: CLIP_MAX_MS + 60_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(outputDuration(longest)).toBe(CLIP_MAX_MS);
  });

  it('reports video we do not hold yet', () => {
    const doc = base(60_000, 90_000);
    const id = segmentAtIndex(doc, 0).id;
    const held = { fromMs: 30_000, toMs: 120_000 };
    const inside = trimSegment(doc, {
      segmentId: id,
      edge: 'end',
      sourceMs: 110_000,
      videoDurationMs: VIDEO_LENGTH,
      held,
    });
    expect(inside.ok && inside.needsMoreVideo).toBe(undefined);

    const later = trimSegment(doc, {
      segmentId: id,
      edge: 'end',
      sourceMs: 130_000,
      videoDurationMs: VIDEO_LENGTH,
      held,
    });
    expect(later.ok && later.needsMoreVideo).toEqual({ fromMs: 120_000, toMs: 130_000 });

    const earlier = trimSegment(doc, {
      segmentId: id,
      edge: 'start',
      sourceMs: 10_000,
      videoDurationMs: VIDEO_LENGTH,
      held,
    });
    expect(earlier.ok && earlier.needsMoreVideo).toEqual({ fromMs: 10_000, toMs: 30_000 });
  });

  it('refuses bad input', () => {
    const doc = base();
    const id = segmentAtIndex(doc, 0).id;
    expect(
      trimSegment(doc, {
        segmentId: id,
        edge: 'end',
        sourceMs: Number.NaN,
        videoDurationMs: VIDEO_LENGTH,
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_time',
    });
    expect(
      trimSegment(doc, { segmentId: id, edge: 'end', sourceMs: 1_000, videoDurationMs: 0 }),
    ).toEqual({
      ok: false,
      code: 'invalid_time',
    });
    expect(
      trimSegment(doc, {
        segmentId: 'nope',
        edge: 'end',
        sourceMs: 1_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    ).toEqual({
      ok: false,
      code: 'segment_not_found',
    });
  });

  it('snaps a moment item to the cut when its moment is trimmed away, and fits items in the end', () => {
    const doc = withItems(base(0, 30_000), [
      sticker('near_start', 1_000, 2_000),
      sticker('near_end', 28_000, 1_500),
      text('long', 0, 30_000, 'clip'),
    ]);
    const id = segmentAtIndex(doc, 0).id;
    const fromStart = ok(
      trimSegment(doc, {
        segmentId: id,
        edge: 'start',
        sourceMs: 5_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    expect(item(fromStart, 'near_start').start).toBe(0);
    expect(item(fromStart, 'near_end').start).toBe(23_000);

    const fromEnd = ok(
      trimSegment(doc, {
        segmentId: id,
        edge: 'end',
        sourceMs: 20_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    // Its moment is gone and nothing follows, so it is moved back to fit at the end.
    expect(item(fromEnd, 'near_end')).toMatchObject({ start: 18_500, duration: 1_500 });
    expect(item(fromEnd, 'long')).toMatchObject({ start: 0, duration: 20_000 });
  });
});

describe('every edit', () => {
  it('never changes its input', () => {
    const doc = deepFreeze(
      withItems(
        threeParts(),
        [sticker('st', 12_000, 2_000), text('tx', 25_000, 4_000, 'clip')],
        [music('mu', 0, 30_000)],
      ),
    );
    const snapshot = JSON.stringify(doc);
    const [a, b] = [segmentAtIndex(doc, 0), segmentAtIndex(doc, 1)];
    ok(splitAt(doc, 5_000));
    ok(removeSegment(doc, b.id));
    ok(setSpeed(doc, a.id, 2));
    ok(
      trimSegment(doc, {
        segmentId: a.id,
        edge: 'start',
        sourceMs: 2_000,
        videoDurationMs: VIDEO_LENGTH,
      }),
    );
    replaceItems(doc, { ...doc, segments: doc.segments.slice(1) });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('never deletes an item and always leaves a valid document', () => {
    const random = seeded(123);
    for (let run = 0; run < 30; run += 1) {
      let doc = withItems(
        base(0, 60_000),
        [
          sticker('s1', 1_000, 3_000),
          sticker('s2', 30_000, 5_000),
          text('t1', 50_000, 9_000, 'moment'),
          text('t2', 10_000, 40_000, 'clip'),
        ],
        [music('m1', 0, 60_000)],
      );
      const count = items(doc).length;
      for (let step = 0; step < 25; step += 1) {
        const total = outputDuration(doc);
        const segment = segmentAtIndex(doc, Math.floor(random() * doc.segments.length));
        const roll = random();
        let result: EditResult;
        if (roll < 0.35) {
          result = splitAt(doc, Math.floor(random() * total));
        } else if (roll < 0.55) {
          result = removeSegment(doc, segment.id);
        } else if (roll < 0.75) {
          result = setSpeed(
            doc,
            segment.id,
            SPEEDS[Math.floor(random() * SPEEDS.length)] as number,
          );
        } else {
          result = trimSegment(doc, {
            segmentId: segment.id,
            edge: random() < 0.5 ? 'start' : 'end',
            sourceMs: Math.floor(random() * 90_000),
            videoDurationMs: 90_000,
          });
        }
        if (!result.ok) {
          continue;
        }
        doc = result.doc;
        const after = outputDuration(doc);
        expect(items(doc)).toHaveLength(count);
        for (const each of items(doc)) {
          expect(each.start).toBeGreaterThanOrEqual(0);
          expect(each.duration).toBeGreaterThanOrEqual(ITEM_MIN_MS);
          expect(each.start + each.duration).toBeLessThanOrEqual(after);
          expect(Number.isInteger(each.start) && Number.isInteger(each.duration)).toBe(true);
        }
        const parsed = clipDocumentSchema.safeParse(doc);
        expect(parsed.success).toBe(true);
      }
    }
  });

  it('does not drift an item inside a slow part over many edits', () => {
    const halves = ok(splitAt(base(0, 40_000), 20_000));
    // The first part plays at a quarter speed: 20 s of video become 80 s of clip.
    const quarter = ok(setSpeed(halves, segmentAtIndex(halves, 0).id, 0.25));
    let doc = withItems(quarter, [sticker('st', 1_001, 500)]);
    for (let i = 0; i < 10; i += 1) {
      const total = outputDuration(doc);
      const result = splitAt(doc, total - 1_000 - i * 300);
      doc = ok(result);
    }
    expect(item(doc, 'st').start).toBe(1_001);
  });
});
