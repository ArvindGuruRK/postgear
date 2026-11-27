/**
 * Export All's one notice (Sprint 13, Module 11): the sentence with its
 * counts, written only when the batch's last job ended, exactly once even
 * when two jobs end at the same moment, never for a batch everyone
 * cancelled, and the reconcile's sweep for a lost `settled` call.
 */
import type { ClipJob } from '@postgear/db';
import { CLIP_NOTIFICATION_TYPES } from '@postgear/scheduling';
import type {
  CreateNotificationInput,
  NotificationsRepository,
} from '../../notifications/notifications.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import type { NotificationStreamRegistry } from '../../notifications/notifications.stream';
import { emptyTables, type FakeTables, fakeClipDb, matches } from '../testing/fake-clip-db';
import { jobRow, TEST_ORG } from '../testing/rows';
import {
  BATCH_FAILED_TITLE,
  BATCH_READY_TITLE,
  batchIdOf,
  batchNotice,
  batchNoticeLine,
  ClipBatchNoticeService,
} from './clip-batch-notice.service';

type Db = ReturnType<typeof fakeClipDb> & {
  notifications: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  $queryRaw: jest.Mock;
};

let mockDb: Db;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as unknown as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const BATCH = '12121212-1212-4121-8121-121212121212';
const OTHER_BATCH = '13131313-1313-4131-8131-131313131313';
const OTHER_ORG = 'seed-second-org';

interface Row extends Record<string, unknown> {
  id: string;
  organizationId: string;
  type: string;
  meta: Record<string, unknown> | null;
}

/** A database with the notifications table, its transactions one after another. */
function database(tables: FakeTables) {
  const rows: Row[] = [];
  const db = fakeClipDb(tables) as Db;
  db.notifications = {
    findFirst: jest.fn(async ({ where }: { where: unknown }) => {
      return rows.find((row) => matches(row, where)) ?? null;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: `n-${rows.length + 1}`, createdAt: new Date() } as unknown as Row;
      rows.push(row);
      return row;
    }),
  };
  db.$queryRaw = jest.fn(async () => []);
  let chain: Promise<unknown> = Promise.resolve();
  db.$transaction = jest.fn(async (work: unknown) => {
    const run = chain.then(() => (work as (tx: unknown) => Promise<unknown>)(db));
    chain = run.catch(() => undefined);
    return run;
  }) as unknown as Db['$transaction'];
  return { db, rows };
}

let count = 0;
function batchJob(status: ClipJob['status'], overrides: Partial<ClipJob> = {}): ClipJob {
  count += 1;
  return jobRow({
    id: `99999999-9999-4999-8999-${String(count).padStart(12, '0')}`,
    kind: 'RENDER',
    status,
    input: { proof: false, batchId: BATCH } as unknown as ClipJob['input'],
    ...overrides,
  });
}

function setup(jobs: ClipJob[]) {
  const tables = emptyTables();
  tables.jobs.push(...jobs);
  const { db, rows } = database(tables);
  mockDb = db;
  const repository = {
    create: jest.fn(async (input: CreateNotificationInput, tx: Db) =>
      tx.notifications.create({ data: input }),
    ),
  };
  const streams = { push: jest.fn() };
  const notifications = new NotificationsService(
    repository as unknown as NotificationsRepository,
    streams as unknown as NotificationStreamRegistry,
  );
  return { service: new ClipBatchNoticeService(notifications), tables, rows, streams };
}

beforeEach(() => {
  count = 0;
});

describe('the batch notice sentence', () => {
  it('counts the ready clips, and the ones that could not be exported', () => {
    expect(batchNoticeLine(8, 0)).toBe('8 clips are ready.');
    expect(batchNoticeLine(6, 2)).toBe('6 clips are ready, 2 could not be exported.');
    expect(batchNoticeLine(1, 0)).toBe('1 clip is ready.');
    expect(batchNoticeLine(1, 1)).toBe('1 clip is ready, 1 could not be exported.');
    expect(batchNoticeLine(0, 3)).toBe('3 clips could not be exported.');
  });

  it('is a ready notice when any clip is ready, a failed one when none is, and none when all were cancelled', () => {
    expect(batchNotice(TEST_ORG, BATCH, { done: 6, failed: 1, cancelled: 1 })).toEqual({
      organizationId: TEST_ORG,
      type: CLIP_NOTIFICATION_TYPES.exportReady,
      title: BATCH_READY_TITLE,
      content: '6 clips are ready, 2 could not be exported.',
      link: `/${TEST_ORG}/clips?tab=clips`,
      meta: { batchId: BATCH, done: 6, failed: 2 },
      email: false,
    });
    expect(batchNotice(TEST_ORG, BATCH, { done: 0, failed: 2, cancelled: 0 })).toMatchObject({
      type: CLIP_NOTIFICATION_TYPES.exportFailed,
      title: BATCH_FAILED_TITLE,
      content: '2 clips could not be exported.',
    });
    expect(batchNotice(TEST_ORG, BATCH, { done: 0, failed: 0, cancelled: 3 })).toBeNull();
  });

  it('reads the batch id of an export only', () => {
    expect(batchIdOf({ kind: 'RENDER', input: { batchId: BATCH } })).toBe(BATCH);
    expect(batchIdOf({ kind: 'RENDER', input: { proof: false } })).toBeNull();
    expect(batchIdOf({ kind: 'RENDER', input: { batchId: 'not-a-uuid' } })).toBeNull();
    expect(batchIdOf({ kind: 'IMPORT', input: { batchId: BATCH } })).toBeNull();
  });
});

describe('ClipBatchNoticeService.settle', () => {
  it('waits while any job of the batch is still open', async () => {
    const { service, rows } = setup([batchJob('DONE'), batchJob('RUNNING'), batchJob('QUEUED')]);
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(false);
    expect(rows).toHaveLength(0);
  });

  it('writes one notice with the counts when the last job ends, and pushes it to the bell', async () => {
    const jobs = [batchJob('DONE'), batchJob('FAILED'), batchJob('DONE'), batchJob('CANCELLED')];
    const { service, rows, streams } = setup(jobs);
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(true);
    expect(rows).toEqual([
      expect.objectContaining({
        organizationId: TEST_ORG,
        type: 'clip_export_ready',
        title: BATCH_READY_TITLE,
        content: '2 clips are ready, 2 could not be exported.',
        link: `/${TEST_ORG}/clips?tab=clips`,
        meta: { batchId: BATCH, done: 2, failed: 2 },
      }),
    ]);
    expect(streams.push).toHaveBeenCalledTimes(1);

    // A later call (the reconcile, a retried `settled`) writes nothing more.
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(false);
    expect(rows).toHaveLength(1);
    expect(streams.push).toHaveBeenCalledTimes(1);
  });

  it('writes it exactly once when two jobs end at the same moment', async () => {
    const first = batchJob('DONE');
    const second = batchJob('DONE');
    const { service, rows } = setup([first, second]);
    const answers = await Promise.all([
      service.settleJob(first),
      service.settleJob(second),
      service.settle(TEST_ORG, BATCH),
    ]);
    expect(answers.filter(Boolean)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('2 clips are ready.');
  });

  it('says nothing for a batch whose every export was cancelled', async () => {
    const { service, rows } = setup([batchJob('CANCELLED'), batchJob('CANCELLED')]);
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("counts only this workspace's jobs of this batch", async () => {
    const { service, rows } = setup([
      batchJob('DONE'),
      // Another workspace's open job, and another batch's open job, never hold it back.
      batchJob('RUNNING', { organizationId: OTHER_ORG }),
      batchJob('RUNNING', {
        input: { proof: false, batchId: OTHER_BATCH } as unknown as ClipJob['input'],
      }),
    ]);
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(true);
    expect(rows[0]?.content).toBe('1 clip is ready.');
    await expect(service.settle(OTHER_ORG, OTHER_BATCH)).resolves.toBe(false);
  });

  it('ignores a job that is not part of a batch', async () => {
    const { service, rows } = setup([]);
    const single = batchJob('DONE', { input: { proof: false } as unknown as ClipJob['input'] });
    await expect(service.settleJob(single)).resolves.toBe(false);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('never throws: a database failure is logged and answered false', async () => {
    const { service } = setup([batchJob('DONE')]);
    mockDb.$transaction = jest.fn(async () => {
      throw new Error('database down');
    }) as unknown as Db['$transaction'];
    await expect(service.settle(TEST_ORG, BATCH)).resolves.toBe(false);
  });
});

describe('ClipBatchNoticeService.sweep', () => {
  it("settles the recent batches the reconcile finds, in case a job's settled call was lost", async () => {
    const { service, rows } = setup([batchJob('DONE'), batchJob('FAILED')]);
    mockDb.$queryRaw.mockResolvedValue([
      { organizationId: TEST_ORG, batchId: BATCH },
      { organizationId: TEST_ORG, batchId: 'not-a-uuid' },
    ]);
    await expect(service.sweep(new Date('2026-11-27T12:00:00.000Z'))).resolves.toBe(1);
    expect(rows[0]?.content).toBe('1 clip is ready, 1 could not be exported.');
    await expect(service.sweep(new Date('2026-11-27T12:15:00.000Z'))).resolves.toBe(0);
  });
});
