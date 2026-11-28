/**
 * `ClipCostService` (Module 15 section 3): a finished job's cost is written
 * once, from the row and what sits beside it (the AI engine's name, an
 * import's files, a Find Clips run's setup); an open job, a costed job and
 * another workspace's job are left alone; nothing ever throws; the
 * maintenance pass costs what a lost call left behind.
 */
import type { AiEngine } from '../../ai/engine/engine.types';
import { ClipCostService } from './clip-cost.service';
import { CLIP_PRICES_DATE } from './clip-prices';

const ORG = 'org-1';
const JOB = '11111111-1111-4111-8111-111111111111';
const LISTEN = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const VIDEO = '44444444-4444-4444-8444-444444444444';
const START = new Date('2026-11-28T10:00:00.000Z');
const after = (seconds: number) => new Date(START.getTime() + seconds * 1000);

const db = {
  jobFindFirst: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  jobFindMany: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  jobUpdateMany: jest.fn(async (..._args: unknown[]) => ({ count: 1 })),
  assetAggregate: jest.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      _sum: { bytes: null },
    }),
  ),
  assetFindFirst: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  runFindFirst: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    clipJob: {
      findFirst: (...args: unknown[]) => db.jobFindFirst(...args),
      findMany: (...args: unknown[]) => db.jobFindMany(...args),
      updateMany: (...args: unknown[]) => db.jobUpdateMany(...args),
    },
    clipAsset: {
      aggregate: (...args: unknown[]) => db.assetAggregate(...args),
      findFirst: (...args: unknown[]) => db.assetFindFirst(...args),
    },
    clipHighlightRun: { findFirst: (...args: unknown[]) => db.runFindFirst(...args) },
  },
}));

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    organizationId: ORG,
    kind: 'RENDER',
    status: 'DONE',
    stage: 'finishing',
    input: { proof: false },
    output: { durationMs: 30_000, bytes: 20_000_000 },
    startedAt: START,
    finishedAt: after(60),
    costCents: null,
    videoId: VIDEO,
    highlightRunId: null,
    video: { durationMs: 600_000 },
    ...overrides,
  };
}

function build(modelName: string | null = 'openai:gpt-4.1-mini') {
  return new ClipCostService({ modelName } as unknown as AiEngine);
}

/** The `data` of the one cost write. */
function written(): { costCents: number; cost: Record<string, unknown> } {
  const call = db.jobUpdateMany.mock.calls[0]?.[0] as {
    data: { costCents: number; cost: Record<string, unknown> };
  };
  return call.data;
}

beforeEach(() => {
  for (const mock of Object.values(db)) mock.mockClear();
  db.jobFindFirst.mockImplementation(async () => null);
  db.jobUpdateMany.mockImplementation(async () => ({ count: 1 }));
});

describe('record', () => {
  it('writes an export: FFmpeg facts, exact cents in the facts, whole cents in the column', async () => {
    db.jobFindFirst.mockResolvedValueOnce(row());
    await build().record(ORG, JOB);

    expect(db.jobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: JOB, organizationId: ORG } }),
    );
    expect(db.jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: JOB, organizationId: ORG, costCents: null } }),
    );
    const data = written();
    expect(data.cost).toEqual({
      videoSeconds: 30,
      ranSeconds: 60,
      provider: 'ffmpeg',
      units: { processorSeconds: 240, storedGbMonths: 0.02 },
      estimated: false,
      prices: CLIP_PRICES_DATE,
      cents: 0.2033,
    });
    expect(data.costCents).toBe(0);
  });

  it('reads an import its files as they stood when it ended', async () => {
    db.jobFindFirst.mockResolvedValueOnce(
      row({ kind: 'IMPORT', input: {}, output: { durationMs: 600_000, assets: 6 } }),
    );
    db.assetAggregate.mockResolvedValueOnce({ _sum: { bytes: BigInt(900_000_000) } });
    await build().record(ORG, JOB);

    const call = db.assetAggregate.mock.calls[0]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    expect(call?.where).toMatchObject({
      organizationId: ORG,
      videoId: VIDEO,
      createdAt: { lte: after(60) },
    });
    expect(written().cost).toMatchObject({
      provider: 'ffmpeg',
      units: { processorSeconds: 120, storedGbMonths: 0.9 },
    });
    // 120 vCPU-seconds (0.0867 cents) and 0.9 GB for a month (1.35 cents).
    expect(written().cost.cents).toBe(1.4367);
    expect(written().costCents).toBe(1);
  });

  it('reads a sharp copy its asset in the same workspace', async () => {
    db.jobFindFirst.mockResolvedValueOnce(
      row({
        kind: 'SEGMENT',
        input: { fromMs: 0, toMs: 60_000 },
        output: { gone: false, assetId: VIDEO },
      }),
    );
    db.assetFindFirst.mockResolvedValueOnce({ bytes: BigInt(50_000_000) });
    await build().record(ORG, JOB);
    expect(db.assetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VIDEO, organizationId: ORG } }),
    );
    expect(written().cost).toMatchObject({ units: { storedGbMonths: 0.05 } });
  });

  it('names the listener from a listening job output and bills a hosted one per audio hour', async () => {
    db.jobFindFirst.mockResolvedValueOnce(
      row({
        kind: 'TRANSCRIBE',
        input: { ranges: [{ fromMs: 0, toMs: 600_000 }] },
        output: {
          transcriptAssetId: null,
          language: 'en',
          wordCount: 900,
          noSpeech: false,
          secondsListened: 600,
          model: 'groq:whisper-large-v3-turbo',
        },
      }),
    );
    await build().record(ORG, JOB);
    expect(written().cost).toMatchObject({
      provider: 'groq:whisper-large-v3-turbo',
      units: { audioSeconds: 600, processorSeconds: 0 },
      estimated: false,
      cents: 0.6667,
    });
    expect(written().costCents).toBe(1);
  });

  it('names the AI engine for a Find Clips run that read, from its setup, and estimates', async () => {
    db.jobFindFirst
      .mockResolvedValueOnce(
        row({
          kind: 'HIGHLIGHTS',
          highlightRunId: RUN,
          input: { videoId: VIDEO, runId: RUN },
          output: {
            found: 4,
            ai: { read: true, noSpeech: false, asked: true, matched: 2, watched: true, actions: 1 },
          },
        }),
      )
      // Its own listening job ran for its first 20 seconds.
      .mockResolvedValueOnce({ startedAt: START, finishedAt: after(20) });
    db.runFindFirst.mockResolvedValueOnce({
      params: {
        setup: {
          range: { fromMs: 0, toMs: 3_600_000 },
          language: 'en',
          request: '',
          genre: 'auto',
          length: 'auto',
          ratio: '9:16',
          captions: { on: false, styleId: 'clean' },
          action: true,
          follow: false,
          silences: false,
          hookTitle: false,
          recipeId: null,
          brandKitId: null,
        },
        listenJobId: LISTEN,
        charges: { read: 'entry-1', signals: null, action: 'entry-2' },
        actionVision: true,
      },
    });
    await build('simulation').record(ORG, JOB);

    expect(db.runFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RUN, organizationId: ORG } }),
    );
    expect(db.jobFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: LISTEN, organizationId: ORG } }),
    );
    // The video is 10 minutes, so the hour asked for reads as 600 seconds.
    expect(written().cost).toMatchObject({
      videoSeconds: 600,
      provider: 'simulation',
      units: { processorSeconds: 80, tokensIn: 5_333, tokensOut: 833, pictures: 48 },
      estimated: true,
    });
  });

  it('leaves a costed job, an open job and a missing job alone', async () => {
    db.jobFindFirst.mockResolvedValueOnce(row({ costCents: 3 }));
    await build().record(ORG, JOB);
    db.jobFindFirst.mockResolvedValueOnce(row({ status: 'RUNNING', finishedAt: null }));
    await build().record(ORG, JOB);
    db.jobFindFirst.mockResolvedValueOnce(null);
    await build().record('another-org', JOB);
    expect(db.jobUpdateMany).not.toHaveBeenCalled();
  });

  it('costs failed and cancelled jobs too', async () => {
    db.jobFindFirst.mockResolvedValueOnce(row({ status: 'FAILED', output: null }));
    await build().record(ORG, JOB);
    db.jobFindFirst.mockResolvedValueOnce(
      row({ status: 'CANCELLED', startedAt: null, output: null }),
    );
    await build().record(ORG, JOB);
    expect(db.jobUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('never throws, and logs ids and the error name only', async () => {
    const service = build();
    const logger = jest.spyOn(Reflect.get(service, 'logger'), 'warn').mockImplementation(() => {});
    db.jobFindFirst.mockRejectedValueOnce(new TypeError('connection reset with secret words'));
    await expect(service.record(ORG, JOB)).resolves.toBeUndefined();
    db.jobFindFirst.mockResolvedValueOnce(row());
    db.jobUpdateMany.mockRejectedValueOnce(new Error('write failed'));
    await expect(service.record(ORG, JOB)).resolves.toBeUndefined();

    const lines = logger.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      event: 'clips.cost.record_failed',
      jobId: JOB,
      orgId: ORG,
      reason: 'TypeError',
    });
    expect(lines.join(' ')).not.toContain('secret');
  });

  it('works without an AI engine', async () => {
    db.jobFindFirst.mockResolvedValueOnce(
      row({ kind: 'TRANSLATE', input: { fromMs: 0, toMs: 60_000 }, output: null }),
    );
    await new ClipCostService().record(ORG, JOB);
    expect(written().cost).toMatchObject({ provider: 'unknown', estimated: true });
  });
});

describe('recordMissing', () => {
  it('costs finished jobs since the date with no cost, oldest first, and counts what it wrote', async () => {
    const since = new Date('2026-11-27T00:00:00.000Z');
    db.jobFindMany.mockResolvedValueOnce([
      { id: JOB, organizationId: ORG },
      { id: LISTEN, organizationId: 'org-2' },
    ]);
    db.jobFindFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ id: LISTEN, organizationId: 'org-2' }));
    db.jobUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(build().recordMissing(since, 25)).resolves.toBe(1);
    expect(db.jobFindMany).toHaveBeenCalledWith({
      where: {
        costCents: null,
        status: { in: ['DONE', 'FAILED', 'CANCELLED'] },
        finishedAt: { gte: since },
      },
      select: { id: true, organizationId: true },
      orderBy: { finishedAt: 'asc' },
      take: 25,
    });
    // Each job is read in its own workspace.
    expect(db.jobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LISTEN, organizationId: 'org-2' } }),
    );
  });

  it('answers 0 and never throws when the list cannot be read', async () => {
    const service = build();
    jest.spyOn(Reflect.get(service, 'logger'), 'warn').mockImplementation(() => {});
    db.jobFindMany.mockRejectedValueOnce(new Error('down'));
    await expect(service.recordMissing(new Date())).resolves.toBe(0);
  });
});
