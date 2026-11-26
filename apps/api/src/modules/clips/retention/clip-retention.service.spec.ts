/**
 * `touchVideo` and `removeVideo` (Module 19 section 1) against a small fake
 * database: the date moves at most once a day and with the plan's days;
 * a removal keeps the row and the exported clips (marked), deletes the rest
 * and the files, stops open jobs, and is safe to call twice.
 */
import type { PrivateStorage } from '@postgear/storage';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import { DAY_MS } from './clip-retention.rules';
import { ClipRetentionService } from './clip-retention.service';

const ORG = 'seed-demo-org';
const VIDEO = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-19T12:00:00.000Z');

interface VideoRow {
  id: string;
  organizationId: string;
  title: string;
  platform: string;
  externalId: string | null;
  createdById: string | null;
  status: string;
  deletedAt: Date | null;
  removedReason: string | null;
  lastUsedAt: Date;
  expiresAt: Date | null;
  expiryNoticeAt: Date | null;
}
interface ClipRow {
  id: string;
  organizationId: string;
  videoId: string;
  lastExportedRevision: number | null;
  removedAt: Date | null;
}

const db = {
  videos: [] as VideoRow[],
  clips: [] as ClipRow[],
  assets: [] as Array<{ id: string; organizationId: string; videoId: string }>,
  jobs: [] as Array<{
    id: string;
    organizationId: string;
    videoId: string | null;
    clipId: string | null;
    status: string;
  }>,
};

function pick<T extends object>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (value instanceof Date)
      return actual instanceof Date && actual.getTime() === value.getTime();
    return actual === value;
  });
}

const fakePrisma = {
  clipVideo: {
    findFirst: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        db.videos.find((video) => pick(video, where)) ?? null,
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<VideoRow> }) => {
        const rows = db.videos.filter((video) => pick(video, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    ),
  },
  clip: {
    findMany: jest.fn(async ({ where }: { where: { organizationId: string; videoId: string } }) =>
      db.clips.filter(
        (clip) => clip.organizationId === where.organizationId && clip.videoId === where.videoId,
      ),
    ),
    deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = db.clips.length;
      db.clips = db.clips.filter((clip) => !pick(clip, where));
      return { count: before - db.clips.length };
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<ClipRow> }) => {
        const rows = db.clips.filter((clip) => pick(clip, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    ),
  },
  clipAsset: {
    deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = db.assets.length;
      db.assets = db.assets.filter((asset) => !pick(asset, where));
      return { count: before - db.assets.length };
    }),
  },
  clipJob: {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          organizationId: string;
          OR: Array<{ videoId?: string; clipId?: { in: string[] } }>;
        };
      }) =>
        db.jobs.filter(
          (job) =>
            job.organizationId === where.organizationId &&
            (job.status === 'QUEUED' || job.status === 'RUNNING') &&
            where.OR.some(
              (part) =>
                (part.videoId !== undefined && job.videoId === part.videoId) ||
                (part.clipId !== undefined &&
                  job.clipId !== null &&
                  part.clipId.in.includes(job.clipId)),
            ),
        ),
    ),
  },
  $transaction: jest.fn(
    async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(fakePrisma),
  ),
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return fakePrisma;
  },
}));

function video(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO,
    organizationId: ORG,
    title: 'A Long Stream',
    platform: 'TWITCH',
    externalId: '900000001',
    createdById: 'user-1',
    status: 'READY',
    deletedAt: null,
    removedReason: null,
    lastUsedAt: new Date(NOW.getTime() - 2 * DAY_MS),
    expiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
    expiryNoticeAt: null,
    ...overrides,
  };
}

function build(retentionDays: unknown = 7) {
  const resolver = { get: jest.fn(async () => retentionDays) };
  const jobs = { cancel: jest.fn(async () => ({})) };
  const storage = { deletePrefix: jest.fn(async () => 1) };
  const service = new ClipRetentionService(
    resolver as unknown as EntitlementResolver,
    jobs as unknown as ClipJobsService,
    storage as unknown as PrivateStorage,
  );
  return { service, resolver, jobs, storage };
}

beforeEach(() => {
  db.videos = [];
  db.clips = [];
  db.assets = [];
  db.jobs = [];
  jest.clearAllMocks();
});

describe('touchVideo', () => {
  it('moves the date to now plus the plan days and clears the notice', async () => {
    db.videos.push(video({ expiryNoticeAt: new Date(NOW.getTime() - DAY_MS) }));
    const { service, resolver } = build(14);

    expect(await service.touchVideo(ORG, VIDEO, NOW)).toBe(true);
    expect(resolver.get).toHaveBeenCalledWith(ORG, 'clips.retention_days');
    expect(db.videos[0]?.lastUsedAt).toEqual(NOW);
    expect(db.videos[0]?.expiresAt).toEqual(new Date(NOW.getTime() + 14 * DAY_MS));
    expect(db.videos[0]?.expiryNoticeAt).toBeNull();
  });

  it('writes at most once a day', async () => {
    db.videos.push(video({ lastUsedAt: new Date(NOW.getTime() - 3_600_000) }));
    const { service } = build();

    expect(await service.touchVideo(ORG, VIDEO, NOW)).toBe(false);
    expect(fakePrisma.clipVideo.updateMany).not.toHaveBeenCalled();
  });

  it('never moves a date closer than three days (a lower plan)', async () => {
    db.videos.push(video({ expiresAt: new Date(NOW.getTime() + 20 * DAY_MS) }));
    const { service } = build(1);

    await service.touchVideo(ORG, VIDEO, NOW);
    expect(db.videos[0]?.expiresAt).toEqual(new Date(NOW.getTime() + 3 * DAY_MS));
  });

  it('does nothing for another workspace, a removed video or one still coming in', async () => {
    db.videos.push(video({ organizationId: 'other-org' }));
    const { service } = build();
    expect(await service.touchVideo(ORG, VIDEO, NOW)).toBe(false);

    db.videos = [video({ status: 'IMPORTING' })];
    expect(await service.touchVideo(ORG, VIDEO, NOW)).toBe(false);
    db.videos = [video({ deletedAt: NOW })];
    expect(await service.touchVideo(ORG, VIDEO, NOW)).toBe(false);
  });

  it('never throws: a failed write is logged and the read goes on', async () => {
    db.videos.push(video({ lastUsedAt: new Date(0) }));
    const { service } = build();
    fakePrisma.clipVideo.updateMany.mockRejectedValueOnce(new Error('database away'));
    await expect(service.touchVideo(ORG, VIDEO, NOW)).resolves.toBe(false);
  });
});

describe('removeVideo', () => {
  function seed() {
    db.videos.push(video());
    db.clips.push(
      {
        id: 'clip-draft',
        organizationId: ORG,
        videoId: VIDEO,
        lastExportedRevision: null,
        removedAt: null,
      },
      {
        id: 'clip-exported',
        organizationId: ORG,
        videoId: VIDEO,
        lastExportedRevision: 3,
        removedAt: null,
      },
    );
    db.assets.push(
      { id: 'asset-proxy', organizationId: ORG, videoId: VIDEO },
      { id: 'asset-other', organizationId: ORG, videoId: '22222222-2222-4222-8222-222222222222' },
    );
    db.jobs.push(
      { id: 'job-import', organizationId: ORG, videoId: VIDEO, clipId: null, status: 'DONE' },
      {
        id: 'job-export',
        organizationId: ORG,
        videoId: null,
        clipId: 'clip-exported',
        status: 'RUNNING',
      },
    );
  }

  it.each([
    ['expired', 'REMOVED'],
    ['rights_request', 'REMOVED'],
    ['deleted', 'READY'],
  ] as const)(
    'for %s: keeps the row, marks it, removes files and unexported clips',
    async (reason, status) => {
      seed();
      const { service, jobs, storage } = build();

      const removed = await service.removeVideo(ORG, VIDEO, reason, NOW);

      expect(removed).toMatchObject({ id: VIDEO, title: 'A Long Stream', externalId: '900000001' });
      expect(db.videos[0]).toMatchObject({ deletedAt: NOW, removedReason: reason, status });
      expect(db.clips).toEqual([
        {
          id: 'clip-exported',
          organizationId: ORG,
          videoId: VIDEO,
          lastExportedRevision: 3,
          removedAt: NOW,
        },
      ]);
      expect(db.assets.map((asset) => asset.id)).toEqual(['asset-other']);
      expect(storage.deletePrefix).toHaveBeenCalledWith(`clips/${ORG}/${VIDEO}/`);
      // The running export of its clip is stopped; the finished import is left alone.
      expect(jobs.cancel).toHaveBeenCalledTimes(1);
      expect(jobs.cancel).toHaveBeenCalledWith(ORG, 'job-export');
    },
  );

  it('takes the face files with the video: their rows go and their keys sit under its prefix (Sprint 13, Module 07)', async () => {
    seed();
    const facesKey = `clips/${ORG}/${VIDEO}/faces-${'d'.repeat(32)}.json.gz`;
    db.assets.push({
      id: 'asset-faces',
      organizationId: ORG,
      videoId: VIDEO,
      kind: 'FACE_TRACKS',
      key: facesKey,
    } as (typeof db.assets)[number]);
    const { service, storage } = build();

    await service.removeVideo(ORG, VIDEO, 'deleted', NOW);

    expect(db.assets.map((asset) => asset.id)).toEqual(['asset-other']);
    const prefix = `clips/${ORG}/${VIDEO}/`;
    expect(storage.deletePrefix).toHaveBeenCalledWith(prefix);
    expect(facesKey.startsWith(prefix)).toBe(true);
  });

  it('answers null the second time and for another workspace', async () => {
    seed();
    const { service, storage } = build();
    await service.removeVideo(ORG, VIDEO, 'expired', NOW);
    storage.deletePrefix.mockClear();

    expect(await service.removeVideo(ORG, VIDEO, 'expired', NOW)).toBeNull();
    expect(await service.removeVideo('other-org', VIDEO, 'expired', NOW)).toBeNull();
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it('still removes when a job cannot be stopped or storage is away', async () => {
    seed();
    const { service, jobs, storage } = build();
    jobs.cancel.mockRejectedValueOnce(new Error('Temporal away'));
    storage.deletePrefix.mockRejectedValueOnce(new Error('storage away'));

    await expect(service.removeVideo(ORG, VIDEO, 'deleted', NOW)).resolves.toMatchObject({
      id: VIDEO,
    });
    expect(db.videos[0]?.deletedAt).toEqual(NOW);
  });
});
