/**
 * The sticker library (Module 12 section 4) with its repository and provider
 * faked: the plan check and the 60 a minute throttle on every workspace
 * route, paging, a miss counted with its nearest categories (and not for an
 * empty Favourites tab), favourites refusing a sticker that is not live, the
 * chips in the taxonomy's order, and the credits grouping; and the same for
 * sounds (Module 14): the sound search, its miss counted as a sound, the
 * sound chips per kind, starring a sound, and sound counts on the credits.
 * The search SQL itself was run against the seeded database (Progress notes).
 */
import { HttpException } from '@nestjs/common';
import type { LibrarySoundView, LibraryStickerView } from '@postgear/video-engine';
import type { RedisService } from '../../redis/redis.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { type ClipLibraryRepository, missTerm, stickerTsQuery } from './clip-library.repository';
import {
  categoriesQuerySchema,
  favouriteBodySchema,
  searchSoundsQuerySchema,
  searchStickersQuerySchema,
} from './clip-library.schemas';
import { ClipLibraryService, LIBRARY_REQUESTS_PER_MINUTE } from './clip-library.service';
import type { SoundProvider, SoundSearchRequest } from './sound-provider';
import type { StickerProvider, StickerSearchRequest } from './sticker-provider';

const ORG = 'seed-demo-org';
const STICKER_ID = '43c9d3e8-90cf-406d-bf4b-883caad5a985';
const SOUND_ID = '63c9d3e8-90cf-406d-bf4b-883caad5a985';

function sound(overrides: Partial<LibrarySoundView> = {}): LibrarySoundView {
  return {
    id: SOUND_ID,
    name: 'Soft Rain',
    kind: 'sfx',
    category: 'ambient',
    tags: ['rain'],
    durationMs: 8_000,
    bpm: null,
    previewUrl: 'http://localhost:3001/uploads/library/sounds/ab/ab.m4a',
    peaks: Array.from({ length: 100 }, () => 40),
    isFavourite: false,
    credit: null,
    details: {
      source: 'PostGear Sounds',
      author: 'PostGear',
      licence: 'OWN',
      licenceUrl: 'own://licence',
      sourceUrl: 'own://sounds/soft-rain',
    },
    ...overrides,
  };
}

function sticker(overrides: Partial<LibraryStickerView> = {}): LibraryStickerView {
  return {
    id: STICKER_ID,
    name: 'Fire',
    kind: 'animated',
    category: 'reactions',
    tags: ['fire'],
    width: 400,
    height: 168,
    durationMs: 1_500,
    fps: 12,
    frames: 18,
    previewUrl: 'http://localhost:3001/uploads/library/previews/f8/f8.webp',
    fileUrl: 'http://localhost:3001/uploads/library/stickers/f8/f8.apng',
    isFavourite: false,
    credit: null,
    ...overrides,
  };
}

function setup(options: { total?: number; active?: boolean; rate?: number } = {}) {
  const searches: StickerSearchRequest[] = [];
  const soundSearches: SoundSearchRequest[] = [];
  const misses: string[] = [];
  const soundMisses: string[] = [];
  const favourites: string[] = [];
  const soundFavourites: string[] = [];
  let hits = 0;
  const repository = {
    recordMiss: jest.fn(async (term: string, kind = 'sticker') => {
      (kind === 'sound' ? soundMisses : misses).push(term);
    }),
    soundCategoryCounts: jest.fn(async () => [
      { category: 'whooshes', count: 10 },
      { category: 'alerts', count: 12 },
      { category: 'calm', count: 2 },
      { category: 'ambient', count: 10 },
      { category: 'not-ours', count: 4 },
    ]),
    isSoundActive: jest.fn(async () => options.active ?? true),
    addSoundFavourite: jest.fn(async (_org: string, _user: string, id: string) => {
      soundFavourites.push(id);
    }),
    removeSoundFavourite: jest.fn(async () => undefined),
    categoryCounts: jest.fn(async () => [
      { category: 'gaming', count: 31 },
      { category: 'arrows-shapes', count: 59 },
      { category: 'reactions', count: 60 },
      { category: 'not-ours', count: 5 },
    ]),
    isActive: jest.fn(async () => options.active ?? true),
    addFavourite: jest.fn(async (_org: string, _user: string, id: string) => {
      favourites.push(id);
    }),
    removeFavourite: jest.fn(async () => undefined),
    creditSources: jest.fn(async () => [
      {
        name: 'Kenney Emotes Pack',
        author: 'Kenney',
        url: 'https://kenney.nl/assets/emotes-pack',
        licence: 'CC0-1.0',
        licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        creditLine: 'Emotes: Kenney (kenney.nl), CC0.',
        changeNote: 'Resized',
        noticeText: null,
        requiresCredit: false,
        stickers: 480,
        sounds: 0,
      },
      {
        name: 'Kenney Impact Sounds',
        author: 'Kenney',
        url: 'https://kenney.nl/assets/impact-sounds',
        licence: 'CC0-1.0',
        licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        creditLine: 'Kenney Impact Sounds: Kenney (kenney.nl), CC0.',
        changeNote: 'Trimmed, levelled and converted to AAC',
        noticeText: null,
        requiresCredit: false,
        stickers: 0,
        sounds: 130,
      },
      {
        name: 'Noto Emoji Animation',
        author: 'Google',
        url: 'https://googlefonts.github.io/noto-emoji-animation/',
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        creditLine:
          'Animated emoji: Noto Emoji Animation by Google, CC BY 4.0, resized and converted to APNG.',
        changeNote: 'Resized and converted to APNG',
        noticeText: null,
        requiresCredit: true,
        stickers: 881,
      },
      {
        name: 'PostGear Stickers',
        author: 'PostGear',
        url: 'own://stickers',
        licence: 'OWN',
        licenceUrl: 'own://licence',
        creditLine: null,
        changeNote: null,
        noticeText: null,
        requiresCredit: false,
        stickers: 193,
      },
    ]),
  };
  const provider: StickerProvider = {
    search: jest.fn(async (request: StickerSearchRequest) => {
      searches.push(request);
      const total = options.total ?? 30;
      return { items: total > 0 ? [sticker()] : [], total };
    }),
    resolve: jest.fn(async () => []),
  };
  const sounds: SoundProvider = {
    search: jest.fn(async (request: SoundSearchRequest) => {
      soundSearches.push(request);
      const total = options.total ?? 30;
      return { items: total > 0 ? [sound()] : [], total };
    }),
    resolve: jest.fn(async () => ({ sounds: [], removed: [] })),
  };
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  const redis = {
    incrementWithTtl: jest.fn(async () => {
      hits += 1;
      return options.rate ?? hits;
    }),
  };
  const service = new ClipLibraryService(
    repository as unknown as ClipLibraryRepository,
    provider,
    limits as unknown as ClipLimitsGuard,
    redis as unknown as RedisService,
    sounds,
  );
  return {
    service,
    searches,
    soundSearches,
    misses,
    soundMisses,
    favourites,
    soundFavourites,
    repository,
    limits,
    redis,
  };
}

const query = (raw: Record<string, string>) => searchStickersQuerySchema.parse(raw);

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string | undefined }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), code: (error.getResponse() as { code?: string }).code };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the search words', () => {
  it('keeps letters and digits only, the last word a prefix, so nothing typed is an operator', () => {
    expect(stickerTsQuery('fir')).toBe('fir:*');
    expect(stickerTsQuery('Lets GO!!')).toBe('lets & go:*');
    expect(stickerTsQuery("a' | b & !c:*")).toBe('a & b & c:*');
    expect(stickerTsQuery('wow wow')).toBe('wow:*');
    expect(stickerTsQuery('café 🔥 3d')).toBe('café & 3d:*');
    expect(stickerTsQuery('   ')).toBeNull();
    expect(stickerTsQuery('!!!')).toBeNull();
    expect(stickerTsQuery('one two three four five six seven')).toBe(
      'one & two & three & four & five & six:*',
    );
    expect(missTerm('  Banana   SPLIT! ')).toBe('banana split');
  });
});

describe('the sticker library', () => {
  it('searches through the provider with the workspace, and says when there is more', async () => {
    const { service, searches, limits } = setup({ total: 30 });
    const page = await service.search(
      ORG,
      query({ q: 'fire', kind: 'animated', page: '1', pageSize: '24' }),
    );
    expect(searches).toEqual([
      {
        q: 'fire',
        kind: 'animated',
        category: undefined,
        favouritesOnly: false,
        page: 1,
        pageSize: 24,
        orgId: ORG,
      },
    ]);
    expect(page).toMatchObject({ page: 1, pageSize: 24, total: 30, hasMore: true });
    expect(page.suggest).toBeUndefined();
    expect(limits.assertEnabled).toHaveBeenCalledWith(ORG);
    expect((await service.search(ORG, query({ page: '2', pageSize: '24' }))).hasMore).toBe(false);
  });

  it('counts a search that found nothing and suggests the nearest categories, the named one first', async () => {
    const { service, misses } = setup({ total: 0 });
    const page = await service.search(ORG, query({ q: 'Shapes banana' }));
    expect(misses).toEqual(['shapes banana']);
    expect(page.suggest?.map((c) => c.slug)).toEqual(['arrows-shapes', 'reactions', 'gaming']);
    expect(page.suggest?.[0]).toEqual({
      slug: 'arrows-shapes',
      name: 'Arrows And Shapes',
      count: 59,
    });
  });

  it('does not count an empty Favourites tab or an empty search as a miss', async () => {
    const { service, misses } = setup({ total: 0 });
    expect(
      (await service.search(ORG, query({ q: 'fire', favourites: 'true' }))).suggest,
    ).toBeUndefined();
    expect((await service.search(ORG, query({}))).suggest).toBeUndefined();
    expect((await service.search(ORG, query({ q: '!!' }))).suggest).toBeUndefined();
    expect(misses).toEqual([]);
  });

  it('refuses the 61st request in a minute for the workspace with one sentence', async () => {
    const { service, redis } = setup({ rate: LIBRARY_REQUESTS_PER_MINUTE + 1 });
    expect(await refusal(service.search(ORG, query({ q: 'fire' })))).toEqual({
      status: 429,
      code: 'library_throttled',
    });
    expect(redis.incrementWithTtl).toHaveBeenCalledWith(`clips:library:rate:${ORG}`, 60);
  });

  it('lists only our categories that have stickers, in the taxonomy order, with their names', async () => {
    const { service } = setup();
    expect(await service.categories(ORG, { type: 'sticker' })).toEqual({
      categories: [
        { slug: 'reactions', name: 'Reactions', count: 60 },
        { slug: 'arrows-shapes', name: 'Arrows And Shapes', count: 59 },
        { slug: 'gaming', name: 'Gaming', count: 31 },
      ],
    });
  });

  it('stars a live sticker for the workspace, and refuses one that left the library', async () => {
    const live = setup();
    expect(
      await live.service.favourite(ORG, 'user-1', { type: 'sticker', itemId: STICKER_ID }),
    ).toEqual({ favourite: true });
    expect(live.favourites).toEqual([STICKER_ID]);
    const gone = setup({ active: false });
    expect(
      await refusal(gone.service.favourite(ORG, 'user-1', { type: 'sticker', itemId: STICKER_ID })),
    ).toEqual({
      status: 404,
      code: 'sticker_not_found',
    });
    expect(gone.favourites).toEqual([]);
  });

  it('groups the credits: attribution first, then public domain, then our own', async () => {
    const { service } = setup();
    const credits = await service.credits();
    expect(
      credits.groups.map((group) => [group.group, group.sources.map((source) => source.name)]),
    ).toEqual([
      ['attribution', ['Noto Emoji Animation']],
      ['public-domain', ['Kenney Emotes Pack', 'Kenney Impact Sounds']],
      ['own', ['PostGear Stickers']],
    ]);
    expect(credits.groups[0]?.sources[0]).toMatchObject({ stickers: 881, licence: 'CC-BY-4.0' });
    expect(credits.groups[1]?.sources[1]).toMatchObject({ stickers: 0, sounds: 130 });
    expect(credits.groups[2]?.sources[0]).toMatchObject({ stickers: 193, sounds: 0 });
  });
});

const soundQuery = (raw: Record<string, string>) => searchSoundsQuerySchema.parse(raw);

describe('the sound library', () => {
  it('searches sounds through the sound provider with the workspace, behind the same throttle', async () => {
    const { service, soundSearches, searches, limits, redis } = setup({ total: 30 });
    const page = await service.searchSounds(
      ORG,
      soundQuery({ q: 'rain', kind: 'sfx', category: 'ambient', page: '1', pageSize: '24' }),
    );
    expect(soundSearches).toEqual([
      {
        q: 'rain',
        kind: 'sfx',
        category: 'ambient',
        favouritesOnly: false,
        page: 1,
        pageSize: 24,
        orgId: ORG,
      },
    ]);
    expect(searches).toEqual([]);
    expect(page).toMatchObject({ total: 30, hasMore: true, items: [{ id: SOUND_ID, credit: null }] });
    expect(limits.assertEnabled).toHaveBeenCalledWith(ORG);
    expect(redis.incrementWithTtl).toHaveBeenCalledWith(`clips:library:rate:${ORG}`, 60);
  });

  it('counts a sound search that found nothing as a sound miss, and suggests effect categories', async () => {
    const { service, soundMisses, misses } = setup({ total: 0 });
    const page = await service.searchSounds(ORG, soundQuery({ q: 'zap', kind: 'sfx' }));
    expect(soundMisses).toEqual(['zap']);
    expect(misses).toEqual([]);
    expect(page.suggest?.map((c) => c.slug)).toEqual(['alerts', 'ambient', 'whooshes']);
    const named = await service.searchSounds(ORG, soundQuery({ q: 'whoo', kind: 'sfx' }));
    expect(named.suggest?.[0]).toEqual({ slug: 'whooshes', name: 'Whooshes', count: 10 });
    expect(
      (await service.searchSounds(ORG, soundQuery({ q: 'zap', favourites: 'true' }))).suggest,
    ).toBeUndefined();
  });

  it('lists sound chips per kind in the taxonomy order, and keeps the sticker chips the default', async () => {
    const { service } = setup();
    expect(await service.categories(ORG, categoriesQuerySchema.parse({ type: 'sound', kind: 'sfx' }))).toEqual({
      categories: [
        { slug: 'alerts', name: 'Alerts And Notifications', count: 12 },
        { slug: 'ambient', name: 'Ambient Sounds', count: 10 },
        { slug: 'whooshes', name: 'Whooshes', count: 10 },
      ],
    });
    expect(
      await service.categories(ORG, categoriesQuerySchema.parse({ type: 'sound', kind: 'music' })),
    ).toEqual({ categories: [{ slug: 'calm', name: 'Calm', count: 2 }] });
    expect(categoriesQuerySchema.parse({})).toEqual({ type: 'sticker' });
    expect(categoriesQuerySchema.safeParse({ type: 'sound', kind: 'animated' }).success).toBe(false);
    expect(categoriesQuerySchema.safeParse({ type: 'sticker', kind: 'sfx' }).success).toBe(false);
  });

  it('stars a live sound, refuses one that left the library, and unstars by type', async () => {
    const live = setup();
    expect(
      await live.service.favourite(ORG, 'user-1', favouriteBodySchema.parse({ type: 'sound', itemId: SOUND_ID })),
    ).toEqual({ favourite: true });
    expect(live.soundFavourites).toEqual([SOUND_ID]);
    expect(live.favourites).toEqual([]);
    await live.service.unfavourite(ORG, SOUND_ID, 'sound');
    expect(live.repository.removeSoundFavourite).toHaveBeenCalledWith(ORG, SOUND_ID);
    expect(live.repository.removeFavourite).not.toHaveBeenCalled();
    const gone = setup({ active: false });
    expect(
      await refusal(gone.service.favourite(ORG, 'user-1', { type: 'sound', itemId: SOUND_ID })),
    ).toEqual({ status: 404, code: 'sound_not_found' });
  });
});
