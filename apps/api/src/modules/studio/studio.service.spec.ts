/**
 * Designs, export and send, against fakes. The exporter is the real one on a
 * fake browser pool, so the event order, the warnings and the failure events
 * asserted here are what a browser would receive. What these cover: nothing
 * crosses a workspace, a stale save is a conflict and never an overwrite, a
 * design is always built on the server, an export saves slide by slide and
 * names the slide that failed, and Send reuses a current export or makes a
 * fresh one before the draft.
 *
 * Sprint 9b adds: premium looks refused with a 402 in a workspace without a
 * paid plan (and never taken away from a design that has one), a kit's fonts
 * and call to action copied into a new design, duplicate in another format,
 * 2x exports, the PDF, captions.txt, the Designs search and kit names on
 * cards.
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Logger } from '@nestjs/common';
import { BrandKitSource, DesignFormat, DesignStatus, type Prisma } from '@postgear/db';
import {
  ART_STYLES,
  applyBrandKit,
  type DesignDocument,
  designMediaIds,
  documentFromPreset,
  FONT_IDS,
  FORMAT_IDS,
  type FormatId,
  findLayout,
  formatSpec,
  isPresetPremium,
  issueMessage,
  PRESETS,
  presetById,
  presetFormats,
  setFormat,
  slideMediaIds,
  THEMES,
  updateElement,
} from '@postgear/design-engine';
import type { BrowserPool } from '@postgear/seo-engine';
import { documentFromText, IntegrationManager } from '@postgear/social-core';
import sharp from 'sharp';
import { securityLogger } from '../../common/logging/security-logger';
import type { SseStream } from '../../common/sse';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { ChannelsService } from '../channels/channels.service';
import type { MediaService, MediaView } from '../media/media.service';
import type { PostsService } from '../posts/posts.service';
import { CAPTION_FILE_NAME } from './design-archive';
import { INSTALL_HINT } from './design-exporter';
import {
  DESIGNS_PAGE_SIZE,
  FORMAT_TO_COLUMN,
  MAX_TITLE_LENGTH,
  updateDesignSchema,
} from './dto/studio.schema';
import { SLIDE_FAILURE_REASONS, STUDIO_MESSAGES } from './studio.messages';
import { PREMIUM_LOOK_REQUIRED_CODE } from './studio.premium';
import type {
  BrandKitRow,
  DesignRow,
  DesignWrite,
  SharedDesignRow,
  StudioRepository,
} from './studio.repository';
import { EXPORT_JPEG_QUALITY, PDF_TIMEOUT_MS, StudioService } from './studio.service';
import type { StudioExportEvent } from './studio.types';

// The template guards real templates cannot reach (every layout takes all
// four formats today), so `presetFormats` and `setFormat` can be told
// otherwise per test. `isPresetPremium` too, so the premium rule is tested
// on a template whose look is known, whatever the library holds this week.
jest.mock('@postgear/design-engine', () => {
  const actual = jest.requireActual('@postgear/design-engine');
  return {
    ...actual,
    presetFormats: jest.fn(actual.presetFormats),
    isPresetPremium: jest.fn(actual.isPresetPremium),
    setFormat: jest.fn(actual.setFormat),
  };
});

/** A premium theme and a premium art style, and a free theme, from the real library. */
function premiumLook() {
  const theme = THEMES.find((candidate) => candidate.premium === true);
  const art = ART_STYLES.find((candidate) => candidate.premium === true);
  const free = THEMES.find((candidate) => candidate.premium !== true);
  if (!theme || !art || !free) throw new Error('The library has no premium theme or art.');

  return { theme: theme.id, art: art.id, freeTheme: free.id };
}

/** The export options of every test that does not care about them. */
const JPEG_1X = { imageFormat: 'jpeg', scale: 1 } as const;

const ORG = 'org-1';
const USER = 'user-1';
const DESIGN_ID = 'design-1';
const LOGO_ID = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e01';
const VIDEO_ID = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e02';
const KIT_UPDATED = new Date('2026-10-02T00:00:00Z');
const COLORS = {
  primary: '#FF5A1F',
  secondary: '#1F6FFF',
  accent: '#00AA55',
  background: '#FFFDF8',
  text: '#1A1A1A',
};
const CLEAN_REPORT = { overflow: [], fontsMissing: [], fitError: null };

/** tips-steps-ink, five slides, no pictures. */
function plainDocument(): DesignDocument {
  return documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
}

/** The same with a kit logo, which every slide with a logo slot draws. */
function brandedDocument(kitId: string | null = 'kit-1'): DesignDocument {
  return applyBrandKit(plainDocument(), {
    kitId,
    colors: COLORS,
    logoMediaId: LOGO_ID,
    name: 'Acme',
    kitVersion: KIT_UPDATED.toISOString(),
    fonts: null,
  });
}

function designRow(overrides: Partial<DesignRow> = {}, document: unknown = plainDocument()) {
  return {
    id: DESIGN_ID,
    organizationId: ORG,
    title: 'Spring Sale',
    format: DesignFormat.SQUARE,
    presetId: 'tips-steps-ink',
    brandKitId: null,
    document: document as Prisma.JsonValue,
    revision: 3,
    status: DesignStatus.DRAFT,
    exportedMediaIds: [],
    lastExportedRevision: null,
    lastSlideIndex: 0,
    createdById: USER,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-03T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as DesignRow;
}

function kitRow(overrides: Partial<BrandKitRow> = {}): BrandKitRow {
  return {
    id: 'kit-1',
    organizationId: ORG,
    name: 'Acme',
    description: null,
    websiteUrl: null,
    logoMediaId: LOGO_ID,
    colors: COLORS as Prisma.JsonValue,
    headingFont: null,
    bodyFont: null,
    lockLook: false,
    ctaText: null,
    ctaUrl: null,
    source: BrandKitSource.MANUAL,
    createdById: USER,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: KIT_UPDATED,
    deletedAt: null,
    ...overrides,
  } as BrandKitRow;
}

function mediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: LOGO_ID,
    name: 'logo.png',
    type: 'image',
    mimeType: 'image/png',
    fileSize: 100,
    width: 200,
    height: 80,
    url: `http://localhost:3001/uploads/${overrides.id ?? LOGO_ID}`,
    thumbnailUrl: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  } as MediaView;
}

let logo: { bytes: Buffer; mimeType: string };

beforeAll(async () => {
  logo = {
    bytes: await sharp({ create: { width: 8, height: 8, channels: 4, background: '#FF5A1F' } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
  };
});

function setup(design: DesignRow | null = designRow()) {
  /** What the workspace's media library holds, by id. */
  const library = new Map<string, MediaView>();

  const repository = {
    listDesigns: jest.fn(async () => ({ items: [] as DesignRow[], total: 0 })),
    searchDesigns: jest.fn(async (): Promise<DesignRow[]> => []),
    findDesign: jest.fn(async (): Promise<DesignRow | null> => design),
    createDesign: jest.fn(async (data: Record<string, unknown>) =>
      designRow(
        {
          id: 'design-new',
          title: data.title as string,
          format: data.format as DesignFormat,
          presetId: data.presetId as string,
          brandKitId: data.brandKitId as string | null,
          createdById: data.createdById as string | null,
          revision: 1,
        },
        data.document,
      ),
    ),
    updateDesign: jest.fn(
      async (
        _orgId: string,
        _id: string,
        revision: number,
        data: DesignWrite,
      ): Promise<DesignRow | null> =>
        designRow(
          { ...(data as Partial<DesignRow>), revision: revision + 1 },
          data.document ?? design?.document,
        ),
    ),
    recordExport: jest.fn(
      async (
        _orgId: string,
        _id: string,
        _data: { mediaIds: string[]; revision: number; status: DesignStatus },
      ): Promise<DesignRow | null> => design,
    ),
    setDesignStatus: jest.fn(async () => undefined),
    softDeleteDesign: jest.fn(async () => true),
    findBrandKit: jest.fn(async (): Promise<BrandKitRow | null> => null),
    brandKitState: jest.fn(async (): Promise<'live' | 'deleted' | 'unknown'> => 'live'),
    brandKitNames: jest.fn(
      async (_orgId: string, _ids: string[]): Promise<Map<string, string>> => new Map(),
    ),
    listFavourites: jest.fn(async (): Promise<string[]> => []),
    addFavourite: jest.fn(async () => undefined),
    removeFavourite: jest.fn(async () => undefined),
  };
  const media = {
    findViews: jest.fn(async (_orgId: string, ids: string[]) => {
      const found = new Map<string, MediaView>();
      for (const id of ids) {
        const view = library.get(id);
        if (view) found.set(id, view);
      }
      return found;
    }),
    readImageBytes: jest.fn(async (_orgId: string, id: string) =>
      library.get(id)?.type === 'image' ? logo : null,
    ),
    saveGenerated: jest.fn(async (_orgId: string, file: { name: string }) =>
      mediaView({ id: randomUUID(), name: file.name, mimeType: 'image/jpeg' }),
    ),
  };
  const posts = {
    create: jest.fn(async (_orgId: string, _input: unknown) => ({ group: 'group-1' })),
  };
  const channels = {
    list: jest.fn(async () => [{ id: 'channel-1' }, { id: 'channel-2' }]),
    listProviders: jest.fn(() => new IntegrationManager().list()),
  };
  const pool = {
    available: jest.fn(async () => true),
    acquire: jest.fn(),
    release: jest.fn(),
    close: jest.fn(),
    render: jest.fn(
      async (_options: Record<string, unknown>): Promise<{ image: Buffer; value: unknown }> => ({
        image: Buffer.from('a png'),
        value: CLEAN_REPORT,
      }),
    ),
    printImages: jest.fn(async (_options: Record<string, unknown>) => Buffer.from('%PDF-1.4')),
  };
  /** A paid workspace unless a test says otherwise, as the seeded demo one is. */
  const entitlements = {
    entitlement: jest.fn(async (_orgId: string) => ({ tier: 'STANDARD' })),
  };

  const service = new StudioService(
    repository as unknown as StudioRepository,
    media as unknown as MediaService,
    posts as unknown as PostsService,
    channels as unknown as ChannelsService,
    pool as unknown as BrowserPool,
    entitlements as unknown as EntitlementsService,
  );

  return { service, repository, media, library, posts, channels, pool, entitlements };
}

/** A stream that records every event, and can be told to drop like a closed tab. */
function stream(options: { abortOn?: StudioExportEvent['type'] } = {}) {
  const controller = new AbortController();
  const events: StudioExportEvent[] = [];
  const sse: SseStream = {
    send: jest.fn((type: string, data: unknown) => {
      expect(type).toBe((data as StudioExportEvent).type);
      events.push(data as StudioExportEvent);
      if (type === options.abortOn) controller.abort();
    }),
    close: jest.fn(),
    signal: controller.signal,
    closed: false,
  };

  return { sse, events, controller };
}

function ofType<T extends StudioExportEvent['type']>(events: StudioExportEvent[], type: T) {
  return events.filter(
    (event): event is Extract<StudioExportEvent, { type: T }> => event.type === type,
  );
}

/** The status, sentence and code an HttpException would answer with. */
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

/** A promise and the function that settles it, to hold a render mid-flight. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

let securityWarn: jest.SpyInstance;
let loggerError: jest.SpyInstance;

beforeEach(() => {
  securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined);
  loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Listing and opening
// ---------------------------------------------------------------------------

describe('list', () => {
  it('pages through the database and sends each card its first slide only', async () => {
    const { service, repository, library } = setup();
    library.set(LOGO_ID, mediaView());
    repository.listDesigns.mockResolvedValue({
      items: [designRow({}, brandedDocument())],
      total: DESIGNS_PAGE_SIZE + 1,
    });

    const page = await service.list(ORG, { page: 2, format: 'square' });

    expect(repository.listDesigns).toHaveBeenCalledWith(
      ORG,
      { format: DesignFormat.SQUARE, status: undefined },
      { skip: DESIGNS_PAGE_SIZE, take: DESIGNS_PAGE_SIZE },
    );
    expect(page).toMatchObject({ page: 2, pageCount: 2, total: DESIGNS_PAGE_SIZE + 1 });

    const [card] = page.designs;
    expect(card).toMatchObject({ id: DESIGN_ID, format: 'square', slideCount: 5, revision: 3 });
    expect(card.cover?.slides).toHaveLength(1);
    expect(Object.keys(card.coverMedia)).toEqual(slideMediaIds(brandedDocument(), 0));
    expect(card).not.toHaveProperty('organizationId');
    expect(card).not.toHaveProperty('deletedAt');
  });

  it('narrows a search by its longest word, then checks every word itself', async () => {
    const { service, repository } = setup();
    repository.searchDesigns.mockResolvedValue([
      designRow({ id: 'd1', title: 'Spring Sale Week' }),
      designRow({ id: 'd2', title: 'Spring Launch' }),
    ]);

    const page = await service.list(ORG, { page: 1, search: 'sale spring' });

    expect(repository.searchDesigns).toHaveBeenCalledWith(
      ORG,
      'spring',
      { format: undefined, status: undefined },
      200,
    );
    expect(repository.listDesigns).not.toHaveBeenCalled();
    expect(page.designs.map((design) => design.id)).toEqual(['d1']);
    expect(page).toMatchObject({ total: 1, pageCount: 1 });
  });

  it('pages through search matches in memory', async () => {
    const { service, repository } = setup();
    repository.searchDesigns.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) =>
        designRow({ id: `d${index}`, title: `Sale ${index}` }),
      ),
    );

    const page = await service.list(ORG, { page: 2, search: 'sale' });

    expect(page.designs.map((design) => design.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `d${DESIGNS_PAGE_SIZE + index}`),
    );
    expect(page).toMatchObject({ page: 2, pageCount: 2, total: 30 });
  });

  it('treats a one-letter search as no search', async () => {
    const { service, repository } = setup();

    await service.list(ORG, { page: 1, search: 's' });

    expect(repository.searchDesigns).not.toHaveBeenCalled();
    expect(repository.listDesigns).toHaveBeenCalled();
  });

  it('names the brand kit on each card as it is now, in one query for the page', async () => {
    const { service, repository } = setup();
    repository.listDesigns.mockResolvedValue({
      items: [
        designRow({ id: 'd1', brandKitId: 'kit-1' }),
        designRow({ id: 'd2', brandKitId: 'kit-1' }),
        designRow({ id: 'd3', brandKitId: 'kit-gone' }),
        designRow({ id: 'd4', brandKitId: null }),
      ],
      total: 4,
    });
    repository.brandKitNames.mockResolvedValue(new Map([['kit-1', 'Acme Spring']]));

    const page = await service.list(ORG, { page: 1 });

    expect(repository.brandKitNames).toHaveBeenCalledTimes(1);
    expect(repository.brandKitNames).toHaveBeenCalledWith(ORG, ['kit-1', 'kit-gone']);
    expect(page.designs.map((design) => design.brandKitName)).toEqual([
      'Acme Spring',
      'Acme Spring',
      null,
      null,
    ]);
  });

  it('still lists a design this version cannot read, with no cover', async () => {
    const { service, repository } = setup();
    repository.listDesigns.mockResolvedValue({
      items: [designRow({ lastSlideIndex: 4 }, { version: 999, slides: [] })],
      total: 1,
    });

    const [card] = (await service.list(ORG, { page: 1 })).designs;

    expect(card).toMatchObject({
      cover: null,
      coverMedia: {},
      slideCount: 0,
      themeId: null,
      lastSlideIndex: 0,
    });
  });
});

describe('get', () => {
  it('opens a design with every picture it draws and the kit logo, images only', async () => {
    const photoPreset = PRESETS.find((preset) =>
      documentFromPreset({ presetId: preset.id, format: 'square' }).slides.some((slide) =>
        findLayout(slide.layoutId)?.slots.some((slot) => slot.kind === 'image'),
      ),
    );
    if (!photoPreset) throw new Error('No template has a picture slot.');

    const base = applyBrandKit(documentFromPreset({ presetId: photoPreset.id, format: 'square' }), {
      kitId: 'kit-1',
      colors: null,
      logoMediaId: LOGO_ID,
      name: 'Acme',
      kitVersion: null,
      fonts: null,
    });
    const slideIndex = base.slides.findIndex((slide) =>
      findLayout(slide.layoutId)?.slots.some((slot) => slot.kind === 'image'),
    );
    const slot = findLayout(base.slides[slideIndex].layoutId)?.slots.find(
      (s) => s.kind === 'image',
    );
    if (!slot) throw new Error('The slide has no picture slot.');
    const document = updateElement(base, base.slides[slideIndex].id, slot.id, {
      mediaId: VIDEO_ID,
    });

    const { service, library } = setup(designRow({}, document));
    library.set(LOGO_ID, mediaView());
    library.set(VIDEO_ID, mediaView({ id: VIDEO_ID, type: 'video' as MediaView['type'] }));

    const detail = await service.get(ORG, DESIGN_ID);

    expect(designMediaIds(document)).toContain(VIDEO_ID);
    expect(Object.keys(detail.media)).toEqual([LOGO_ID]);
    expect(detail.media[LOGO_ID]).toEqual({
      url: mediaView().url,
      thumbnailUrl: null,
      name: 'logo.png',
      width: 200,
      height: 80,
    });
    expect(detail.document.slides).toHaveLength(document.slides.length);
  });

  it('names the linked kit on the design too', async () => {
    const { service, repository } = setup(designRow({ brandKitId: 'kit-1' }));
    repository.brandKitNames.mockResolvedValue(new Map([['kit-1', 'Acme']]));

    expect((await service.get(ORG, DESIGN_ID)).brandKitName).toBe('Acme');
    expect(repository.brandKitNames).toHaveBeenCalledWith(ORG, ['kit-1']);
  });

  it('says a design that is not in this workspace could not be found', async () => {
    const { service } = setup(null);

    expect(await refusal(service.get(ORG, 'design-x'))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.DESIGN_NOT_FOUND,
    });
  });

  it('answers a document this version cannot read with a 422, not a 500', async () => {
    const { service } = setup(designRow({}, { version: 999, slides: [] }));

    expect(await refusal(service.get(ORG, DESIGN_ID))).toEqual({
      status: 422,
      message: STUDIO_MESSAGES.DESIGN_UNREADABLE,
      code: 'design_unreadable',
    });
  });
});

// ---------------------------------------------------------------------------
// Creating, saving, duplicating
// ---------------------------------------------------------------------------

describe('create', () => {
  it('builds the design from the template on the server, copying the kit in', async () => {
    const { service, repository, library } = setup();
    library.set(LOGO_ID, mediaView());
    repository.findBrandKit.mockResolvedValue(kitRow());

    const detail = await service.create(ORG, USER, {
      presetId: 'tips-steps-ink',
      format: 'portrait',
      brandKitId: 'kit-1',
    });

    const written = repository.createDesign.mock.calls[0][0];
    expect(written).toMatchObject({
      orgId: ORG,
      title: presetById('tips-steps-ink')?.name,
      format: DesignFormat.PORTRAIT,
      presetId: 'tips-steps-ink',
      brandKitId: 'kit-1',
      createdById: USER,
    });
    expect((written.document as unknown as DesignDocument).brand).toEqual({
      kitId: 'kit-1',
      colors: COLORS,
      logoMediaId: LOGO_ID,
      name: 'Acme',
      kitVersion: KIT_UPDATED.toISOString(),
      fonts: null,
    });
    expect(detail.document.format).toBe('portrait');
    expect(detail.media[LOGO_ID]).toBeDefined();
  });

  it('leaves out a kit logo that was deleted, and colours that cannot be read', async () => {
    const { service, repository } = setup();
    repository.findBrandKit.mockResolvedValue(
      kitRow({ colors: { primary: 'red' } as Prisma.JsonValue }),
    );

    await service.create(ORG, USER, {
      presetId: 'tips-steps-ink',
      format: 'square',
      brandKitId: 'kit-1',
    });

    const { brand } = repository.createDesign.mock.calls[0][0]
      .document as unknown as DesignDocument;
    expect(brand).toMatchObject({ kitId: 'kit-1', colors: null, logoMediaId: null });
  });

  it('copies the kit fonts in, and leaves out a face the library no longer has', async () => {
    const [heading, body] = FONT_IDS;
    const { service, repository } = setup();
    repository.findBrandKit
      .mockResolvedValueOnce(kitRow({ headingFont: heading, bodyFont: body }))
      .mockResolvedValueOnce(kitRow({ headingFont: 'retired-face', bodyFont: null }));
    const input = { presetId: 'tips-steps-ink', format: 'square' as const, brandKitId: 'kit-1' };

    await service.create(ORG, USER, input);
    await service.create(ORG, USER, input);

    const brandOf = (call: number) =>
      (repository.createDesign.mock.calls[call][0].document as unknown as DesignDocument).brand;
    expect(brandOf(0).fonts).toEqual({ heading, body });
    expect(brandOf(1).fonts).toBeNull();
  });

  it('writes the kit call to action into the closing slide once, at creation', async () => {
    const { service, repository } = setup();
    repository.findBrandKit.mockResolvedValue(
      kitRow({ ctaText: 'Book a call', ctaUrl: 'acme.com/book' }),
    );

    await service.create(ORG, USER, {
      presetId: 'tips-steps-ink',
      format: 'square',
      brandKitId: 'kit-1',
    });

    const document = repository.createDesign.mock.calls[0][0].document as unknown as DesignDocument;
    const template = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    const closing = document.slides.findIndex(
      (slide) => findLayout(slide.layoutId)?.role === 'closing',
    );

    expect(closing).toBeGreaterThan(0);
    expect(document.slides[closing].elements.cta?.text).toBe('Book a call');
    // Every other slide keeps the template's words.
    expect(document.slides.slice(0, closing).map((slide) => slide.elements)).toEqual(
      template.slides.slice(0, closing).map((slide) => slide.elements),
    );
  });

  it('keeps the template words when the kit has no call to action', async () => {
    const { service, repository } = setup();
    repository.findBrandKit.mockResolvedValue(kitRow());

    await service.create(ORG, USER, {
      presetId: 'tips-steps-ink',
      format: 'square',
      brandKitId: 'kit-1',
    });

    const document = repository.createDesign.mock.calls[0][0].document as unknown as DesignDocument;
    const template = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    expect(document.slides.map((slide) => slide.elements)).toEqual(
      template.slides.map((slide) => slide.elements),
    );
  });

  it('starts a blank design as Untitled Design, and keeps a title it was given', async () => {
    const { service, repository } = setup();

    await service.create(ORG, USER, { presetId: 'blank', format: 'story' });
    await service.create(ORG, null, {
      presetId: 'tips-steps-ink',
      format: 'square',
      title: 'Launch Week',
    });

    expect(repository.createDesign.mock.calls[0][0]).toMatchObject({
      title: 'Untitled Design',
      presetId: 'blank',
      format: DesignFormat.STORY,
      brandKitId: null,
    });
    expect(repository.createDesign.mock.calls[1][0]).toMatchObject({
      title: 'Launch Week',
      createdById: null,
    });
  });

  it.each([
    [
      'a template that does not exist',
      { presetId: 'no-such-template', format: 'square' as const },
      404,
      STUDIO_MESSAGES.TEMPLATE_NOT_FOUND,
    ],
    [
      'a kit this workspace does not have',
      { presetId: 'tips-steps-ink', format: 'square' as const, brandKitId: 'kit-x' },
      404,
      STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND,
    ],
  ])('refuses %s and writes nothing', async (_label, input, status, message) => {
    const { service, repository } = setup();

    expect(await refusal(service.create(ORG, USER, input))).toMatchObject({ status, message });
    expect(repository.createDesign).not.toHaveBeenCalled();
  });

  it('refuses a template in a format it cannot be drawn in', async () => {
    const { service, repository } = setup();
    jest.mocked(presetFormats).mockReturnValueOnce(['story']);

    expect(
      await refusal(service.create(ORG, USER, { presetId: 'tips-steps-ink', format: 'square' })),
    ).toMatchObject({ status: 422, message: STUDIO_MESSAGES.TEMPLATE_WRONG_FORMAT });
    expect(repository.createDesign).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it('saves a title alone against the revision the editor loaded', async () => {
    const { service, repository } = setup();

    const result = await service.update(ORG, DESIGN_ID, { revision: 3, title: 'Summer Sale' });

    expect(repository.updateDesign).toHaveBeenCalledWith(ORG, DESIGN_ID, 3, {
      title: 'Summer Sale',
    });
    expect(result).toEqual({
      id: DESIGN_ID,
      title: 'Summer Sale',
      revision: 4,
      status: 'DRAFT',
      exportStale: true,
      lastSlideIndex: 0,
      updatedAt: '2026-10-03T00:00:00.000Z',
    });
  });

  it('keeps the row in step with the document, and the slide index inside it', async () => {
    const { service, repository } = setup();
    const document = applyBrandKit(
      documentFromPreset({ presetId: 'tips-steps-ink', format: 'story' }),
      {
        kitId: 'kit-1',
        colors: null,
        logoMediaId: null,
        name: 'Acme',
        kitVersion: null,
        fonts: null,
      },
    );

    const result = await service.update(
      ORG,
      DESIGN_ID,
      updateDesignSchema.parse({ revision: 3, document, lastSlideIndex: 19 }),
    );

    expect(repository.updateDesign).toHaveBeenCalledWith(ORG, DESIGN_ID, 3, {
      document,
      format: DesignFormat.STORY,
      presetId: 'tips-steps-ink',
      brandKitId: 'kit-1',
      lastSlideIndex: document.slides.length - 1,
    });
    expect(result.lastSlideIndex).toBe(document.slides.length - 1);
  });

  it('still saves a design whose kit was deleted, dropping only the link', async () => {
    const { service, repository } = setup();
    repository.brandKitState.mockResolvedValue('deleted');

    await service.update(
      ORG,
      DESIGN_ID,
      updateDesignSchema.parse({ revision: 3, document: brandedDocument() }),
    );

    expect(repository.updateDesign.mock.calls[0][3]).toMatchObject({ brandKitId: null });
    expect(securityWarn).not.toHaveBeenCalled();
  });

  it('records a kit this workspace never had, and does not link it', async () => {
    const { service, repository } = setup();
    repository.brandKitState.mockResolvedValue('unknown');

    await service.update(
      ORG,
      DESIGN_ID,
      updateDesignSchema.parse({ revision: 3, document: brandedDocument('kit-elsewhere') }),
    );

    expect(repository.brandKitState).toHaveBeenCalledWith(ORG, 'kit-elsewhere');
    expect(repository.updateDesign.mock.calls[0][3]).toMatchObject({ brandKitId: null });
    expect(securityWarn).toHaveBeenCalledWith('studio.foreign_reference', {
      orgId: ORG,
      kind: 'brand_kit',
    });
  });

  it('tells a save made from an older revision to reload, rather than overwriting', async () => {
    const { service, repository } = setup();
    repository.updateDesign.mockResolvedValue(null);

    expect(await refusal(service.update(ORG, DESIGN_ID, { revision: 2, title: 'Mine' }))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.DESIGN_CONFLICT,
      code: 'design_conflict',
    });
  });

  it('says a design deleted in the meantime could not be found', async () => {
    const { service, repository } = setup(null);
    repository.updateDesign.mockResolvedValue(null);

    expect(
      await refusal(service.update(ORG, DESIGN_ID, { revision: 3, title: 'Mine' })),
    ).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.DESIGN_NOT_FOUND,
    });
  });

  // The gallery filters on the row's format, so the row must follow the
  // document on every save: after the Design tab's Format select as much as
  // after anything else.
  it.each(FORMAT_IDS)(
    'writes the format column with every save of a %s document',
    async (format: FormatId) => {
      const { service, repository } = setup();
      const document = setFormat(plainDocument(), format);
      expect(document.format).toBe(format);

      await service.update(ORG, DESIGN_ID, updateDesignSchema.parse({ revision: 3, document }));

      expect(repository.updateDesign.mock.calls[0][3]).toMatchObject({
        format: FORMAT_TO_COLUMN[format],
      });
    },
  );

  it('leaves the format column alone when no document is saved', async () => {
    const { service, repository } = setup();

    await service.update(ORG, DESIGN_ID, { revision: 3, title: 'New Name', lastSlideIndex: 1 });

    expect(repository.updateDesign.mock.calls[0][3]).not.toHaveProperty('format');
  });
});

describe('duplicate and remove', () => {
  it('copies a design with fresh slide ids and a (Copy) title', async () => {
    const source = brandedDocument();
    const { service, repository } = setup(designRow({ brandKitId: 'kit-1' }, source));

    await service.duplicate(ORG, USER, DESIGN_ID);

    const written = repository.createDesign.mock.calls[0][0];
    const copy = written.document as unknown as DesignDocument;

    expect(written).toMatchObject({
      orgId: ORG,
      title: 'Spring Sale (Copy)',
      format: DesignFormat.SQUARE,
      brandKitId: 'kit-1',
      createdById: USER,
    });
    expect(copy.slides.map((slide) => slide.elements)).toEqual(
      source.slides.map((slide) => slide.elements),
    );

    const before = new Set(source.slides.map((slide) => slide.id));
    expect(copy.slides.every((slide) => !before.has(slide.id))).toBe(true);
    expect(new Set(copy.slides.map((slide) => slide.id)).size).toBe(copy.slides.length);
  });

  it('keeps a copy of a title at the limit inside the limit', async () => {
    const { service, repository } = setup(designRow({ title: 'a'.repeat(MAX_TITLE_LENGTH) }));

    await service.duplicate(ORG, USER, DESIGN_ID);

    const { title } = repository.createDesign.mock.calls[0][0];
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title).toMatch(/a \(Copy\)$/);
  });

  it('makes a Story version: the same slides in the new shape, named for it', async () => {
    const source = brandedDocument();
    const { service, repository } = setup(designRow({ brandKitId: 'kit-1' }, source));

    await service.duplicate(ORG, USER, DESIGN_ID, { format: 'story' });

    const written = repository.createDesign.mock.calls[0][0];
    const copy = written.document as unknown as DesignDocument;

    expect(written).toMatchObject({
      title: 'Spring Sale (Story)',
      format: DesignFormat.STORY,
      presetId: 'tips-steps-ink',
      brandKitId: 'kit-1',
    });
    expect(copy.format).toBe('story');
    expect(copy.slides.map((slide) => slide.layoutId)).toEqual(
      source.slides.map((slide) => slide.layoutId),
    );
    expect(copy.slides.map((slide) => slide.elements)).toEqual(
      source.slides.map((slide) => slide.elements),
    );
    expect(copy.slides.every((slide, index) => slide.id !== source.slides[index].id)).toBe(true);
  });

  it('keeps a Story title at the limit inside the limit', async () => {
    const { service, repository } = setup(designRow({ title: 'a'.repeat(MAX_TITLE_LENGTH) }));

    await service.duplicate(ORG, USER, DESIGN_ID, { format: 'story' });

    const { title } = repository.createDesign.mock.calls[0][0];
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title).toMatch(/a \(Story\)$/);
  });

  it('copies plainly when asked for the format the design already has, or none', async () => {
    const { service, repository } = setup();

    await service.duplicate(ORG, USER, DESIGN_ID, { format: 'square' });
    await service.duplicate(ORG, USER, DESIGN_ID, {});

    for (const [written] of repository.createDesign.mock.calls) {
      expect(written).toMatchObject({ title: 'Spring Sale (Copy)', format: DesignFormat.SQUARE });
    }
  });

  it('refuses a format the slides cannot take, with a sentence that says what to change', async () => {
    const { service, repository } = setup();
    jest.mocked(setFormat).mockImplementationOnce((document) => document);

    expect(await refusal(service.duplicate(ORG, USER, DESIGN_ID, { format: 'landscape' }))).toEqual(
      {
        status: 400,
        message: STUDIO_MESSAGES.formatUnavailable(0, 'Landscape'),
        code: 'format_unavailable',
      },
    );
    expect(repository.createDesign).not.toHaveBeenCalled();
  });

  it('will not copy a design that is missing or unreadable', async () => {
    expect((await refusal(setup(null).service.duplicate(ORG, USER, 'design-x'))).status).toBe(404);
    expect(
      (
        await refusal(
          setup(designRow({}, { version: 999 })).service.duplicate(ORG, USER, DESIGN_ID),
        )
      ).status,
    ).toBe(422);
  });

  it('says a design that is already gone could not be found', async () => {
    const { service, repository } = setup();
    repository.softDeleteDesign.mockResolvedValue(false);

    expect(await refusal(service.remove(ORG, 'design-x'))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.DESIGN_NOT_FOUND,
    });
  });
});

// ---------------------------------------------------------------------------
// Premium looks (Sprint 9b)
// ---------------------------------------------------------------------------

describe('premium looks', () => {
  const PREMIUM_REFUSAL = {
    status: 402,
    message: STUDIO_MESSAGES.PREMIUM_LOCKED,
    code: PREMIUM_LOOK_REQUIRED_CODE,
  };

  /** A workspace without a paid plan: never had one, or downgraded. */
  function locked(design: DesignRow | null = designRow()) {
    const context = setup(design);
    context.entitlements.entitlement.mockResolvedValue({ tier: 'FREE' });
    return context;
  }

  /** The stored design and a save of it with `changes`, through the real request schema. */
  function save(changes: Partial<DesignDocument>, stored: DesignDocument) {
    return updateDesignSchema.parse({ revision: 3, document: { ...stored, ...changes } });
  }

  it('tells the web app whether premium looks are open, per workspace', async () => {
    const paid = setup();
    expect(await paid.service.access(ORG)).toEqual({ premium: true });
    expect(paid.entitlements.entitlement).toHaveBeenCalledWith(ORG);

    expect(await locked().service.access(ORG)).toEqual({ premium: false });
  });

  it('refuses a premium template without a paid plan, with the code the lock dialog opens on', async () => {
    const { service, repository } = locked();
    jest.mocked(isPresetPremium).mockReturnValueOnce(true);

    expect(
      await refusal(service.create(ORG, USER, { presetId: 'tips-steps-ink', format: 'square' })),
    ).toEqual(PREMIUM_REFUSAL);
    expect(repository.createDesign).not.toHaveBeenCalled();
  });

  it('refuses a real premium template from the library, in a format it has', async () => {
    const preset = PRESETS.find((candidate) => isPresetPremium(candidate));
    if (!preset) throw new Error('The library has no premium template.');
    const { service } = locked();

    expect(
      await refusal(
        service.create(ORG, USER, { presetId: preset.id, format: presetFormats(preset)[0] }),
      ),
    ).toEqual(PREMIUM_REFUSAL);
  });

  it('opens a premium template to a paid workspace', async () => {
    const { service, repository, entitlements } = setup();
    jest.mocked(isPresetPremium).mockReturnValueOnce(true);

    await service.create(ORG, USER, { presetId: 'tips-steps-ink', format: 'square' });

    expect(entitlements.entitlement).toHaveBeenCalledWith(ORG);
    expect(repository.createDesign).toHaveBeenCalledTimes(1);
  });

  it('never asks billing about a free template', async () => {
    const { service, repository, entitlements } = locked();
    jest.mocked(isPresetPremium).mockReturnValueOnce(false);

    await service.create(ORG, USER, { presetId: 'tips-steps-ink', format: 'square' });

    expect(entitlements.entitlement).not.toHaveBeenCalled();
    expect(repository.createDesign).toHaveBeenCalledTimes(1);
  });

  it('refuses a save that changes the theme to a premium one, and writes nothing', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    const { service, repository } = locked(designRow({}, stored));

    expect(
      await refusal(service.update(ORG, DESIGN_ID, save({ themeId: look.theme }, stored))),
    ).toEqual(PREMIUM_REFUSAL);
    expect(repository.updateDesign).not.toHaveBeenCalled();
  });

  it('refuses a save that changes the background art to a premium one', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    const { service, repository } = locked(designRow({}, stored));

    expect(await refusal(service.update(ORG, DESIGN_ID, save({ art: look.art }, stored)))).toEqual(
      PREMIUM_REFUSAL,
    );
    expect(repository.updateDesign).not.toHaveBeenCalled();
  });

  it('keeps saving a design that already had its premium look, after a downgrade', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.theme, art: look.art };
    const { service, repository, entitlements } = locked(designRow({}, stored));

    await service.update(ORG, DESIGN_ID, save({ caption: 'Edited after the plan ended' }, stored));

    expect(repository.updateDesign).toHaveBeenCalledTimes(1);
    expect(entitlements.entitlement).not.toHaveBeenCalled();
  });

  it('refuses moving a downgraded design from one premium look to another', async () => {
    const look = premiumLook();
    const other = THEMES.find((theme) => theme.premium === true && theme.id !== look.theme);
    if (!other) throw new Error('The library has only one premium theme.');
    const stored = { ...plainDocument(), themeId: look.theme, art: null };
    const { service } = locked(designRow({}, stored));

    expect(
      (await refusal(service.update(ORG, DESIGN_ID, save({ themeId: other.id }, stored)))).code,
    ).toBe(PREMIUM_LOOK_REQUIRED_CODE);
  });

  it('saves a change to a premium look in a paid workspace', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    const { service, repository, entitlements } = setup(designRow({}, stored));

    await service.update(ORG, DESIGN_ID, save({ themeId: look.theme, art: look.art }, stored));

    expect(entitlements.entitlement).toHaveBeenCalledWith(ORG);
    expect(repository.updateDesign).toHaveBeenCalledTimes(1);
  });

  it('answers a stale save with the conflict, whatever look it holds, and writes nothing', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    const { service, repository } = locked(designRow({ revision: 5 }, stored));

    const answer = await refusal(
      service.update(ORG, DESIGN_ID, save({ themeId: look.theme }, stored)),
    );

    expect([answer.status, answer.code]).toEqual([409, 'design_conflict']);
    expect(repository.updateDesign).not.toHaveBeenCalled();
  });

  it('refuses a save sent ahead of the row, so a second save landing first cannot carry a premium look past the check', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    // The row is at 3; the save claims 4, the revision another save in flight would leave.
    const { service, repository } = locked(designRow({ revision: 3 }, stored));
    const ahead = updateDesignSchema.parse({
      revision: 4,
      document: { ...stored, themeId: look.theme },
    });

    const answer = await refusal(service.update(ORG, DESIGN_ID, ahead));

    expect([answer.status, answer.code]).toEqual([409, 'design_conflict']);
    expect(repository.updateDesign).not.toHaveBeenCalled();
  });

  it('answers a premium save of a deleted design with not found', async () => {
    const look = premiumLook();
    const { service, repository } = locked(null);

    const answer = await refusal(
      service.update(ORG, DESIGN_ID, save({ themeId: look.theme }, plainDocument())),
    );

    expect(answer.status).toBe(404);
    expect(repository.updateDesign).not.toHaveBeenCalled();
  });

  it('costs an ordinary autosave no extra read and no billing question', async () => {
    const look = premiumLook();
    const stored = { ...plainDocument(), themeId: look.freeTheme, art: null };
    const { service, repository, entitlements } = locked(designRow({}, stored));

    await service.update(ORG, DESIGN_ID, save({ caption: 'Hello' }, stored));

    expect(repository.findDesign).not.toHaveBeenCalled();
    expect(entitlements.entitlement).not.toHaveBeenCalled();
    expect(repository.updateDesign).toHaveBeenCalledTimes(1);
  });

  it('lets a workspace without a paid plan duplicate a premium design', async () => {
    const look = premiumLook();
    const { service, repository, entitlements } = locked(
      designRow({}, { ...plainDocument(), themeId: look.theme, art: look.art }),
    );

    await service.duplicate(ORG, USER, DESIGN_ID, { format: 'story' });

    expect(repository.createDesign).toHaveBeenCalledTimes(1);
    expect(entitlements.entitlement).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Favourites and share links
// ---------------------------------------------------------------------------

describe('prepareArchive', () => {
  const SLIDE_A = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e11';
  const SLIDE_B = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e12';

  async function names(entries: AsyncIterable<{ name: string; bytes: Uint8Array }>) {
    const seen: string[] = [];
    for await (const entry of entries) seen.push(entry.name);
    return seen;
  }

  it('hands over the last export, in slide order, named as the library names it', async () => {
    const { service, library } = setup(
      designRow({ exportedMediaIds: [SLIDE_B, SLIDE_A], lastExportedRevision: 3 }),
    );
    library.set(
      SLIDE_A,
      mediaView({ id: SLIDE_A, name: 'Spring Sale 02.jpg', mimeType: 'image/jpeg' }),
    );
    library.set(
      SLIDE_B,
      mediaView({ id: SLIDE_B, name: 'Spring Sale 01.jpg', mimeType: 'image/jpeg' }),
    );

    const archive = await service.prepareArchive(ORG, DESIGN_ID);

    expect(archive.fileName).toBe('Spring Sale.zip');
    expect(await names(archive.entries)).toEqual(['Spring Sale 01.jpg', 'Spring Sale 02.jpg']);
  });

  it('refuses a design that was never exported, before anything streams', async () => {
    const { service } = setup(designRow({ exportedMediaIds: [] }));

    expect(await refusal(service.prepareArchive(ORG, DESIGN_ID))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.DOWNLOAD_NOTHING,
      code: 'download_nothing',
    });
  });

  it('refuses when a slide of the export left the library, rather than zipping a gap', async () => {
    const { service, library } = setup(designRow({ exportedMediaIds: [SLIDE_A, SLIDE_B] }));
    library.set(SLIDE_A, mediaView({ id: SLIDE_A, name: 'Spring Sale 01.jpg' }));

    expect(await refusal(service.prepareArchive(ORG, DESIGN_ID))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.DOWNLOAD_MISSING,
      code: 'download_missing',
    });
  });

  it('refuses a video under an exported id: a slide is a picture', async () => {
    const { service, library } = setup(designRow({ exportedMediaIds: [VIDEO_ID] }));
    library.set(VIDEO_ID, mediaView({ id: VIDEO_ID, type: 'video', mimeType: 'video/mp4' }));

    expect((await refusal(service.prepareArchive(ORG, DESIGN_ID))).code).toBe('download_missing');
  });

  it('answers 404 for a design another workspace owns', async () => {
    const { service } = setup(null);

    expect(await refusal(service.prepareArchive(ORG, DESIGN_ID))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.DESIGN_NOT_FOUND,
    });
  });

  it('fails the stream when a slide disappears between the check and the read', async () => {
    const { service, library, media } = setup(designRow({ exportedMediaIds: [SLIDE_A] }));
    library.set(SLIDE_A, mediaView({ id: SLIDE_A, name: 'Spring Sale 01.jpg' }));
    media.readImageBytes.mockResolvedValueOnce(null as never);

    const archive = await service.prepareArchive(ORG, DESIGN_ID);

    await expect(names(archive.entries)).rejects.toThrow('Exported slide 1 is no longer readable.');
  });

  it('adds the caption as captions.txt after the slides', async () => {
    const document = { ...plainDocument(), caption: 'Five tips\r\nfor spring 🌱' };
    const { service, library } = setup(designRow({ exportedMediaIds: [SLIDE_A] }, document));
    library.set(
      SLIDE_A,
      mediaView({ id: SLIDE_A, name: 'Spring Sale 01.jpg', mimeType: 'image/jpeg' }),
    );

    const entries: Array<{ name: string; bytes: Uint8Array }> = [];
    for await (const entry of (await service.prepareArchive(ORG, DESIGN_ID)).entries) {
      entries.push(entry);
    }

    expect(entries.map((entry) => entry.name)).toEqual(['Spring Sale 01.jpg', CAPTION_FILE_NAME]);
    expect(new TextDecoder().decode(entries[1].bytes)).toBe('Five tips\nfor spring 🌱\n');
  });
});

describe('printPdf', () => {
  const SLIDE_A = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e21';
  const SLIDE_B = '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e22';

  /** A design exported as two square JPEGs, `edge` pixels a side. */
  function printable(edge = 1080) {
    const context = setup(designRow({ exportedMediaIds: [SLIDE_B, SLIDE_A] }));

    for (const id of [SLIDE_A, SLIDE_B]) {
      context.library.set(id, mediaView({ id, mimeType: 'image/jpeg', width: edge, height: edge }));
    }

    return context;
  }

  const live = () => new AbortController().signal;

  it('prints the last export a page per slide, in slide order, named for the design', async () => {
    const { service, pool, media } = printable();
    const handed: Array<{ bytes: Buffer; mimeType: string }> = [];
    pool.printImages.mockImplementation(async (options) => {
      for await (const image of options.images as AsyncIterable<{
        bytes: Buffer;
        mimeType: string;
      }>) {
        handed.push(image);
      }
      return Buffer.from('%PDF-1.4');
    });

    const pdf = await service.printPdf(ORG, DESIGN_ID, live());

    expect(pdf).toEqual({ fileName: 'Spring Sale.pdf', bytes: Buffer.from('%PDF-1.4') });
    expect(pool.printImages.mock.calls[0][0]).toMatchObject({
      width: 1080,
      height: 1080,
      timeoutMs: PDF_TIMEOUT_MS,
    });
    expect(media.readImageBytes.mock.calls.map(([, id]) => id)).toEqual([SLIDE_B, SLIDE_A]);
    expect(handed).toEqual([logo, logo]);
  });

  it('prints a 2x export on pages the size of its format', async () => {
    const { service, pool } = printable(2160);

    await service.printPdf(ORG, DESIGN_ID, live());

    expect(pool.printImages.mock.calls[0][0]).toMatchObject({ width: 1080, height: 1080 });
  });

  it('refuses what Download All refuses, before asking for a browser', async () => {
    const nothing = setup(designRow({ exportedMediaIds: [] }));
    expect((await refusal(nothing.service.printPdf(ORG, DESIGN_ID, live()))).code).toBe(
      'download_nothing',
    );

    const missing = setup(designRow({ exportedMediaIds: [SLIDE_A] }));
    expect((await refusal(missing.service.printPdf(ORG, DESIGN_ID, live()))).code).toBe(
      'download_missing',
    );
    expect(missing.pool.available).not.toHaveBeenCalled();
    expect(missing.pool.printImages).not.toHaveBeenCalled();

    expect((await refusal(setup(null).service.printPdf(ORG, DESIGN_ID, live()))).status).toBe(404);
  });

  it('says export is unavailable when there is no browser', async () => {
    const { service, pool } = printable();
    pool.available.mockResolvedValue(false);

    expect(await refusal(service.printPdf(ORG, DESIGN_ID, live()))).toEqual({
      status: 503,
      message: STUDIO_MESSAGES.EXPORT_UNAVAILABLE,
      code: 'export_unavailable',
    });
    expect(pool.printImages).not.toHaveBeenCalled();
  });

  it('answers a print that failed with a sentence, as nothing was sent yet', async () => {
    const { service, pool } = printable();
    pool.printImages.mockRejectedValue(
      new Error('Timeout 120000ms exceeded waiting for the print'),
    );

    expect(await refusal(service.printPdf(ORG, DESIGN_ID, live()))).toEqual({
      status: 503,
      message: STUDIO_MESSAGES.PDF_FAILED,
      code: 'pdf_failed',
    });
  });

  it('prints one PDF of a design at a time, and prints again once it is done', async () => {
    const { service, pool } = printable();
    const bytes = Buffer.from('%PDF-1.4');
    let finish: (pdf: typeof bytes) => void = () => {};
    pool.printImages.mockImplementationOnce(
      () => new Promise<typeof bytes>((resolve) => (finish = resolve)),
    );

    const first = service.printPdf(ORG, DESIGN_ID, live());
    // Let the first print reach the browser before the second click.
    await new Promise((resolve) => setImmediate(resolve));

    expect(await refusal(service.printPdf(ORG, DESIGN_ID, live()))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.PDF_BUSY,
      code: 'pdf_busy',
    });
    expect(pool.printImages).toHaveBeenCalledTimes(1);

    finish(bytes);
    await first;

    await expect(service.printPdf(ORG, DESIGN_ID, live())).resolves.toEqual({
      fileName: 'Spring Sale.pdf',
      bytes,
    });
  });

  it('will not print a design while it is being exported, since the export replaces its slides', async () => {
    const { service, pool } = printable();
    const held = gate();
    pool.render.mockImplementationOnce(async () => {
      await held.opened;
      return { image: Buffer.from('a png'), value: CLEAN_REPORT };
    });
    const running = (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(stream().sse);

    expect(await refusal(service.printPdf(ORG, DESIGN_ID, live()))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.EXPORT_BUSY,
      code: 'export_busy',
    });
    expect(pool.printImages).not.toHaveBeenCalled();

    held.open();
    await running;
  });

  it('frees the design for the next print after a print fails', async () => {
    const { service, pool } = printable();
    pool.printImages.mockRejectedValueOnce(new Error('The page crashed.'));

    expect((await refusal(service.printPdf(ORG, DESIGN_ID, live()))).code).toBe('pdf_failed');

    pool.printImages.mockResolvedValue(Buffer.from('%PDF-1.4'));
    await expect(service.printPdf(ORG, DESIGN_ID, live())).resolves.not.toBeNull();
  });

  it('answers nothing when the person went away mid-print', async () => {
    const { service, pool } = printable();
    const controller = new AbortController();
    pool.printImages.mockImplementation(async () => {
      controller.abort();
      throw new Error('The print was cancelled.');
    });

    await expect(service.printPdf(ORG, DESIGN_ID, controller.signal)).resolves.toBeNull();
  });
});

describe('search (the top bar)', () => {
  it('finds designs with every word, showing the first exported slide while it exists', async () => {
    const COVER = randomUUID();
    const { service, repository, library } = setup();
    library.set(COVER, mediaView({ id: COVER, thumbnailUrl: 'http://localhost:3001/thumb.webp' }));
    repository.searchDesigns.mockResolvedValue([
      designRow({ id: 'd1', title: 'Spring Sale Week', exportedMediaIds: [COVER, randomUUID()] }),
      designRow({ id: 'd2', title: 'Spring Launch' }),
      designRow({
        id: 'd3',
        title: 'Sale For Spring',
        format: DesignFormat.STORY,
        exportedMediaIds: [randomUUID()],
      }),
    ]);

    const found = await service.search(ORG, ['spring', 'sale'], 4);

    expect(repository.searchDesigns).toHaveBeenCalledWith(ORG, 'spring', {}, 200);
    expect(found).toEqual({
      designs: [
        {
          id: 'd1',
          title: 'Spring Sale Week',
          format: 'square',
          updatedAt: '2026-10-03T00:00:00.000Z',
          thumbnailUrl: 'http://localhost:3001/thumb.webp',
        },
        {
          id: 'd3',
          title: 'Sale For Spring',
          format: 'story',
          updatedAt: '2026-10-03T00:00:00.000Z',
          thumbnailUrl: null,
        },
      ],
      more: false,
    });
  });

  it('says when there are more matches than it shows', async () => {
    const { service, repository, media } = setup();
    repository.searchDesigns.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) =>
        designRow({ id: `d${index}`, title: `Sale ${index}` }),
      ),
    );

    const found = await service.search(ORG, ['sale'], 4);

    expect(found.designs.map((design) => design.id)).toEqual(['d0', 'd1', 'd2', 'd3']);
    expect(found.more).toBe(true);
    // Nothing exported, so nothing to look up.
    expect(media.findViews).not.toHaveBeenCalled();
  });
});

describe('favourites', () => {
  it('never offers the gallery a template that has been retired', async () => {
    const { service, repository } = setup();
    repository.listFavourites.mockResolvedValue(['tips-steps-ink', 'retired-template']);

    expect(await service.favourites(ORG)).toEqual({ presetIds: ['tips-steps-ink'] });
  });

  it('adds a real template and refuses one that does not exist', async () => {
    const { service, repository } = setup();

    await service.addFavourite(ORG, USER, 'tips-steps-ink');
    expect(repository.addFavourite).toHaveBeenCalledWith(ORG, 'tips-steps-ink', USER);

    expect(await refusal(service.addFavourite(ORG, USER, 'no-such-template'))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.TEMPLATE_NOT_FOUND,
    });
    expect(repository.addFavourite).toHaveBeenCalledTimes(1);
  });

  it('removes a favourite without minding whether it was there', async () => {
    const { service, repository } = setup();

    await expect(service.removeFavourite(ORG, 'tips-steps-ink')).resolves.toEqual({
      presetIds: [],
    });
    expect(repository.removeFavourite).toHaveBeenCalledWith(ORG, 'tips-steps-ink');
  });
});

describe('sharedView', () => {
  function share(document: unknown): SharedDesignRow {
    return {
      id: 'share-1',
      designId: DESIGN_ID,
      tokenHash: 'hash',
      expiresAt: new Date('2026-11-03T00:00:00Z'),
      revokedAt: null,
      lastViewedAt: null,
      createdById: USER,
      createdAt: new Date('2026-10-27T00:00:00Z'),
      design: { ...designRow({}, document), organization: { name: 'Acme Workspace' } },
    } as SharedDesignRow;
  }

  it('shows the design as it is now, without the kit id or version', async () => {
    const { service, library } = setup();
    library.set(LOGO_ID, mediaView());

    const view = await service.sharedView(share(brandedDocument()));

    expect(view).toMatchObject({
      title: 'Spring Sale',
      workspaceName: 'Acme Workspace',
      format: 'square',
      caption: '',
      expiresAt: '2026-11-03T00:00:00.000Z',
    });
    expect(view.document.brand).toMatchObject({
      kitId: null,
      kitVersion: null,
      logoMediaId: LOGO_ID,
    });
    expect(Object.keys(view.media)).toEqual([LOGO_ID]);
    expect(view.platforms.map((platform) => platform.id)).toEqual([
      'instagram',
      'facebook',
      'linkedin',
      'x',
    ]);
    expect(JSON.stringify(view)).not.toContain(ORG);
    expect(JSON.stringify(view)).not.toContain('kit-1');
  });

  it('calls a design this version cannot read a link that does not work', async () => {
    const { service } = setup();

    expect(await refusal(service.sharedView(share({ version: 999 })))).toMatchObject({
      status: 404,
      message: STUDIO_MESSAGES.SHARE_UNAVAILABLE,
    });
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('prepareExport', () => {
  it('saves every slide as it goes, in order, and records the export', async () => {
    const { service, repository, media, pool } = setup(designRow({ title: 'Spring/Sale' }));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    const spec = formatSpec('square');
    expect(events[0]).toEqual({
      type: 'start',
      slides: 5,
      format: 'square',
      width: spec.width,
      height: spec.height,
      imageFormat: 'jpeg',
      scale: 1,
    });
    expect(events.map((event) => event.type)).toEqual([
      'start',
      ...Array.from({ length: 5 }, () => ['slide', 'saved']).flat(),
      'done',
    ]);
    expect(ofType(events, 'slide')[1]).toEqual({
      type: 'slide',
      index: 1,
      total: 5,
      label: 'Rendering slide 2 of 5',
    });

    const saved = ofType(events, 'saved').map((event) => event.media.id);
    expect(ofType(events, 'done')[0]).toEqual({
      type: 'done',
      mediaIds: saved,
      status: 'EXPORTED',
      revision: 3,
      reused: false,
    });
    expect(repository.recordExport).toHaveBeenCalledWith(ORG, DESIGN_ID, {
      mediaIds: saved,
      revision: 3,
      status: 'EXPORTED',
    });
    expect(media.saveGenerated.mock.calls[0][1]).toEqual({
      data: Buffer.from('a png'),
      mimeType: 'image/png',
      name: 'Spring-Sale 01.jpg',
      alt: expect.stringMatching(/\S/),
      encode: { prefer: 'jpeg', quality: EXPORT_JPEG_QUALITY, maxEdge: spec.width },
    });
    expect(pool.render.mock.calls[0][0]).toMatchObject({ width: 1080, height: 1080, scale: 1 });
  });

  it('draws a 2x export at twice the pixels on the same layout, and keeps every pixel', async () => {
    const { service, media, pool } = setup(
      designRow(
        {},
        documentFromPreset({
          presetId: 'tips-steps-ink',
          format: 'story',
        }),
      ),
    );
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, { imageFormat: 'png', scale: 2 }))(sse);

    expect(events[0]).toMatchObject({
      type: 'start',
      format: 'story',
      width: 2160,
      height: 3840,
      scale: 2,
    });
    // Laid out at the format's own size and painted at twice the pixels.
    expect(pool.render.mock.calls[0][0]).toMatchObject({ width: 1080, height: 1920, scale: 2 });
    // The library's usual 2048 px cap would halve a 2x story; the slide's own size is the cap.
    expect(media.saveGenerated.mock.calls[0][1]).toMatchObject({
      encode: { prefer: 'png', maxEdge: 3840 },
    });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('names PNG slides .png, and describes a slide without words by its place', async () => {
    let document = plainDocument();
    const cover = document.slides[0];
    for (const slot of findLayout(cover.layoutId)?.slots ?? []) {
      if (slot.bind) continue;
      if (slot.kind === 'text') document = updateElement(document, cover.id, slot.id, { text: '' });
      if (slot.kind === 'list')
        document = updateElement(document, cover.id, slot.id, { items: [] });
    }
    const { service, media } = setup(designRow({}, document));

    await (await service.prepareExport(ORG, DESIGN_ID, { imageFormat: 'png', scale: 1 }))(
      stream().sse,
    );

    expect(media.saveGenerated.mock.calls[0][1]).toMatchObject({
      name: 'Spring Sale 01.png',
      alt: 'Spring Sale, slide 1',
      encode: { prefer: 'png' },
    });
  });

  it('keeps a design that was already sent at Sent', async () => {
    const { service, repository } = setup(designRow({ status: DesignStatus.SENT }));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(ofType(events, 'done')[0].status).toBe('SENT');
    expect(repository.recordExport.mock.calls[0][2]).toMatchObject({ status: 'SENT' });
  });

  it('warns once per slide about a deleted logo, and still finishes', async () => {
    const document = brandedDocument();
    const { service } = setup(designRow({}, document));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    const drawn = document.slides.flatMap((_, index) =>
      slideMediaIds(document, index).includes(LOGO_ID) ? [index] : [],
    );
    expect(drawn.length).toBeGreaterThan(0);
    expect(ofType(events, 'warning')).toEqual(
      drawn.map((slideIndex) => ({
        type: 'warning',
        kind: 'missingPicture',
        slideIndex,
        message: issueMessage(document, { kind: 'missingPicture', slideIndex, slot: 'logo' }),
      })),
    );
    // Found before drawing, so every warning comes before the first slide.
    expect(events.findIndex((event) => event.type === 'warning')).toBe(1);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('warns about a logo deleted while the export runs, on the slide that found it', async () => {
    const document = brandedDocument();
    const { service, library, media } = setup(designRow({}, document));
    library.set(LOGO_ID, mediaView());
    media.readImageBytes.mockResolvedValue(null);
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    const first = ofType(events, 'warning')[0];
    expect(first).toMatchObject({ kind: 'missingPicture' });
    const at = events.indexOf(first);
    expect(events[at - 1]).toMatchObject({ type: 'slide', index: first.slideIndex });
  });

  it('warns about text still too long at its smallest size', async () => {
    const document = plainDocument();
    const { service, pool } = setup(designRow({}, document));
    pool.render.mockResolvedValueOnce({
      image: Buffer.from('a png'),
      value: { ...CLEAN_REPORT, overflow: ['headline'] },
    });
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(ofType(events, 'warning')).toEqual([
      {
        type: 'warning',
        kind: 'overflow',
        slideIndex: 0,
        message: issueMessage(document, { kind: 'overflow', slideIndex: 0, slot: 'headline' }),
      },
    ]);
  });

  it('names the slide that could not be drawn and keeps the ones before it', async () => {
    const { service, pool, repository } = setup();
    pool.render
      .mockResolvedValueOnce({ image: Buffer.from('a png'), value: CLEAN_REPORT })
      .mockResolvedValueOnce({ image: Buffer.from('a png'), value: CLEAN_REPORT })
      .mockRejectedValueOnce(new Error('Protocol error (Page.captureScreenshot)'));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    const saved = ofType(events, 'saved').map((event) => event.media.id);
    expect(saved).toHaveLength(2);
    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'render_failed',
      message: STUDIO_MESSAGES.slideFailed(2, SLIDE_FAILURE_REASONS.unknown),
      slideIndex: 2,
      savedMediaIds: saved,
    });
    expect(repository.recordExport).not.toHaveBeenCalled();
  });

  it('says export is unavailable when the browser turns out to be missing', async () => {
    const { service, pool } = setup();
    pool.render.mockRejectedValue(
      new Error("browserType.launch: Executable doesn't exist at C:\\ms-playwright\\chromium"),
    );
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'no_browser',
      message: STUDIO_MESSAGES.EXPORT_UNAVAILABLE,
      slideIndex: 0,
      savedMediaIds: [],
    });
    expect(loggerError).toHaveBeenCalledWith(INSTALL_HINT);
  });

  it('names the slide the library could not take', async () => {
    const { service, media } = setup();
    media.saveGenerated
      .mockResolvedValueOnce(mediaView({ id: randomUUID(), mimeType: 'image/jpeg' }))
      .mockRejectedValueOnce(new Error('The bucket did not answer.'));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'save_failed',
      message: STUDIO_MESSAGES.slideNotSaved(1),
      slideIndex: 1,
      savedMediaIds: [ofType(events, 'saved')[0].media.id],
    });
  });

  it('reports anything else as a stop, listing every slide that was saved', async () => {
    const { service, repository } = setup();
    repository.recordExport.mockRejectedValue(new Error('deadlock detected'));
    const { sse, events } = stream();

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'unexpected',
      message: STUDIO_MESSAGES.EXPORT_FAILED,
      slideIndex: null,
      savedMediaIds: ofType(events, 'saved').map((event) => event.media.id),
    });
    expect(ofType(events, 'saved')).toHaveLength(5);
  });

  it('stops quietly when the tab closes, and frees the design for the next export', async () => {
    const { service, pool, repository } = setup();
    const { sse, events, controller } = stream();
    pool.render
      .mockResolvedValueOnce({ image: Buffer.from('a png'), value: CLEAN_REPORT })
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error('Target page, context or browser has been closed');
      });

    await (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(sse);

    expect(ofType(events, 'error')).toEqual([]);
    expect(ofType(events, 'saved')).toHaveLength(1);
    expect(repository.recordExport).not.toHaveBeenCalled();
    await expect(service.prepareExport(ORG, DESIGN_ID, JPEG_1X)).resolves.toBeInstanceOf(Function);
  });

  it('refuses before streaming when there is no browser, logging how to install it once', async () => {
    const { service, pool } = setup();
    pool.available.mockResolvedValue(false);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await refusal(service.prepareExport(ORG, DESIGN_ID, JPEG_1X))).toEqual({
        status: 503,
        message: STUDIO_MESSAGES.EXPORT_UNAVAILABLE,
        code: 'export_unavailable',
      });
    }
    expect(loggerError.mock.calls.filter(([message]) => message === INSTALL_HINT)).toHaveLength(1);
  });

  it('refuses a missing or unreadable design before checking for a browser', async () => {
    const missing = setup(null);
    expect((await refusal(missing.service.prepareExport(ORG, 'design-x', JPEG_1X))).status).toBe(
      404,
    );

    const unreadable = setup(designRow({}, { version: 999 }));
    expect((await refusal(unreadable.service.prepareExport(ORG, DESIGN_ID, JPEG_1X))).status).toBe(
      422,
    );
    expect(unreadable.pool.available).not.toHaveBeenCalled();
  });

  it('will not export one design twice at once', async () => {
    const { service, pool } = setup();
    const held = gate();
    pool.render.mockImplementationOnce(async () => {
      await held.opened;
      return { image: Buffer.from('a png'), value: CLEAN_REPORT };
    });

    const first = stream();
    const running = (await service.prepareExport(ORG, DESIGN_ID, JPEG_1X))(first.sse);

    expect(await refusal(service.prepareExport(ORG, DESIGN_ID, JPEG_1X))).toEqual({
      status: 409,
      message: STUDIO_MESSAGES.EXPORT_BUSY,
      code: 'export_busy',
    });

    held.open();
    await running;
    expect(first.events.at(-1)?.type).toBe('done');
  });

  it('turns away the second of two exports that both got past the check', async () => {
    const { service, pool } = setup();
    const held = gate();
    pool.render.mockImplementationOnce(async () => {
      await held.opened;
      return { image: Buffer.from('a png'), value: CLEAN_REPORT };
    });

    const runA = await service.prepareExport(ORG, DESIGN_ID, JPEG_1X);
    const runB = await service.prepareExport(ORG, DESIGN_ID, JPEG_1X);
    const a = stream();
    const b = stream();

    const runningA = runA(a.sse);
    await runB(b.sse);
    held.open();
    await runningA;

    expect(b.events).toEqual([
      {
        type: 'error',
        code: 'render_failed',
        message: STUDIO_MESSAGES.EXPORT_BUSY,
        slideIndex: null,
        savedMediaIds: [],
      },
    ]);
    expect(a.events.at(-1)?.type).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

describe('prepareSend', () => {
  const CURRENT = Array.from({ length: 5 }, () => randomUUID());

  /**
   * A design whose last export is still current, and the library that holds
   * it: square JPEGs at 1x unless a test says otherwise.
   */
  function exported(
    options: { ids?: string[]; exportedAt?: number; mimeType?: string; edge?: number } = {},
  ) {
    const ids = options.ids ?? CURRENT;
    const context = setup(
      designRow({ exportedMediaIds: ids, lastExportedRevision: options.exportedAt ?? 3 }),
    );
    const edge = options.edge ?? formatSpec('square').width;

    for (const id of CURRENT) {
      context.library.set(
        id,
        mediaView({ id, mimeType: options.mimeType ?? 'image/jpeg', width: edge, height: edge }),
      );
    }

    return context;
  }

  it('sends a current export as it is, without a browser', async () => {
    const { service, pool, posts, repository } = exported();
    pool.available.mockResolvedValue(false);
    const { sse, events } = stream();
    const before = Date.now();

    await (
      await service.prepareSend(ORG, DESIGN_ID, {
        channelIds: ['channel-1'],
        caption: 'Five tips\nfor spring',
        imageFormat: 'jpeg',
      })
    )(sse);

    expect(events).toEqual([
      { type: 'done', mediaIds: CURRENT, status: 'DRAFT', revision: 3, reused: true },
      { type: 'sent', group: 'group-1', mediaIds: CURRENT },
    ]);
    expect(pool.render).not.toHaveBeenCalled();

    const [orgId, body] = posts.create.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(orgId).toBe(ORG);
    expect(body).toMatchObject({
      state: 'DRAFT',
      shared: [
        {
          content: documentFromText('Five tips\nfor spring'),
          media: CURRENT.map((id) => ({ id })),
        },
      ],
      channels: [{ channelId: 'channel-1', customized: false }],
    });

    const publishDate = new Date(body.publishDate as string);
    expect(publishDate.getTime()).toBeGreaterThan(before);
    expect(publishDate.getUTCMinutes() + publishDate.getUTCSeconds()).toBe(0);
    expect(repository.setDesignStatus).toHaveBeenCalledWith(ORG, DESIGN_ID, DesignStatus.SENT);
  });

  it.each([
    ['the design changed since', { exportedAt: 2 }],
    ['a slide was added since', { ids: CURRENT.slice(0, 4) }],
    ['a picture was deleted from the library', { ids: [...CURRENT.slice(0, 4), randomUUID()] }],
    ['the pictures are PNGs and a JPEG set was asked for', { mimeType: 'image/png' }],
    ['the export was drawn at 2x, which no platform serves', { edge: 2160 }],
  ])('exports afresh when %s', async (_label, options) => {
    const { service, pool, posts } = exported(options);
    const { sse, events } = stream();

    await (
      await service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' })
    )(sse);

    expect(pool.render).toHaveBeenCalledTimes(5);
    // Send always draws at 1x.
    expect(pool.render.mock.calls.every(([options]) => options.scale === 1)).toBe(true);
    expect(ofType(events, 'start')[0]).toMatchObject({ width: 1080, height: 1080, scale: 1 });
    const fresh = ofType(events, 'saved').map((event) => event.media.id);
    expect(ofType(events, 'done')[0]).toMatchObject({ reused: false, mediaIds: fresh });
    expect(events.at(-1)).toEqual({ type: 'sent', group: 'group-1', mediaIds: fresh });
    expect(posts.create.mock.calls[0]).toEqual([
      ORG,
      expect.objectContaining({
        shared: [expect.objectContaining({ media: fresh.map((id) => ({ id })) })],
      }),
    ]);
  });

  it('uses the design caption when none was sent', async () => {
    const { service, posts } = exported();

    await (
      await service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' })
    )(stream().sse);

    expect(posts.create.mock.calls[0]).toEqual([
      ORG,
      expect.objectContaining({
        shared: [expect.objectContaining({ content: documentFromText('') })],
      }),
    ]);
  });

  it('refuses a caption no post could hold, before anything else', async () => {
    const { service, channels } = exported();
    const caption = Array.from({ length: 501 }, () => 'a').join('\n');

    expect(
      await refusal(
        service.prepareSend(ORG, DESIGN_ID, {
          channelIds: ['channel-1'],
          caption,
          imageFormat: 'jpeg',
        }),
      ),
    ).toMatchObject({ status: 400, message: STUDIO_MESSAGES.SEND_CAPTION_INVALID });
    expect(channels.list).not.toHaveBeenCalled();
  });

  it('refuses a channel this workspace does not have, and records it', async () => {
    const { service, pool } = setup();

    expect(
      await refusal(
        service.prepareSend(ORG, DESIGN_ID, {
          channelIds: ['channel-1', 'channel-9'],
          imageFormat: 'jpeg',
        }),
      ),
    ).toMatchObject({ status: 400, message: STUDIO_MESSAGES.CHANNEL_UNAVAILABLE });
    expect(securityWarn).toHaveBeenCalledWith('studio.foreign_reference', {
      orgId: ORG,
      kind: 'channel',
    });
    expect(pool.available).not.toHaveBeenCalled();
  });

  it('refuses before streaming when an export is needed and there is no browser', async () => {
    const { service, pool } = setup();
    pool.available.mockResolvedValue(false);

    expect(
      await refusal(
        service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' }),
      ),
    ).toMatchObject({ status: 503, code: 'export_unavailable' });
  });

  it.each([
    ['after a fresh export', setup, 'done' as const],
    ['after reusing an export', exported, 'done' as const],
  ])('makes no draft nobody will open, when the tab closes %s', async (_label, make, abortOn) => {
    const { service, posts, repository } = make();
    const { sse, events } = stream({ abortOn });

    await (
      await service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' })
    )(sse);

    expect(posts.create).not.toHaveBeenCalled();
    expect(repository.setDesignStatus).not.toHaveBeenCalled();
    expect(ofType(events, 'sent')).toEqual([]);
  });

  it('makes no draft when the export failed', async () => {
    const { service, pool, posts } = setup();
    pool.render.mockRejectedValue(new Error('Protocol error (Page.captureScreenshot)'));
    const { sse, events } = stream();

    await (
      await service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' })
    )(sse);

    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'render_failed', slideIndex: 0 });
    expect(posts.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'passes on a refusal the posts module wrote for a person',
      new BadRequestException('Instagram needs at least one image.'),
      'Instagram needs at least one image.',
    ],
    [
      'reads a refusal that carries a code',
      new ConflictException({ message: 'You have reached your plan limit.', code: 'plan_limit' }),
      'You have reached your plan limit.',
    ],
    [
      'says the export stopped for anything else',
      new Error('connection reset'),
      STUDIO_MESSAGES.EXPORT_FAILED,
    ],
  ])('%s, listing the saved slides', async (_label, error, message) => {
    const { service, posts, repository } = exported();
    posts.create.mockRejectedValue(error);
    const { sse, events } = stream();

    await (
      await service.prepareSend(ORG, DESIGN_ID, { channelIds: ['channel-1'], imageFormat: 'jpeg' })
    )(sse);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'send_failed',
      message,
      slideIndex: null,
      savedMediaIds: CURRENT,
    });
    expect(repository.setDesignStatus).not.toHaveBeenCalled();
  });
});
