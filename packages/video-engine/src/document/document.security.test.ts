/**
 * Security sweep, Module 20: "Documents", the schema half. A saved clip is
 * read by the strict schema: a key it does not know, a reference that is not
 * a plain id, or a count over its cap is refused, and the refusal never
 * repeats what was sent. The worker reads the export's copy with the same
 * schema (`renderInputSchema`), so a document changed after the save is
 * refused there too.
 *
 * Existing tests this builds on: upgrade.test.ts:58 (unknown keys refused
 * without repeating them), time/items.test.ts:97 and :180 (the editor's own
 * add stops at the caps).
 */
import { renderInputSchema } from '../jobs';
import {
  TEST_VIDEO_ID,
  testDocument,
  testSegment,
  testSticker,
  testText,
  withItems,
} from '../render/test-docs';
import { MAX_ITEMS, MAX_SEGMENTS, MAX_SOUNDS, MAX_STICKERS, MAX_TRACKS, MAX_ZOOMS } from './limits';
import type { AudioItem, ClipDocument } from './schema';
import { safeParseClipDocument } from './upgrade';

const UUID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const KEY = 'clips/other-org/library/0123456789abcdef0123456789abcdef.png';

function base(): ClipDocument {
  return testDocument([testSegment('seg', 0, 30_000)]);
}

function refused(doc: unknown): string[] {
  const result = safeParseClipDocument(doc);
  if (result.ok) throw new Error('expected the document to be refused');
  return result.issues;
}

function sound(id: string, start: number): AudioItem {
  return {
    id,
    type: 'sfx',
    start,
    duration: 1_000,
    anchor: 'moment',
    ref: { library: 'sound', id: UUID },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: false,
  };
}

/** Sets a value deep inside a copy of the document. */
function withExtra(path: (string | number)[], extra: Record<string, unknown>): unknown {
  const doc = JSON.parse(JSON.stringify(withItems(base(), [testText('t1'), testSticker('s1')])));
  let at = doc;
  for (const part of path) at = at[part];
  Object.assign(at, extra);
  return doc;
}

describe('Clips security: Documents (schema)', () => {
  it('reads the base document, so every refusal below is the change alone', () => {
    expect(safeParseClipDocument(withItems(base(), [testText('t1'), testSticker('s1')])).ok).toBe(
      true,
    );
  });

  it.each([
    ['the document', []],
    ['the canvas', ['canvas']],
    ['a source', ['sources', 0]],
    ['a part', ['segments', 0]],
    ['the layout', ['layout']],
    ['an area', ['layout', 'areas', 0]],
    ['the looks', ['looks']],
    ['the fades', ['fades']],
    ['a track', ['tracks', 0]],
    ['a text', ['tracks', 0, 'items', 0]],
    ['a text style', ['tracks', 0, 'items', 0, 'style']],
    ['a transform', ['tracks', 0, 'items', 0, 'transform']],
    ['a sticker', ['tracks', 0, 'items', 1]],
    ['a sticker reference', ['tracks', 0, 'items', 1, 'ref']],
  ] as const)('refuses an unknown key on %s, without repeating it', (_label, path) => {
    const issues = refused(withExtra([...path], { key: KEY, organizationId: 'other-org' }));
    const text = issues.join('\n');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('other-org');
    expect(text).not.toContain('organizationId');
  });

  it.each([
    ['a storage key as an upload', { asset: KEY }],
    ['a path as an upload', { asset: '../../other-org/library/x.png' }],
    ['a key beside the id', { asset: UUID, key: KEY }],
    ['a library id that is a path', { library: 'sticker', id: '../x' }],
    ['a library id from another kind', { library: 'sound', id: UUID }],
    ['an address', { url: 'https://evil.example/x.png' }],
    ['a workspace beside the id', { asset: UUID, organizationId: 'other-org' }],
  ])('refuses a sticker that names %s', (_label, ref) => {
    const doc = withItems(base(), [testSticker('s1', { ref: ref as never })]);
    expect(refused(doc).join('\n')).not.toContain(KEY);
  });

  it.each([
    ['a storage key', { asset: KEY }],
    ['a path', { library: 'sound', id: '../../x.m4a' }],
    ['a sticker id', { library: 'sticker', id: UUID }],
  ])('refuses a sound that names %s', (_label, ref) => {
    const doc = {
      ...base(),
      tracks: [{ id: 'aud', kind: 'audio', items: [{ ...sound('a1', 0), ref }] }],
    };
    refused(doc);
  });

  it('refuses a source that names a video by anything but its id', () => {
    for (const videoId of [KEY, '../other', 'https://www.youtube.com/watch?v=x', '']) {
      const doc = { ...base(), sources: [{ id: 'src', videoId }] };
      expect(refused(doc).join('\n')).not.toContain(videoId || '\u0000');
    }
    refused({ ...base(), sources: [{ id: 'src', videoId: TEST_VIDEO_ID, organizationId: 'x' }] });
  });

  it('refuses ids that are free text', () => {
    for (const id of ['a b', '../x', '{x}', 'x'.repeat(65), '']) {
      refused(withItems(base(), [testText(id)]));
    }
  });

  describe('caps a hostile client could send past the editor', () => {
    /** The cap itself reads, and one more is refused: the count is the reason. */
    function capped(make: (count: number) => unknown, cap: number) {
      expect(safeParseClipDocument(make(cap)).ok).toBe(true);
      refused(make(cap + 1));
    }

    it(`refuses more than ${MAX_SEGMENTS} parts`, () => {
      capped(
        (count) =>
          testDocument(
            Array.from({ length: count }, (_, i) =>
              testSegment(`s${i}`, i * 1_000, i * 1_000 + 500),
            ),
          ),
        MAX_SEGMENTS,
      );
    });

    it('refuses more than eight sources', () => {
      capped(
        (count) => ({
          ...base(),
          sources: Array.from({ length: count }, (_, i) => ({
            id: i === 0 ? 'src' : `v${i}`,
            videoId: TEST_VIDEO_ID,
          })),
        }),
        8,
      );
    });

    it(`refuses more than ${MAX_ITEMS} items`, () => {
      capped(
        (count) =>
          withItems(
            base(),
            Array.from({ length: count }, (_, i) =>
              testText(`t${i}`, { start: (i * 200) % 28_000, duration: 1_000 }),
            ),
          ),
        MAX_ITEMS,
      );
    });

    it(`refuses more than ${MAX_STICKERS} stickers`, () => {
      capped(
        (count) =>
          withItems(
            base(),
            Array.from({ length: count }, (_, i) =>
              testSticker(`k${i}`, { start: i * 100, duration: 1_000 }),
            ),
          ),
        MAX_STICKERS,
      );
    });

    it(`refuses more than ${MAX_SOUNDS} sounds`, () => {
      capped(
        (count) => ({
          ...base(),
          tracks: [
            {
              id: 'aud',
              kind: 'audio',
              items: Array.from({ length: count }, (_, i) => sound(`a${i}`, i * 100)),
            },
          ],
        }),
        MAX_SOUNDS,
      );
    });

    it(`refuses more than ${MAX_ZOOMS} zooms`, () => {
      capped(
        (count) => ({
          ...base(),
          zooms: Array.from({ length: count }, (_, i) => ({
            id: `z${i}`,
            source: 'src',
            from: i * 10,
            to: i * 10 + 5,
            scale: 1.5,
            focus: { x: 0.5, y: 0.5 },
            ease: 0,
          })),
        }),
        MAX_ZOOMS,
      );
    });

    it(`refuses more than ${MAX_TRACKS} tracks`, () => {
      capped(
        (count) => ({
          ...base(),
          tracks: Array.from({ length: count }, (_, i) => ({
            id: `trk${i}`,
            kind: 'overlay',
            items: [],
          })),
        }),
        MAX_TRACKS,
      );
    });
  });

  describe("the export's copy, read again by the worker", () => {
    const input = {
      clipId: UUID,
      videoId: TEST_VIDEO_ID,
      revision: 1,
      document: base(),
      quality: '720p',
      proof: false,
      watermark: false,
      name: 'Best Moment',
    };

    it('reads a clean input', () => {
      expect(renderInputSchema.safeParse(input).success).toBe(true);
    });

    it('refuses an input with an extra key, or a document changed to carry one', () => {
      expect(renderInputSchema.safeParse({ ...input, organizationId: 'other-org' }).success).toBe(
        false,
      );
      expect(
        renderInputSchema.safeParse({ ...input, document: { ...base(), key: KEY } }).success,
      ).toBe(false);
      expect(
        renderInputSchema.safeParse({
          ...input,
          document: withItems(base(), [testSticker('s1', { ref: { asset: KEY } as never })]),
        }).success,
      ).toBe(false);
    });
  });
});
