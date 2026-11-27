/**
 * Text To Speech (Sprint 13, Module 09) against an in-memory database and a
 * fake ledger: off answers 503 `voice_off`, a line in a script the voice does
 * not read 422 `voice_language`, a new line one SPEECH job charged once under
 * the documented key, the same line and voice again no second job and no
 * second charge, a line made again after a failure a fresh charge, a short
 * ledger a 402 with the row taken back, tenancy, and no line in any log.
 */
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { ClipAsset, ClipJob } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipItemService } from '../clip/clip-item.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { MediaServiceProbe } from '../status/media-service.probe';
import type { MediaVoices, SpeakerVoices } from '../status/media-voices.client';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG, TEST_USER } from '../testing/rows';
import { ClipVoiceRepository } from './clip-voice.repository';
import { ClipVoiceService, voiceChargeKey, voiceInputHash, voicePrice } from './clip-voice.service';

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

const CLIP = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG = 'seed-second-org';
const LINE = 'Wait for it. This is the best part.';
const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');

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

/** The media service's list under simulation: the shared fixture Python answers. */
const SIMULATED = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      '../../../../../../packages/media-contract/fixtures/voices/simulated.json',
    ),
    'utf8',
  ),
) as { speaker: { name: string }; voices: SpeakerVoices['voices'] };

let idCount = 0;
function setup(
  options: { tts?: boolean; service?: 'ok' | 'off'; limit?: number; voices?: SpeakerVoices } = {},
) {
  const tables: FakeTables = emptyTables();
  tables.clips.push(clipRow({ id: CLIP }));
  mockDb = fakeClipDb(tables);
  // The voice repository takes back a row whose charge was refused.
  (mockDb as unknown as { clipJob: Record<string, unknown> }).clipJob.deleteMany = jest.fn(
    async ({ where }: { where: { id: string; status: string } }) => {
      const before = tables.jobs.length;
      tables.jobs = tables.jobs.filter(
        (row) => !(row.id === where.id && row.status === where.status),
      );
      return { count: before - tables.jobs.length };
    },
  );
  const ledger = fakeLedger(options.limit ?? 10);
  const scheduling = { startClipJob: jest.fn(async () => true) };
  const jobsRepository = new ClipJobsRepository();
  const jobs = new ClipJobsService(
    jobsRepository,
    scheduling as unknown as SchedulingService,
    { get: jest.fn(async () => 'normal') } as unknown as EntitlementResolver,
    ledger.usage as unknown as UsageService,
    { deletePrefix: jest.fn() } as never,
  );
  jest.spyOn(jobs, 'newJobId').mockImplementation(() => {
    idCount += 1;
    return `88888888-8888-4888-8888-${String(idCount).padStart(12, '0')}`;
  });
  const items = {
    requireClip: jest.fn(async (orgId: string, clipId: string) => {
      const found = tables.clips.find((row) => row.id === clipId && row.organizationId === orgId);
      if (!found) throw new NotFoundException({ code: 'clip_not_found' });
      return found;
    }),
  };
  const limits = {
    assertEnabled: jest.fn(async () => undefined),
    assertStorage: jest.fn(async () => undefined),
  };
  const config = { get: jest.fn(() => ((options.tts ?? true) ? 'true' : 'false')) };
  const service = new ClipVoiceService(
    items as unknown as ClipItemService,
    jobs,
    jobsRepository,
    new ClipVoiceRepository(),
    limits as unknown as ClipLimitsGuard,
    ledger.usage as unknown as UsageService,
    { state: jest.fn(async () => options.service ?? 'ok') } as unknown as MediaServiceProbe,
    {
      list: jest.fn(
        async () => options.voices ?? { speaker: SIMULATED.speaker.name, voices: SIMULATED.voices },
      ),
    } as unknown as MediaVoices,
    config as never,
  );
  return { service, tables, scheduling, limits, ...ledger };
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

const body = (overrides: Partial<{ text: string; voiceId: string; revision: number }> = {}) => ({
  text: LINE,
  voiceId: 'sim-river',
  revision: 4,
  ...overrides,
});

function finish(tables: FakeTables, job: ClipJob) {
  Object.assign(job, { status: 'DONE', output: { assetId: job.id, durationMs: 2_100 } });
  tables.assets.push(
    assetRow({
      id: job.id,
      videoId: null,
      clipId: null,
      kind: 'AUDIO',
      key: `clips/${TEST_ORG}/library/${job.id.replace(/-/g, '')}.m4a`,
      meta: { status: 'ready', purpose: 'sound', madeByAi: true, voice: 'sim-river' },
    } as Partial<ClipAsset>),
  );
}

describe('ClipVoiceService.voices', () => {
  it('lists the voices, enabled only when CLIPS_TTS is on and the media service is up', async () => {
    expect(await setup().service.voices()).toEqual({
      enabled: true,
      voices: [
        { id: 'sim-river', name: 'River', languages: ['en'], sampleUrl: null },
        { id: 'sim-meadow', name: 'Meadow', languages: ['en', 'hi'], sampleUrl: null },
        { id: 'sim-stone', name: 'Stone', languages: ['en'], sampleUrl: null },
      ],
    });
    expect(await setup({ tts: false }).service.voices()).toEqual({ enabled: false, voices: [] });
    expect((await setup({ service: 'off' }).service.voices()).enabled).toBe(false);
  });

  it("offers the media service's own voices, and none while its speaker cannot speak", async () => {
    const kokoro = {
      speaker: 'kokoro',
      voices: [{ id: 'kokoro-heart', name: 'Heart', languages: ['en'] }],
    };
    expect(await setup({ voices: kokoro }).service.voices()).toEqual({
      enabled: true,
      voices: [
        {
          id: 'kokoro-heart',
          name: 'Heart',
          languages: ['en'],
          sampleUrl: '/clips/voice-samples/kokoro-heart.m4a',
        },
      ],
    });
    expect(await setup({ voices: { speaker: 'kokoro', voices: [] } }).service.voices()).toEqual({
      enabled: false,
      voices: [],
    });
  });
});

describe('ClipVoiceService.make', () => {
  it('starts one SPEECH job, charged once under the documented key', async () => {
    const { service, tables, scheduling, usage } = setup();
    const outcome = await service.make(TEST_ORG, TEST_USER, CLIP, body());

    expect(outcome).toMatchObject({ price: 1, reused: false, meter: { used: 1, remaining: 9 } });
    expect(outcome.job).toMatchObject({ kind: 'SPEECH', status: 'QUEUED' });
    expect(tables.jobs).toHaveLength(1);
    expect(tables.jobs[0]).toMatchObject({
      kind: 'SPEECH',
      clipId: CLIP,
      videoId: null,
      input: { text: LINE, voiceId: 'sim-river', aiMinutes: 1 },
    });
    expect(scheduling.startClipJob).toHaveBeenCalledTimes(1);
    const key = voiceChargeKey(CLIP, 4, voiceInputHash('sim-river', LINE));
    expect(key).toMatch(/^clips\.ai:voice:5{8}-5{4}-4555-8555-5{12}:4:[0-9a-f]{16}$/);
    expect(usage.consume).toHaveBeenCalledWith(TEST_ORG, 'clips.ai_minutes_per_month', 1, {
      idempotencyKey: key,
      refId: tables.jobs[0]?.id,
      meta: { step: 'voice', clipId: CLIP },
    });
  });

  it('prices one AI minute per 1,000 characters, one at least', () => {
    expect(voicePrice('x')).toBe(1);
    expect(voicePrice('x'.repeat(500))).toBe(1);
  });

  it('the same line and voice again is no second job and no second charge', async () => {
    const { service, tables, usage, used } = setup();
    const first = await service.make(TEST_ORG, TEST_USER, CLIP, body());
    // Still running: answered as it is.
    const again = await service.make(TEST_ORG, TEST_USER, CLIP, body());
    expect(again).toMatchObject({ reused: true, price: 0, meter: null });
    expect(again.job.id).toBe(first.job.id);
    // Finished with its sound still there, even typed at a later revision: still the same.
    const job = tables.jobs[0];
    if (job) finish(tables, job);
    const later = await service.make(TEST_ORG, TEST_USER, CLIP, body({ revision: 9 }));
    expect(later).toMatchObject({ reused: true, price: 0 });
    expect(tables.jobs).toHaveLength(1);
    expect(usage.consume).toHaveBeenCalledTimes(1);
    expect(used()).toBe(1);
  });

  it('another voice or another line is a new job and a new charge', async () => {
    const { service, tables, used } = setup();
    await service.make(TEST_ORG, TEST_USER, CLIP, body());
    await service.make(TEST_ORG, TEST_USER, CLIP, body({ voiceId: 'sim-stone' }));
    await service.make(TEST_ORG, TEST_USER, CLIP, body({ text: 'Another line.' }));
    expect(tables.jobs).toHaveLength(3);
    expect(used()).toBe(3);
  });

  it('a line made again after a failure (its charge given back) is charged afresh', async () => {
    const { service, tables, usage, used, entries } = setup();
    const first = await service.make(TEST_ORG, TEST_USER, CLIP, body());
    // The worker failed it and gave the minutes back.
    const job = tables.jobs[0];
    if (job) job.status = 'FAILED';
    await usage.reverseAllFor(TEST_ORG, first.job.id);
    expect(used()).toBe(0);

    const retry = await service.make(TEST_ORG, TEST_USER, CLIP, body());
    expect(retry).toMatchObject({ reused: false, price: 1 });
    expect(retry.job.id).not.toBe(first.job.id);
    expect(used()).toBe(1);
    const key = voiceChargeKey(CLIP, 4, voiceInputHash('sim-river', LINE));
    expect(entries.map((entry) => entry.key)).toContain(`${key}:1`);
  });

  it('a made sound that was deleted is made again', async () => {
    const { service, tables, used } = setup();
    await service.make(TEST_ORG, TEST_USER, CLIP, body());
    const job = tables.jobs[0];
    if (job) finish(tables, job);
    tables.assets = [];
    const again = await service.make(TEST_ORG, TEST_USER, CLIP, body());
    expect(again.reused).toBe(false);
    expect(used()).toBe(2);
  });

  it('off answers 503 voice_off, before any row or charge', async () => {
    for (const options of [
      { tts: false },
      { service: 'off' as const },
      { voices: { speaker: 'kokoro', voices: [] } },
    ]) {
      const { service, tables, usage } = setup(options);
      const answer = await refusal(service.make(TEST_ORG, TEST_USER, CLIP, body()));
      expect(answer).toMatchObject({ status: 503, body: { code: 'voice_off' } });
      expect(tables.jobs).toHaveLength(0);
      expect(usage.consume).not.toHaveBeenCalled();
    }
  });

  it('a line in a script the voice does not read answers 422 voice_language', async () => {
    const { service, tables } = setup();
    const answer = await refusal(
      service.make(TEST_ORG, TEST_USER, CLIP, body({ text: 'இது சிறந்த பகுதி' })),
    );
    expect(answer).toMatchObject({
      status: 422,
      body: {
        code: 'voice_language',
        message: 'This voice cannot read this language. Pick another voice.',
      },
    });
    expect(tables.jobs).toHaveLength(0);
    // Meadow reads Hindi.
    const hindi = await service.make(
      TEST_ORG,
      TEST_USER,
      CLIP,
      body({ voiceId: 'sim-meadow', text: 'यह सबसे अच्छा हिस्सा है' }),
    );
    expect(hindi.reused).toBe(false);
  });

  it('a voice the media service no longer offers answers 422 voice_unknown', async () => {
    const { service, tables, usage } = setup();
    const answer = await refusal(
      service.make(TEST_ORG, TEST_USER, CLIP, body({ voiceId: 'kokoro-heart' })),
    );
    expect(answer).toMatchObject({
      status: 422,
      body: {
        code: 'voice_unknown',
        message: 'This voice is no longer available. Pick another voice.',
      },
    });
    expect(tables.jobs).toHaveLength(0);
    expect(usage.consume).not.toHaveBeenCalled();
  });

  it('a short ledger answers 402 and takes the row back, nothing left charged', async () => {
    const { service, tables, scheduling, used } = setup({ limit: 0 });
    const answer = await refusal(service.make(TEST_ORG, TEST_USER, CLIP, body()));
    expect(answer).toMatchObject({ status: 402, body: { code: 'clips_ai_minutes_used' } });
    expect(tables.jobs).toHaveLength(0);
    expect(scheduling.startClipJob).not.toHaveBeenCalled();
    expect(used()).toBe(0);
  });

  it("another workspace's clip is a plain 404", async () => {
    const { service, tables } = setup();
    await expect(service.make(OTHER_ORG, TEST_USER, CLIP, body())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tables.jobs).toHaveLength(0);
  });

  it('never logs the line', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup();
    await service.make(TEST_ORG, TEST_USER, CLIP, body());
    const written = JSON.stringify(log.mock.calls);
    expect(written).toContain('clips.voice.started');
    expect(written).not.toContain('Wait for it');
    log.mockRestore();
  });
});
