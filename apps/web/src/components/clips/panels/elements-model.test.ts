import {
  createClipDocument,
  defaultBadgeItem,
  defaultStickerItem,
  type LibraryStickerView,
  type StickerFileView,
  type StickerItem,
} from '@postgear/video-engine';
import {
  badgeNameOf,
  ELEMENTS_TABS,
  fileInfoOf,
  fileOfItem,
  isElementsTab,
  kindOfTab,
  MISSING_FILE,
  noMatchSentence,
  pictureOf,
  previewPictures,
  type StickerFileInfo,
  stickerTitle,
  tileFileInfo,
  tileKey,
  unknownFiles,
} from './elements-model';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const STAR = '5c0e8a52-0000-4000-8000-000000000001';
const SPARK = '5c0e8a52-0000-4000-8000-000000000002';

const doc = () => createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });

function withItems(items: StickerItem[]) {
  return { tracks: [{ id: 'trk_a', kind: 'overlay' as const, items }] };
}

function libraryItem(id: string, libraryId: string): StickerItem {
  return {
    ...defaultStickerItem(
      doc(),
      0,
      { library: 'sticker', id: libraryId },
      { width: 100, height: 100 },
    ),
    id,
  };
}

function view(overrides: Partial<LibraryStickerView> = {}): LibraryStickerView {
  return {
    id: STAR,
    name: 'Gold Star',
    kind: 'static',
    category: 'reactions',
    tags: [],
    width: 256,
    height: 128,
    durationMs: null,
    fps: null,
    frames: null,
    previewUrl: 'https://space.test/gold-star.webp',
    fileUrl: 'https://space.test/gold-star.png',
    isFavourite: false,
    credit: null,
    ...overrides,
  };
}

describe('tabs', () => {
  it('lists the four tabs in order, and knows which kind each one lists', () => {
    expect(ELEMENTS_TABS.map((tab) => tab.label)).toEqual([
      'Stickers',
      'GIFs',
      'Favourites',
      'Uploaded',
    ]);
    expect(isElementsTab('gifs')).toBe(true);
    expect(isElementsTab('sounds')).toBe(false);
    expect(kindOfTab('stickers')).toBe('static');
    expect(kindOfTab('gifs')).toBe('animated');
    expect(kindOfTab('favourites')).toBeUndefined();
    expect(kindOfTab('uploaded')).toBeUndefined();
  });
});

describe('sentences', () => {
  it('names the search that found nothing, tidied', () => {
    expect(noMatchSentence('  big   zebra ')).toBe(
      'Nothing found for "big zebra". Try another word or pick a category.',
    );
    expect(noMatchSentence('   ')).toBe('Nothing here yet. Pick another category.');
  });

  it('keeps a badge name to one clean line of at most 30 characters', () => {
    expect(badgeNameOf('  Night\n\tOwl  ')).toBe('Night Owl');
    expect(badgeNameOf('a'.repeat(40))).toHaveLength(30);
    expect(badgeNameOf(' \u0007 ')).toBe('');
  });
});

describe('what the preview draws', () => {
  it('a still picture has no frame rate; a moving one keeps its frames', () => {
    expect(pictureOf(view())).toEqual({
      fileUrl: 'https://space.test/gold-star.png',
      animated: false,
      width: 256,
      height: 128,
      fps: null,
      frames: null,
    });
    expect(pictureOf(view({ kind: 'animated', fps: 12, frames: 24 }))).toMatchObject({
      animated: true,
      fps: 12,
      frames: 24,
    });
  });

  it('an upload not ready yet has no picture', () => {
    expect(
      pictureOf({ kind: null, width: null, height: null, fps: null, frames: null, fileUrl: null }),
    ).toBeNull();
  });

  it('a file the API says is missing draws nothing and says so', () => {
    const missing: StickerFileView = { key: `library:${STAR}`, missing: true };
    expect(fileInfoOf(missing)).toBe(MISSING_FILE);
    const found = fileInfoOf({
      key: `library:${STAR}`,
      missing: false,
      name: 'Gold Star',
      kind: 'static',
      width: 256,
      height: 128,
      durationMs: null,
      fps: null,
      frames: null,
      fileUrl: 'https://space.test/gold-star.png',
      previewUrl: null,
      credit: null,
    });
    expect(found).toMatchObject({ missing: false, name: 'Gold Star' });
    expect(found.picture?.fileUrl).toBe('https://space.test/gold-star.png');
  });

  it('a tile keys its file the way the clip refers to it', () => {
    expect(tileKey(view(), 'library')).toBe(`library:${STAR}`);
    expect(tileKey(view({ id: 'up-1' }), 'upload')).toBe('asset:up-1');
    expect(tileFileInfo(view())).toMatchObject({
      missing: false,
      name: 'Gold Star',
      previewUrl: 'https://space.test/gold-star.webp',
    });
  });

  it('asks only for the files it does not know, once each, and never for a badge', () => {
    const items = [
      libraryItem('stk_a', STAR),
      libraryItem('stk_b', STAR),
      libraryItem('stk_c', SPARK),
      { ...libraryItem('stk_d', STAR), ref: { asset: 'up-1' } },
      { ...defaultBadgeItem(doc(), 0, 'twitch', 'Night Owl', 400), id: 'stk_e' },
    ];
    const known = new Map<string, StickerFileInfo>([[`library:${SPARK}`, tileFileInfo(view())]]);
    expect(unknownFiles(withItems(items), known)).toEqual({ library: [STAR], asset: ['up-1'] });
  });

  it('hands the preview only the files that can be drawn', () => {
    const files = new Map<string, StickerFileInfo>([
      [`library:${STAR}`, tileFileInfo(view())],
      [`library:${SPARK}`, MISSING_FILE],
    ]);
    expect([...previewPictures(files).keys()]).toEqual([`library:${STAR}`]);
  });

  it('finds the selected sticker file, and its title', () => {
    const files = new Map<string, StickerFileInfo>([[`library:${STAR}`, tileFileInfo(view())]]);
    const item = libraryItem('stk_a', STAR);
    expect(fileOfItem(item, files)?.name).toBe('Gold Star');
    expect(stickerTitle(item, fileOfItem(item, files))).toBe('Gold Star');
    expect(stickerTitle(item, null)).toBe('Sticker');
    const badge = { ...defaultBadgeItem(doc(), 0, 'kick', 'Night Owl', 400), id: 'stk_b' };
    expect(fileOfItem(badge, files)).toBeNull();
    expect(stickerTitle(badge, null)).toBe('Follow Badge');
  });
});
