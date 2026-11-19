/**
 * Sprint 12, Module 20 section 2, the stories' row "A library item is hidden
 * after I used it": the clip keeps working and exports as before. The export
 * reads a library sticker or sound by id among ACTIVE and HIDDEN rows, so a
 * hidden one still arrives; a removed one does not (the editor then asks
 * before leaving it out). That search shows ACTIVE items only is proved in
 * the API (`operator-library.service.spec.ts`, "the product search").
 *
 * Prisma is replaced by a small table that answers `findFirst` by the same
 * `where` the real rows build, so the test reads the real query.
 */
import { prismaSoundFileRows } from './sounds/rows';
import { prismaStickerFileRows } from './stickers/rows';

type Status = 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';

const STICKERS = new Map<string, { status: Status; fileKey: string }>([
  ['st-active', { status: 'ACTIVE', fileKey: 'library/stickers/aa/active.png' }],
  ['st-hidden', { status: 'HIDDEN', fileKey: 'library/stickers/bb/hidden.png' }],
  ['st-removed', { status: 'REMOVED', fileKey: 'library/stickers/cc/removed.png' }],
  ['st-staged', { status: 'STAGED', fileKey: 'library/stickers/dd/staged.png' }],
]);
const SOUNDS = new Map<string, { status: Status; fileKey: string }>([
  ['so-hidden', { status: 'HIDDEN', fileKey: 'library/sounds/ee/hidden.m4a' }],
  ['so-removed', { status: 'REMOVED', fileKey: 'library/sounds/ff/removed.m4a' }],
]);

interface Where {
  id: string;
  status?: { in: Status[] };
}

async function mockFindIn(
  table: 'stickers' | 'sounds',
  { where }: { where: Where },
): Promise<Record<string, unknown> | null> {
  const row = (table === 'stickers' ? STICKERS : SOUNDS).get(where.id);
  if (!row) return null;
  if (where.status && !where.status.in.includes(row.status)) return null;
  return {
    fileKey: row.fileKey,
    kind: 'STILL',
    width: 512,
    height: 512,
    fps: null,
    frames: null,
    durationMs: 2_000,
  };
}

// Read at call time, so the hoisted factory never touches the tables early.
jest.mock('@postgear/db', () => ({
  Prisma: {},
  prisma: {
    clipSticker: { findFirst: (args: { where: Where }) => mockFindIn('stickers', args) },
    clipSound: { findFirst: (args: { where: Where }) => mockFindIn('sounds', args) },
  },
}));

describe('a library item hidden after it was used', () => {
  it('a hidden sticker still reaches the export, like an active one', async () => {
    await expect(prismaStickerFileRows.librarySticker('st-hidden')).resolves.toMatchObject({
      fileKey: 'library/stickers/bb/hidden.png',
    });
    await expect(prismaStickerFileRows.librarySticker('st-active')).resolves.toMatchObject({
      fileKey: 'library/stickers/aa/active.png',
    });
  });

  it('a hidden sound still reaches the export', async () => {
    await expect(prismaSoundFileRows.librarySound('so-hidden')).resolves.toEqual({
      fileKey: 'library/sounds/ee/hidden.m4a',
      durationMs: 2_000,
    });
  });

  it('a removed (or never published) item does not: the clip never changes silently', async () => {
    await expect(prismaStickerFileRows.librarySticker('st-removed')).resolves.toBeNull();
    await expect(prismaStickerFileRows.librarySticker('st-staged')).resolves.toBeNull();
    await expect(prismaSoundFileRows.librarySound('so-removed')).resolves.toBeNull();
  });
});
