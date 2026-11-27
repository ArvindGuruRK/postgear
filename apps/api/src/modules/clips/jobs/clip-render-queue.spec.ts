/**
 * The fair render queue (Sprint 13, Module 11) against an in-memory
 * database: one export running per workspace, the global slots, the
 * highest priority first, equal priorities taking turns, Preview Export
 * skipping the queue, and serializable claims that never overfill.
 */
import { type ClipJob, Prisma } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { emptyTables, type FakeClipDb, type FakeTables, fakeClipDb } from '../testing/fake-clip-db';
import { jobRow } from '../testing/rows';
import { ClipJobsRepository, pickFairRenders, RENDER_AGING_MS } from './clip-jobs.repository';
import { ClipJobsService, isQueuedRender } from './clip-jobs.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const LOW = 'org-low';
const HIGH = 'org-high';
const A = 'org-a';
const B = 'org-b';
const T0 = new Date('2026-11-27T10:00:00.000Z');

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

let count = 0;
function exportJob(orgId: string, overrides: Partial<ClipJob> & { proof?: boolean } = {}): ClipJob {
  count += 1;
  const { proof = false, ...rest } = overrides;
  return jobRow({
    id: `99999999-9999-4999-8999-${String(count).padStart(12, '0')}`,
    organizationId: orgId,
    kind: 'RENDER',
    status: 'QUEUED',
    startedAt: null,
    input: { proof } as unknown as ClipJob['input'],
    createdAt: at(count),
    ...rest,
  });
}

/** Transactions one after another, as Postgres orders two conflicting serializable ones. */
function serialDb(tables: FakeTables) {
  const db = fakeClipDb(tables);
  const options: unknown[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  db.$transaction = jest.fn(async (work: unknown, opts?: unknown) => {
    options.push(opts);
    const run = chain.then(() => (work as (tx: unknown) => Promise<unknown>)(db));
    chain = run.catch(() => undefined);
    return run;
  }) as unknown as FakeClipDb['$transaction'];
  return { db, options };
}

/** Plays the worker: each claimed export runs, then ends; answers the order they started in. */
async function drain(tables: FakeTables, slots: number, steps = 50): Promise<string[]> {
  const repository = new ClipJobsRepository();
  const order: string[] = [];
  let clock = 1000;
  for (let step = 0; step < steps; step += 1) {
    clock += 1;
    const claimed = await repository.claimWaitingRenders(slots, at(clock));
    for (const job of claimed) {
      const row = tables.jobs.find((candidate) => candidate.id === job.id) as ClipJob;
      order.push(`${row.organizationId}:${(row.input as { n?: number }).n ?? '?'}`);
      row.status = 'RUNNING';
    }
    // The oldest running export ends: its `settled` call runs the next claim.
    const running = tables.jobs
      .filter((row) => row.status === 'RUNNING')
      .sort((x, y) => (x.startedAt as Date).getTime() - (y.startedAt as Date).getTime());
    const ending = running[0];
    if (!ending && claimed.length === 0) break;
    if (ending) Object.assign(ending, { status: 'DONE', finishedAt: at(clock) });
  }
  return order;
}

function batch(orgId: string, size: number, priority: string, firstSecond: number): ClipJob[] {
  return Array.from({ length: size }, (_, index) =>
    exportJob(orgId, {
      priority,
      createdAt: at(firstSecond + index),
      input: { proof: false, n: index + 1 } as unknown as ClipJob['input'],
    }),
  );
}

beforeEach(() => {
  count = 0;
});

describe('pickFairRenders', () => {
  it('offers one export per workspace, the highest priority first', () => {
    const waiting = [
      exportJob(LOW, { priority: 'low', createdAt: at(1) }),
      exportJob(LOW, { priority: 'low', createdAt: at(2) }),
      exportJob(HIGH, { priority: 'high', createdAt: at(3) }),
    ];
    const picked = pickFairRenders(waiting, new Map(), 3, at(200));
    expect(picked.map((job) => job.organizationId)).toEqual([HIGH, LOW]);
    expect(picked[1]?.createdAt).toEqual(at(1));
  });

  it('gives equal priorities turns: never served first, then the one served longest ago', () => {
    const waiting = [
      exportJob(A, { createdAt: at(1) }),
      exportJob(B, { createdAt: at(2) }),
      exportJob('org-c', { createdAt: at(3) }),
    ];
    const lastServed = new Map([
      [A, at(100)],
      [B, at(50)],
    ]);
    expect(
      pickFairRenders(waiting, lastServed, 3, at(200)).map((job) => job.organizationId),
    ).toEqual(['org-c', B, A]);
    expect(pickFairRenders(waiting, lastServed, 1, at(200))).toHaveLength(1);
    expect(pickFairRenders(waiting, lastServed, 0, at(200))).toEqual([]);
  });
});

describe('pickFairRenders: no workspace starves', () => {
  it('lets a low priority export that waited long go before a busy high priority workspace', () => {
    const waiting = [
      exportJob(LOW, { priority: 'low', createdAt: at(1) }),
      exportJob(HIGH, { priority: 'high', createdAt: at(1_190) }),
    ];
    const lastServed = new Map([[HIGH, at(1_150)]]);
    // Five minutes in, high still goes first.
    expect(pickFairRenders(waiting, lastServed, 1, at(300))[0]?.organizationId).toBe(HIGH);
    // Twenty minutes in, the low export ranks with the highest and was never served: it goes.
    expect(pickFairRenders(waiting, lastServed, 1, at(1_201))[0]?.organizationId).toBe(LOW);
    expect(RENDER_AGING_MS).toBe(600_000);
  });
});

describe('ClipJobsRepository.claimWaitingRenders', () => {
  it('claims at most one export per workspace, within the slots, and never a preview', async () => {
    const tables = emptyTables();
    const proof = exportJob(A, { proof: true, createdAt: at(0) });
    const a1 = exportJob(A);
    const a2 = exportJob(A);
    const b1 = exportJob(B);
    const c1 = exportJob('org-c');
    tables.jobs.push(proof, a1, a2, b1, c1);
    mockDb = serialDb(tables).db;

    const claimed = await new ClipJobsRepository().claimWaitingRenders(2, at(500));
    expect(claimed.map((job) => job.id)).toEqual([a1.id, b1.id]);
    expect(a1.startedAt).toEqual(at(500));
    expect(b1.startedAt).toEqual(at(500));
    expect(proof.startedAt).toBeNull();
    expect(a2.startedAt).toBeNull();

    // Both slots are held now (claimed, not yet RUNNING): nothing more starts.
    expect(await new ClipJobsRepository().claimWaitingRenders(2, at(501))).toEqual([]);
  });

  it('leaves a workspace with an export running alone, and a running preview holds no slot', async () => {
    const tables = emptyTables();
    tables.jobs.push(
      exportJob(A, { status: 'RUNNING', startedAt: at(0) }),
      exportJob(B, { status: 'RUNNING', startedAt: at(0), proof: true }),
    );
    const a2 = exportJob(A);
    const b2 = exportJob(B);
    tables.jobs.push(a2, b2);
    mockDb = serialDb(tables).db;

    const claimed = await new ClipJobsRepository().claimWaitingRenders(3, at(500));
    expect(claimed.map((job) => job.id)).toEqual([b2.id]);
  });

  it('claims in a serializable transaction, so two claims at once never overfill', async () => {
    const tables = emptyTables();
    tables.jobs.push(exportJob(A), exportJob(B));
    const { db, options } = serialDb(tables);
    mockDb = db;

    const repository = new ClipJobsRepository();
    const [first, second] = await Promise.all([
      repository.claimWaitingRenders(1, at(500)),
      repository.claimWaitingRenders(1, at(500)),
    ]);
    expect([...first, ...second]).toHaveLength(1);
    expect(options).toEqual([
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    ]);
  });

  it('retries a claim Postgres aborted, and the retry sees the winner', async () => {
    const tables = emptyTables();
    tables.jobs.push(exportJob(A), exportJob(B));
    const db = fakeClipDb(tables);
    const repository = new ClipJobsRepository();
    let attempts = 0;
    const winner: string[] = [];
    db.$transaction = jest.fn(async (work: unknown) => {
      attempts += 1;
      if (attempts === 1) {
        // Another caller commits its claim first; this one is aborted (P2034).
        const other = await (work as (tx: unknown) => Promise<Array<{ id: string }>>)(db);
        winner.push(...other.map((job) => job.id));
        throw new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2034',
          clientVersion: 'test',
        });
      }
      return (work as (tx: unknown) => Promise<unknown>)(db);
    }) as unknown as FakeClipDb['$transaction'];
    mockDb = db;

    expect(await repository.claimWaitingRenders(1, at(500))).toEqual([]);
    expect(attempts).toBe(2);
    expect(winner).toHaveLength(1);
  });
});

describe('the fair starting order (two workspaces)', () => {
  it("lets a high priority workspace's batch overtake a low one's that started first", async () => {
    const tables = emptyTables();
    tables.jobs.push(...batch(LOW, 3, 'low', 1));
    mockDb = serialDb(tables).db;
    const repository = new ClipJobsRepository();
    // The low batch's first export starts alone, then the high batch arrives.
    const first = await repository.claimWaitingRenders(1, at(900));
    expect(first).toHaveLength(1);
    (tables.jobs.find((row) => row.id === first[0]?.id) as ClipJob).status = 'RUNNING';
    tables.jobs.push(...batch(HIGH, 3, 'high', 10));

    expect(await drain(tables, 1)).toEqual([
      `${HIGH}:1`,
      `${HIGH}:2`,
      `${HIGH}:3`,
      `${LOW}:2`,
      `${LOW}:3`,
    ]);
  });

  it('takes turns between equal priorities, oldest first, so a big batch never starves a later one', async () => {
    const tables = emptyTables();
    tables.jobs.push(...batch(A, 4, 'normal', 1), ...batch(B, 2, 'normal', 20));
    mockDb = serialDb(tables).db;

    expect(await drain(tables, 1)).toEqual([
      `${A}:1`,
      `${B}:1`,
      `${A}:2`,
      `${B}:2`,
      `${A}:3`,
      `${A}:4`,
    ]);
  });

  it('runs one export per workspace at a time when there are more slots', async () => {
    const tables = emptyTables();
    tables.jobs.push(...batch(A, 2, 'normal', 1), ...batch(B, 1, 'normal', 5));
    mockDb = serialDb(tables).db;

    const claimed = await new ClipJobsRepository().claimWaitingRenders(4, at(900));
    expect(claimed.map((job) => job.organizationId).sort()).toEqual([A, B]);
  });
});

describe('ClipJobsService and the render queue', () => {
  function service(claimed: Array<{ id: string; organizationId: string; kind: 'RENDER' }>) {
    const repository = {
      claimWaitingRenders: jest.fn(async () => claimed),
      releaseClaim: jest.fn(async () => undefined),
    };
    const scheduling = { startClipJob: jest.fn(async () => true) };
    const config = {
      get: jest.fn((key: string) => (key === 'CLIPS_RENDER_SLOTS' ? '3' : undefined)),
    };
    const jobs = new ClipJobsService(
      repository as unknown as ClipJobsRepository,
      scheduling as unknown as SchedulingService,
      {} as EntitlementResolver,
      {} as UsageService,
      {} as PrivateStorage,
      config as never,
    );
    return { jobs, repository, scheduling };
  }

  it('sends a single export through the queue with the configured slots', async () => {
    const job = { id: 'export-1', organizationId: A, kind: 'RENDER' as const };
    const { jobs, repository, scheduling } = service([job]);
    await expect(jobs.start({ ...job, input: { proof: false } })).resolves.toBe(true);
    expect(repository.claimWaitingRenders).toHaveBeenCalledWith(3, expect.any(Date));
    expect(scheduling.startClipJob).toHaveBeenCalledWith('export-1', A, 'RENDER');
  });

  it('answers false for an export that has to wait its turn', async () => {
    const { jobs, scheduling } = service([]);
    await expect(
      jobs.start({ id: 'export-2', organizationId: A, kind: 'RENDER', input: { proof: false } }),
    ).resolves.toBe(false);
    expect(scheduling.startClipJob).not.toHaveBeenCalled();
  });

  it('starts a Preview Export at once, outside the queue', async () => {
    const { jobs, repository, scheduling } = service([]);
    await expect(
      jobs.start({ id: 'proof-1', organizationId: A, kind: 'RENDER', input: { proof: true } }),
    ).resolves.toBe(true);
    expect(repository.claimWaitingRenders).not.toHaveBeenCalled();
    expect(scheduling.startClipJob).toHaveBeenCalledWith('proof-1', A, 'RENDER');
  });

  it('gives every claim back when Temporal cannot be reached', async () => {
    const claimed = [
      { id: 'export-1', organizationId: A, kind: 'RENDER' as const },
      { id: 'export-2', organizationId: B, kind: 'RENDER' as const },
    ];
    const { jobs, repository, scheduling } = service(claimed);
    scheduling.startClipJob.mockResolvedValue(false);
    await expect(jobs.startWaitingRenders()).resolves.toEqual([]);
    expect(repository.releaseClaim).toHaveBeenCalledWith(A, 'export-1');
    expect(repository.releaseClaim).toHaveBeenCalledWith(B, 'export-2');
  });

  it('never fails the request when the claim itself fails', async () => {
    const { jobs, repository } = service([]);
    repository.claimWaitingRenders.mockRejectedValue(new Error('busy'));
    await expect(
      jobs.start({ id: 'export-3', organizationId: A, kind: 'RENDER', input: { proof: false } }),
    ).resolves.toBe(false);
  });

  it('knows which jobs the queue starts', () => {
    expect(isQueuedRender({ kind: 'RENDER', input: { proof: false } })).toBe(true);
    expect(isQueuedRender({ kind: 'RENDER', input: { proof: true } })).toBe(false);
    expect(isQueuedRender({ kind: 'IMPORT', input: {} })).toBe(false);
  });
});
