/**
 * Find Clips (Module 16) against an in-memory database and an in-memory
 * ledger: the price, the charge (once, with its key, refused past the
 * allowance with the numbers), the running refusal, the reversal when the
 * rows never land, the reversal and run state on a cancel of a job that
 * never ran and in the reconcile, and tenancy.
 */
import { HttpException } from '@nestjs/common';
import type { ClipHighlightRun, ClipJob } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import { SIGNALS_ENGINE_VERSION, SIGNALS_TUNING } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { lostJobCode } from '../internal/clip-reconcile.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { emptyTables, type FakeClipDb, type FakeTables, fakeClipDb } from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipHighlightsService, signalsChargeKey } from './clip-highlights.service';
import { highlightsPrice, runStatus, toHighlightRunView } from './clip-highlights.view';

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

const VIDEO = videoRow().id;
const OTHER_ORG = 'seed-second-org';
const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');

interface Entry {
  id: string;
  key: string;
  units: number;
  refId: string | null;
  reverses: string | null;
}

/** A ledger with the real rules that matter here: keys, a hard limit, full reversals. */
function fakeLedger(limit: number) {
  const entries: Entry[] = [];
  const used = () => entries.reduce((sum, entry) => sum + entry.units, 0);
  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        meter: string,
        units: number,
        options: { idempotencyKey: string; refId?: string },
      ) => {
        expect(meter).toBe('clips.ai_minutes_per_month');
        const existing = entries.find((entry) => entry.key === options.idempotencyKey);
        if (!existing && used() + units > limit) {
          const left = Math.max(0, limit - used());
          throw new EntitlementRefusedException(
            'clips_ai_minutes_used',
            refusalMessage('clips_ai_minutes_used', { n: left, need: units, date: CYCLE_END }),
            { limit, used: used(), needed: units, remaining: left },
          );
        }
        const entry = existing ?? {
          id: `entry-${entries.length + 1}`,
          key: options.idempotencyKey,
          units,
          refId: options.refId ?? null,
          reverses: null,
        };
        if (!existing) entries.push(entry);
        return {
          entryId: entry.id,
          duplicate: Boolean(existing),
          over: false,
          state: {
            used: used(),
            limit,
            remaining: limit - used(),
            cycleStart: new Date('2026-11-01T00:00:00.000Z'),
            cycleEnd: CYCLE_END,
          },
        };
      },
    ),
    reverseAllFor: jest.fn(async (_org: string, refId: string) => {
      let count = 0;
      for (const charge of entries.filter((entry) => entry.refId === refId && entry.units > 0)) {
        const key = `rev:${charge.id}`;
        if (entries.some((entry) => entry.key === key)) continue;
        entries.push({
          id: `entry-${entries.length + 1}`,
          key,
          units: -charge.units,
          refId,
          reverses: charge.id,
        });
        count += 1;
      }
      return count;
    }),
  };
  return { usage, entries, used };
}

let idCount = 0;
function setup(options: { tables?: FakeTables; limit?: number; startOk?: boolean } = {}) {
  const tables = options.tables ?? seed();
  mockDb = fakeClipDb(tables);
  const ledger = fakeLedger(options.limit ?? 30);
  const jobsRepository = new ClipJobsRepository();
  const scheduling = {
    startClipJob: jest.fn(async () => options.startOk ?? true),
    cancelClipJob: jest.fn(async () => 'notFound' as const),
  };
  const resolver = { get: jest.fn(async () => 'normal') };
  const jobs = new ClipJobsService(
    jobsRepository,
    scheduling as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
    ledger.usage as unknown as UsageService,
    { deletePrefix: jest.fn() } as never,
  );
  jest.spyOn(jobs, 'newJobId').mockImplementation(() => {
    idCount += 1;
    return `88888888-8888-4888-8888-${String(idCount).padStart(12, '0')}`;
  });
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  const service = new ClipHighlightsService(
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    limits as unknown as ClipLimitsGuard,
    ledger.usage as unknown as UsageService,
  );
  return { service, tables, ledger, jobs, scheduling, limits };
}

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  tables.runs = [];
  return tables;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the price', () => {
  it('is 0.25 AI minutes per video minute, rounded up, at least 1', () => {
    expect(highlightsPrice(10 * 60_000)).toBe(3);
    expect(highlightsPrice(60 * 60_000)).toBe(15);
    expect(highlightsPrice(20_000)).toBe(1);
    expect(highlightsPrice(null)).toBe(1);
  });
});

describe('POST /clips/videos/:videoId/highlights', () => {
  it('charges the price once with its key, writes the run and its job, and starts it', async () => {
    const { service, tables, ledger, scheduling } = setup();
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO);

    const job = tables.jobs[0] as ClipJob;
    const run = tables.runs?.[0] as ClipHighlightRun;
    expect(job.kind).toBe('HIGHLIGHTS');
    expect(job.highlightRunId).toBe(run.id);
    expect(job.input).toEqual({ videoId: VIDEO, runId: run.id });
    expect(run).toMatchObject({
      organizationId: TEST_ORG,
      videoId: VIDEO,
      status: 'QUEUED',
      engineVersion: SIGNALS_ENGINE_VERSION,
      aiMinutesCharged: 3,
      usageEntryId: 'entry-1',
      createdById: TEST_USER,
    });
    expect((run.params as { tuning: string }).tuning).toBe(SIGNALS_TUNING);

    expect(ledger.usage.consume).toHaveBeenCalledWith(TEST_ORG, 'clips.ai_minutes_per_month', 3, {
      idempotencyKey: signalsChargeKey(job.id),
      refId: job.id,
      meta: { step: 'signals', videoId: VIDEO },
    });
    expect(signalsChargeKey(job.id)).toBe(`clips.ai:signals:${job.id}`);
    expect(ledger.used()).toBe(3);
    expect(scheduling.startClipJob).toHaveBeenCalledWith(job.id, TEST_ORG, 'HIGHLIGHTS');

    expect(outcome.run).toMatchObject({
      id: run.id,
      jobId: job.id,
      status: 'QUEUED',
      aiMinutes: 3,
    });
    expect(outcome.job.id).toBe(job.id);
    expect(outcome.meter).toEqual({
      used: 3,
      remaining: 27,
      limit: 30,
      cycleEnd: CYCLE_END.toISOString(),
    });
  });

  it('refuses a second run while one is open, before any charge', async () => {
    const { service, ledger } = setup();
    await service.start(TEST_ORG, TEST_USER, VIDEO);
    const refused = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('highlights_running');
    expect(refused.body.message).toBe('We are already looking for clips in this video.');
    expect(ledger.usage.consume).toHaveBeenCalledTimes(1);
    expect(ledger.used()).toBe(3);
  });

  it('a double click that loses the race is refused and its charge given back', async () => {
    const { service, tables, ledger } = setup();
    // The other click's job lands between this request's look and its transaction.
    const consume = ledger.usage.consume.getMockImplementation();
    ledger.usage.consume.mockImplementationOnce(async (...args) => {
      tables.jobs.push(
        jobRow({
          id: '99999999-9999-4999-8999-999999999999',
          kind: 'HIGHLIGHTS',
          status: 'QUEUED',
          videoId: VIDEO,
        }),
      );
      return (consume as NonNullable<typeof consume>)(...args);
    });
    const refused = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO));
    expect(refused.body.code).toBe('highlights_running');
    expect(ledger.used()).toBe(0);
    expect(ledger.entries.map((entry) => entry.key)).toEqual([
      expect.stringMatching(/^clips\.ai:signals:/),
      'rev:entry-1',
    ]);
    expect(tables.runs).toHaveLength(0);
  });

  it('refuses past the allowance with the typed 402 and the right numbers', async () => {
    const { service, tables, ledger } = setup({ limit: 2 });
    const refused = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO));
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('clips_ai_minutes_used');
    expect(refused.body.message).toBe(
      'This needs 3 AI minutes and you have 2 left. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(refused.body.details).toEqual({ limit: 2, used: 0, needed: 3, remaining: 2 });
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.used()).toBe(0);
  });

  it('keeps the rows and the charge when Temporal is out of reach (the reconcile starts it)', async () => {
    const { service, tables, ledger } = setup({ startOk: false });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO);
    expect(outcome.job.status).toBe('QUEUED');
    expect(tables.runs).toHaveLength(1);
    expect(ledger.used()).toBe(3);
  });

  it('refuses a video that is not ready, and answers 404 for another workspace or a bad id', async () => {
    const importing = seed();
    (importing.videos[0] as { status: string }).status = 'IMPORTING';
    const notReady = await refusal(
      setup({ tables: importing }).service.start(TEST_ORG, TEST_USER, VIDEO),
    );
    expect(notReady.status).toBe(409);
    expect(notReady.body.code).toBe('video_not_ready');

    const { service, ledger } = setup();
    for (const [org, id] of [
      [OTHER_ORG, VIDEO],
      [TEST_ORG, 'not-a-uuid'],
      [TEST_ORG, '12121212-1212-4121-8121-121212121212'],
    ] as const) {
      const missing = await refusal(service.start(org, TEST_USER, id));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('video_not_found');
      expect((await refusal(service.latest(org, id))).status).toBe(404);
    }
    expect(ledger.usage.consume).not.toHaveBeenCalled();
  });
});

describe('GET /clips/videos/:videoId/highlights', () => {
  it('answers the price, the sound note and the latest run', async () => {
    const { service } = setup();
    expect(await service.latest(TEST_ORG, VIDEO)).toEqual({
      price: 3,
      noSound: false,
      run: null,
      job: null,
    });
    await service.start(TEST_ORG, TEST_USER, VIDEO);
    const view = await service.latest(TEST_ORG, VIDEO);
    expect(view.run?.status).toBe('QUEUED');
    expect(view.job?.kind).toBe('HIGHLIGHTS');
  });

  it('says how a finished run found its clips', () => {
    const run = {
      id: 'r1',
      organizationId: TEST_ORG,
      videoId: VIDEO,
      status: 'DONE',
      engineVersion: 1,
      tracks: ['loudness', 'scene', 'chat'],
      params: {},
      aiMinutesCharged: 3,
      usageEntryId: 'entry-1',
      found: 7,
      createdById: TEST_USER,
      createdAt: new Date('2026-11-19T10:00:00.000Z'),
      finishedAt: new Date('2026-11-19T10:01:00.000Z'),
    } as ClipHighlightRun;
    expect(toHighlightRunView(run, null)).toMatchObject({
      found: 7,
      foundBy: 'Sound, picture and chat',
      refunded: false,
    });
    expect(toHighlightRunView({ ...run, tracks: ['loudness', 'scene'] }, null).foundBy).toBe(
      'Sound and picture',
    );
  });

  it("trusts the job's end while the run row has not been closed", () => {
    expect(runStatus({ status: 'RUNNING' }, { status: 'FAILED' })).toBe('FAILED');
    expect(runStatus({ status: 'QUEUED' }, { status: 'RUNNING' })).toBe('RUNNING');
    expect(runStatus({ status: 'DONE' }, { status: 'RUNNING' })).toBe('DONE');
    expect(runStatus({ status: 'QUEUED' }, null)).toBe('QUEUED');
  });
});

describe('a run that never ran', () => {
  it('cancelled before its workflow started: the run is CANCELLED and the minutes come back', async () => {
    const { service, jobs, tables, ledger } = setup({ startOk: false });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO);
    await jobs.cancel(TEST_ORG, outcome.job.id);
    expect(tables.jobs[0]?.status).toBe('CANCELLED');
    expect(tables.runs?.[0]?.status).toBe('CANCELLED');
    expect(ledger.used()).toBe(0);
    expect(ledger.entries.at(-1)?.key).toBe('rev:entry-1');
    const view = await service.latest(TEST_ORG, VIDEO);
    expect(view.run).toMatchObject({ status: 'CANCELLED', refunded: true });
  });

  it('a lost run fails with its own sentence in the reconcile', () => {
    expect(lostJobCode({ kind: 'HIGHLIGHTS', input: {} } as never)).toBe('highlights_failed');
  });
});
