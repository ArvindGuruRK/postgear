/**
 * The transcript door (Sprint 13, Module 02) against an in-memory database
 * and ledger: covered answers at once, only the gaps are listened to and
 * charged, a running job is joined, the price, the refusal, the give-back
 * when nothing lands, fixes kept in the row's meta, tenancy, and no speech
 * text in any log line.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ClipAsset } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import {
  emptyTranscript,
  mergeTranscript,
  readTranscriptAssetMeta,
  type Transcript,
  transcriptAssetMeta,
  type WordFix,
} from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { MediaServiceProbe } from '../status/media-service.probe';
import {
  assetRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
  readsLedger,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { ClipTranscriptStore } from './clip-transcript-store';
import {
  capRanges,
  ClipTranscriptsService,
  listenChargeKey,
  listenPrice,
} from './clip-transcripts.service';

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
const TEN_MINUTES = 600_000;
const OTHER_ORG = 'seed-second-org';
const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');
const TRANSCRIPT_KEY = `clips/${TEST_ORG}/${VIDEO}/transcript-${'c'.repeat(32)}.json.gz`;

function fakeLedger(limit: number) {
  const entries: Array<{ id: string; key: string; units: number; refId: string | null }> = [];
  const used = () => entries.reduce((sum, entry) => sum + entry.units, 0);
  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        _meter: string,
        units: number,
        options: { idempotencyKey: string; refId?: string },
      ) => {
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
        entries.push({ id: `entry-${entries.length + 1}`, key, units: -charge.units, refId });
        count += 1;
      }
      return count;
    }),
  };
  return { usage, entries, used };
}

/** A transcript of the stream sample's 60 to 120 s: one word a second. */
function listened(fromSec = 60, toSec = 120): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: toSec * 1000 }],
    words: Array.from({ length: toSec - fromSec }, (_, index) => ({
      start: (fromSec + index) * 1000,
      end: (fromSec + index) * 1000 + 400,
      text: index === 3 ? 'Arvin,' : index === 9 ? 'Arvin' : `word${index}`,
      sure: 0.9,
    })),
  });
}

function transcriptAsset(
  transcript: Transcript,
  fixes: WordFix[] = [],
  source?: string,
): ClipAsset {
  return assetRow({
    id: '77777777-7777-4777-8777-777777777777',
    organizationId: TEST_ORG,
    videoId: VIDEO,
    kind: 'TRANSCRIPT',
    key: TRANSCRIPT_KEY,
    meta: { ...transcriptAssetMeta(transcript, fixes), ...(source ? { source } : {}) },
  } as Partial<ClipAsset>);
}

let idCount = 0;
function setup(
  options: {
    tables?: FakeTables;
    limit?: number;
    transcript?: Transcript | null;
    service?: 'ok' | 'off';
  } = {},
) {
  const tables = options.tables ?? seed();
  mockDb = fakeClipDb(tables);
  const ledger = fakeLedger(options.limit ?? 300);
  // Module 15: the scheduler starts a paid AI job only while its charge stands.
  readsLedger(mockDb, ledger.entries);
  const jobsRepository = new ClipJobsRepository();
  const scheduling = { startClipJob: jest.fn(async () => true) };
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
  const store = { read: jest.fn(async () => options.transcript ?? null) };
  const service = new ClipTranscriptsService(
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    ledger.usage as unknown as UsageService,
    store as unknown as ClipTranscriptStore,
    { state: jest.fn(async () => options.service ?? 'ok') } as unknown as MediaServiceProbe,
  );
  return { service, tables, ledger, scheduling, store };
}

function seed(extra: (tables: FakeTables) => void = () => undefined): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', durationMs: TEN_MINUTES, hasAudio: true }));
  extra(tables);
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
  it('is one AI minute for each minute listened to, rounded up, two at least', () => {
    expect(listenPrice([{ fromMs: 0, toMs: TEN_MINUTES }])).toBe(10);
    expect(listenPrice([{ fromMs: 0, toMs: 60_000 }])).toBe(2);
    expect(listenPrice([{ fromMs: 0, toMs: 30_000 }])).toBe(2);
    expect(listenPrice([{ fromMs: 0, toMs: 150_000 }])).toBe(3);
    expect(listenPrice([])).toBe(0);
  });

  it('caps the stretches of one job by listening through the smallest gaps', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      fromMs: i * 60_000,
      toMs: i * 60_000 + 30_000,
    }));
    const capped = capRanges(many);
    expect(capped).toHaveLength(64);
    expect(capped[0]?.fromMs).toBe(0);
    expect(capped.at(-1)?.toMs).toBe(69 * 60_000 + 30_000);
  });
});

describe('ensure', () => {
  it('listens to an unheard stretch: the job, the price, one charge with its key', async () => {
    const { service, tables, ledger, scheduling } = setup();
    const outcome = await service.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 60_000,
      toMs: 180_000,
    });

    expect(outcome.covered).toBe(false);
    if (outcome.covered || outcome.joined) throw new Error('expected a new job');
    expect(outcome.price).toBe(2);
    expect(outcome.ranges).toEqual([{ fromMs: 60_000, toMs: 180_000 }]);
    expect(outcome.meter.remaining).toBe(298);
    expect(tables.jobs).toHaveLength(1);
    expect(tables.jobs[0]).toMatchObject({
      kind: 'TRANSCRIBE',
      videoId: VIDEO,
      input: { videoId: VIDEO, language: 'auto', ranges: outcome.ranges, aiMinutes: 2 },
    });
    expect(ledger.entries.map((entry) => entry.key)).toEqual([listenChargeKey(outcome.job.id)]);
    expect(scheduling.startClipJob).toHaveBeenCalledTimes(1);
  });

  it('rounds the request outward to 30 second blocks', async () => {
    const { service } = setup();
    const outcome = await service.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 61_500,
      toMs: 95_000,
    });
    if (outcome.covered) throw new Error('expected a job');
    expect(outcome.ranges).toEqual([{ fromMs: 60_000, toMs: 120_000 }]);
  });

  it('a covered stretch answers at once: no job, no charge', async () => {
    const { service, tables, ledger, scheduling } = setup({
      tables: seed((t) => t.assets.push(transcriptAsset(listened()))),
    });
    await expect(
      service.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 61_000, toMs: 119_000 }),
    ).resolves.toEqual({ covered: true, language: 'en', price: 0 });
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
    expect(scheduling.startClipJob).not.toHaveBeenCalled();
  });

  it('a wider stretch listens only to the new part and charges only for it', async () => {
    const { service } = setup({ tables: seed((t) => t.assets.push(transcriptAsset(listened()))) });
    const outcome = await service.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 0, toMs: 240_000 });
    if (outcome.covered || outcome.joined) throw new Error('expected a new job');
    expect(outcome.ranges).toEqual([
      { fromMs: 0, toMs: 60_000 },
      { fromMs: 120_000, toMs: 240_000 },
    ]);
    // Three minutes are new: the minute already heard is not paid for again.
    expect(outcome.price).toBe(3);
  });

  it('the whole video is the default stretch', async () => {
    const { service } = setup();
    const outcome = await service.ensure(TEST_ORG, TEST_USER, VIDEO);
    if (outcome.covered) throw new Error('expected a job');
    expect(outcome.ranges).toEqual([{ fromMs: 0, toMs: TEN_MINUTES }]);
    expect(outcome.price).toBe(10);
  });

  it('joins a job already listening to that stretch instead of starting a second', async () => {
    const { service, tables, ledger } = setup();
    const first = await service.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 0, toMs: 120_000 });
    const second = await service.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 60_000,
      toMs: 180_000,
    });
    if (first.covered || second.covered) throw new Error('expected jobs');
    expect(second.joined).toBe(true);
    expect(second.price).toBe(0);
    expect(second.job.id).toBe(first.job.id);
    expect(tables.jobs).toHaveLength(1);
    expect(ledger.entries).toHaveLength(1);
  });

  it('refuses with the numbers when the AI minutes are short, before any job', async () => {
    const { service, tables, ledger } = setup({ limit: 5 });
    const answer = await refusal(service.ensure(TEST_ORG, TEST_USER, VIDEO));
    expect(answer.status).toBe(402);
    expect(answer.body.code).toBe('clips_ai_minutes_used');
    expect(String(answer.body.message)).toContain('needs 10 AI minutes and you have 5 left');
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.used()).toBe(0);
  });

  it('gives the charge back when the row never lands', async () => {
    const { service, tables, ledger } = setup();
    // The video leaves READY between the first look and the transaction.
    const original = mockDb.$transaction;
    mockDb.$transaction = (async (fn: never, ...rest: never[]) => {
      (tables.videos[0] as { status: string }).status = 'IMPORTING';
      return (original as (...args: unknown[]) => unknown)(fn, ...rest);
    }) as never;
    const answer = await refusal(
      service.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 0, toMs: 60_000 }),
    );
    expect(answer.body.code).toBe('video_not_ready');
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.used()).toBe(0);
    expect(ledger.entries.map((entry) => entry.key)).toEqual([
      expect.stringMatching(/^clips\.ai:listen:/),
      'rev:entry-1',
    ]);
  });

  it('a file the person supplied covers everything: nothing is listened to', async () => {
    const { service, ledger } = setup({
      tables: seed((t) => t.assets.push(transcriptAsset(listened(), [], 'supplied'))),
    });
    await expect(service.ensure(TEST_ORG, TEST_USER, VIDEO)).resolves.toMatchObject({
      covered: true,
    });
    expect(ledger.entries).toHaveLength(0);
  });

  it.each([
    ['a video with no sound', { hasAudio: false }, {}, 409, 'no_speech'],
    ['a video still coming in', { status: 'IMPORTING' }, {}, 409, 'video_not_ready'],
    ['a language we cannot draw', {}, { language: 'ja' }, 422, 'language_unsupported'],
  ] as const)('refuses %s before any charge', async (_name, video, request, status, code) => {
    const tables = emptyTables();
    tables.videos.push(
      videoRow({ status: 'READY', durationMs: TEN_MINUTES, hasAudio: true, ...video } as never),
    );
    const { service, ledger } = setup({ tables });
    const answer = await refusal(service.ensure(TEST_ORG, TEST_USER, VIDEO, request));
    expect([answer.status, answer.body.code]).toEqual([status, code]);
    expect(ledger.entries).toHaveLength(0);
  });

  it('says captions are off when the media service is not running, before any charge', async () => {
    const { service, ledger } = setup({ service: 'off' });
    const answer = await refusal(service.ensure(TEST_ORG, TEST_USER, VIDEO));
    expect([answer.status, answer.body.code]).toEqual([503, 'captions_off']);
    expect(ledger.entries).toHaveLength(0);
  });

  it("answers another workspace's video as not found", async () => {
    const { service } = setup();
    const answer = await refusal(service.ensure(OTHER_ORG, TEST_USER, VIDEO));
    expect([answer.status, answer.body.code]).toEqual([404, 'video_not_found']);
    expect((await refusal(service.read(OTHER_ORG, VIDEO))).status).toBe(404);
    expect((await refusal(service.ensure(TEST_ORG, TEST_USER, 'not-a-uuid'))).status).toBe(404);
  });

  it('quotes the price without charging or starting anything', async () => {
    const { service, tables, ledger } = setup({
      tables: seed((t) => t.assets.push(transcriptAsset(listened()))),
    });
    await expect(service.quote(TEST_ORG, VIDEO, { fromMs: 0, toMs: 240_000 })).resolves.toEqual({
      price: 3,
      ms: 180_000,
      covered: false,
    });
    await expect(
      service.quote(TEST_ORG, VIDEO, { fromMs: 60_000, toMs: 120_000 }),
    ).resolves.toEqual({
      price: 0,
      ms: 0,
      covered: true,
    });
    expect(tables.jobs).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('never logs a word of what was said', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const { service } = setup({
        tables: seed((t) => t.assets.push(transcriptAsset(listened()))),
        transcript: listened(),
      });
      await service.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 0, toMs: 60_000 });
      await service.fix(TEST_ORG, VIDEO, { replace: { from: 'Arvin', to: 'Arvind' } });
    } finally {
      spy.mockRestore();
    }
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join('\n')).not.toMatch(/Arvin|word\d/);
  });
});

describe('read', () => {
  it('answers the words of a stretch with fixes applied, and what is left to listen to', async () => {
    const transcript = listened();
    const { service } = setup({
      tables: seed((t) =>
        t.assets.push(transcriptAsset(transcript, [{ at: 63_000, text: 'Arvind,' }])),
      ),
      transcript,
    });
    const outcome = await service.read(TEST_ORG, VIDEO, { fromMs: 60_000, toMs: 70_000 });
    expect(outcome.complete).toBe(true);
    expect(outcome.price).toBe(0);
    expect(outcome.transcript?.words.map((word) => word.text).slice(0, 5)).toEqual([
      'word0',
      'word1',
      'word2',
      'Arvind,',
      'word4',
    ]);
    expect(outcome.transcript).toMatchObject({ language: 'en', source: 'listened', fixes: 1 });

    const wider = await service.read(TEST_ORG, VIDEO, { fromMs: 0, toMs: 180_000 });
    expect(wider.complete).toBe(false);
    expect(wider.price).toBe(2);
    expect(wider.transcript?.covered).toEqual([{ fromMs: 60_000, toMs: 120_000 }]);
  });

  it('answers no transcript, and the price, for a video nobody listened to', async () => {
    const { service } = setup();
    await expect(service.read(TEST_ORG, VIDEO)).resolves.toEqual({
      transcript: null,
      complete: false,
      price: 10,
    });
  });
});

describe('fix', () => {
  const withTranscript = () => {
    const transcript = listened();
    return setup({
      tables: seed((t) => t.assets.push(transcriptAsset(transcript))),
      transcript,
    });
  };
  const fixesOf = (tables: FakeTables): WordFix[] =>
    readTranscriptAssetMeta(tables.assets[0]?.meta)?.fixes ?? [];

  it('keeps a fix in the row meta, keyed by the moment the word starts', async () => {
    const { service, tables } = withTranscript();
    await expect(
      service.fix(TEST_ORG, VIDEO, { fixes: [{ index: 3, text: 'Arvind,' }] }),
    ).resolves.toEqual({ changed: 1, fixes: 1 });
    expect(fixesOf(tables)).toEqual([{ at: 63_000, text: 'Arvind,' }]);
  });

  it('Replace Everywhere fixes every spelling and keeps punctuation', async () => {
    const { service, tables } = withTranscript();
    await expect(
      service.fix(TEST_ORG, VIDEO, { replace: { from: 'arvin', to: 'Arvind' } }),
    ).resolves.toEqual({ changed: 2, fixes: 2 });
    expect(fixesOf(tables)).toEqual([
      { at: 63_000, text: 'Arvind,' },
      { at: 69_000, text: 'Arvind' },
    ]);
  });

  it('typing the heard word back, or restore, takes the fix away', async () => {
    const { service, tables } = withTranscript();
    await service.fix(TEST_ORG, VIDEO, {
      fixes: [
        { index: 3, text: 'Arvind,' },
        { index: 9, text: 'Arvind' },
      ],
    });
    await service.fix(TEST_ORG, VIDEO, { fixes: [{ index: 3, text: 'Arvin,' }] });
    expect(fixesOf(tables)).toEqual([{ at: 69_000, text: 'Arvind' }]);
    await service.fix(TEST_ORG, VIDEO, { restore: [9] });
    expect(fixesOf(tables)).toEqual([]);
  });

  it('ignores a word index the transcript does not have, and refuses a video never listened to', async () => {
    const { service, tables } = withTranscript();
    await expect(
      service.fix(TEST_ORG, VIDEO, { fixes: [{ index: 9_999, text: 'x' }] }),
    ).resolves.toEqual({ changed: 0, fixes: 0 });
    expect(fixesOf(tables)).toEqual([]);
    const bare = setup();
    const answer = await refusal(bare.service.fix(TEST_ORG, VIDEO, { restore: [1] }));
    expect([answer.status, answer.body.code]).toEqual([409, 'transcript_missing']);
  });
});

describe('Export The Transcript, a video (Module 17 item 10)', () => {
  it('writes the whole transcript as SRT on the video clock, with the video-wide fixes', async () => {
    const transcript = listened();
    const { service } = setup({
      tables: seed((t) =>
        t.assets.push(transcriptAsset(transcript, [{ at: 63_000, text: 'Arvind,' }])),
      ),
      transcript,
    });
    const file = await service.download(TEST_ORG, VIDEO, { format: 'srt' });
    expect(file.contentType).toBe('application/x-subrip; charset=utf-8');
    expect(file.fileName).toMatch(/\.srt$/);
    expect(file.words).toBe(60);
    // A 600 ms gap is no pause, so cues run up to 7 seconds, on the video's clock.
    expect(file.body.startsWith('1\n00:01:00,000 --> 00:01:06,400\n')).toBe(true);
    expect(file.body).toContain('Arvind,');
    expect(file.body).toContain('\n2\n00:01:07,000 --> ');
    expect(file.body).not.toContain('Arvin, ');
  });

  it('writes plain text, and logs counts only, never a word', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const transcript = listened();
    const { service } = setup({
      tables: seed((t) => t.assets.push(transcriptAsset(transcript))),
      transcript,
    });
    const file = await service.download(TEST_ORG, VIDEO, { format: 'txt' });
    expect(file.contentType).toBe('text/plain; charset=utf-8');
    expect(file.body.split(' ')).toHaveLength(60);
    const lines = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(lines).toContain('clips.transcript.download');
    expect(lines).not.toContain('word1');
    expect(lines).not.toContain('Arvin');
    log.mockRestore();
  });

  it('refuses a video never listened to, and one in another workspace is not found', async () => {
    const bare = setup();
    const answer = await refusal(bare.service.download(TEST_ORG, VIDEO, { format: 'txt' }));
    expect([answer.status, answer.body.code]).toEqual([409, 'transcript_missing']);

    const transcript = listened();
    const { service } = setup({
      tables: seed((t) => t.assets.push(transcriptAsset(transcript))),
      transcript,
    });
    const elsewhere = await refusal(service.download(OTHER_ORG, VIDEO, { format: 'srt' }));
    expect(elsewhere.status).toBe(404);
  });
});

it('keeps jobRow imported for the shared fixtures', () => {
  expect(jobRow().organizationId).toBe(TEST_ORG);
});
