/**
 * The one scheduler against an in-memory database (Sprint 13, Module 15):
 * a pass across every class, the import cap read through the resolver at
 * the pass (so an operator edit applies at once), the claims handed back
 * when Temporal refuses, a Preview Export started outside the queue, a paid
 * AI job started only once its charge stands, and the reconcile's lists.
 */
import { type ClipJob, Prisma } from '@postgear/db';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import {
  emptyTables,
  type FakeClipDb,
  type FakeLedgerEntry,
  type FakeTables,
  fakeClipDb,
  readsLedger,
} from '../testing/fake-clip-db';
import { jobRow } from '../testing/rows';
import { ClipJobsRepository } from './clip-jobs.repository';
import { ClipSchedulerService, schedulerSlots } from './clip-scheduler.service';

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

const FREE = 'org-free';
const PRO = 'org-pro';
const T0 = new Date('2026-11-28T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let count = 0;
function row(orgId: string, kind: ClipJob['kind'], overrides: Partial<ClipJob> = {}): ClipJob {
  count += 1;
  return jobRow({
    id: `77777777-7777-4777-8777-${String(count).padStart(12, '0')}`,
    organizationId: orgId,
    kind,
    status: 'QUEUED',
    startedAt: null,
    input: (kind === 'RENDER' ? { proof: false } : {}) as unknown as ClipJob['input'],
    createdAt: at(count),
    ...overrides,
  });
}

function build(
  tables: FakeTables,
  caps: Record<string, number> = { [FREE]: 1, [PRO]: 2 },
  ledger: FakeLedgerEntry[] = [],
) {
  mockDb = fakeClipDb(tables);
  readsLedger(mockDb, ledger);
  mockDb.$transaction = jest.fn(async (work: unknown, options?: unknown) => {
    expect(options).toEqual(
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    return (work as (tx: unknown) => Promise<unknown>)(mockDb);
  }) as unknown as FakeClipDb['$transaction'];
  const scheduling = { startClipJob: jest.fn(async () => true) };
  const resolver = {
    get: jest.fn(async (orgId: string, key: string) => {
      if (key !== 'clips.concurrent_imports') throw new Error(`unexpected ${key}`);
      return caps[orgId] ?? 1;
    }),
  };
  const scheduler = new ClipSchedulerService(
    new ClipJobsRepository(),
    scheduling as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
  );
  return { scheduler, scheduling, resolver, caps, ledger };
}

/** The AI minutes a press charged for a job, in thousandths. */
function charge(orgId: string, jobId: string, units = 4_000): FakeLedgerEntry {
  return { organizationId: orgId, refId: jobId, units, meter: 'clips.ai_minutes_per_month' };
}

beforeEach(() => {
  count = 0;
});

describe('schedulerSlots', () => {
  it('reads each class from its setting, the defaults otherwise', () => {
    expect(schedulerSlots(null)).toEqual({ media: 4, 'media-py': 2, render: 2 });
    const config = {
      get: (key: string) =>
        ({ CLIPS_MEDIA_SLOTS: '6', CLIPS_MEDIA_PY_SLOTS: 'x', CLIPS_RENDER_SLOTS: 3 })[key],
    };
    expect(schedulerSlots(config as never)).toEqual({ media: 6, 'media-py': 2, render: 3 });
  });
});

describe('ClipSchedulerService.pass', () => {
  it('starts every class in one pass, with the import cap from the resolver', async () => {
    const tables = emptyTables();
    tables.jobs.push(
      row(FREE, 'IMPORT', { status: 'RUNNING', startedAt: at(0) }),
      row(FREE, 'IMPORT'),
      row(FREE, 'SEGMENT'),
      row(FREE, 'TRANSCRIBE'),
      row(FREE, 'RENDER'),
    );
    const listen = tables.jobs[3] as ClipJob;
    const { scheduler, scheduling, resolver } = build(tables, undefined, [charge(FREE, listen.id)]);

    const started = await scheduler.pass(at(100));
    expect(started).toHaveLength(3);
    expect(scheduling.startClipJob.mock.calls.map((call) => (call as unknown[])[2]).sort()).toEqual(
      ['RENDER', 'SEGMENT', 'TRANSCRIBE'],
    );
    // The Free workspace's one import is running: its second waits, read once for the pass.
    expect(resolver.get).toHaveBeenCalledTimes(1);
    expect(tables.jobs[1]?.startedAt).toBeNull();
    for (const job of tables.jobs.slice(2)) expect(job.startedAt).toEqual(at(100));
  });

  it('applies an operator edit of the import cap at the next pass', async () => {
    const tables = emptyTables();
    tables.jobs.push(row(PRO, 'IMPORT'), row(PRO, 'IMPORT'), row(PRO, 'IMPORT'));
    const { scheduler, caps } = build(tables, { [PRO]: 1 });

    expect(await scheduler.pass(at(100))).toHaveLength(1);
    expect(await scheduler.pass(at(101))).toHaveLength(0);
    caps[PRO] = 3;
    expect(await scheduler.pass(at(102))).toHaveLength(2);
  });

  it('gives the claim and every later one back when Temporal refuses a start', async () => {
    const tables = emptyTables();
    tables.jobs.push(row(FREE, 'SEGMENT'), row(PRO, 'SEGMENT'), row(PRO, 'DOWNLOAD'));
    const { scheduler, scheduling } = build(tables);
    scheduling.startClipJob.mockResolvedValueOnce(true).mockResolvedValue(false);

    expect(await scheduler.pass(at(100))).toEqual([tables.jobs[0]?.id]);
    expect(tables.jobs[0]?.startedAt).toEqual(at(100));
    expect(tables.jobs[1]?.startedAt).toBeNull();
    expect(tables.jobs[2]?.startedAt).toBeNull();
  });
});

describe('ClipSchedulerService.start', () => {
  it('starts a Preview Export at once, with no claim and no slot', async () => {
    const tables = emptyTables();
    const proof = row(FREE, 'RENDER', { input: { proof: true } as unknown as ClipJob['input'] });
    tables.jobs.push(
      row(PRO, 'RENDER', { status: 'RUNNING', startedAt: at(0) }),
      row(FREE, 'RENDER', { status: 'RUNNING', startedAt: at(0) }),
      proof,
    );
    const { scheduler, scheduling } = build(tables);
    await expect(scheduler.start(proof)).resolves.toBe(true);
    expect(scheduling.startClipJob).toHaveBeenCalledWith(proof.id, FREE, 'RENDER');
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('answers whether the job it was asked about started, never throwing', async () => {
    const tables = emptyTables();
    const first = row(FREE, 'FACES');
    const second = row(FREE, 'FACES');
    tables.jobs.push(first, second);
    const { scheduler } = build(tables);
    await expect(scheduler.start(first)).resolves.toBe(true);
    // One Python job per workspace: the second waits its turn.
    await expect(scheduler.start(second)).resolves.toBe(false);

    mockDb.$transaction = jest.fn(async () => {
      throw new Error('database unavailable');
    }) as unknown as FakeClipDb['$transaction'];
    await expect(scheduler.start(second)).resolves.toBe(false);
  });
});

describe('a paid AI job and its charge (Module 15)', () => {
  it('keeps waiting until its charge lands, without holding back the job behind it', async () => {
    const tables = emptyTables();
    const voice = row(FREE, 'SPEECH');
    const faces = row(FREE, 'FACES');
    tables.jobs.push(voice, faces);
    const { scheduler, scheduling, ledger } = build(tables);

    // The row is written a moment before its charge: the pass skips it and starts the next one.
    expect(await scheduler.pass(at(100))).toEqual([faces.id]);
    expect(voice.startedAt).toBeNull();
    expect(scheduling.startClipJob).not.toHaveBeenCalledWith(voice.id, FREE, 'SPEECH');

    // A charge given back in full counts as none.
    ledger.push(charge(FREE, voice.id), { ...charge(FREE, voice.id), units: -4_000 });
    faces.status = 'DONE';
    expect(await scheduler.pass(at(101))).toEqual([]);

    ledger.push(charge(FREE, voice.id));
    expect(await scheduler.pass(at(102))).toEqual([voice.id]);
    expect(scheduling.startClipJob).toHaveBeenCalledWith(voice.id, FREE, 'SPEECH');
  });

  it("never counts another workspace's charge, and reads the ledger only for paid kinds", async () => {
    const tables = emptyTables();
    const listen = row(FREE, 'TRANSCRIBE');
    tables.jobs.push(listen, row(PRO, 'SEGMENT'), row(PRO, 'FACES'));
    const { scheduler } = build(tables, undefined, [charge(PRO, listen.id)]);
    const reads = (mockDb as unknown as { usageEntry: { findMany: jest.Mock } }).usageEntry;

    expect(await scheduler.pass(at(100))).toHaveLength(2);
    expect(listen.startedAt).toBeNull();
    expect(reads.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("the reconcile's lists (Module 15)", () => {
  const BEFORE = at(1_000);

  it('staleQueued: a claim made before the cut and a Preview Export made before it, never a waiting job', async () => {
    const tables = emptyTables();
    const lost = row(FREE, 'IMPORT', { startedAt: at(10) });
    const fresh = row(FREE, 'SEGMENT', { startedAt: at(2_000) });
    const waiting = row(FREE, 'EMOTE', { createdAt: at(5) });
    const preview = row(FREE, 'RENDER', {
      input: { proof: true } as unknown as ClipJob['input'],
      createdAt: at(6),
    });
    tables.jobs.push(lost, fresh, waiting, preview);
    build(tables);
    const ids = (await new ClipJobsRepository().staleQueued(BEFORE, 10)).map((job) => job.id);
    expect(ids.sort()).toEqual([lost.id, preview.id].sort());
  });

  it('staleWaitingPaid: only paid AI jobs still waiting, made before the cut', async () => {
    const tables = emptyTables();
    const oldListen = row(FREE, 'TRANSCRIBE', { createdAt: at(5) });
    const oldVoice = row(PRO, 'SPEECH', { createdAt: at(6) });
    const newListen = row(FREE, 'TRANSCRIBE', { createdAt: at(2_000) });
    const claimed = row(FREE, 'HIGHLIGHTS', { createdAt: at(7), startedAt: at(8) });
    const free = row(FREE, 'FACES', { createdAt: at(9) });
    tables.jobs.push(oldListen, oldVoice, newListen, claimed, free);
    build(tables);
    const ids = (await new ClipJobsRepository().staleWaitingPaid(BEFORE, 10)).map((job) => job.id);
    expect(ids).toEqual([oldListen.id, oldVoice.id]);
  });
});
