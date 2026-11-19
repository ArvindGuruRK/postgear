/**
 * The operator's Library (Module 19 section 9): the licence guard at publish
 * and restore whatever the screen sends, a run publish that holds back what
 * the guard refuses, remove writing the deny list and deleting the files
 * (a fake storage), hide keeping clips working, the takedown count, and a
 * staged item never reaching the product's search.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClipLibraryRepository } from '../../clips/library/clip-library.repository';
import type { PrivateStorage, StorageBackend } from '../../media/storage/storage.interface';
import type { OperatorAuditService } from '../operator-audit.service';
import type {
  ItemDetailRow,
  OperatorLibraryRepository,
  RunRow,
  StagedItemRow,
} from './operator-library.repository';
import {
  libraryItemsQuerySchema,
  patchSourceSchema,
  publishRunSchema,
} from './operator-library.schema';
import { OperatorLibraryService } from './operator-library.service';

const actor = { id: 'op-1', email: 'demo@postgear.local' };

/** Every SQL the product's library search sends, as text. */
const productSql: string[] = [];
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        productSql.push(actual.Prisma.sql(strings, ...values).sql);
        return [{ total: 0 }];
      }),
    },
  };
});
const ITEM = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const REASON = 'A takedown request from the author.';

function item(over: Partial<ItemDetailRow> = {}): ItemDetailRow {
  return {
    id: ITEM,
    name: 'Whoosh',
    kind: 'SFX',
    category: 'whoosh',
    tags: ['air'],
    status: 'ACTIVE',
    statusReason: null,
    statusById: null,
    statusAt: null,
    licence: 'CC0-1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    author: 'Kenney',
    authorUrl: null,
    origin: 'kenney',
    originId: 'impact-1',
    sourceUrl: 'https://kenney.nl/assets/impact-sounds',
    originalWork: true,
    retrievedAt: new Date('2026-11-18'),
    sourceChecksum: 'a'.repeat(64),
    runId: RUN,
    fileKey: 'library/sounds/aa/whoosh.m4a',
    previewKey: null,
    bytes: 2048,
    durationMs: 900,
    width: null,
    height: null,
    createdAt: new Date('2026-11-18'),
    source: {
      id: 'src-1',
      code: 'kenney-impact-sounds',
      name: 'Kenney Impact Sounds',
      licence: 'CC0-1.0',
      requiresCredit: false,
      creditLine: null,
    },
    ...over,
  };
}

function run(over: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN,
    origin: 'openverse',
    args: { kind: 'sound' },
    startedAt: new Date('2026-11-18'),
    finishedAt: new Date('2026-11-18'),
    accepted: 3,
    rejected: 47,
    rejectionsByReason: { licence_not_allowed: 41, brand_name: 6 },
    reportKey: `ops/library-runs/${RUN}.md`,
    stickers: { staged: 0, active: 0, hidden: 0, removed: 0 },
    sounds: { staged: 3, active: 0, hidden: 0, removed: 0 },
    ...over,
  };
}

function staged(over: Partial<StagedItemRow> = {}): StagedItemRow {
  return {
    type: 'sound',
    id: ITEM,
    name: 'Whoosh',
    licence: 'CC0-1.0',
    origin: 'openverse',
    requiresCredit: false,
    creditLine: null,
    ...over,
  };
}

function build(row: ItemDetailRow = item()) {
  let current = row;
  const repository = {
    runs: jest.fn(async () => [run()]),
    run: jest.fn(async (): Promise<RunRow | null> => run()),
    stagedItemsOf: jest.fn(async (): Promise<StagedItemRow[]> => [staged()]),
    publishRunItems: jest.fn(
      async (_runId: string, ids: { sticker: string[]; sound: string[] }) =>
        ids.sticker.length + ids.sound.length,
    ),
    items: jest.fn(async () => ({ rows: [], total: 0 })),
    item: jest.fn(async () => current),
    usageCount: jest.fn(async () => 4),
    setStatus: jest.fn(
      async (_type: string, _id: string, _from: string[], to: 'ACTIVE' | 'HIDDEN') => {
        current = { ...current, status: to };
        return true;
      },
    ),
    markRemoved: jest.fn(async () => {
      current = { ...current, status: 'REMOVED' };
      return true;
    }),
    deny: jest.fn(async () => []),
    misses: jest.fn(async () => []),
    sources: jest.fn(async () => []),
    source: jest.fn(async () => null),
    updateSource: jest.fn(async () => ({})),
    emailsOf: jest.fn(async () => new Map<string, string>()),
  };
  const storage = {
    deleted: [] as string[],
    delete: jest.fn(async (key: string) => {
      storage.deleted.push(key);
    }),
    publicUrl: jest.fn((key: string) => `http://localhost:3001/uploads/${key}`),
  };
  const privateStorage = {
    signedUrl: jest.fn(async (key: string) => `http://localhost:3001/clips/files/signed-${key}`),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new OperatorLibraryService(
    repository as unknown as OperatorLibraryRepository,
    audit as unknown as OperatorAuditService,
    storage as unknown as StorageBackend,
    privateStorage as unknown as PrivateStorage,
  );
  return { service, repository, storage, privateStorage, audit };
}

describe('OperatorLibraryService licence guard', () => {
  it('refuses to publish a CC BY sound, whatever the screen sends', async () => {
    const { service, repository } = build(item({ status: 'STAGED', licence: 'CC-BY-4.0' }));
    await expect(service.publishItem('sound', ITEM, REASON, actor)).rejects.toMatchObject({
      response: {
        message:
          'This licence is not allowed for sounds. A sound can only be CC0, Public Domain or our own.',
        code: 'licence_not_allowed',
      },
    });
    expect(repository.setStatus).not.toHaveBeenCalled();
  });

  it('refuses an item from a source that is not one of the adapters', async () => {
    const { service } = build(item({ status: 'STAGED', origin: 'giphy' }));
    await expect(service.publishItem('sound', ITEM, REASON, actor)).rejects.toMatchObject({
      response: { code: 'unknown_source' },
    });
  });

  it('refuses a sticker whose source still needs its credit line', async () => {
    const { service } = build(
      item({
        status: 'STAGED',
        licence: 'CC-BY-4.0',
        origin: 'openpeeps',
        source: { ...item().source, requiresCredit: true, creditLine: null },
      }),
    );
    await expect(service.publishItem('sticker', ITEM, REASON, actor)).rejects.toMatchObject({
      response: { message: 'This source needs a credit line before its items are published.' },
    });
  });

  it('refuses to restore a hidden item the guard would not publish', async () => {
    const { service } = build(item({ status: 'HIDDEN', licence: 'CC-BY-4.0' }));
    await expect(service.restoreItem('sound', ITEM, REASON, actor)).rejects.toMatchObject({
      response: { code: 'licence_not_allowed' },
    });
  });

  it('publishes an allowed staged item and records it', async () => {
    const { service, repository, audit } = build(item({ status: 'STAGED' }));
    const view = await service.publishItem('sound', ITEM, REASON, actor);
    expect(repository.setStatus).toHaveBeenCalledWith(
      'sound',
      ITEM,
      ['STAGED'],
      'ACTIVE',
      REASON,
      'op-1',
    );
    expect(view.status).toBe('ACTIVE');
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'library.item_published' }),
    );
  });

  it('publishes only a staged item, and never a removed one', async () => {
    await expect(
      build(item({ status: 'ACTIVE' })).service.publishItem('sound', ITEM, REASON, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      build(item({ status: 'REMOVED' })).service.restoreItem('sound', ITEM, REASON, actor),
    ).rejects.toMatchObject({ response: { code: 'item_removed' } });
  });
});

describe('OperatorLibraryService runs', () => {
  it('lists a run with its rejections largest first and the review badge for Openverse', async () => {
    const { service } = build();
    const [view] = await service.runs();
    expect(view).toMatchObject({
      type: 'sound',
      needsReview: true,
      rejections: [
        { reason: 'licence_not_allowed', count: 41 },
        { reason: 'brand_name', count: 6 },
      ],
      counts: { staged: 3 },
    });
  });

  it('signs the licence report for ten minutes in the private space', async () => {
    const { service, privateStorage } = build();
    const view = await service.run(RUN);
    expect(privateStorage.signedUrl).toHaveBeenCalledWith(`ops/library-runs/${RUN}.md`, {
      expiresInSeconds: 600,
      downloadName: `library-run-${RUN}.md`,
    });
    expect(view.reportUrl).toContain('signed-');
  });

  it('needs the review tick', () => {
    expect(publishRunSchema.safeParse({}).success).toBe(false);
    expect(publishRunSchema.safeParse({ reviewed: false }).success).toBe(false);
    expect(publishRunSchema.safeParse({ reviewed: true }).success).toBe(true);
  });

  it('publishes the passing items and holds back the ones the guard refuses', async () => {
    const { service, repository, audit } = build();
    const bad = '55555555-5555-4555-8555-555555555555';
    repository.stagedItemsOf.mockResolvedValue([
      staged(),
      staged({ id: bad, name: 'Credit Me', licence: 'CC-BY-4.0' }),
    ]);
    const result = await service.publishRun(RUN, actor);
    expect(repository.publishRunItems).toHaveBeenCalledWith(
      RUN,
      { sticker: [], sound: [ITEM] },
      'op-1',
    );
    expect(result.published).toBe(1);
    expect(result.heldBack).toEqual([
      expect.objectContaining({
        id: bad,
        reason: expect.stringContaining('not allowed for sounds'),
      }),
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'library.run_published' }),
    );
  });

  it('refuses a run with nothing staged, and a run the guard refuses entirely', async () => {
    const { service, repository } = build();
    repository.stagedItemsOf.mockResolvedValueOnce([]);
    await expect(service.publishRun(RUN, actor)).rejects.toMatchObject({
      response: { code: 'nothing_staged' },
    });
    repository.stagedItemsOf.mockResolvedValueOnce([staged({ licence: 'CC-BY-4.0' })]);
    await expect(service.publishRun(RUN, actor)).rejects.toMatchObject({
      response: { code: 'licence_not_allowed' },
    });
    expect(repository.publishRunItems).not.toHaveBeenCalled();
  });

  it('answers 404 for a run that is not there', async () => {
    const { service, repository } = build();
    repository.run.mockResolvedValueOnce(null);
    await expect(service.run(RUN)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OperatorLibraryService hide and remove', () => {
  it('hides without touching the files, so clips that use it keep working', async () => {
    const { service, repository, storage } = build();
    const view = await service.hideItem('sound', ITEM, REASON, actor);
    expect(repository.setStatus).toHaveBeenCalledWith(
      'sound',
      ITEM,
      ['STAGED', 'ACTIVE'],
      'HIDDEN',
      REASON,
      'op-1',
    );
    expect(storage.delete).not.toHaveBeenCalled();
    expect(view.status).toBe('HIDDEN');
    expect(view.audioUrl).not.toBeNull();
  });

  it('removes: the deny list and the status first, then both files leave the public bucket', async () => {
    const sticker = item({
      kind: 'STATIC',
      fileKey: 'library/stickers/aa/fire.png',
      previewKey: 'library/previews/aa/fire.webp',
    });
    const { service, repository, storage, audit } = build(sticker);
    const order: string[] = [];
    repository.markRemoved.mockImplementationOnce(async () => {
      order.push('deny');
      return true;
    });
    storage.delete.mockImplementation(async (key: string) => {
      order.push(`delete ${key}`);
    });
    await service.removeItem('sticker', ITEM, REASON, actor);
    expect(repository.markRemoved).toHaveBeenCalledWith(
      'sticker',
      expect.objectContaining({
        sourceChecksum: 'a'.repeat(64),
        origin: 'kenney',
        originId: 'impact-1',
      }),
      REASON,
      'op-1',
    );
    expect(order).toEqual([
      'deny',
      'delete library/stickers/aa/fire.png',
      'delete library/previews/aa/fire.webp',
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'library.item_removed' }),
    );
  });

  it('keeps the removal when a file delete fails (logged, not thrown)', async () => {
    const { service, storage } = build();
    storage.delete.mockRejectedValueOnce(new Error('bucket down'));
    await expect(service.removeItem('sound', ITEM, REASON, actor)).resolves.toMatchObject({
      status: 'REMOVED',
    });
  });

  it('refuses a second removal', async () => {
    const { service, repository } = build(item({ status: 'REMOVED' }));
    await expect(service.removeItem('sound', ITEM, REASON, actor)).rejects.toMatchObject({
      response: { code: 'item_removed' },
    });
    expect(repository.markRemoved).not.toHaveBeenCalled();
  });

  it('shows how many clips use an item, and no file address once removed', async () => {
    const { service } = build(item({ status: 'REMOVED' }));
    const view = await service.item('sound', ITEM);
    expect(view.usage).toBe(4);
    expect(view.audioUrl).toBeNull();
  });
});

describe('OperatorLibraryService queries and sources', () => {
  it('searches with the product search words and pages by 25', async () => {
    const { service, repository } = build();
    await service.items(
      libraryItemsQuerySchema.parse({ type: 'sound', status: 'STAGED', q: 'fire whoo', page: '2' }),
    );
    expect(repository.items).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sound',
        status: 'STAGED',
        tsQuery: 'fire & whoo:*',
        limit: 25,
        offset: 25,
      }),
    );
  });

  it('takes no address of any kind: unknown query keys are refused', () => {
    expect(
      libraryItemsQuerySchema.safeParse({ type: 'sound', url: 'https://example.com' }).success,
    ).toBe(false);
    expect(
      patchSourceSchema.safeParse({ url: 'https://example.com', reason: 'Fixing the source link.' })
        .success,
    ).toBe(false);
    expect(patchSourceSchema.safeParse({ reason: 'Nothing to change at all.' }).success).toBe(
      false,
    );
  });

  it('flags a source that needs a credit line and has items waiting or live', async () => {
    const { service, repository } = build();
    repository.sources.mockResolvedValueOnce([
      {
        id: 'src-2',
        code: 'openpeeps',
        name: 'Open Peeps',
        author: 'Pablo Stanley',
        url: 'https://www.openpeeps.com',
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        creditLine: null,
        changeNote: null,
        noticeText: null,
        requiresCredit: true,
        creditPerItem: false,
        createdAt: new Date(),
        stickers: { staged: 12, active: 0, hidden: 0, removed: 0 },
        sounds: { staged: 0, active: 0, hidden: 0, removed: 0 },
      },
    ] as never);
    const [source] = await service.sources();
    expect(source).toMatchObject({ group: 'attribution', needsCreditLine: true });
  });

  it('changes only the credit words, and records the change', async () => {
    const { service, repository, audit } = build();
    const before = {
      id: 'src-2',
      code: 'openpeeps',
      name: 'Open Peeps',
      creditLine: null,
      changeNote: 'Resized',
      noticeText: null,
    };
    repository.source.mockResolvedValueOnce(before as never);
    repository.sources.mockResolvedValueOnce([
      {
        ...before,
        author: 'Pablo Stanley',
        url: 'https://www.openpeeps.com',
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        creditLine: 'Open Peeps by Pablo Stanley, CC BY 4.0',
        requiresCredit: true,
        creditPerItem: false,
        createdAt: new Date(),
        stickers: { staged: 12, active: 0, hidden: 0, removed: 0 },
        sounds: { staged: 0, active: 0, hidden: 0, removed: 0 },
      },
    ] as never);
    const view = await service.updateSource(
      'src-2',
      patchSourceSchema.parse({
        creditLine: 'Open Peeps by Pablo Stanley, CC BY 4.0',
        changeNote: 'Resized',
        reason: 'Adding the credit line.',
      }),
      actor,
    );
    expect(view.needsCreditLine).toBe(false);
    expect(repository.updateSource).toHaveBeenCalledWith('src-2', {
      creditLine: 'Open Peeps by Pablo Stanley, CC BY 4.0',
    });
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'library.source_updated' }),
    );
  });
});

describe('the product search', () => {
  it('never shows a staged, hidden or removed item: every search asks for ACTIVE only', async () => {
    const product = new ClipLibraryRepository();
    productSql.length = 0;
    await product.search('org-1', { tsQuery: null, favouritesOnly: false, limit: 24, offset: 0 });
    await product.search('org-1', {
      tsQuery: 'fire:*',
      favouritesOnly: true,
      limit: 24,
      offset: 0,
    });
    await product.searchSounds('org-1', {
      tsQuery: 'whoosh:*',
      favouritesOnly: false,
      limit: 24,
      offset: 0,
    });
    expect(productSql.length).toBeGreaterThanOrEqual(6);
    for (const sql of productSql) expect(sql).toContain(`s.status = 'ACTIVE'::"ClipLibraryStatus"`);
  });
});
