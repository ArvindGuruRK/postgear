import {
  type AudioItem,
  type ClipDocument,
  createClipDocument,
  outputDuration,
  type StickerItem,
  type TextItem,
  type Zoom,
} from '@postgear/video-engine';
import {
  edgeFrameMs,
  itemLabel,
  LAST_PART_SENTENCE,
  missingRange,
  nudgeItem,
  packLanes,
  partHatch,
  partLabel,
  readSnapping,
  removeProblem,
  removeSelection,
  SNAP_STORAGE_KEY,
  SPLIT_EDGE_SENTENCE,
  SPLIT_LIMIT_SENTENCE,
  spokenTime,
  splitAtPlayhead,
  tabForSelection,
  timelineRows,
  trimShiftMs,
  writeSnapping,
  zoomSpans,
} from './timeline-model';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const LIBRARY_ITEM = '22222222-2222-4222-8222-222222222222';
const TRANSFORM = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

/** A 30 s clip from 10 s to 40 s of the video. */
function clip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
}

function text(id: string, start: number, duration: number, words = 'HE REALLY DID THAT'): TextItem {
  return {
    id,
    type: 'text',
    start,
    duration,
    anchor: 'moment',
    text: words,
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
    transform: TRANSFORM,
  };
}

function sticker(id: string, start: number, duration: number): StickerItem {
  return {
    id,
    type: 'sticker',
    start,
    duration,
    anchor: 'moment',
    ref: { library: 'sticker', id: LIBRARY_ITEM },
    transform: TRANSFORM,
    flipX: false,
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

function withTracks(
  doc: ClipDocument,
  overlay: (TextItem | StickerItem)[],
  sounds: AudioItem[] = [],
): ClipDocument {
  return {
    ...doc,
    tracks: [
      { id: 'trk_overlay', kind: 'overlay', items: overlay },
      { id: 'trk_audio', kind: 'audio', items: sounds },
    ],
  };
}

function zoom(id: string, from: number, to: number, doc: ClipDocument): Zoom {
  return {
    id,
    source: doc.sources[0].id,
    from,
    to,
    scale: 1.5,
    focus: { x: 0.5, y: 0.5 },
    ease: 300,
  };
}

/** The clip split at 10 s of its own time: two parts of 10 s and 20 s. */
function twoParts(): ClipDocument {
  const result = splitAtPlayhead(clip(), 10_000);
  if (!result.ok) throw new Error(result.sentence);
  return result.doc;
}

describe('spokenTime', () => {
  it.each([
    [0, '0 seconds'],
    [1_000, '1 second'],
    [4_500, '4.5 seconds'],
    [12_000, '12 seconds'],
    [59_940, '59.9 seconds'],
    [59_960, '1 minute'],
    [64_000, '1 minute 4 seconds'],
    [120_000, '2 minutes'],
    [3_720_000, '1 hour 2 minutes'],
    [Number.NaN, '0 seconds'],
  ])('says %d ms as "%s"', (ms, words) => {
    expect(spokenTime(ms)).toBe(words);
  });
});

describe('labels', () => {
  it('names a part, with its speed when it is not 1x', () => {
    expect(partLabel(1, 12_000, 20_000, 1)).toBe('Part 2, from 12 seconds, 8 seconds long');
    expect(partLabel(0, 0, 4_000, 2)).toBe('Part 1, from 0 seconds, 4 seconds long, 2x speed');
  });

  it('names an item by its words or its kind', () => {
    expect(itemLabel(text('t', 4_000, 3_000))).toBe(
      'Text, HE REALLY DID THAT, from 4 seconds, 3 seconds long',
    );
    expect(itemLabel(sticker('s', 0, 1_500))).toBe('Sticker, from 0 seconds, 1.5 seconds long');
    expect(itemLabel(music('m', 0, 30_000))).toBe('Music, from 0 seconds, 30 seconds long');
  });
});

describe('packLanes', () => {
  const bar = (startMs: number, endMs: number) => ({ startMs, endMs });

  it('always answers one row, even with nothing on it', () => {
    expect(packLanes([])).toEqual([[]]);
  });

  it('keeps bars that only touch on one row', () => {
    expect(packLanes([bar(0, 5), bar(5, 9)])).toEqual([[bar(0, 5), bar(5, 9)]]);
  });

  it('puts an overlapping bar on a second row, and reuses the first row once it is free', () => {
    const lanes = packLanes([bar(0, 10), bar(4, 6), bar(12, 14), bar(5, 13)]);
    expect(lanes).toEqual([[bar(0, 10), bar(12, 14)], [bar(4, 6)], [bar(5, 13)]]);
  });
});

describe('timelineRows', () => {
  it('shows an empty Overlay, Zoom and Sound row for a clip with nothing on it', () => {
    const rows = timelineRows(clip());
    expect(rows.map((row) => [row.label, row.bars.length])).toEqual([
      ['Overlay', 0],
      ['Zoom', 0],
      ['Sound', 0],
    ]);
  });

  it('opens a second Overlay row when two overlays overlap in time', () => {
    const doc = withTracks(
      clip(),
      [text('t1', 0, 5_000), sticker('s1', 3_000, 2_000)],
      [music('m1', 0, 30_000)],
    );
    const rows = timelineRows(doc);
    expect(rows.map((row) => row.label)).toEqual(['Overlay', 'Overlay 2', 'Zoom', 'Sound']);
    expect(rows[0].bars.map((bar) => bar.selection)).toEqual([{ kind: 'item', id: 't1' }]);
    expect(rows[1].bars[0]).toMatchObject({ name: 'Sticker', startMs: 3_000, endMs: 5_000 });
    expect(rows[3].bars[0]).toMatchObject({ name: 'Music', movable: true });
  });

  it('draws a zoom where its video plays, once per part, joined across a plain cut', () => {
    const doc = twoParts();
    const placedZoom = zoom('z1', 15_000, 25_000, doc);
    const rows = timelineRows({ ...doc, zooms: [placedZoom] });
    const zoomRow = rows.find((row) => row.kind === 'zoom');
    // Video 15 s to 25 s is clip 5 s to 15 s, across the cut at 10 s: one bar.
    expect(zoomRow?.bars).toEqual([
      expect.objectContaining({
        key: 'z1:0',
        selection: { kind: 'zoom', id: 'z1' },
        startMs: 5_000,
        endMs: 15_000,
        name: 'Zoom 1.5x',
        movable: false,
      }),
    ]);
  });
});

describe('zoomSpans', () => {
  it('scales by the part speed and leaves out what was cut', () => {
    const doc = clip();
    const source = doc.sources[0].id;
    const placed = [
      {
        segment: { ...doc.segments[0], sourceIn: 10_000, sourceOut: 20_000, speed: 2 as const },
        index: 0,
        outStart: 0,
        outEnd: 5_000,
      },
    ];
    expect(zoomSpans(placed, { source, from: 14_000, to: 30_000 })).toEqual([
      { startMs: 2_000, endMs: 5_000 },
    ]);
    expect(zoomSpans(placed, { source, from: 30_000, to: 40_000 })).toEqual([]);
  });
});

describe('partHatch and missingRange', () => {
  const part = { sourceIn: 8_000, sourceOut: 30_000, speed: 1 };

  it('hatches nothing without a held range', () => {
    expect(partHatch(part, 22_000, null)).toEqual({});
  });

  it('hatches the start before what we hold and the end past it', () => {
    expect(partHatch(part, 22_000, { fromMs: 10_000, toMs: 25_000 })).toEqual({
      untilMs: 2_000,
      fromMs: 17_000,
    });
    expect(partHatch(part, 22_000, { fromMs: 0, toMs: 60_000 })).toEqual({});
  });

  it('hatches all of a part that lies wholly outside, at its speed', () => {
    expect(
      partHatch({ sourceIn: 50_000, sourceOut: 60_000, speed: 2 }, 5_000, {
        fromMs: 0,
        toMs: 40_000,
      }),
    ).toEqual({
      fromMs: 0,
    });
  });

  it('asks for the whole clip range when any of it is not held', () => {
    const doc = clip();
    expect(missingRange(doc, { fromMs: 5_000, toMs: 45_000 })).toBeNull();
    expect(missingRange(doc, { fromMs: 12_000, toMs: 45_000 })).toEqual({
      fromMs: 10_000,
      toMs: 40_000,
    });
    expect(missingRange(doc, null)).toBeNull();
  });
});

describe('split and remove', () => {
  it('splits at the playhead and keeps the length', () => {
    const doc = twoParts();
    expect(doc.segments).toHaveLength(2);
    expect(outputDuration(doc)).toBe(30_000);
  });

  it('refuses a split near an edge with the sentence the tooltip shows', () => {
    expect(splitAtPlayhead(clip(), 100)).toEqual({ ok: false, sentence: SPLIT_EDGE_SENTENCE });
    expect(splitAtPlayhead(twoParts(), 10_000)).toEqual({
      ok: false,
      sentence: SPLIT_EDGE_SENTENCE,
    });
  });

  it('refuses a split past the parts limit', () => {
    let doc = clip();
    for (let at = 500; doc.segments.length < 50; at += 500) {
      const next = splitAtPlayhead(doc, at);
      if (next.ok) doc = next.doc;
    }
    expect(splitAtPlayhead(doc, 29_000)).toEqual({ ok: false, sentence: SPLIT_LIMIT_SENTENCE });
  });

  it('removes a part and the rest close up, but never the last one', () => {
    const doc = twoParts();
    const removed = removeSelection(doc, { kind: 'segment', id: doc.segments[0].id });
    expect(removed?.ok && outputDuration(removed.doc)).toBe(20_000);
    const single = clip();
    expect(removeSelection(single, { kind: 'segment', id: single.segments[0].id })).toEqual({
      ok: false,
      sentence: LAST_PART_SENTENCE,
    });
    expect(removeProblem(single, { kind: 'segment', id: single.segments[0].id })).toBe(
      LAST_PART_SENTENCE,
    );
    expect(removeProblem(doc, { kind: 'segment', id: doc.segments[0].id })).toBeNull();
  });

  it('removes an item or a zoom, and does nothing for nothing selected or a crop area', () => {
    const base = withTracks(clip(), [text('t1', 0, 5_000)]);
    const doc = { ...base, zooms: [zoom('z1', 12_000, 20_000, base)] };
    const noItem = removeSelection(doc, { kind: 'item', id: 't1' });
    expect(noItem?.ok && noItem.doc.tracks[0]).toMatchObject({ items: [] });
    const noZoom = removeSelection(doc, { kind: 'zoom', id: 'z1' });
    expect(noZoom?.ok && noZoom.doc.zooms).toEqual([]);
    expect(removeSelection(doc, null)).toBeNull();
    expect(removeSelection(doc, { kind: 'zoom', id: 'nope' })).toBeNull();
    expect(removeSelection(doc, { kind: 'area', id: doc.layout.areas[0]?.id ?? 'a' })).toBeNull();
  });
});

describe('nudgeItem and tabForSelection', () => {
  const doc = withTracks(
    clip(),
    [text('t1', 4_000, 3_000), sticker('s1', 0, 1_000)],
    [music('m1', 0, 30_000)],
  );

  it('moves an item by a step and keeps it inside the clip', () => {
    const later = nudgeItem(doc, 't1', 1_000);
    expect(later.tracks[0]).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: 't1', start: 5_000 })]),
    });
    const early = nudgeItem(doc, 's1', -1_000);
    expect(early).toBe(doc);
  });

  it('opens the panel that edits what is selected', () => {
    expect(tabForSelection(doc, { kind: 'item', id: 't1' })).toBe('text');
    expect(tabForSelection(doc, { kind: 'item', id: 's1' })).toBe('elements');
    expect(tabForSelection(doc, { kind: 'item', id: 'm1' })).toBe('audio');
    expect(tabForSelection(doc, { kind: 'segment', id: doc.segments[0].id })).toBe('effects');
    expect(tabForSelection(doc, { kind: 'zoom', id: 'z' })).toBe('effects');
    expect(tabForSelection(doc, { kind: 'area', id: 'a' })).toBe('layouts');
    expect(tabForSelection(doc, { kind: 'item', id: 'gone' })).toBeNull();
    expect(tabForSelection(doc, null)).toBeNull();
  });
});

describe('dragging an edge', () => {
  it('shows the first frame of a start edge and the last frame of an end edge', () => {
    const doc = twoParts();
    const second = doc.segments[1].id;
    expect(edgeFrameMs(doc, second, 'start', 30)).toBe(10_000);
    expect(edgeFrameMs(doc, second, 'end', 25)).toBe(29_960);
    expect(edgeFrameMs(doc, 'nope', 'end', 30)).toBeNull();
  });

  it('holds a start edge under the pointer until release, and never shifts an end edge', () => {
    const start = twoParts();
    const id = start.segments[1].id;
    const draft: ClipDocument = {
      ...start,
      segments: [
        start.segments[0],
        { ...start.segments[1], sourceIn: start.segments[1].sourceIn + 3_000 },
      ],
    };
    expect(trimShiftMs(start, draft, id, 'start')).toBe(3_000);
    expect(trimShiftMs(start, draft, id, 'end')).toBe(0);
    const outward: ClipDocument = {
      ...start,
      segments: [
        start.segments[0],
        { ...start.segments[1], sourceIn: start.segments[1].sourceIn - 1 },
      ],
    };
    expect(trimShiftMs(start, outward, id, 'start')).toBe(0);
  });
});

describe('the snapping switch', () => {
  afterEach(() => window.localStorage.clear());

  it('is on until it is turned off, and remembers', () => {
    expect(readSnapping()).toBe(true);
    writeSnapping(false);
    expect(window.localStorage.getItem(SNAP_STORAGE_KEY)).toBe('off');
    expect(readSnapping()).toBe(false);
    writeSnapping(true);
    expect(readSnapping()).toBe(true);
  });

  it('stays on when storage is blocked', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSnapping()).toBe(true);
    spy.mockRestore();
  });
});
