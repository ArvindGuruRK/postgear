/**
 * Brand kits, logos, website extraction and share links, against fakes: the
 * address checks and the sentence each refusal gets, the per-workspace
 * extraction limit, every way a logo is refused, kit writes that only touch
 * what was sent, and share links that say nothing to a stranger about why
 * they do not work.
 */
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BrandKitSource, type Prisma } from '@postgear/db';
import { brandFromTheme, DEFAULT_THEME_ID, themeById } from '@postgear/design-engine';
import { type BrowserPool, SeoCrawlError } from '@postgear/seo-engine';
import sharp from 'sharp';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import type { MediaService, MediaView } from '../media/media.service';
import type { RedisService } from '../redis/redis.service';
import type { ExtractDeps } from './brand-extractor';
import { BrandKitsService, EXTRACT_LIMIT_PER_MINUTE, websiteAddress } from './brand-kits.service';
import { MAX_LOGO_BYTES } from './brand-logo';
import { MAX_ACTIVE_SHARES } from './dto/studio.schema';
import { STUDIO_MESSAGES } from './studio.messages';
import type {
  BrandKitRow,
  DesignRow,
  DesignShareRow,
  SharedDesignRow,
  StudioRepository,
} from './studio.repository';

const ORG = 'org-1';
const USER = 'user-1';
/** A public address written as a literal, so the guard passes it without a DNS lookup. */
const PUBLIC_SITE = 'https://93.184.216.34/';
const COLORS = {
  primary: '#FF5A1F',
  secondary: '#1F6FFF',
  accent: '#00AA55',
  background: '#FFFDF8',
  text: '#1A1A1A',
};

function kitRow(overrides: Partial<BrandKitRow> = {}): BrandKitRow {
  return {
    id: 'kit-1',
    organizationId: ORG,
    name: 'Acme',
    description: null,
    websiteUrl: null,
    logoMediaId: null,
    colors: COLORS as Prisma.JsonValue,
    source: BrandKitSource.MANUAL,
    createdById: USER,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as BrandKitRow;
}

function mediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: 'media-1',
    name: 'logo.png',
    type: 'image',
    mimeType: 'image/png',
    fileSize: 100,
    width: 200,
    height: 80,
    url: 'http://localhost:3001/uploads/logo.png',
    thumbnailUrl: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  } as MediaView;
}

function shareRow(overrides: Partial<SharedDesignRow> = {}): SharedDesignRow {
  return {
    id: 'share-1',
    designId: 'design-1',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    lastViewedAt: null,
    createdById: USER,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    design: {
      id: 'design-1',
      organizationId: ORG,
      deletedAt: null,
      organization: { name: 'Acme Workspace' },
    },
    ...overrides,
  } as unknown as SharedDesignRow;
}

function setup(options: { webUrl?: string } = {}) {
  const counters = new Map<string, number>();
  const repository = {
    listBrandKits: jest.fn(async (): Promise<BrandKitRow[]> => []),
    findBrandKit: jest.fn(async (): Promise<BrandKitRow | null> => null),
    createBrandKit: jest.fn(async (data: Record<string, unknown>) =>
      kitRow({ ...(data as Partial<BrandKitRow>), id: 'kit-new' }),
    ),
    updateBrandKit: jest.fn(async (): Promise<BrandKitRow | null> => kitRow()),
    softDeleteBrandKit: jest.fn(async () => true),
    findDesign: jest.fn(async (): Promise<DesignRow | null> => ({ id: 'design-1' }) as DesignRow),
    listActiveShares: jest.fn(async (): Promise<DesignShareRow[]> => []),
    countActiveShares: jest.fn(async () => 0),
    createShare: jest.fn(async (data: { designId: string; tokenHash: string; expiresAt: Date }) =>
      shareRow({ ...data, id: 'share-new' }),
    ),
    revokeShare: jest.fn(async () => true),
    findShareByHash: jest.fn(async (): Promise<SharedDesignRow | null> => null),
    touchShare: jest.fn(async () => undefined),
  };
  const media = {
    findViews: jest.fn(async (): Promise<Map<string, MediaView>> => new Map()),
    saveGenerated: jest.fn(async (_orgId: string, file: { name: string; mimeType: string }) =>
      mediaView({ id: 'media-new', name: file.name, mimeType: file.mimeType }),
    ),
  };
  const redis = {
    incrementWithTtl: jest.fn(async (key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    }),
  };
  const pool = {
    available: jest.fn(async () => true),
    acquire: jest.fn(),
  };
  const config = {
    get: jest.fn(() => options.webUrl ?? 'http://localhost:3000/'),
  };

  const service = new BrandKitsService(
    repository as unknown as StudioRepository,
    media as unknown as MediaService,
    redis as unknown as RedisService,
    pool as unknown as BrowserPool,
    config as unknown as ConfigService<Env, true>,
  );

  const extraction = {
    url: PUBLIC_SITE,
    finalUrl: PUBLIC_SITE,
    name: 'Acme',
    description: null,
    logos: [],
    colors: [],
    usedBrowser: false,
  };
  const fetchPage = jest.fn();
  service.extractDeps = {
    fetchPage,
    fetchAsset: jest.fn(),
  } as unknown as ExtractDeps;

  return { service, repository, media, redis, pool, fetchPage, extraction };
}

/** The status and sentence an HttpException would answer with. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;

    const body = error.getResponse();
    return {
      status: error.getStatus(),
      message: typeof body === 'string' ? body : (body as { message?: string }).message,
      code: typeof body === 'object' ? (body as { code?: string }).code : undefined,
    };
  }

  throw new Error('Nothing was refused.');
}

function pageHtml(body: string) {
  return {
    requestedUrl: PUBLIC_SITE,
    finalUrl: PUBLIC_SITE,
    statusCode: 200,
    headers: {},
    body,
    bytes: body.length,
    contentType: 'text/html',
    compressed: false,
    https: true,
    certificateValid: true,
    responseTimeMs: 1,
    redirects: [],
    addresses: ['93.184.216.34'],
  };
}

let warnSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  logSpy = jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Website addresses
// ---------------------------------------------------------------------------

describe('websiteAddress', () => {
  it.each([
    ['acme.example', 'https://acme.example/'],
    ['  https://acme.example/about  ', 'https://acme.example/about'],
    ['http://acme.example', 'http://acme.example/'],
  ])('reads %s as %s', (input, address) => {
    expect(websiteAddress(input)).toBe(address);
  });

  it.each([
    '',
    'javascript:alert(1)',
    'mailto:hello@acme.example',
    'ftp://acme.example',
    'https://user:secret@acme.example',
    'data:text/html,<script>alert(1)</script>',
  ])('refuses %s', (input) => {
    expect(websiteAddress(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

describe('extract', () => {
  it('reads a public site and saves nothing', async () => {
    const { service, fetchPage, repository, media } = setup();
    fetchPage.mockResolvedValue(
      pageHtml('<title>Acme | Home</title><meta name="theme-color" content="#FF5A1F">'),
    );

    const result = await service.extract(ORG, PUBLIC_SITE);

    expect(result.name).toBe('Acme');
    expect(result.colors[0]).toMatchObject({ hex: '#FF5A1F', suggestedRole: 'primary' });
    expect(repository.createBrandKit).not.toHaveBeenCalled();
    expect(media.saveGenerated).not.toHaveBeenCalled();
  });

  it.each([
    ['the local machine by name', 'http://localhost/'],
    ['the local machine with a port', 'localhost:3000'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a private network', 'http://10.0.0.8/'],
    ['the IPv6 loopback', 'http://[::1]/'],
  ])('refuses %s with the stories sentence, and records it', async (_label, address) => {
    const { service, fetchPage } = setup();

    expect(await refusal(service.extract(ORG, address))).toEqual({
      status: 422,
      message: STUDIO_MESSAGES.EXTRACT_PRIVATE,
      code: 'extract_private',
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'studio.unsafe_url',
      expect.objectContaining({ orgId: ORG }),
    );
  });

  it('asks for a real address when what was typed cannot be one', async () => {
    const { service, redis } = setup();

    expect(await refusal(service.extract(ORG, 'javascript:alert(1)'))).toMatchObject({
      status: 400,
      message: STUDIO_MESSAGES.WEBSITE_INVALID,
    });
    expect(await refusal(service.extract(ORG, 'https://93.184.216.34:8443/'))).toMatchObject({
      status: 400,
      message: STUDIO_MESSAGES.WEBSITE_INVALID,
    });
    // Only the second reached the limit: the first was not an address at all.
    expect(redis.incrementWithTtl).toHaveBeenCalledTimes(1);
  });

  it('gives a redirect into a private network the same answer as typing one', async () => {
    const { service, fetchPage } = setup();
    fetchPage.mockRejectedValue(
      new SeoCrawlError('unsafe_url', 'Redirected somewhere private.', false, {
        reason: 'private_address',
      }),
    );

    expect(await refusal(service.extract(ORG, PUBLIC_SITE))).toMatchObject({
      status: 422,
      code: 'extract_private',
    });
    expect(warnSpy).toHaveBeenCalledWith('studio.unsafe_url', {
      orgId: ORG,
      reason: 'private_address',
    });
  });

  it.each([
    [
      'a redirect to an odd port',
      new SeoCrawlError('unsafe_url', 'Port.', false, { reason: 'port' }),
    ],
    ['a timeout', new SeoCrawlError('timeout', 'Too slow.', true)],
    [
      'a site that blocks bots',
      new SeoCrawlError('bad_status', 'Forbidden.', false, { statusCode: 403 }),
    ],
    ['something unexpected', new Error('socket hang up')],
  ])('says the site could not be read after %s', async (_label, error) => {
    const { service, fetchPage } = setup();
    fetchPage.mockRejectedValue(error);

    expect(await refusal(service.extract(ORG, PUBLIC_SITE))).toEqual({
      status: 422,
      message: STUDIO_MESSAGES.EXTRACT_FAILED,
      code: 'extract_failed',
    });
  });

  it(`allows ${EXTRACT_LIMIT_PER_MINUTE} a minute per workspace, refused addresses included`, async () => {
    const { service, redis } = setup();

    for (let attempt = 0; attempt < EXTRACT_LIMIT_PER_MINUTE; attempt++) {
      expect((await refusal(service.extract(ORG, 'http://10.0.0.8/'))).status).toBe(422);
    }

    expect(await refusal(service.extract(ORG, PUBLIC_SITE))).toEqual({
      status: 429,
      message: STUDIO_MESSAGES.EXTRACT_RATE_LIMITED,
      code: 'extract_rate_limited',
    });
    expect(redis.incrementWithTtl).toHaveBeenLastCalledWith(`studio:extract:${ORG}`, 60);

    // Another workspace has its own count.
    expect((await refusal(service.extract('org-2', 'http://10.0.0.8/'))).status).toBe(422);
  });
});

describe('rendering a JavaScript shell', () => {
  function lease(status: number | null) {
    const page = {
      goto: jest.fn(async () => (status === null ? null : { status: () => status })),
      waitForLoadState: jest.fn(async () => undefined),
      content: jest.fn(async () => '<html><title>Rendered</title></html>'),
      url: jest.fn(() => `${PUBLIC_SITE}home`),
    };
    return { page, refused: [], release: jest.fn(async () => undefined) };
  }

  /** The private method the extractor is handed, called the way the extractor calls it. */
  function render(service: BrandKitsService, signal = new AbortController().signal) {
    const renderer = service as unknown as {
      renderPage(
        url: string,
        options: { signal: AbortSignal; timeoutMs: number },
      ): Promise<{ html: string; finalUrl: string }>;
    };
    return renderer.renderPage(PUBLIC_SITE, { signal, timeoutMs: 5_000 });
  }

  it('loads the page in the shared browser and always gives the page back', async () => {
    const { service, pool } = setup();
    const held = lease(200);
    pool.acquire.mockResolvedValue(held);

    expect(await render(service)).toEqual({
      html: '<html><title>Rendered</title></html>',
      finalUrl: `${PUBLIC_SITE}home`,
    });
    expect(held.page.goto).toHaveBeenCalledWith(PUBLIC_SITE, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    expect(held.release).toHaveBeenCalled();
  });

  it.each([
    ['an error status', 404],
    ['no response at all', null],
  ])('fails on %s, still giving the page back', async (_label, status) => {
    const { service, pool } = setup();
    const held = lease(status);
    pool.acquire.mockResolvedValue(held);

    await expect(render(service)).rejects.toThrow();
    expect(held.release).toHaveBeenCalled();
  });

  it('gives the page back the moment the extraction is abandoned', async () => {
    const { service, pool } = setup();
    const held = lease(200);
    const controller = new AbortController();
    held.page.goto.mockImplementation(async () => {
      controller.abort();
      return { status: () => 200 };
    });
    pool.acquire.mockResolvedValue(held);

    await render(service, controller.signal);

    expect(held.release.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not try without a browser', async () => {
    const { service, pool } = setup();
    pool.available.mockResolvedValue(false);

    await expect(render(service)).rejects.toThrow('No browser is available.');
    expect(pool.acquire).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

describe('uploadLogo', () => {
  const svg = (body: string) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">${body}</svg>`);

  it('keeps a PNG lossless in the library, even with no transparency', async () => {
    const { service, media } = setup();
    const buffer = await sharp({
      create: { width: 200, height: 80, channels: 4, background: '#FF5A1F' },
    })
      .png()
      .toBuffer();

    const { media: saved } = await service.uploadLogo(ORG, { buffer, originalname: 'acme.png' });

    expect(saved.id).toBe('media-new');
    expect(media.saveGenerated).toHaveBeenCalledWith(ORG, {
      data: buffer,
      mimeType: 'image/png',
      name: 'acme.png',
      alt: 'Brand logo',
      encode: { prefer: 'png' },
    });
  });

  it('leaves a JPEG to the library as a JPEG', async () => {
    const { service, media } = setup();
    const buffer = await sharp({
      create: { width: 200, height: 80, channels: 3, background: '#FF5A1F' },
    })
      .jpeg()
      .toBuffer();

    await service.uploadLogo(ORG, { buffer, originalname: 'acme.jpg' });

    expect(media.saveGenerated).toHaveBeenCalledWith(ORG, {
      data: buffer,
      mimeType: 'image/jpeg',
      name: 'acme.jpg',
      alt: 'Brand logo',
      encode: undefined,
    });
  });

  it('draws an SVG to a PNG before it reaches the library', async () => {
    const { service, media } = setup();

    await service.uploadLogo(ORG, {
      buffer: svg('<rect width="40" height="20"/>'),
      originalname: 'acme.svg',
    });

    expect(media.saveGenerated).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        mimeType: 'image/png',
        name: 'acme.png',
        encode: { prefer: 'png' },
      }),
    );
  });

  it.each([
    ['no file', undefined, 400, STUDIO_MESSAGES.LOGO_NO_FILE],
    ['an empty file', Buffer.alloc(0), 400, STUDIO_MESSAGES.LOGO_NO_FILE],
    ['a PDF', Buffer.from('%PDF-1.7\n'), 415, STUDIO_MESSAGES.LOGO_REJECTED],
    ['a file over 5 MB', Buffer.alloc(MAX_LOGO_BYTES + 1, 1), 413, STUDIO_MESSAGES.LOGO_REJECTED],
    [
      'an SVG with a script',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      422,
      STUDIO_MESSAGES.LOGO_UNSAFE_SVG,
    ],
    [
      'an SVG that cannot be drawn',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'),
      422,
      STUDIO_MESSAGES.LOGO_UNREADABLE,
    ],
  ])('refuses %s with its sentence', async (_label, buffer, status, message) => {
    const { service, media } = setup();
    const file = buffer ? { buffer, originalname: 'logo' } : undefined;

    expect(await refusal(service.uploadLogo(ORG, file))).toMatchObject({ status, message });
    expect(media.saveGenerated).not.toHaveBeenCalled();
  });

  it('records why a logo was refused', async () => {
    const { service } = setup();

    await refusal(
      service.uploadLogo(ORG, {
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>'),
        originalname: 'logo.svg',
      }),
    );

    expect(logSpy).toHaveBeenCalledWith('studio.logo_rejected', {
      orgId: ORG,
      reason: 'unsafe_svg',
    });
  });

  it('calls a logo the library cannot decode unreadable, and lets a server fault through', async () => {
    const { service, media } = setup();
    const buffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();

    media.saveGenerated.mockRejectedValueOnce(new HttpException('Unsupported', 415));
    expect(await refusal(service.uploadLogo(ORG, { buffer, originalname: 'a.png' }))).toMatchObject(
      {
        status: 422,
        message: STUDIO_MESSAGES.LOGO_UNREADABLE,
      },
    );

    media.saveGenerated.mockRejectedValueOnce(new Error('The bucket did not answer.'));
    await expect(service.uploadLogo(ORG, { buffer, originalname: 'a.png' })).rejects.toThrow(
      'The bucket did not answer.',
    );
  });
});

// ---------------------------------------------------------------------------
// Kits
// ---------------------------------------------------------------------------

describe('brand kits', () => {
  it('creates a kit with a checked logo and a normalised website', async () => {
    const { service, repository, media } = setup();
    media.findViews.mockResolvedValue(new Map([['media-1', mediaView()]]));

    const view = await service.create(ORG, USER, {
      name: 'Acme',
      description: '',
      websiteUrl: 'acme.example',
      logoMediaId: 'media-1',
      colors: COLORS,
    });

    expect(repository.createBrandKit).toHaveBeenCalledWith({
      orgId: ORG,
      name: 'Acme',
      description: null,
      websiteUrl: 'https://acme.example/',
      logoMediaId: 'media-1',
      colors: COLORS,
      source: BrandKitSource.MANUAL,
      createdById: USER,
    });
    expect(view.logoUrl).toBe(mediaView().url);
  });

  it.each([
    ['a logo that is not in this library', new Map(), 404, STUDIO_MESSAGES.LOGO_NOT_FOUND],
    [
      'a video for a logo',
      new Map([['media-1', mediaView({ type: 'video' as MediaView['type'] })]]),
      400,
      STUDIO_MESSAGES.LOGO_REJECTED,
    ],
  ])('refuses %s', async (_label, views, status, message) => {
    const { service, media, repository } = setup();
    media.findViews.mockResolvedValue(views);

    expect(
      await refusal(
        service.create(ORG, USER, { name: 'Acme', logoMediaId: 'media-1', colors: COLORS }),
      ),
    ).toMatchObject({ status, message });
    expect(repository.createBrandKit).not.toHaveBeenCalled();
  });

  it('refuses a website that cannot be one', async () => {
    const { service } = setup();

    expect(
      await refusal(
        service.create(ORG, USER, {
          name: 'Acme',
          websiteUrl: 'javascript:alert(1)',
          colors: COLORS,
        }),
      ),
    ).toMatchObject({ status: 400, message: STUDIO_MESSAGES.WEBSITE_INVALID });
  });

  it('writes only what an edit sent, and unlinks a logo without looking it up', async () => {
    const { service, repository, media } = setup();

    await service.update(ORG, 'kit-1', { logoMediaId: null, description: '' });

    expect(repository.updateBrandKit).toHaveBeenCalledWith(ORG, 'kit-1', {
      logoMediaId: null,
      description: null,
    });
    expect(media.findViews).not.toHaveBeenCalled();
  });

  it('says a kit that is gone could not be found', async () => {
    const { service, repository } = setup();
    repository.updateBrandKit.mockResolvedValue(null);
    repository.softDeleteBrandKit.mockResolvedValue(false);

    expect(await refusal(service.update(ORG, 'kit-x', { name: 'B' }))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND,
    });
    expect(await refusal(service.remove(ORG, 'kit-x'))).toMatchObject({ status: 404 });
    expect(await refusal(service.get(ORG, 'kit-x'))).toMatchObject({ status: 404 });
  });

  it('lists kits with one library lookup, and survives a deleted logo and unreadable colours', async () => {
    const { service, repository, media } = setup();
    repository.listBrandKits.mockResolvedValue([
      kitRow({ id: 'kit-1', logoMediaId: 'gone' }),
      kitRow({
        id: 'kit-2',
        logoMediaId: 'media-1',
        colors: { primary: 'red' } as Prisma.JsonValue,
      }),
    ]);
    media.findViews.mockResolvedValue(new Map([['media-1', mediaView()]]));

    const [first, second] = await service.list(ORG);

    expect(media.findViews).toHaveBeenCalledTimes(1);
    expect(media.findViews).toHaveBeenCalledWith(ORG, ['gone', 'media-1']);
    expect(first).toMatchObject({ logoMediaId: 'gone', logoUrl: null, colors: COLORS });
    expect(second.colors).toEqual(brandFromTheme(themeById(DEFAULT_THEME_ID)));
  });
});

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

describe('share links', () => {
  it('makes a link whose token is shown once and stored only as its hash', async () => {
    const { service, repository } = setup({ webUrl: 'https://postgear.rkay.in/' });
    const before = Date.now();

    const view = await service.createShare(ORG, 'design-1', USER, 7);

    expect(view.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.url).toBe(`https://postgear.rkay.in/share/design/${view.token}`);

    const [written] = repository.createShare.mock.calls[0];
    expect(written.tokenHash).toBe(
      createHash('sha256')
        .update(view.token ?? '')
        .digest('hex'),
    );
    expect(written.tokenHash).not.toContain(view.token);
    expect(written.expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(written.expiresAt.getTime() - before).toBeLessThan(7 * 86_400_000 + 5_000);
  });

  it('keeps a link between one day and thirty whatever it is asked for', async () => {
    const { service, repository } = setup();
    const now = Date.now();

    await service.createShare(ORG, 'design-1', USER, 365);
    const [written] = repository.createShare.mock.calls[0];

    expect(Math.round((written.expiresAt.getTime() - now) / 86_400_000)).toBe(30);
  });

  it(`stops at ${MAX_ACTIVE_SHARES} working links for one design`, async () => {
    const { service, repository } = setup();
    repository.countActiveShares.mockResolvedValue(MAX_ACTIVE_SHARES);

    expect(await refusal(service.createShare(ORG, 'design-1', USER, 7))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.shareLimit(MAX_ACTIVE_SHARES),
      code: 'share_limit',
    });
    expect(repository.createShare).not.toHaveBeenCalled();
  });

  it('will not share, list or revoke for a design this workspace does not have', async () => {
    const { service, repository } = setup();
    repository.findDesign.mockResolvedValue(null);
    repository.revokeShare.mockResolvedValue(false);

    expect((await refusal(service.createShare(ORG, 'design-x', USER, 7))).status).toBe(404);
    expect((await refusal(service.listShares(ORG, 'design-x'))).status).toBe(404);
    expect(await refusal(service.revokeShare(ORG, 'design-x', 'share-1'))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.SHARE_NOT_FOUND,
    });
  });

  describe('resolveShare', () => {
    const TOKEN = 'a'.repeat(43);

    it('opens a working link and notes the view', async () => {
      const { service, repository } = setup();
      const row = shareRow();
      repository.findShareByHash.mockResolvedValue(row);

      expect(await service.resolveShare(TOKEN)).toBe(row);
      expect(repository.findShareByHash).toHaveBeenCalledWith(
        createHash('sha256').update(TOKEN).digest('hex'),
      );
      expect(repository.touchShare).toHaveBeenCalledWith('share-1', expect.any(Date));
    });

    it('still opens the link when noting the view fails', async () => {
      const { service, repository } = setup();
      repository.findShareByHash.mockResolvedValue(shareRow());
      repository.touchShare.mockRejectedValue(new Error('deadlock'));

      await expect(service.resolveShare(TOKEN)).resolves.toBeDefined();
    });

    it.each([
      ['never existed', null],
      ['was revoked', shareRow({ revokedAt: new Date() })],
      ['has expired', shareRow({ expiresAt: new Date(Date.now() - 1_000) })],
      [
        'points at a deleted design',
        shareRow({
          design: {
            id: 'design-1',
            organizationId: ORG,
            deletedAt: new Date(),
            organization: { name: 'Acme Workspace' },
          } as unknown as SharedDesignRow['design'],
        }),
      ],
    ])('answers a link that %s with the same 404', async (_label, row) => {
      const { service, repository } = setup();
      repository.findShareByHash.mockResolvedValue(row);

      expect(await refusal(service.resolveShare(TOKEN))).toMatchObject({
        status: 404,
        message: STUDIO_MESSAGES.SHARE_UNAVAILABLE,
      });
      expect(repository.touchShare).not.toHaveBeenCalled();
    });

    it.each(['short', 'has spaces in it that no token has', `${'a'.repeat(129)}`, '../../etc'])(
      'does not look up %s',
      async (token) => {
        const { service, repository } = setup();

        expect((await refusal(service.resolveShare(token))).status).toBe(404);
        expect(repository.findShareByHash).not.toHaveBeenCalled();
      },
    );
  });
});
