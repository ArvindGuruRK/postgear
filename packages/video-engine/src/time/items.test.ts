import { createClipDocument } from '../document/create';
import { MAX_ITEMS, MAX_TRACKS } from '../document/limits';
import {
  type AudioItem,
  type ClipDocument,
  clipDocumentSchema,
  type StickerItem,
  type TextItem,
} from '../document/schema';
import { defaultTextItem } from '../document/text';
import { setSpeed } from './edits';
import {
  addItem,
  anchorAfterRetime,
  countItems,
  duplicateItem,
  findItem,
  type ItemEditResult,
  isWholeClip,
  removeItem,
  setItemAnchor,
  setItemTiming,
  updateItem,
} from './items';
import { outputDuration } from './time-map';

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
    widthPx: 270,
    heightPx: 270,
    loop: true,
  };
}

/** A 30 s clip with three stickers. */
function doc(stickers: StickerItem[] = []): ClipDocument {
  const base = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
  return {
    ...base,
    tracks: [
      {
        id: 'trk_overlay',
        kind: 'overlay',
        items: stickers.length
          ? stickers
          : [sticker('stk_a', 2_000, 3_000), sticker('stk_b', 26_000, 4_000), sticker('c', 0, 100)],
      },
    ],
  };
}

function ok(result: ItemEditResult): { doc: ClipDocument; itemId?: string } {
  if (!result.ok) throw new Error(result.code);
  expect(clipDocumentSchema.safeParse(result.doc).success).toBe(true);
  return result;
}

describe('duplicateItem', () => {
  it('puts a copy with a new id right after the original on the same track', () => {
    const before = doc();
    const { doc: after, itemId } = ok(duplicateItem(before, 'stk_a'));
    expect(itemId).toMatch(/^stk_[0-9a-f]{16}$/);
    const track = after.tracks[0];
    if (track?.kind !== 'overlay') throw new Error('no overlay');
    expect(track.items.map((i) => i.id)).toEqual(['stk_a', itemId, 'stk_b', 'c']);
    expect(findItem(after, itemId as string)?.item).toEqual({
      ...sticker('stk_a', 5_000, 3_000),
      id: itemId,
    });
    // The input is untouched.
    expect(countItems(before)).toBe(3);
  });

  it('ends the copy with the clip when it does not fit after the original', () => {
    const { doc: after, itemId } = ok(duplicateItem(doc(), 'stk_b'));
    expect(findItem(after, itemId as string)?.item).toMatchObject({
      start: 26_000,
      duration: 4_000,
    });
  });

  it('gives an id with no prefix a plain one', () => {
    expect(ok(duplicateItem(doc(), 'c')).itemId).toMatch(/^item_/);
  });

  it('refuses past MAX_ITEMS and an unknown id', () => {
    const full = doc(
      Array.from({ length: MAX_ITEMS }, (_, i) => sticker(`stk_${i}`, (i * 200) % 29_000, 100)),
    );
    expect(duplicateItem(full, 'stk_0')).toEqual({ ok: false, code: 'too_many_items' });
    expect(duplicateItem(doc(), 'nope')).toEqual({ ok: false, code: 'item_not_found' });
  });
});

describe('removeItem', () => {
  it('removes one item and moves nothing else', () => {
    const before = doc();
    const { doc: after } = ok(removeItem(before, 'stk_a'));
    expect(countItems(after)).toBe(2);
    expect(findItem(after, 'stk_a')).toBeNull();
    expect(findItem(after, 'stk_b')?.item).toBe(findItem(before, 'stk_b')?.item);
    expect(after.segments).toBe(before.segments);
  });

  it('refuses an unknown id', () => {
    expect(removeItem(doc(), 'nope')).toEqual({ ok: false, code: 'item_not_found' });
  });
});

function sound(start: number, duration: number): AudioItem {
  return {
    id: 'x',
    type: 'sfx',
    start,
    duration,
    anchor: 'moment',
    ref: { library: 'sound', id: LIBRARY_ITEM },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: false,
  };
}

/** A 30 s clip with no tracks at all. */
function empty(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
}

function textOf(d: ClipDocument, id: string): TextItem {
  const item = findItem(d, id)?.item;
  if (item?.type !== 'text') throw new Error(`no text ${id}`);
  return item;
}

describe('addItem', () => {
  it('makes an overlay track for the first text and gives it a text id', () => {
    const { doc: after, itemId } = ok(addItem(empty(), defaultTextItem(empty(), 2_000)));
    expect(itemId).toMatch(/^txt_[0-9a-f]{16}$/);
    expect(after.tracks).toHaveLength(1);
    expect(after.tracks[0]?.kind).toBe('overlay');
    expect(textOf(after, itemId as string)).toMatchObject({ start: 2_000, duration: 3_000 });
  });

  it('uses the first track with room, and stacks a new one when every track is busy', () => {
    let d = ok(addItem(empty(), defaultTextItem(empty(), 0))).doc;
    // 5 to 8 s is free on the first track.
    d = ok(addItem(d, defaultTextItem(d, 5_000))).doc;
    expect(d.tracks).toHaveLength(1);
    // 1 to 4 s overlaps the first text: a second overlay track on top.
    const third = ok(addItem(d, defaultTextItem(d, 1_000)));
    expect(third.doc.tracks).toHaveLength(2);
    expect(findItem(third.doc, third.itemId as string)?.trackIndex).toBe(1);
    // Items on a track stay in time order.
    const track = third.doc.tracks[0];
    if (track?.kind !== 'overlay') throw new Error('no overlay');
    expect(track.items.map((item) => item.start)).toEqual([0, 5_000]);
  });

  it('puts sounds on a sound track and keeps every item inside the clip', () => {
    const { doc: after, itemId } = ok(addItem(doc(), sound(29_000, 5_000)));
    expect(itemId).toMatch(/^snd_/);
    const found = findItem(after, itemId as string);
    expect(after.tracks[found?.trackIndex as number]?.kind).toBe('audio');
    expect(found?.item).toMatchObject({ start: 25_000, duration: 5_000 });
  });

  it(`refuses past MAX_ITEMS and past ${MAX_TRACKS} busy tracks`, () => {
    const full = doc(
      Array.from({ length: MAX_ITEMS }, (_, i) => sticker(`stk_${i}`, (i * 200) % 29_000, 100)),
    );
    expect(addItem(full, sticker('n', 0, 1_000))).toEqual({ ok: false, code: 'too_many_items' });
    let busy = empty();
    for (let i = 0; i < MAX_TRACKS; i += 1) {
      busy = ok(addItem(busy, sticker('n', 0, 30_000))).doc;
    }
    expect(busy.tracks).toHaveLength(MAX_TRACKS);
    expect(addItem(busy, sticker('n', 0, 1_000))).toEqual({ ok: false, code: 'too_many_tracks' });
  });
});

describe('updateItem, timing and Whole Clip', () => {
  it('changes one item and keeps its id and kind', () => {
    const { doc: after } = ok(
      updateItem<StickerItem>(doc(), 'stk_a', (item) => ({ ...item, id: 'other', flipX: true })),
    );
    expect(findItem(after, 'stk_a')?.item).toMatchObject({ id: 'stk_a', flipX: true });
    const same = doc();
    expect(ok(updateItem(same, 'stk_a', (item) => item)).doc).toBe(same);
    expect(updateItem(doc(), 'nope', (item) => item)).toEqual({ ok: false, code: 'item_not_found' });
  });

  it('sets From and For inside the clip, never shorter than the minimum', () => {
    const after = ok(setItemTiming(doc(), 'stk_a', 28_000, 5_000)).doc;
    expect(findItem(after, 'stk_a')?.item).toMatchObject({ start: 25_000, duration: 5_000 });
    const tiny = ok(setItemTiming(doc(), 'stk_a', 1_000, 10)).doc;
    expect(findItem(tiny, 'stk_a')?.item.duration).toBeGreaterThanOrEqual(100);
  });

  it('puts a Whole Clip text on the clip clock from 0, and a retime puts it back on its moment', () => {
    const added = ok(addItem(empty(), defaultTextItem(empty(), 4_000)));
    const id = added.itemId as string;
    const whole = ok(setItemAnchor(added.doc, id, 'whole')).doc;
    expect(textOf(whole, id)).toMatchObject({ anchor: 'clip', start: 0, duration: 30_000 });
    expect(isWholeClip(textOf(whole, id), 30_000)).toBe(true);
    const shorter = ok(setItemTiming(whole, id, 0, 10_000)).doc;
    expect(textOf(shorter, id)).toMatchObject({ anchor: 'moment', duration: 10_000 });
    const moment = ok(setItemAnchor(whole, id, 'moment')).doc;
    expect(textOf(moment, id)).toMatchObject({ anchor: 'moment', start: 0, duration: 30_000 });
  });

  it('keeps a Whole Clip text covering the clip when the clip gets shorter or longer', () => {
    const added = ok(addItem(empty(), defaultTextItem(empty(), 0)));
    const id = added.itemId as string;
    const whole = ok(setItemAnchor(added.doc, id, 'whole')).doc;
    const segmentId = whole.segments[0]?.id as string;
    const faster = setSpeed(whole, segmentId, 2);
    if (!faster.ok) throw new Error(faster.code);
    expect(outputDuration(faster.doc)).toBe(15_000);
    expect(textOf(faster.doc, id)).toMatchObject({ anchor: 'clip', start: 0, duration: 15_000 });
    const slower = setSpeed(faster.doc, segmentId, 0.5);
    if (!slower.ok) throw new Error(slower.code);
    expect(textOf(slower.doc, id)).toMatchObject({ start: 0, duration: 60_000 });
  });

  it('only overlays leave the clip clock when retimed: music keeps its anchor', () => {
    expect(anchorAfterRetime({ type: 'text', anchor: 'clip' }, 0, 1_000, 30_000)).toBe('moment');
    expect(anchorAfterRetime({ type: 'sticker', anchor: 'clip' }, 0, 30_000, 30_000)).toBe('clip');
    expect(anchorAfterRetime({ type: 'music', anchor: 'clip' }, 5_000, 1_000, 30_000)).toBe('clip');
    expect(anchorAfterRetime({ type: 'text', anchor: 'moment' }, 0, 30_000, 30_000)).toBe('moment');
  });
});
