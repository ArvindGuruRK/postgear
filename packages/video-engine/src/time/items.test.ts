import { createClipDocument } from '../document/create';
import { MAX_ITEMS } from '../document/limits';
import { type ClipDocument, clipDocumentSchema, type StickerItem } from '../document/schema';
import { countItems, duplicateItem, findItem, type ItemEditResult, removeItem } from './items';

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
