/**
 * The cleanup sweep (Module 19 section 2), part by part, against fakes: the
 * notice once and the removal after it, short-lived files, abandoned
 * uploads, stale sharp ranges (an open job's kept), unused workspace files
 * (the preview too), old failed imports, the charge backstop given back
 * once, the storage notice once, orphans only after 24 hours and never an
 * open job's, overrides expired once with the stamp; and one failing part
 * never stops the others.
 */
import type { PrivateStorage } from '@postgear/storage';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { RedisService } from '../../redis/redis.service';
import { DAY_MS } from './clip-retention.rules';
import type { ClipRetentionService } from './clip-retention.service';
import { ClipSweepService, dailyKey, idsOfKey } from './clip-sweep.service';

const ORG = 'seed-demo-org';
const VIDEO = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-19T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Raw = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const raw: { handler: (sql: string, values: unknown[]) => unknown[] } = { handler: () => [] };

const fakePrisma = {
  clipVideo: {
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  clipAsset: {
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    groupBy: jest.fn(async (): Promise<unknown[]> => []),
  },
  clipJob: { count: jest.fn(async () => 0), findMany: jest.fn(async (): Promise<unknown[]> => []) },
  clipStorageNotice: {
    deleteMany: jest.fn(async () => ({ count: 0 })),
    upsert: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  orgEntitlementOverride: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
  entitlementChange: {
    findFirst: jest.fn(async (): Promise<unknown> => null),
    create: jest.fn(async () => ({})),
  },
  $transaction: jest.fn(
    async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(fakePrisma),
  ),
  $queryRaw: jest.fn((async (strings: TemplateStringsArray, ...values: unknown[]) =>
    raw.handler(strings.join('?'), values)) as Raw),
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return fakePrisma;
  },
}));

function build() {
  const retention = {
    retentionDays: jest.fn(async () => 7),
    removeVideo: jest.fn(async (orgId: string, id: string) => ({
      id,
      organizationId: orgId,
      title: 'A Talk',
    })),
    deleteFiles: jest.fn(async () => undefined),
  };
  const resolver = { get: jest.fn(async (): Promise<unknown> => 3) };
  const usage = { reverse: jest.fn(async () => ({ entryId: 'rev', duplicate: false })) };
  const notifications = { notify: jest.fn(async () => ({})) };
  const redis = {
    setIfAbsent: jest.fn(async () => false),
    set: jest.fn(async () => undefined),
  };
  const storage = {
    deletePrefix: jest.fn(async () => 1),
    delete: jest.fn(async () => undefined),
    abortUpload: jest.fn(async () => undefined),
    list: jest.fn(async (): Promise<unknown> => ({ objects: [], next: null })),
  };
  const service = new ClipSweepService(
    retention as unknown as ClipRetentionService,
    resolver as unknown as EntitlementResolver,
    usage as unknown as UsageService,
    notifications as unknown as NotificationsService,
    redis as unknown as RedisService,
    storage as unknown as PrivateStorage,
  );
  return { service, retention, resolver, usage, notifications, redis, storage };
}

beforeEach(() => {
  jest.clearAllMocks();
  raw.handler = () => [];
});

describe('notices and expiry', () => {
  it('sends the notice once and holds the date three days out', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        title: 'A Talk',
        lastUsedAt: ago(5 * DAY_MS),
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        expiryNoticeAt: null,
      },
    ]);
    const { service, notifications } = build();

    expect(await service.noticesAndExpiry(NOW)).toEqual({ noticed: 1, expired: 0 });
    expect(fakePrisma.clipVideo.updateMany).toHaveBeenCalledWith({
      where: { id: VIDEO, organizationId: ORG, expiryNoticeAt: null, deletedAt: null },
      data: { expiryNoticeAt: NOW, expiresAt: new Date(NOW.getTime() + 3 * DAY_MS) },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        type: 'clip_video_expiring',
        content: '"A Talk" will be removed in 3 days. Open it to keep it longer.',
        link: `/${ORG}/clips/video/${VIDEO}`,
        email: false,
      }),
    );
  });

  it('writes no second notice when another pass already marked it', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        title: 'A Talk',
        lastUsedAt: ago(5 * DAY_MS),
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        expiryNoticeAt: null,
      },
    ]);
    fakePrisma.clipVideo.updateMany.mockResolvedValueOnce({ count: 0 });
    const { service, notifications } = build();

    expect(await service.noticesAndExpiry(NOW)).toEqual({ noticed: 0, expired: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('removes a video past its date and tells the workspace why', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        title: 'A Talk',
        lastUsedAt: ago(8 * DAY_MS),
        expiresAt: ago(60_000),
        expiryNoticeAt: ago(3 * DAY_MS),
      },
    ]);
    const { service, retention, notifications } = build();

    expect(await service.noticesAndExpiry(NOW)).toEqual({ noticed: 0, expired: 1 });
    expect(retention.removeVideo).toHaveBeenCalledWith(ORG, VIDEO, 'expired', NOW);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clip_video_removed',
        content: '"A Talk" was removed because nobody opened it for 7 days.',
        link: `/${ORG}/clips?tab=videos`,
      }),
    );
  });

  it('moves the date forward when the plan now keeps videos longer', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        title: 'A Talk',
        lastUsedAt: ago(5 * DAY_MS),
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        expiryNoticeAt: null,
      },
    ]);
    const { service, retention, notifications } = build();
    retention.retentionDays.mockResolvedValueOnce(30);

    expect(await service.noticesAndExpiry(NOW)).toEqual({ noticed: 0, expired: 0 });
    expect(fakePrisma.clipVideo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { expiresAt: new Date(NOW.getTime() + 25 * DAY_MS), expiryNoticeAt: null },
      }),
    );
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(retention.removeVideo).not.toHaveBeenCalled();
  });
});

describe('short-lived files', () => {
  it('removes expired downloads and Preview Export files with their rows', async () => {
    raw.handler = (sql) =>
      sql.includes("kind IN ('DOWNLOAD', 'PROOF')")
        ? [
            { id: 'a1', organizationId: ORG, kind: 'DOWNLOAD', jobId: JOB },
            { id: 'a2', organizationId: ORG, kind: 'PROOF', jobId: JOB },
          ]
        : [];
    const { service, storage } = build();

    expect(await service.shortLivedFiles(NOW)).toBe(2);
    expect(storage.deletePrefix).toHaveBeenCalledWith(`clips/${ORG}/downloads/${JOB}/`);
    expect(storage.deletePrefix).toHaveBeenCalledWith(`clips/${ORG}/proofs/${JOB}/`);
    expect(fakePrisma.clipAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: 'a1', organizationId: ORG },
    });
  });
});

describe('abandoned uploads', () => {
  it('aborts the storage upload and removes the row and files', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        assets: [
          {
            key: `clips/${ORG}/${VIDEO}/original-${'a'.repeat(32)}.mp4`,
            meta: { uploadId: 'u'.repeat(32) },
          },
        ],
      },
    ]);
    const { service, storage, retention } = build();

    expect(await service.abandonedUploads(NOW)).toBe(1);
    expect(fakePrisma.clipVideo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          platform: 'UPLOAD',
          status: 'IMPORTING',
          createdAt: { lt: ago(DAY_MS) },
          jobs: { none: { kind: 'IMPORT' } },
        }),
      }),
    );
    expect(storage.abortUpload).toHaveBeenCalledWith(
      expect.stringContaining('original-'),
      'u'.repeat(32),
    );
    expect(retention.deleteFiles).toHaveBeenCalledWith(ORG, VIDEO);
  });
});

describe('stale sharp ranges', () => {
  it('lets go of link videos unused for 14 days, keeping one an open job reads', async () => {
    fakePrisma.clipAsset.findMany.mockResolvedValueOnce([
      { id: 's1', organizationId: ORG, key: 'k1', clipId: 'clip-idle' },
      { id: 's2', organizationId: ORG, key: 'k2', clipId: 'clip-exporting' },
    ]);
    fakePrisma.clipJob.count.mockImplementation(async (args?: unknown) =>
      (args as { where: { clipId: string } }).where.clipId === 'clip-exporting' ? 1 : 0,
    );
    const { service, storage } = build();

    expect(await service.staleSegments(NOW)).toBe(1);
    expect(fakePrisma.clipAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: 'SEGMENT',
          video: {
            deletedAt: null,
            hdAvailable: true,
            platform: { not: 'UPLOAD' },
            lastUsedAt: { lt: ago(14 * DAY_MS) },
          },
        },
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith('k1');
    expect(storage.delete).not.toHaveBeenCalledWith('k2');
    fakePrisma.clipJob.count.mockReset();
    fakePrisma.clipJob.count.mockResolvedValue(0);
  });
});

describe('unused workspace stickers and sounds', () => {
  it('deletes the file, its preview and the row', async () => {
    raw.handler = (sql, values) => {
      if (!sql.includes('jsonb_path_exists')) return [];
      expect(values).toContainEqual(ago(30 * DAY_MS));
      return [{ id: 'st1', organizationId: ORG, key: 'sticker-key', previewKey: 'preview-key' }];
    };
    const { service, storage } = build();

    expect(await service.unusedLibraryFiles(NOW)).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('sticker-key');
    expect(storage.delete).toHaveBeenCalledWith('preview-key');
  });
});

describe('old failed imports', () => {
  it('removes FAILED videos untouched for 7 days', async () => {
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([{ id: VIDEO, organizationId: ORG }]);
    const { service, retention } = build();

    expect(await service.failedImports(NOW)).toBe(1);
    expect(fakePrisma.clipVideo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'FAILED', deletedAt: null, updatedAt: { lt: ago(7 * DAY_MS) } },
      }),
    );
    expect(retention.removeVideo).toHaveBeenCalledWith(ORG, VIDEO, 'expired', NOW);
  });
});

describe('the charge backstop', () => {
  it('gives back a charge with no job once, through UsageService', async () => {
    raw.handler = (sql, values) => {
      if (!sql.includes('NOT EXISTS (SELECT 1 FROM "ClipJob"')) return [];
      expect(values).toContainEqual(ago(60 * 60_000));
      return [
        { id: 'entry-1', organizationId: ORG },
        { id: 'entry-2', organizationId: ORG },
      ];
    };
    const { service, usage } = build();
    usage.reverse.mockResolvedValueOnce({ entryId: 'r1', duplicate: false });
    usage.reverse.mockResolvedValueOnce({ entryId: 'r2', duplicate: true });

    expect(await service.chargeBackstop(NOW)).toBe(1);
    expect(usage.reverse).toHaveBeenCalledWith(ORG, 'entry-1');
    expect(usage.reverse).toHaveBeenCalledWith(ORG, 'entry-2');
  });
});

describe('the storage notice', () => {
  it('notifies a workspace over its plan once, and clears the row when under again', async () => {
    fakePrisma.clipAsset.groupBy.mockResolvedValueOnce([
      { organizationId: ORG, _sum: { bytes: BigInt(4 * 1024 ** 3) } },
      { organizationId: 'small-org', _sum: { bytes: BigInt(1024) } },
    ]);
    const { service, notifications, resolver } = build();

    expect(await service.storageNotices(NOW)).toBe(1);
    expect(resolver.get).toHaveBeenCalledWith(ORG, 'clips.storage_gb', NOW);
    expect(fakePrisma.clipStorageNotice.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: { notIn: [ORG] } },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clip_storage_over_limit',
        content:
          "Your videos use 4.3 GB, over your plan's 3 GB. Delete some, or upgrade, to bring in more.",
        link: `/${ORG}/clips?tab=videos&sort=size`,
      }),
    );

    // The next pass: already told, so no second notice.
    fakePrisma.clipAsset.groupBy.mockResolvedValueOnce([
      { organizationId: ORG, _sum: { bytes: BigInt(4 * 1024 ** 3) } },
    ]);
    fakePrisma.clipStorageNotice.updateMany.mockResolvedValueOnce({ count: 0 });
    notifications.notify.mockClear();
    expect(await service.storageNotices(NOW)).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('orphan files (daily)', () => {
  it('deletes only old files with no row that no open job or import owns', async () => {
    const OPEN_JOB = '44444444-4444-4444-8444-444444444444';
    const keys = {
      known: `clips/${ORG}/${VIDEO}/proxy-${'a'.repeat(32)}.mp4`,
      preview: `clips/${ORG}/library/${'b'.repeat(32)}.webp`,
      fresh: `clips/${ORG}/${VIDEO}/poster-${'c'.repeat(32)}.webp`,
      busy: `clips/${ORG}/exports/${OPEN_JOB}/render.mp4`,
      orphan: `clips/${ORG}/downloads/${JOB}/file.mp4`,
    };
    const { service, storage } = build();
    storage.list.mockResolvedValueOnce({
      objects: [
        { key: keys.known, bytes: 1, modifiedAt: ago(5 * DAY_MS) },
        { key: keys.preview, bytes: 1, modifiedAt: ago(5 * DAY_MS) },
        { key: keys.fresh, bytes: 1, modifiedAt: ago(60_000) },
        { key: keys.busy, bytes: 1, modifiedAt: ago(5 * DAY_MS) },
        { key: keys.orphan, bytes: 1, modifiedAt: ago(2 * DAY_MS) },
      ],
      next: null,
    });
    raw.handler = (sql) =>
      sql.includes("meta->>'previewKey' = ANY") ? [{ key: keys.known }, { key: keys.preview }] : [];
    fakePrisma.clipJob.findMany.mockResolvedValueOnce([{ id: OPEN_JOB }]);
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([]);
    fakePrisma.clipAsset.findMany.mockResolvedValueOnce([
      { key: keys.known },
      { key: `clips/${ORG}/${VIDEO}/filmstrip-${'d'.repeat(32)}.jpg` },
    ]);

    expect(await service.orphanFiles(NOW)).toEqual({ objects: 5, deleted: 1, missing: 1 });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(keys.orphan);
  });

  it('reads the ids a key sits under', () => {
    expect(idsOfKey(`clips/${ORG}/${VIDEO}/proxy-${'a'.repeat(32)}.mp4`)).toEqual([VIDEO]);
    expect(idsOfKey(`clips/${ORG}/downloads/${JOB}/file.mp4`)).toEqual([JOB]);
    expect(idsOfKey(`clips/${ORG}/library/${'b'.repeat(32)}.png`)).toEqual([]);
  });
});

describe('overrides past their end date (daily)', () => {
  it('writes one EXPIRE row and the stamp, and never twice', async () => {
    const override = {
      organizationId: ORG,
      key: 'clips.ai_minutes_per_month',
      value: 100,
      expiresAt: ago(DAY_MS),
    };
    fakePrisma.orgEntitlementOverride.findMany.mockResolvedValue([override]);
    const { service, redis } = build();

    expect(await service.expireOverrides(NOW)).toBe(1);
    expect(fakePrisma.entitlementChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'ORG',
        organizationId: ORG,
        key: 'clips.ai_minutes_per_month',
        action: 'EXPIRE',
        oldValue: 100,
        actorId: null,
      }),
    });
    expect(redis.set).toHaveBeenCalledWith(`ent:org:${ORG}`, expect.any(String), 86_400);

    fakePrisma.entitlementChange.findFirst.mockResolvedValueOnce({ id: 'change-1' });
    fakePrisma.entitlementChange.create.mockClear();
    expect(await service.expireOverrides(NOW)).toBe(0);
    expect(fakePrisma.entitlementChange.create).not.toHaveBeenCalled();
    fakePrisma.orgEntitlementOverride.findMany.mockReset();
    fakePrisma.orgEntitlementOverride.findMany.mockResolvedValue([]);
  });
});

describe('sweep', () => {
  it('runs every part even when one throws, and names it', async () => {
    const { service, redis } = build();
    fakePrisma.clipVideo.findMany.mockRejectedValueOnce(new Error('database away'));

    const answer = await service.sweep({ now: NOW });

    expect(answer.failedParts).toEqual(['expiry']);
    expect(answer.orphans).toBeNull();
    expect(answer.overridesExpired).toBeNull();
    expect(redis.setIfAbsent).toHaveBeenCalledWith(dailyKey(NOW), '1', 26 * 3600);
    expect(fakePrisma.clipAsset.groupBy).toHaveBeenCalled();
  });

  it('runs the daily parts on the first pass of the day, or when forced', async () => {
    const { service, redis, storage } = build();
    redis.setIfAbsent.mockResolvedValueOnce(true);
    expect((await service.sweep({ now: NOW })).orphans).toEqual({
      objects: 0,
      deleted: 0,
      missing: 0,
    });

    storage.list.mockClear();
    expect((await service.sweep({ now: NOW, daily: true })).overridesExpired).toBe(0);
    expect(storage.list).toHaveBeenCalledWith('clips/', { after: null, limit: 1000 });
  });

  it('keys the daily gate by UTC day', () => {
    expect(dailyKey(NOW)).toBe('clips:sweep:daily:2026-11-19');
  });
});
