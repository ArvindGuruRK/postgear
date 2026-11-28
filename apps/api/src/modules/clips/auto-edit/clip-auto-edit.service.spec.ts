/**
 * Auto-Edit Video (Sprint 13, Module 10) against an in-memory database and an
 * in-memory ledger: the price follows coverage, a video over 30 minutes needs
 * a range (and a range over 30 minutes is refused with its sentence), the
 * running and the AI minutes refusals come before any charge, a clip with
 * nothing to listen to is made at once (200), a clip that needs listening
 * writes an AUTO_EDIT job (202), and the listening it started is given back
 * when its row never lands. Cancelling the job cancels its listening.
 */
import { HttpException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import {
  clipErrorMessage,
  DEFAULT_AUTO_EDIT_RECIPE,
  type RecipeSettings,
} from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipRecipeApplierService } from '../recipes/clip-recipe-applier.service';
import {
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
  readsLedger,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { ClipAutoEditRepository } from './clip-auto-edit.repository';
import { autoEditSchema } from './clip-auto-edit.schema';
import { ClipAutoEditService, recipeNeedsWords } from './clip-auto-edit.service';

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

// The starters' settings are the engine's data; pinned here so these specs
// test the route's rules, not the table.
const STARTERS: Record<string, RecipeSettings> = {
  'starter-auto-edit-talking-video': {
    version: 1,
    silences: { on: true, minMs: 800 },
    fillers: { on: true },
    captions: { on: true, styleId: 'clean' },
  },
  'starter-reframe': { version: 1, ratio: '9:16', follow: { on: true, mode: 'speaker' } },
};
jest.mock('@postgear/video-engine', () => {
  const actual = jest.requireActual('@postgear/video-engine');
  return {
    ...actual,
    starterRecipe: (id: string) =>
      STARTERS[id] ? { id, name: id, help: '', settings: STARTERS[id] } : null,
  };
});

const VIDEO = videoRow().id;
const LISTEN_JOB = '77777777-7777-4777-8777-777777777777';
const OWN_RECIPE = '55555555-5555-4555-8555-555555555555';
const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');
const MINUTE = 60_000;

interface Entry {
  id: string;
  key: string;
  units: number;
  refId: string | null;
}

function fakeLedger(limit: number) {
  const entries: Entry[] = [];
  const used = () => entries.reduce((sum, entry) => sum + entry.units, 0);
  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        _meter: string,
        units: number,
        options: { idempotencyKey: string; refId?: string },
      ) => {
        const entry = {
          id: `entry-${entries.length + 1}`,
          key: options.idempotencyKey,
          units,
          refId: options.refId ?? null,
        };
        entries.push(entry);
        return {
          entryId: entry.id,
          duplicate: false,
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
        entries.push({ id: `entry-${entries.length + 1}`, key, units: -charge.units, refId });
        count += 1;
      }
      return count;
    }),
  };
  return { usage, used, entries };
}

function setup(
  options: {
    tables?: FakeTables;
    limit?: number;
    listenPrice?: number;
    joined?: boolean;
    /** Runs inside `ensure`, after its charge (a race with another request). */
    duringEnsure?: (tables: FakeTables) => void;
  } = {},
) {
  const tables = options.tables ?? seed();
  mockDb = fakeClipDb(tables);
  const limit = options.limit ?? 30;
  const ledger = fakeLedger(limit);
  // Module 15: the scheduler starts a paid AI job only while its charge stands.
  readsLedger(mockDb, ledger.entries);
  const jobsRepository = new ClipJobsRepository();
  const scheduling = {
    startClipJob: jest.fn(async () => true),
    cancelClipJob: jest.fn(async () => 'notFound' as const),
  };
  const jobs = new ClipJobsService(
    jobsRepository,
    scheduling as unknown as SchedulingService,
    { get: jest.fn(async () => 'normal') } as unknown as EntitlementResolver,
    ledger.usage as unknown as UsageService,
    { deletePrefix: jest.fn() } as never,
  );
  jest.spyOn(jobs, 'newJobId').mockReturnValue('88888888-8888-4888-8888-000000000001');
  const resolver = {
    meter: jest.fn(async () => ({
      used: ledger.used(),
      limit,
      remaining: limit - ledger.used(),
      cycleStart: new Date('2026-11-01T00:00:00.000Z'),
      cycleEnd: CYCLE_END,
    })),
  };
  const listenPrice = options.listenPrice ?? 0;
  const transcripts = {
    quote: jest.fn(async () => ({ price: listenPrice, ms: 0, covered: listenPrice === 0 })),
    ensure: jest.fn(async (org: string) => {
      if (!options.joined) {
        // Module 02 writes its own TRANSCRIBE job and charges under its own key.
        tables.jobs.push(
          jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'QUEUED', videoId: VIDEO }),
        );
        await ledger.usage.consume(org, 'clips.ai_minutes_per_month', listenPrice, {
          idempotencyKey: `clips.ai:listen:${LISTEN_JOB}`,
          refId: LISTEN_JOB,
        });
      }
      options.duringEnsure?.(tables);
      return {
        covered: false,
        job: { id: LISTEN_JOB },
        price: options.joined ? 0 : listenPrice,
        joined: Boolean(options.joined),
      };
    }),
  };
  const applier = {
    createAutoEditClip: jest.fn(
      async (_org: string, _user: string | null, params: { clipId: string }) => ({
        clipId: params.clipId,
        skipped: [{ part: 'captions' as const, reason: 'no_speech' as const }],
        noSpeech: true,
      }),
    ),
  };
  const repository = {
    findRecipe: jest.fn(async (org: string, id: string) =>
      org === TEST_ORG && id === OWN_RECIPE ? { id, settings: { version: 1, ratio: '1:1' } } : null,
    ),
  };
  const service = new ClipAutoEditService(
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    ledger.usage as unknown as UsageService,
    resolver as unknown as EntitlementResolver,
    transcripts as unknown as ClipTranscriptsService,
    applier as unknown as ClipRecipeApplierService,
    repository as unknown as ClipAutoEditRepository,
  );
  return { service, tables, ledger, jobs, scheduling, transcripts, applier };
}

function seed(durationMs = 10 * MINUTE, hasAudio = true): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', durationMs, hasAudio }));
  return tables;
}

const body = (extra: Record<string, unknown> = {}) => autoEditSchema.parse(extra);

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

describe('the body', () => {
  it('defaults to Auto-Edit Talking Video and refuses unknown keys and made-up ids', () => {
    expect(body().recipeId).toBe(DEFAULT_AUTO_EDIT_RECIPE);
    expect(autoEditSchema.safeParse({ recipeId: 'starter-nope' }).success).toBe(false);
    expect(autoEditSchema.safeParse({ extra: true }).success).toBe(false);
    expect(autoEditSchema.safeParse({ range: { fromMs: 5, toMs: 5 } }).success).toBe(false);
  });

  it('needs words for captions, silences, filler words or bleeps only', () => {
    expect(recipeNeedsWords({ version: 1, ratio: '9:16' })).toBe(false);
    expect(recipeNeedsWords({ version: 1, captions: { on: false, styleId: 'clean' } })).toBe(false);
    expect(recipeNeedsWords({ version: 1, bleep: { on: true, mode: 'mute' } })).toBe(true);
  });
});

describe('POST /clips/videos/:videoId/auto-edit/price', () => {
  it('follows coverage: a covered video costs nothing', async () => {
    const { service } = setup({ listenPrice: 0 });
    await expect(service.price(TEST_ORG, VIDEO, body())).resolves.toEqual({
      aiMinutes: 0,
      range: { fromMs: 0, toMs: 10 * MINUTE },
      needsRange: false,
      remaining: 30,
      limit: 30,
      cycleEnd: CYCLE_END.toISOString(),
    });
  });

  it('prices the listening a video still lacks, and nothing for a recipe without words', async () => {
    const { service, transcripts } = setup({ listenPrice: 4 });
    expect((await service.price(TEST_ORG, VIDEO, body())).aiMinutes).toBe(4);
    expect(transcripts.quote).toHaveBeenCalledWith(TEST_ORG, VIDEO, {
      fromMs: 0,
      toMs: 10 * MINUTE,
    });
    expect(
      (await service.price(TEST_ORG, VIDEO, body({ recipeId: 'starter-reframe' }))).aiMinutes,
    ).toBe(0);
  });

  it('a silent video has nothing to listen to', async () => {
    const { service } = setup({ tables: seed(10 * MINUTE, false), listenPrice: 4 });
    expect((await service.price(TEST_ORG, VIDEO, body())).aiMinutes).toBe(0);
  });

  it('a video over 30 minutes asks for a range, priced on its first 30 minutes', async () => {
    const { service } = setup({ tables: seed(31 * MINUTE) });
    const price = await service.price(TEST_ORG, VIDEO, body());
    expect(price.needsRange).toBe(true);
    expect(price.range).toEqual({ fromMs: 0, toMs: 30 * MINUTE });
  });
});

describe('POST /clips/videos/:videoId/auto-edit', () => {
  it('makes the clip at once when nothing needs listening (200: no job, no charge)', async () => {
    const { service, applier, tables, ledger, transcripts } = setup({ listenPrice: 0 });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO, body());
    expect(outcome.job).toBeNull();
    expect(outcome.aiMinutes).toBe(0);
    expect(outcome.noSpeech).toBe(true);
    expect(outcome.skipped).toEqual([{ part: 'captions', reason: 'no_speech' }]);
    expect(applier.createAutoEditClip).toHaveBeenCalledWith(TEST_ORG, TEST_USER, {
      clipId: outcome.clipId,
      videoId: VIDEO,
      recipeId: DEFAULT_AUTO_EDIT_RECIPE,
      range: { fromMs: 0, toMs: 10 * MINUTE },
    });
    expect(transcripts.ensure).not.toHaveBeenCalled();
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.used()).toBe(0);
  });

  it('refuses a 31 minute video without a range, and a range over 30 minutes, with its sentence', async () => {
    const { service, applier } = setup({ tables: seed(31 * MINUTE) });
    const sentence = 'Auto-Edit works on up to 30 minutes at a time. Pick the part you want.';
    expect(clipErrorMessage('auto_edit_too_long')).toBe(sentence);
    await expect(refusal(service.start(TEST_ORG, TEST_USER, VIDEO, body()))).resolves.toEqual({
      status: 422,
      body: { message: sentence, code: 'auto_edit_too_long' },
    });
    const wide = body({ range: { fromMs: 0, toMs: 31 * MINUTE } });
    expect((await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, wide))).body.code).toBe(
      'auto_edit_too_long',
    );
    expect((await refusal(service.price(TEST_ORG, VIDEO, wide))).status).toBe(422);
    expect(applier.createAutoEditClip).not.toHaveBeenCalled();
  });

  it('takes a range of at most 30 minutes inside a longer video', async () => {
    const { service, applier } = setup({ tables: seed(45 * MINUTE) });
    const range = { fromMs: 5 * MINUTE, toMs: 35 * MINUTE };
    await service.start(TEST_ORG, TEST_USER, VIDEO, body({ range }));
    expect(applier.createAutoEditClip.mock.calls[0]?.[2]).toMatchObject({ range });
  });

  it('a workspace recipe is used; another workspace recipe is a 404', async () => {
    const { service, applier } = setup({ listenPrice: 6 });
    // The own recipe only changes the shape: no words, so no listening and no job.
    const own = await service.start(TEST_ORG, TEST_USER, VIDEO, body({ recipeId: OWN_RECIPE }));
    expect(own.job).toBeNull();
    expect(applier.createAutoEditClip.mock.calls[0]?.[2]).toMatchObject({ recipeId: OWN_RECIPE });
    const other = '66666666-6666-4666-8666-666666666666';
    expect(
      await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, body({ recipeId: other }))),
    ).toMatchObject({ status: 404, body: { code: 'recipe_not_found' } });
  });

  it('listens first: an AUTO_EDIT job waits on the listen job (202), the listening charged once', async () => {
    const { service, tables, scheduling, ledger, applier } = setup({ listenPrice: 4 });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO, body());
    const job = tables.jobs.find((row) => row.kind === 'AUTO_EDIT') as ClipJob;
    expect(job).toMatchObject({ videoId: VIDEO, clipId: outcome.clipId, status: 'QUEUED' });
    expect(job.input).toEqual({
      videoId: VIDEO,
      clipId: outcome.clipId,
      recipeId: DEFAULT_AUTO_EDIT_RECIPE,
      range: { fromMs: 0, toMs: 10 * MINUTE },
      listenJobId: LISTEN_JOB,
      listenStarted: true,
    });
    expect(outcome).toMatchObject({ aiMinutes: 4, skipped: [], noSpeech: false });
    expect(outcome.job).toMatchObject({ id: job.id, kind: 'AUTO_EDIT' });
    expect(scheduling.startClipJob).toHaveBeenCalledWith(job.id, TEST_ORG, 'AUTO_EDIT');
    expect(ledger.used()).toBe(4);
    expect(applier.createAutoEditClip).not.toHaveBeenCalled();
  });

  it('a listen job it only joined is not its own (listenStarted false, nothing charged)', async () => {
    const { service, tables, ledger } = setup({ listenPrice: 4, joined: true });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO, body());
    expect(outcome.aiMinutes).toBe(0);
    const job = tables.jobs.find((row) => row.kind === 'AUTO_EDIT') as ClipJob;
    expect(job.input).toMatchObject({ listenJobId: LISTEN_JOB, listenStarted: false });
    expect(ledger.used()).toBe(0);
  });

  it('409 auto_edit_running while another edit of the video is open, before any charge', async () => {
    const tables = seed();
    tables.jobs.push(jobRow({ kind: 'AUTO_EDIT', status: 'RUNNING', videoId: VIDEO }));
    const { service, transcripts, applier } = setup({ tables, listenPrice: 4 });
    expect(await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, body()))).toMatchObject({
      status: 409,
      body: { code: 'auto_edit_running', message: clipErrorMessage('auto_edit_running') },
    });
    expect(transcripts.ensure).not.toHaveBeenCalled();
    expect(applier.createAutoEditClip).not.toHaveBeenCalled();
  });

  it('402 clips_ai_minutes_used when the listening does not fit, before any charge', async () => {
    const { service, transcripts, ledger } = setup({ listenPrice: 12, limit: 5 });
    const error = await service.start(TEST_ORG, TEST_USER, VIDEO, body()).catch((e) => e);
    expect(error).toBeInstanceOf(EntitlementRefusedException);
    expect((error as HttpException).getStatus()).toBe(402);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'clips_ai_minutes_used',
    });
    expect(transcripts.ensure).not.toHaveBeenCalled();
    expect(ledger.used()).toBe(0);
  });

  it('keeps the listening when another edit won the race: the winner may be waiting on it', async () => {
    const { service, tables, ledger } = setup({
      listenPrice: 4,
      duringEnsure: (rows) =>
        rows.jobs.push(
          jobRow({
            id: '99999999-9999-4999-8999-999999999999',
            kind: 'AUTO_EDIT',
            status: 'QUEUED',
            videoId: VIDEO,
          }),
        ),
    });
    expect((await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, body()))).body.code).toBe(
      'auto_edit_running',
    );
    expect(tables.jobs.find((row) => row.id === LISTEN_JOB)?.status).not.toBe('CANCELLED');
    // The words it buys are kept for the workspace, so a later Auto-Edit of the stretch is free.
    expect(ledger.used()).toBe(4);
  });

  it('gives the listening back when the video left READY meanwhile', async () => {
    const { service, tables, ledger } = setup({
      listenPrice: 4,
      duringEnsure: (rows) => {
        const video = rows.videos[0];
        if (video) video.status = 'FAILED';
      },
    });
    expect((await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, body()))).status).toBe(409);
    expect(tables.jobs.some((row) => row.kind === 'AUTO_EDIT')).toBe(false);
    expect(ledger.used()).toBe(0);
  });

  it('another workspace video is a plain 404', async () => {
    const { service } = setup();
    expect((await refusal(service.start('seed-second-org', TEST_USER, VIDEO, body()))).status).toBe(
      404,
    );
  });
});

describe('cancelling an AUTO_EDIT job', () => {
  it('cancels the listen job it started, which gives the listening back', async () => {
    const { service, tables, jobs, ledger } = setup({ listenPrice: 4 });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO, body());
    expect(ledger.used()).toBe(4);
    const view = await jobs.cancel(TEST_ORG, outcome.job?.id as string);
    expect(view.status).toBe('CANCELLED');
    expect(tables.jobs.find((row) => row.id === LISTEN_JOB)?.status).toBe('CANCELLED');
    expect(ledger.used()).toBe(0);
  });

  it('leaves a listen job it only joined alone', async () => {
    const tables = seed();
    tables.jobs.push(
      jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'RUNNING', videoId: VIDEO }),
    );
    const { service, jobs } = setup({ tables, listenPrice: 4, joined: true });
    const outcome = await service.start(TEST_ORG, TEST_USER, VIDEO, body());
    await jobs.cancel(TEST_ORG, outcome.job?.id as string);
    expect(tables.jobs.find((row) => row.id === LISTEN_JOB)?.status).toBe('RUNNING');
  });
});
