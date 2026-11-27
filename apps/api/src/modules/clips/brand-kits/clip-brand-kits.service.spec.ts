/**
 * The brand kit for clips (Sprint 13, Module 10): the clip fields through
 * the kit page, the engine's shape of a kit, and its logo copied once as the
 * workspace's own sticker.
 */
import type { BrandKit } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import sharp from 'sharp';
import type { MediaService } from '../../media/media.service';
import { ClipErrorException } from '../clip-error.exception';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import type { ClipBrandKitsRepository } from './clip-brand-kits.repository';
import { clipBrandKitPatchSchema } from './clip-brand-kits.schema';
import { ClipBrandKitsService, cardColours } from './clip-brand-kits.service';

const db = {
  clipVideo: { findFirst: jest.fn() },
  clipCaptionStyle: { findFirst: jest.fn() },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: new Proxy({}, { get: (_target, key: string) => (db as Record<string, unknown>)[key] }),
}));

const ORG = 'seed-demo-org';
const KIT = '11111111-1111-4111-8111-111111111111';
const INTRO = '22222222-2222-4222-8222-222222222222';
const OUTRO = '33333333-3333-4333-8333-333333333333';
const COLORS = {
  primary: '#1F3BFF',
  secondary: '#FF5A1F',
  accent: '#00AA55',
  background: '#FFFFFF',
  text: '#111111',
};

function kit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    id: KIT,
    organizationId: ORG,
    name: 'Acme',
    logoMediaId: 'media-1',
    colors: COLORS,
    clipLogoPosition: 'top-right',
    clipCaptionStyleId: 'clean',
    clipIntroVideoId: null,
    clipOutroVideoId: null,
    clipOutroText: null,
    clipLogoAssetId: null,
    deletedAt: null,
    ...overrides,
  } as unknown as BrandKit;
}

function video(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Sting',
    status: 'READY',
    durationMs: 3_000,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 400, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
});

function build(row: BrandKit | null = kit()) {
  const stickers = new Map<string, { id: string; meta: unknown }>();
  const repository = {
    list: jest.fn(async () => (row ? [row] : [])),
    find: jest.fn(async () => row),
    update: jest.fn(async (_org: string, _id: string, data: Partial<BrandKit>) =>
      row ? { ...row, ...data } : null,
    ),
    setLogoAsset: jest.fn(async () => true),
    videos: jest.fn(async (): Promise<unknown[]> => []),
    videoFiles: jest.fn(async () => []),
    createSticker: jest.fn(async (_org: string, input: { meta: unknown }) => {
      const created = { id: `asset-${stickers.size + 1}`, meta: input.meta };
      stickers.set(created.id, created);
      return created;
    }),
    removeSticker: jest.fn(async () => undefined),
    sticker: jest.fn(async (_org: string, id: string) => stickers.get(id) ?? null),
  };
  const media = {
    readImageBytes: jest.fn(async () => ({ bytes: png, mimeType: 'image/png' })),
    findViews: jest.fn(async () => new Map()),
  };
  const playback = { address: jest.fn(async (key: string) => ({ url: `https://files/${key}` })) };
  const limits = { assertStorage: jest.fn(async () => undefined) };
  const storage = { put: jest.fn(async () => undefined), delete: jest.fn(async () => undefined) };
  const service = new ClipBrandKitsService(
    repository as unknown as ClipBrandKitsRepository,
    media as unknown as MediaService,
    playback as unknown as ClipPlaybackService,
    limits as unknown as ClipLimitsGuard,
    storage as unknown as PrivateStorage,
  );
  return { service, repository, media, storage, limits, stickers };
}

async function code(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof ClipErrorException) return error.clipCode;
  return (error as { response?: { code?: string } } | null)?.response?.code ?? null;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.clipVideo.findFirst.mockResolvedValue(null);
  db.clipCaptionStyle.findFirst.mockResolvedValue(null);
});

describe('the kit page patch', () => {
  it('takes only the clip fields, at least one, and cleans the outro line', () => {
    expect(clipBrandKitPatchSchema.parse({ clipOutroText: '  Follow us  ' })).toEqual({
      clipOutroText: 'Follow us',
    });
    expect(clipBrandKitPatchSchema.safeParse({}).success).toBe(false);
    expect(clipBrandKitPatchSchema.safeParse({ name: 'Acme' }).success).toBe(false);
    expect(clipBrandKitPatchSchema.safeParse({ clipLogoAssetId: 'a' }).success).toBe(false);
    expect(clipBrandKitPatchSchema.safeParse({ clipOutroText: 'Hi \u{1F600}' }).success).toBe(
      false,
    );
  });
});

describe('ClipBrandKitsService.update', () => {
  it('writes the fields it was sent and answers the kit page view', async () => {
    db.clipVideo.findFirst.mockResolvedValue({ status: 'READY', durationMs: 4_000 });
    const { service, repository } = build();

    const { brandKit } = await service.update(ORG, KIT, {
      clipIntroVideoId: INTRO,
      clipLogoPosition: 'bottom-left',
    });

    expect(repository.update).toHaveBeenCalledWith(ORG, KIT, {
      clipIntroVideoId: INTRO,
      clipLogoPosition: 'bottom-left',
    });
    expect(brandKit).toMatchObject({ id: KIT, clipLogoPosition: 'bottom-left', colors: COLORS });
    expect(db.clipVideo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: INTRO, organizationId: ORG, deletedAt: null }),
      }),
    );
  });

  it('refuses a video over 5 seconds, one not ready, and one of another workspace', async () => {
    const { service, repository } = build();
    db.clipVideo.findFirst.mockResolvedValue({ status: 'READY', durationMs: 5_001 });
    expect(await code(service.update(ORG, KIT, { clipOutroVideoId: OUTRO }))).toBe(
      'brand_video_too_long',
    );
    db.clipVideo.findFirst.mockResolvedValue({ status: 'PROCESSING', durationMs: null });
    expect(await code(service.update(ORG, KIT, { clipOutroVideoId: OUTRO }))).toBe(
      'brand_video_not_ready',
    );
    db.clipVideo.findFirst.mockResolvedValue(null);
    expect(await code(service.update(ORG, KIT, { clipOutroVideoId: OUTRO }))).toBe(
      'video_not_found',
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('takes a built-in caption style or an own one, and refuses any other', async () => {
    const { service, repository } = build();
    await service.update(ORG, KIT, { clipCaptionStyleId: 'clean' });
    expect(db.clipCaptionStyle.findFirst).not.toHaveBeenCalled();

    expect(
      await code(
        service.update(ORG, KIT, { clipCaptionStyleId: '44444444-4444-4444-8444-444444444444' }),
      ),
    ).toBe('caption_style_not_found');
    expect(db.clipCaptionStyle.findFirst).toHaveBeenCalledWith({
      where: { id: '44444444-4444-4444-8444-444444444444', organizationId: ORG },
      select: { id: true },
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it("answers another workspace's kit, or a word, with brand_kit_not_found", async () => {
    const { service } = build(null);
    expect(await code(service.update(ORG, KIT, { clipOutroText: 'Bye' }))).toBe(
      'brand_kit_not_found',
    );
    expect(await code(service.use(ORG, 'not-an-id'))).toBe('brand_kit_not_found');
  });
});

describe('ClipBrandKitsService.use', () => {
  it('copies the logo once as the workspace sticker, then reuses the copy', async () => {
    const first = build();
    const used = await first.service.use(ORG, KIT);

    expect(used.logo).toMatchObject({ assetId: 'asset-1', width: 400, height: 200 });
    expect(first.repository.createSticker).toHaveBeenCalledTimes(1);
    expect(first.storage.put).toHaveBeenCalledTimes(2);
    expect(first.limits.assertStorage).toHaveBeenCalledWith(ORG, expect.any(Number));
    expect(first.repository.setLogoAsset).toHaveBeenCalledWith(ORG, KIT, null, 'asset-1');

    // The kit now records its copy: a second use reads it and copies nothing.
    const second = build(kit({ clipLogoAssetId: 'asset-1' }));
    second.stickers.set('asset-1', {
      id: 'asset-1',
      meta: (
        first.repository.createSticker.mock.calls[0] as unknown as [string, { meta: unknown }]
      )[1].meta,
    });
    const again = await second.service.use(ORG, KIT);
    expect(again.logo).toEqual({ assetId: 'asset-1', width: 400, height: 200 });
    expect(second.repository.createSticker).not.toHaveBeenCalled();
    expect(second.media.readImageBytes).not.toHaveBeenCalled();
  });

  it('drops its own copy when another first use won, and answers the winner', async () => {
    const { service, repository, storage, stickers } = build();
    stickers.set('asset-9', {
      id: 'asset-9',
      meta: {
        status: 'ready',
        name: 'Acme Logo',
        animated: false,
        width: 400,
        height: 200,
        fps: null,
        frames: null,
        durationMs: null,
        previewKey: 'clips/seed-demo-org/library/preview.webp',
      },
    });
    repository.setLogoAsset.mockResolvedValue(false);
    repository.find
      .mockResolvedValueOnce(kit())
      .mockResolvedValueOnce(kit({ clipLogoAssetId: 'asset-9' }));

    const used = await service.use(ORG, KIT);

    expect(repository.removeSticker).toHaveBeenCalledWith(ORG, 'asset-2');
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(used.logo).toEqual({ assetId: 'asset-9', width: 400, height: 200 });
  });

  it('has no logo when the kit has none, and no copy is made', async () => {
    const { service, repository } = build(kit({ logoMediaId: null }));
    expect((await service.use(ORG, KIT)).logo).toBeNull();
    expect(repository.createSticker).not.toHaveBeenCalled();
  });

  it('uses an intro of at most 5 seconds, drops a longer one, and makes a card outro from the line', async () => {
    const { service, repository } = build(
      kit({ logoMediaId: null, clipIntroVideoId: INTRO, clipOutroText: 'Follow For More' }),
    );
    repository.videos.mockResolvedValue([video(INTRO)]);
    const used = await service.use(ORG, KIT);
    expect(used.intro).toEqual({ videoId: INTRO, durationMs: 3_000, width: 1080, height: 1920 });
    expect(used.outro).toEqual({
      kind: 'card',
      text: 'Follow For More',
      background: COLORS.primary,
      colour: COLORS.background,
    });
    expect(used).toMatchObject({ logoPosition: 'top-right', captionStyleId: 'clean' });

    repository.videos.mockResolvedValue([video(INTRO, { durationMs: 6_000 })]);
    expect((await service.use(ORG, KIT)).intro).toBeNull();
  });

  it('prefers an outro video over the line', async () => {
    const { service, repository } = build(
      kit({ logoMediaId: null, clipOutroVideoId: OUTRO, clipOutroText: 'Bye' }),
    );
    repository.videos.mockResolvedValue([video(OUTRO)]);
    expect((await service.use(ORG, KIT)).outro).toMatchObject({
      kind: 'video',
      video: { videoId: OUTRO },
    });
  });
});

describe('cardColours', () => {
  it('puts the more readable of the text and background colours on the primary', () => {
    expect(cardColours({ ...COLORS, primary: '#FFEE00' })).toEqual({
      background: '#FFEE00',
      colour: COLORS.text,
    });
    expect(cardColours(COLORS).colour).toBe(COLORS.background);
  });
});
