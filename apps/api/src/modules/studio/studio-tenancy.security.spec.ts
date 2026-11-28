/**
 * Security sweep, Sprint 13 Module 16: a Studio design of document version 3
 * (the Schedule Maker's week) is another workspace's to read or change only
 * when it is theirs.
 *
 * The existing tenancy tests (`studio.service.spec.ts` "says a design that is
 * not in this workspace could not be found", "answers 404 for a design
 * another workspace owns") hand the service a repository that answers null.
 * This one runs the real `StudioRepository` over an in-memory design table
 * that reads each `where` as Postgres would, so a query that forgot its
 * workspace would find the row: every way in (read, save, copy, delete,
 * export, send, print, download, share links) answers 404 for another
 * workspace and leaves the design and its rows exactly as they were.
 */
import type { BrowserPool } from '@postgear/seo-engine';
import {
  DESIGN_SCHEMA_VERSION,
  designDocumentSchema,
  documentFromPreset,
} from '@postgear/design-engine';
import type { ConfigService } from '@nestjs/config';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { ChannelsService } from '../channels/channels.service';
import type { MediaService } from '../media/media.service';
import type { PostsService } from '../posts/posts.service';
import type { RedisService } from '../redis/redis.service';
import { BrandKitsService } from './brand-kits.service';
import { StudioRepository } from './studio.repository';
import { StudioService } from './studio.service';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {},
}));

const OURS = 'org-ours';
const THEIRS = 'org-theirs';
const DESIGN_ID = 'design-theirs-week';
const SHARE_ID = 'share-theirs';

type Row = Record<string, unknown>;

/** Does `row` satisfy a Prisma `where` of plain equalities, `null`, `{ gt }`, `{ not }` and one relation? */
function matches(
  row: Row,
  where: Row,
  relations: Record<string, (row: Row) => Row | undefined> = {},
): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key in relations) {
      const related = relations[key]?.(row);
      return related !== undefined && matches(related, wanted as Row);
    }
    const value = row[key];
    if (wanted !== null && typeof wanted === 'object' && !(wanted instanceof Date)) {
      const filter = wanted as Row;
      if ('gt' in filter) return value instanceof Date && value > (filter.gt as Date);
      if ('not' in filter) return value !== filter.not;
      if ('in' in filter) return (filter.in as unknown[]).includes(value);
      if ('contains' in filter) return typeof value === 'string';
      return false;
    }
    return value === wanted;
  });
}

const prismaDb = jest.requireMock('@postgear/db').prisma as Record<string, unknown>;

function seed() {
  let counter = 0;
  const base = documentFromPreset({
    presetId: 'schedule-week-clean-blue',
    format: 'portrait',
    newId: () => `s-${++counter}`,
  });
  const slide = base.slides[0];
  if (!slide) throw new Error('no slide');
  const document = designDocumentSchema.parse({
    ...base,
    schedule: {
      source: 'twitch',
      login: 'theirstreamer',
      timeZone: 'Asia/Kolkata',
      weekStart: '2026-11-23',
      fetchedAt: '2026-11-28T10:00:00.000Z',
      hour12: true,
    },
    slides: [
      {
        ...slide,
        elements: {
          ...slide.elements,
          schedule: {
            rows: [
              { day: 'Mon', time: '7 PM', title: 'Their Private Plans' },
              { day: 'Tue', time: '', title: '', off: true },
            ],
          },
        },
      },
    ],
  });
  const designs: Row[] = [
    {
      id: DESIGN_ID,
      organizationId: THEIRS,
      title: 'Their Week',
      format: 'PORTRAIT',
      presetId: 'schedule-week-clean-blue',
      brandKitId: null,
      document,
      revision: 4,
      status: 'DRAFT',
      exportedMediaIds: ['media-theirs'],
      lastExportedRevision: 4,
      lastSlideIndex: 0,
      createdById: 'u-theirs',
      deletedAt: null,
      createdAt: new Date('2026-11-20T10:00:00Z'),
      updatedAt: new Date('2026-11-20T10:00:00Z'),
    },
  ];
  const shares: Row[] = [
    {
      id: SHARE_ID,
      designId: DESIGN_ID,
      tokenHash: 'hash',
      revokedAt: null,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date('2026-11-20T10:00:00Z'),
      createdById: 'u-theirs',
      lastViewedAt: null,
    },
  ];
  const designOf = (share: Row) => designs.find((design) => design.id === share.designId);
  const writes: string[] = [];

  Object.assign(prismaDb, {
    design: {
      findFirst: jest.fn(
        async ({ where }: { where: Row }) => designs.find((row) => matches(row, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        designs.filter((row) => matches(row, where)),
      ),
      count: jest.fn(
        async ({ where }: { where: Row }) => designs.filter((row) => matches(row, where)).length,
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = designs.filter((row) => matches(row, where));
        for (const row of hit) {
          writes.push(`design.updateMany:${String(row.id)}`);
          Object.assign(row, data);
        }
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        writes.push('design.create');
        const row = { ...designs[0], ...data, id: 'design-copy', revision: 1 };
        designs.push(row);
        return row;
      }),
    },
    designShare: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        shares.filter((row) => matches(row, where, { design: designOf })),
      ),
      count: jest.fn(
        async ({ where }: { where: Row }) => shares.filter((row) => matches(row, where)).length,
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = shares.filter((row) => matches(row, where, { design: designOf }));
        for (const row of hit) {
          writes.push(`designShare.updateMany:${String(row.id)}`);
          Object.assign(row, data);
        }
        return { count: hit.length };
      }),
      create: jest.fn(async () => {
        writes.push('designShare.create');
        return shares[0];
      }),
    },
  });

  const repository = new StudioRepository();
  const posts = { create: jest.fn() };
  const media = {
    findViews: jest.fn(async () => new Map()),
    readImageBytes: jest.fn(),
    saveGenerated: jest.fn(),
  };
  const pool = { available: jest.fn(async () => true), render: jest.fn(), printImages: jest.fn() };
  const studio = new StudioService(
    repository,
    media as unknown as MediaService,
    posts as unknown as PostsService,
    {
      list: jest.fn(async () => [{ id: 'channel-1' }]),
      listProviders: jest.fn(() => []),
    } as unknown as ChannelsService,
    pool as unknown as BrowserPool,
    { entitlement: jest.fn(async () => ({ tier: 'STANDARD' })) } as unknown as EntitlementsService,
  );
  const kits = new BrandKitsService(
    repository,
    media as unknown as MediaService,
    {} as unknown as RedisService,
    pool as unknown as BrowserPool,
    { get: () => 'http://localhost:3000' } as unknown as ConfigService<never, true>,
  );
  const snapshot = JSON.stringify({ designs, shares });
  return { studio, kits, repository, designs, shares, writes, posts, pool, document, snapshot };
}

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? -1;
  }
}

describe("another workspace's version 3 design", () => {
  it('is a version 3 document with a filled week, owned by them', () => {
    const { designs, document } = seed();
    expect(DESIGN_SCHEMA_VERSION).toBe(3);
    expect(document.schemaVersion).toBe(3);
    expect(document.schedule?.login).toBe('theirstreamer');
    expect(designs[0]?.organizationId).toBe(THEIRS);
  });

  it('is found by its own workspace, so the table reads the where honestly', async () => {
    const { studio, kits } = seed();
    expect(await statusOf(studio.get(THEIRS, DESIGN_ID))).toBe('ok');
    expect(await kits.listShares(THEIRS, DESIGN_ID)).toHaveLength(1);
  });

  it.each([
    ['read', (s: ReturnType<typeof seed>) => s.studio.get(OURS, DESIGN_ID)],
    [
      'saved over, week and all',
      (s: ReturnType<typeof seed>) =>
        s.studio.update(OURS, DESIGN_ID, {
          revision: 4,
          document: s.document,
          title: 'Taken',
        } as never),
    ],
    [
      'renamed',
      (s: ReturnType<typeof seed>) =>
        s.studio.update(OURS, DESIGN_ID, { revision: 4, title: 'Taken' } as never),
    ],
    ['copied', (s: ReturnType<typeof seed>) => s.studio.duplicate(OURS, 'u-ours', DESIGN_ID)],
    ['deleted', (s: ReturnType<typeof seed>) => s.studio.remove(OURS, DESIGN_ID)],
    [
      'exported',
      (s: ReturnType<typeof seed>) =>
        s.studio.prepareExport(OURS, DESIGN_ID, { imageFormat: 'png', scale: 1 } as never),
    ],
    [
      'sent to the composer',
      (s: ReturnType<typeof seed>) =>
        s.studio.prepareSend(OURS, DESIGN_ID, {
          channelIds: ['channel-1'],
          imageFormat: 'png',
        } as never),
    ],
    ['downloaded', (s: ReturnType<typeof seed>) => s.studio.prepareArchive(OURS, DESIGN_ID)],
    [
      'printed',
      (s: ReturnType<typeof seed>) =>
        s.studio.printPdf(OURS, DESIGN_ID, new AbortController().signal),
    ],
    [
      'given a share link',
      (s: ReturnType<typeof seed>) => s.kits.createShare(OURS, DESIGN_ID, 'u-ours', 7),
    ],
    [
      'asked for its share links',
      (s: ReturnType<typeof seed>) => s.kits.listShares(OURS, DESIGN_ID),
    ],
    [
      'has its share link revoked',
      (s: ReturnType<typeof seed>) => s.kits.revokeShare(OURS, DESIGN_ID, SHARE_ID),
    ],
  ])('cannot be %s: 404, and nothing of theirs changes', async (_name, act) => {
    const setup = seed();
    expect(await statusOf(act(setup))).toBe(404);
    expect(setup.writes).toEqual([]);
    expect(JSON.stringify({ designs: setup.designs, shares: setup.shares })).toBe(setup.snapshot);
    expect(setup.posts.create).not.toHaveBeenCalled();
    expect(setup.pool.render).not.toHaveBeenCalled();
    expect(setup.pool.printImages).not.toHaveBeenCalled();
  });

  it('never shows up in our list, our search or our status writes', async () => {
    const setup = seed();
    expect(
      (await setup.repository.listDesigns(OURS, {} as never, { skip: 0, take: 50 })).items,
    ).toEqual([]);
    expect(await setup.repository.searchDesigns(OURS, 'Week', {} as never, 10)).toEqual([]);
    await setup.repository.setDesignStatus(OURS, DESIGN_ID, 'SENT' as never);
    expect(
      await setup.repository.recordExport(OURS, DESIGN_ID, {
        mediaIds: [],
        revision: 9,
        status: 'EXPORTED' as never,
      }),
    ).toBeNull();
    expect(setup.writes).toEqual([]);
    expect(JSON.stringify({ designs: setup.designs, shares: setup.shares })).toBe(setup.snapshot);
  });
});
