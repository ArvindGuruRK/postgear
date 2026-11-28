/**
 * No route runs free (Sprint 13, Module 15 section 4).
 *
 * Every worker-facing Clips route is classed here, and a new one fails this
 * file until it is. The three that would spend money on a model for a job
 * (the moment reader, the still check, and the maintenance pass that starts
 * a lost job again) each refuse, or do nothing, for a job whose AI minutes
 * charge is missing, given back, or another workspace's; with the charge
 * standing they do their work.
 */
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { PrivateStorage } from '../../media/storage/storage.interface';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipMomentsService } from '../highlights/clip-moments.service';
import { ClipStillsService } from '../highlights/clip-stills.service';
import { ClipReconcileService, PAID_AI_KINDS } from '../internal/clip-reconcile.service';
import { ClipsInternalController } from '../internal/clips-internal.controller';
import type { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { refusal, type AiBench, aiBench, highlightsOf, setupOf, VIDEO } from './ai-audit-bench';

let mockDb: unknown;
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

beforeEach(() => {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});
afterEach(() => jest.restoreAllMocks());

function bench(heard: [number, number] | null = [0, 600]): AiBench {
  const made = aiBench({ heard });
  mockDb = made.db;
  return made;
}

/**
 * Every route of `/internal/clips`, by what it does about AI minutes. A new
 * route must be added here, and if it does paid AI work, tested below.
 */
const INTERNAL_ROUTES: Record<string, string> = {
  // Paid AI work for a job: refused without its charge (tested below).
  'jobs/:jobId/pick-moments': 'paid: clips.ai:read:<jobId> must stand',
  'jobs/:jobId/check-stills': 'paid: clips.ai:action:<jobId> must stand',
  // Free AI steps by the rate table (faces, hook titles): no charge exists to check.
  'jobs/:jobId/follow-speaker': 'free: Follow The Speaker (faces)',
  'jobs/:jobId/auto-edit': 'free: hook title and faces; its listening was charged at the press',
  'jobs/:jobId/apply-recipe': 'free: hook titles and faces on a paid run',
  // No AI at all.
  'jobs/:jobId/charge-import': 'no AI: import minutes',
  'jobs/:jobId/reverse': 'gives back, never charges',
  'jobs/:jobId/finish-export': 'no AI: an export',
  'jobs/:jobId/finish-save-download': 'no AI: a download saved to Media',
  'jobs/:jobId/settled': 'no AI: starts waiting imports and exports',
  // Starts lost jobs again: a paid kind only while its charge stands (tested below).
  reconcile: 'restarts: paid AI kinds only with a live charge',
  sweep: 'no AI: the cleanup sweep',
};

describe('every worker-facing Clips route is classed', () => {
  it('lists each route of /internal/clips, and no other', () => {
    const proto = ClipsInternalController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string)
      .filter((value) => typeof value === 'string');
    expect([...paths].sort()).toEqual(Object.keys(INTERNAL_ROUTES).sort());
  });

  it('names the job kinds the reconcile treats as paid', () => {
    expect([...PAID_AI_KINDS].sort()).toEqual(['HIGHLIGHTS', 'SPEECH', 'TRANSCRIBE']);
  });
});

// ---------------------------------------------------------------------------

function reader() {
  const writer = {
    pickMoments: jest.fn(async () => ({ picks: [], windows: 1, failed: 0 })),
    writeTitles: jest.fn(async () => []),
  };
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  return { writer, ai, service: (b: AiBench) => momentsOf(b, ai as unknown as AiEngine) };
}

function momentsOf(b: AiBench, ai: AiEngine): ClipMomentsService {
  return new ClipMomentsService(b.transcripts, new ClipVideosRepository(), b.usage, ai);
}

async function setupRun(b: AiBench, action = false, vision = false): Promise<string> {
  const started = await highlightsOf(b, vision).start(
    TEST_ORG,
    TEST_USER,
    VIDEO,
    setupOf({ action }),
  );
  return started.job.id;
}

const keyed = (b: AiBench, key: string) => b.ledger.find((row) => row.idempotencyKey === key);

describe('pick-moments: the model reads only for a run whose reading charge stands', () => {
  it('reads with the charge standing', async () => {
    const b = bench();
    const jobId = await setupRun(b);
    const { writer, service } = reader();
    await expect(service(b).pick(jobId, TEST_ORG)).resolves.toMatchObject({ noSpeech: false });
    expect(writer.pickMoments).toHaveBeenCalledTimes(1);
  });

  it('refuses when the run was given everything back (failed or cancelled)', async () => {
    const b = bench();
    const jobId = await setupRun(b);
    await b.usage.reverseAllFor(TEST_ORG, jobId);
    const { ai, writer, service } = reader();
    const answer = await refusal(service(b).pick(jobId, TEST_ORG));
    expect(answer).toMatchObject({ status: 409, body: { code: 'highlights_failed' } });
    expect(ai.createSnippetWriter).not.toHaveBeenCalled();
    expect(writer.pickMoments).not.toHaveBeenCalled();
  });

  it('refuses when only the reading charge was given back (the signals still stand)', async () => {
    const b = bench();
    const jobId = await setupRun(b);
    const read = keyed(b, `clips.ai:read:${jobId}`);
    if (!read) throw new Error('no read charge');
    await b.usage.reverse(TEST_ORG, read.id);
    expect(b.net(jobId)).toBeGreaterThan(0);
    const { writer, service } = reader();
    await expect(refusal(service(b).pick(jobId, TEST_ORG))).resolves.toMatchObject({ status: 409 });
    expect(writer.pickMoments).not.toHaveBeenCalled();
  });

  it('refuses when there is no charge at all, or only another workspace has one', async () => {
    const b = bench();
    const jobId = await setupRun(b);
    const read = keyed(b, `clips.ai:read:${jobId}`);
    if (!read) throw new Error('no read charge');
    read.organizationId = 'another-org';
    const { writer, service } = reader();
    await expect(refusal(service(b).pick(jobId, TEST_ORG))).resolves.toMatchObject({ status: 409 });
    b.ledger.length = 0;
    await expect(refusal(service(b).pick(jobId, TEST_ORG))).resolves.toMatchObject({ status: 409 });
    expect(writer.pickMoments).not.toHaveBeenCalled();
  });

  it('a stretch with no words still answers noSpeech (and gives the reading back), as before', async () => {
    const b = bench(null);
    b.hear(0, 600, true);
    const jobId = await setupRun(b);
    const { writer, service } = reader();
    await expect(service(b).pick(jobId, TEST_ORG)).resolves.toMatchObject({ noSpeech: true });
    expect(writer.pickMoments).not.toHaveBeenCalled();
    expect(keyed(b, `clips.ai:read:${jobId}`)).toBeDefined();
    expect(b.reversals()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

function stillsOf() {
  const storage = {
    getStream: jest.fn(async () => ({
      totalBytes: 3,
      body: Readable.from([Buffer.from([0xff, 0xd8, 0xff])]),
    })),
  };
  const writer = {
    checkStills: jest.fn(async ({ bursts }: { bursts: unknown[] }) =>
      bursts.map(() => ({ notable: false, kind: 'nothing' as const, sure: 0.9, line: '' })),
    ),
  };
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipStillsService(
    storage as unknown as PrivateStorage,
    ai as unknown as AiEngine,
  );
  return { service, storage, writer };
}

const stillsBody = (jobId: string) => ({
  organizationId: TEST_ORG,
  bursts: [
    {
      stillKeys: [`clips/${TEST_ORG}/${VIDEO}/still-0-${jobId.replace(/-/g, '')}.jpg`],
      momentSec: 12,
      spanSec: 2,
      withSound: true,
    },
  ],
});

describe('check-stills: pictures reach the model only while Look For Action is paid', () => {
  it('checks with the charge standing', async () => {
    const b = bench();
    const jobId = await setupRun(b, true, true);
    const { service, writer } = stillsOf();
    await expect(service.check(jobId, stillsBody(jobId))).resolves.toMatchObject({
      verdicts: [expect.objectContaining({ kind: 'nothing' })],
    });
    expect(writer.checkStills).toHaveBeenCalledTimes(1);
  });

  it('refuses after the motion measure gave Look For Action back, before a picture is read', async () => {
    const b = bench();
    const jobId = await setupRun(b, true, true);
    await b.internal.reverseCharges(jobId, { organizationId: TEST_ORG, step: 'action' });
    const { service, storage, writer } = stillsOf();
    const answer = await refusal(service.check(jobId, stillsBody(jobId)));
    expect(answer).toMatchObject({ status: 409, body: { code: 'highlights_failed' } });
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(writer.checkStills).not.toHaveBeenCalled();
  });

  it('refuses when the run was given everything back, or the charge is gone', async () => {
    const b = bench();
    const jobId = await setupRun(b, true, true);
    await b.usage.reverseAllFor(TEST_ORG, jobId);
    const { service, writer } = stillsOf();
    await expect(refusal(service.check(jobId, stillsBody(jobId)))).resolves.toMatchObject({
      status: 409,
    });
    b.ledger.length = 0;
    await expect(refusal(service.check(jobId, stillsBody(jobId)))).resolves.toMatchObject({
      status: 409,
    });
    expect(writer.checkStills).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

const OTHER_VIDEO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NO_CHARGE = {
  highlights: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  speech: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  transcribe: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  faces: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  autoEdit: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
};

function reconcilerOf(b: AiBench) {
  const jobs = {
    restart: jest.fn(async () => true),
    // Module 15's one scheduler pass (and the older names some specs still use).
    startNext: jest.fn(async (): Promise<string[]> => []),
    startWaiting: jest.fn(async (): Promise<string[]> => []),
    startRendersQuietly: jest.fn(async (): Promise<string[]> => []),
  };
  const repository = {
    // Every claimed open job counts as stale here: the pass's own age filter is not what is tested.
    staleQueued: jest.fn(async () =>
      b.tables.jobs.filter((job) => job.status === 'QUEUED' && job.startedAt !== null),
    ),
    staleRunning: jest.fn(async () => []),
    // Module 15: paid AI jobs still waiting for their turn (the age filter is not tested here).
    staleWaitingPaid: jest.fn(async () =>
      b.tables.jobs.filter(
        (job) => job.status === 'QUEUED' && job.startedAt === null && PAID_AI_KINDS.has(job.kind),
      ),
    ),
    releaseClaim: jest.fn(async () => undefined),
    closeHighlightRun: jest.fn(async () => undefined),
    failOpen: jest.fn(async (jobId: string, error: unknown) => {
      const job = b.tables.jobs.find((row) => row.id === jobId && row.status === 'QUEUED');
      if (!job) return false;
      Object.assign(job, { status: 'FAILED', error });
      return true;
    }),
  };
  const scheduling = { describeClipJob: jest.fn(async () => 'notFound') };
  const reconciler = new ClipReconcileService(
    jobs as unknown as ClipJobsService,
    repository as unknown as ClipJobsRepository,
    scheduling as unknown as SchedulingService,
    b.usage,
    { notify: jest.fn(async () => undefined) } as unknown as NotificationsService,
    { deletePrefix: jest.fn(async () => 0) } as unknown as PrivateStorage,
  );
  return { reconciler, jobs, repository };
}

/** A pass claimed every open job long ago and its start was lost. */
const CLAIMED_AT = new Date('2026-11-02T00:00:00.000Z');
function claimAll(b: AiBench): void {
  for (const job of b.tables.jobs) {
    if (job.status === 'QUEUED') Object.assign(job, { startedAt: CLAIMED_AT });
  }
}

const idsOf = (mock: jest.Mock, at: number) =>
  mock.mock.calls.map((call) => String(call[at])).sort();
const statusOf = (b: AiBench, id: string) => b.tables.jobs.find((job) => job.id === id)?.status;

describe('reconcile: a lost paid AI job goes back in line only with its charge', () => {
  it('queues the charged ones again and fails the uncharged ones; free kinds queue as before', async () => {
    const b = bench(null);
    // Charged at the press, start lost: these go back in line.
    const run = await setupRun(b);
    const listen = b.tables.jobs.find((job) => job.kind === 'TRANSCRIBE')?.id;
    // A row that outlived its charge (refused or lost: another video's listen), and rows that
    // never had one.
    b.tables.videos.push(
      videoRow({ id: OTHER_VIDEO, status: 'READY', durationMs: 60_000, hasAudio: true }),
    );
    const given = await b.transcripts.ensure(TEST_ORG, TEST_USER, OTHER_VIDEO, {});
    if (given.covered || given.joined) throw new Error('expected a job');
    await b.usage.reverseAllFor(TEST_ORG, given.job.id);
    for (const [kind, id] of [
      ['HIGHLIGHTS', NO_CHARGE.highlights],
      ['SPEECH', NO_CHARGE.speech],
      ['TRANSCRIBE', NO_CHARGE.transcribe],
      ['FACES', NO_CHARGE.faces],
      ['AUTO_EDIT', NO_CHARGE.autoEdit],
    ] as const) {
      b.tables.jobs.push(jobRow({ id, kind, status: 'QUEUED', videoId: VIDEO }));
    }
    claimAll(b);
    const before = b.net();

    const { reconciler, jobs, repository } = reconcilerOf(b);
    const answer = await reconciler.reconcile();

    expect(idsOf(repository.releaseClaim, 1)).toEqual(
      [run, listen, NO_CHARGE.faces, NO_CHARGE.autoEdit].sort(),
    );
    expect(jobs.restart).not.toHaveBeenCalled();
    expect(answer.failed).toBe(4);
    for (const id of [given.job.id, NO_CHARGE.highlights, NO_CHARGE.speech, NO_CHARGE.transcribe]) {
      expect(statusOf(b, id)).toBe('FAILED');
    }
    // Nothing was charged or given back by the pass: no money moved.
    expect(b.net()).toBe(before);
  });

  it("another workspace's charge under the same key does not count for this one", async () => {
    const b = bench(null);
    const outcome = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {});
    if (outcome.covered || outcome.joined) throw new Error('expected a job');
    for (const row of b.ledger) row.organizationId = 'another-org';
    claimAll(b);
    const { reconciler, repository } = reconcilerOf(b);
    await expect(reconciler.reconcile()).resolves.toMatchObject({ failed: 1 });
    expect(repository.releaseClaim).not.toHaveBeenCalled();
    expect(statusOf(b, outcome.job.id)).toBe('FAILED');
  });
});
