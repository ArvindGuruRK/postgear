/**
 * The worker's internal calls and the maintenance pass, against fakes: the
 * upload charge answered once, an export handed to Media exactly once, and
 * a reconcile that never fails a job while Temporal is out of reach.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import type { UsageService } from '../../entitlements/usage.service';
import type { MediaService } from '../../media/media.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { ClipWorkflowState, SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { jobRow, TEST_ORG, videoRow } from '../testing/rows';
import { ClipReconcileService, lostJobCode } from './clip-reconcile.service';
import { ClipsInternalService } from './clips-internal.service';

const JOB_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_ID = '55555555-5555-4555-8555-555555555555';
const MEDIA_ID = '66666666-6666-4666-8666-666666666666';

const db = {
  jobs: [] as ClipJob[],
  entries: [] as Array<{
    id: string;
    organizationId: string;
    idempotencyKey: string;
    units: number;
  }>,
  videos: [] as Array<ReturnType<typeof videoRow>>,
  clips: [] as Array<{
    id: string;
    organizationId: string;
    title: string;
    lastExportedRevision: number | null;
    exportedMediaId: string | null;
  }>,
};

const fakePrisma = {
  usageEntry: {
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: { id?: string; idempotencyKey?: string; organizationId: string };
      }) =>
        db.entries.find(
          (entry) =>
            entry.organizationId === where.organizationId &&
            (where.id === undefined || entry.id === where.id) &&
            (where.idempotencyKey === undefined || entry.idempotencyKey === where.idempotencyKey),
        ) ?? null,
    ),
  },
  clipJob: {
    findFirst: jest.fn(
      async ({ where }: { where: { id: string; organizationId: string } }) =>
        db.jobs.find((job) => job.id === where.id && job.organizationId === where.organizationId) ??
        null,
    ),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ClipJob> }) => {
      const job = db.jobs.find((row) => row.id === where.id);
      if (job) Object.assign(job, data);
      return job;
    }),
  },
  clip: {
    updateMany: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const clip = db.clips.find((row) => row.id === where.id);
        if (clip) Object.assign(clip, data);
        return { count: clip ? 1 : 0 };
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        db.clips.find((row) => row.id === where.id) ?? null,
    ),
  },
  clipVideo: {
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }) => {
        const video = db.videos.find((row) => row.id === where.id && row.status === where.status);
        if (video) Object.assign(video, data);
        return { count: video ? 1 : 0 };
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        db.videos.find((row) => row.id === where.id) ?? null,
    ),
  },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return fakePrisma;
  },
}));

/** One transaction at a time, as Postgres orders two conflicting serializable ones. */
let chain: Promise<unknown> = Promise.resolve();
jest.mock('../clips.tx', () => ({
  serializable: (work: (client: unknown) => Promise<unknown>) => {
    const run = chain.then(() => work(fakePrisma));
    chain = run.catch(() => undefined);
    return run;
  },
}));

function deps() {
  const jobs = {
    startWaiting: jest.fn(async () => ['started-1']),
    restart: jest.fn(async () => true),
  };
  const jobsRepository = {
    find: jest.fn(
      async (orgId: string, id: string) =>
        db.jobs.find((job) => job.id === id && job.organizationId === orgId) ?? null,
    ),
    staleQueued: jest.fn(async () => db.jobs.filter((job) => job.status === 'QUEUED')),
    staleRunning: jest.fn(async () => db.jobs.filter((job) => job.status === 'RUNNING')),
    releaseClaim: jest.fn(async () => undefined),
    failOpen: jest.fn(async (jobId: string, error: unknown) => {
      const job = db.jobs.find(
        (row) => row.id === jobId && (row.status === 'QUEUED' || row.status === 'RUNNING'),
      );
      if (!job) return false;
      Object.assign(job, { status: 'FAILED', error });
      return true;
    }),
  };
  const limits = {
    chargeImport: jest.fn(async (orgId: string, jobId: string) => {
      const key = `clips.import:${jobId}`;
      let entry = db.entries.find((row) => row.idempotencyKey === key);
      if (!entry) {
        entry = {
          id: `entry-${db.entries.length + 1}`,
          organizationId: orgId,
          idempotencyKey: key,
          units: 1500,
        };
        db.entries.push(entry);
      }
      return { entryId: entry.id, duplicate: false };
    }),
  };
  const usage = { reverseAllFor: jest.fn(async () => 1) };
  const media = { saveRendered: jest.fn(async () => ({ id: MEDIA_ID })) };
  const notifications = { notify: jest.fn(async () => undefined) };
  const scheduling = {
    describeClipJob: jest.fn(async (): Promise<ClipWorkflowState> => 'running'),
  };

  const internal = new ClipsInternalService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    limits as unknown as ClipLimitsGuard,
    usage as unknown as UsageService,
    media as unknown as MediaService,
    notifications as unknown as NotificationsService,
  );
  const reconciler = new ClipReconcileService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    scheduling as unknown as SchedulingService,
    usage as unknown as UsageService,
    notifications as unknown as NotificationsService,
  );
  return {
    internal,
    reconciler,
    jobs,
    jobsRepository,
    limits,
    usage,
    media,
    notifications,
    scheduling,
  };
}

const FINISH = {
  organizationId: TEST_ORG,
  clipId: CLIP_ID,
  revision: 3,
  key: 'media/seed-demo-org/clip.mp4',
  bytes: 1_000_000,
  posterKey: null,
  durationMs: 30_000,
  width: 1080,
  height: 1920,
  fps: 30,
  name: 'Best Bit.mp4',
};

beforeEach(() => {
  db.jobs = [];
  db.entries = [];
  db.videos = [];
  db.clips = [
    {
      id: CLIP_ID,
      organizationId: TEST_ORG,
      title: 'Best Bit',
      lastExportedRevision: null,
      exportedMediaId: null,
    },
  ];
  chain = Promise.resolve();
  jest.clearAllMocks();
});

describe('ClipsInternalService.chargeImport', () => {
  it('charges an open upload import and answers the thousandths, once for a replay', async () => {
    const { internal, limits } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, status: 'RUNNING' }));
    const body = { organizationId: TEST_ORG, durationMs: 90_000 };

    await expect(internal.chargeImport(JOB_ID, body)).resolves.toEqual({
      charged: true,
      units: 1500,
    });
    await expect(internal.chargeImport(JOB_ID, body)).resolves.toEqual({
      charged: true,
      units: 1500,
    });
    expect(db.entries).toHaveLength(1);
    expect(limits.chargeImport).toHaveBeenCalledWith(TEST_ORG, JOB_ID, 90_000);
  });

  it('answers an earlier charge for a job that has since closed, and 409 when there was none', async () => {
    const { internal, limits } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, status: 'DONE' }));
    await expect(
      internal.chargeImport(JOB_ID, { organizationId: TEST_ORG, durationMs: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    db.entries.push({
      id: 'e1',
      organizationId: TEST_ORG,
      idempotencyKey: `clips.import:${JOB_ID}`,
      units: 700,
    });
    await expect(
      internal.chargeImport(JOB_ID, { organizationId: TEST_ORG, durationMs: 1 }),
    ).resolves.toEqual({
      charged: true,
      units: 700,
    });
    expect(limits.chargeImport).not.toHaveBeenCalled();
  });

  it('answers 404 for a job of another workspace or another kind', async () => {
    const { internal } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, status: 'RUNNING', kind: 'RENDER' }));
    await expect(
      internal.chargeImport(JOB_ID, { organizationId: TEST_ORG, durationMs: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      internal.chargeImport(JOB_ID, { organizationId: 'other-org', durationMs: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClipsInternalService.finishExport', () => {
  function renderJob(overrides: Partial<ClipJob> = {}) {
    db.jobs.push(
      jobRow({
        id: JOB_ID,
        kind: 'RENDER',
        status: 'RUNNING',
        videoId: null,
        clipId: CLIP_ID,
        input: { clipId: CLIP_ID, revision: 3, proof: false },
        ...overrides,
      }),
    );
  }

  it('makes one Media row for two calls at once, and rings the bell once', async () => {
    const { internal, media, notifications } = deps();
    renderJob();
    const [a, b] = await Promise.all([
      internal.finishExport(JOB_ID, FINISH),
      internal.finishExport(JOB_ID, FINISH),
    ]);

    expect(a).toEqual({ mediaId: MEDIA_ID });
    expect(b).toEqual({ mediaId: MEDIA_ID });
    expect(media.saveRendered).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(db.clips[0]).toEqual(
      expect.objectContaining({ lastExportedRevision: 3, exportedMediaId: MEDIA_ID }),
    );
  });

  it('refuses a call that names another revision or a preview', async () => {
    const { internal, media } = deps();
    renderJob({ input: { clipId: CLIP_ID, revision: 2, proof: false } });
    await expect(internal.finishExport(JOB_ID, FINISH)).rejects.toBeInstanceOf(NotFoundException);
    expect(media.saveRendered).not.toHaveBeenCalled();
  });

  it('refuses a job that already closed without an export (409)', async () => {
    const { internal } = deps();
    renderJob({ status: 'CANCELLED' });
    await expect(internal.finishExport(JOB_ID, FINISH)).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores the fingerprint on the clip and sends the bell to the Export tab (Module 15)', async () => {
    const { internal, notifications } = deps();
    renderJob();
    await internal.finishExport(JOB_ID, { ...FINISH, fingerprint: 'v1-abc' });
    expect(db.clips[0]).toEqual(
      expect.objectContaining({ lastExportedRevision: 3, lastExportedFingerprint: 'v1-abc' }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clip_export_ready',
        link: `/${TEST_ORG}/clips/edit/${CLIP_ID}?tab=export`,
      }),
    );
  });

  it('clears the fingerprint for a finish from an older worker without one', async () => {
    const { internal } = deps();
    renderJob();
    await internal.finishExport(JOB_ID, FINISH);
    expect(db.clips[0]).toEqual(expect.objectContaining({ lastExportedFingerprint: null }));
  });
});

describe('ClipReconcileService', () => {
  it('changes nothing while Temporal cannot be reached', async () => {
    const { reconciler, scheduling, jobsRepository, jobs } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, status: 'RUNNING' }));
    scheduling.describeClipJob.mockResolvedValue('unavailable');

    await expect(reconciler.reconcile()).resolves.toEqual({ started: 0, failed: 0 });
    expect(jobsRepository.failOpen).not.toHaveBeenCalled();
    expect(jobs.startWaiting).not.toHaveBeenCalled();
  });

  it('fails a running import whose workflow is gone: charge back, video failed, bell rung', async () => {
    const { reconciler, scheduling, usage, notifications } = deps();
    const video = videoRow({ status: 'IMPORTING' });
    db.videos.push(video);
    db.jobs.push(jobRow({ id: JOB_ID, status: 'RUNNING', videoId: video.id }));
    scheduling.describeClipJob.mockResolvedValue('notFound');

    const answer = await reconciler.reconcile();
    expect(answer.failed).toBe(1);
    expect(db.jobs[0]?.status).toBe('FAILED');
    expect(usage.reverseAllFor).toHaveBeenCalledWith(TEST_ORG, JOB_ID);
    expect(db.videos[0]?.status).toBe('FAILED');
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clip_video_failed' }),
    );
  });

  it('leaves a quiet job alone while its workflow still runs', async () => {
    const { reconciler, jobsRepository } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, status: 'RUNNING' }));
    await expect(reconciler.reconcile()).resolves.toEqual({ started: 0, failed: 0 });
    expect(jobsRepository.failOpen).not.toHaveBeenCalled();
  });

  it('starts again a render whose start was lost, and queues waiting imports', async () => {
    const { reconciler, scheduling, jobs } = deps();
    db.jobs.push(jobRow({ id: JOB_ID, kind: 'RENDER', status: 'QUEUED', clipId: CLIP_ID }));
    db.jobs.push(
      jobRow({ id: 'waiting-import', kind: 'IMPORT', status: 'QUEUED', startedAt: null }),
    );
    scheduling.describeClipJob.mockResolvedValue('notFound');

    const answer = await reconciler.reconcile();
    expect(jobs.restart).toHaveBeenCalledWith(expect.objectContaining({ id: JOB_ID }));
    expect(jobs.startWaiting).toHaveBeenCalledWith(TEST_ORG);
    expect(answer.started).toBe(2);
  });

  it('names the failure by kind', () => {
    expect(lostJobCode({ kind: 'IMPORT', input: {} })).toBe('import_failed');
    expect(lostJobCode({ kind: 'RENDER', input: { proof: true } })).toBe('preview_failed');
    expect(lostJobCode({ kind: 'RENDER', input: { proof: false } })).toBe('export_failed');
    expect(lostJobCode({ kind: 'SEGMENT', input: {} })).toBe('tool_failed');
  });
});
