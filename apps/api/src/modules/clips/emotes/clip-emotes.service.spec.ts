/**
 * Emote Maker (Sprint 13, Module 14) against fakes: the real limits guard
 * and job builder (so every input is checked against the engine's schema),
 * a ledger that keeps charges by idempotency key and reverses them by job,
 * an in-memory table of jobs, a scheduler that can finish a job at once, and
 * a storage that signs addresses. No database, no network, no FFmpeg.
 */
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ClipAsset, ClipJob, ClipVideo } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import type { PrivateStorage } from '@postgear/storage';
import { CLIP_ERROR_MESSAGES, emoteTooBigSentence } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { EmoteExportBody } from './clip-emotes.schema';
import { ClipEmotesService } from './clip-emotes.service';
import { EMOTE_LINK_SECONDS } from './emotes.messages';

const OTHER_ORG = 'seed-second-org';
const VIDEO = '22222222-2222-4222-8222-222222222222';

const PLAN: Record<string, unknown> = {
  'clips.enabled': true,
  'clips.queue_priority': 'normal',
  'clips.downloads_per_day': 2,
};

interface Entry {
  meter: string;
  units: number;
  key: string;
  refId: string;
  meta: unknown;
  reversed: boolean;
}

const GIF = {
  name: 'emote-twitch-112.gif',
  size: 112,
  format: 'gif',
  bytes: 77_415,
  maxBytes: 512_000,
  fits: true,
  rung: 1,
  frames: 60,
  fps: 20,
  extra: false,
};

function doneOutput(files: unknown[] = [GIF]) {
  return {
    platform: 'twitch',
    files,
    zip: { name: 'emote-twitch.zip', bytes: 78_000 },
    sharp: false,
  };
}

function body(overrides: Partial<EmoteExportBody> = {}): EmoteExportBody {
  return {
    videoId: VIDEO,
    platform: 'twitch',
    startMs: 12_400,
    endMs: 15_400,
    crop: { x: 620, y: 210, size: 480 },
    key: null,
    flip: false,
    still: false,
    ...overrides,
  };
}

function build(
  options: {
    video?: ClipVideo | null;
    proxyMeta?: unknown;
    /** What the worker does once the job is started. */
    worker?: (row: ClipJob) => void;
    failCreate?: boolean;
    plan?: Record<string, unknown>;
  } = {},
) {
  const table = { ...PLAN, ...options.plan };
  const rows: ClipJob[] = [];
  const ledger: Entry[] = [];
  const video = options.video === undefined ? videoRow({ status: 'READY' }) : options.video;
  const proxy = {
    id: randomUUID(),
    kind: 'PROXY',
    key: `clips/${TEST_ORG}/${VIDEO}/proxy-aaaaaaaaaaaaaaaa.mp4`,
    meta:
      options.proxyMeta === undefined ? { width: 1280, height: 720, fps: 30 } : options.proxyMeta,
    createdAt: new Date('2026-11-28T09:00:00Z'),
  } as unknown as ClipAsset;

  const resolver = {
    assert: jest.fn(async (_org: string, key: string, predicate: (v: unknown) => boolean) => {
      if (predicate(table[key])) return table[key];
      throw new EntitlementRefusedException(
        'clips_not_in_plan',
        refusalMessage('clips_not_in_plan'),
        {},
      );
    }),
    get: jest.fn(async (_org: string, key: string) => table[key]),
    getMany: jest.fn(async (_org: string, keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, table[key]])),
    ),
  } as unknown as EntitlementResolver;

  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        meter: string,
        units: number,
        opts: { idempotencyKey: string; refId: string; meta?: unknown },
      ) => {
        const twin = ledger.find((entry) => entry.key === opts.idempotencyKey);
        if (twin) return { entryId: twin.key, duplicate: true };
        const used = ledger
          .filter((entry) => entry.meter === meter && !entry.reversed)
          .reduce((sum, entry) => sum + entry.units, 0);
        const limit = Number(table[meter]);
        if (used + units > limit) {
          throw new EntitlementRefusedException(
            'clips_downloads_today',
            refusalMessage('clips_downloads_today', { n: limit }),
            { limit },
          );
        }
        ledger.push({
          meter,
          units,
          key: opts.idempotencyKey,
          refId: opts.refId,
          meta: opts.meta,
          reversed: false,
        });
        return { entryId: opts.idempotencyKey, duplicate: false };
      },
    ),
    reverseAllFor: jest.fn(async (_org: string, refId: string) => {
      let count = 0;
      for (const entry of ledger) {
        if (entry.refId === refId && !entry.reversed) {
          entry.reversed = true;
          count += 1;
        }
      }
      return count;
    }),
  };
  const limits = new ClipLimitsGuard(resolver, usage as unknown as UsageService);

  const jobsRepository = {
    create: jest.fn(async (job: NewClipJob) => {
      if (options.failCreate) throw new Error('database unavailable');
      const row = jobRow({ ...(job as unknown as Partial<ClipJob>), createdAt: new Date() });
      rows.push(row);
      return row;
    }),
    find: jest.fn(
      async (org: string, id: string) =>
        rows.find((row) => row.id === id && row.organizationId === org) ?? null,
    ),
    // Module 15's one scheduler: every waiting job here has its turn at once (its rules have their own spec).
    claimNext: jest.fn(async (_slots: unknown, _cap: unknown, now: Date) => {
      const waiting = rows.filter((row) => row.status === 'QUEUED' && row.startedAt === null);
      for (const row of waiting) row.startedAt = now;
      return waiting;
    }),
    releaseClaim: jest.fn(async (org: string, id: string) => {
      const row = rows.find((entry) => entry.id === id && entry.organizationId === org);
      if (row?.status === 'QUEUED') row.startedAt = null;
    }),
  };
  const scheduling = {
    startClipJob: jest.fn(async (id: string) => {
      const row = rows.find((entry) => entry.id === id);
      if (row && options.worker) options.worker(row);
      return true;
    }),
  };
  const storage = {
    signedUrl: jest.fn(async (key: string) => `https://files.test/${key}`),
  };
  const jobs = new ClipJobsService(
    jobsRepository as unknown as ClipJobsRepository,
    scheduling as unknown as SchedulingService,
    resolver,
    usage as unknown as UsageService,
    storage as unknown as PrivateStorage,
  );
  const videos = {
    findLive: jest.fn(async (org: string, id: string) =>
      video && video.organizationId === org && video.id === id ? video : null,
    ),
    assetsOf: jest.fn(async () => [proxy]),
  };

  const service = new ClipEmotesService(
    videos as unknown as ClipVideosRepository,
    jobs,
    jobsRepository as unknown as ClipJobsRepository,
    limits,
    usage as unknown as UsageService,
    storage as unknown as PrivateStorage,
  );
  let clock = Date.parse('2026-11-28T10:00:00Z');
  service.timing = {
    waitMs: 2_000,
    pollMs: 500,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  const active = () => ledger.filter((entry) => !entry.reversed);
  return { service, rows, ledger, active, storage, scheduling, usage };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
  }
  throw new Error('expected a refusal');
}

const finish = (output: unknown) => (row: ClipJob) => {
  Object.assign(row, { status: 'DONE', output, finishedAt: new Date(), progress: 100 });
};

describe('POST /clips/emotes/export', () => {
  it('makes one EMOTE job, charges one download for the person, and answers 200 with the files', async () => {
    const { service, rows, active, storage } = build({ worker: finish(doneOutput()) });
    const outcome = await service.export(TEST_ORG, TEST_USER, body());

    expect(rows).toHaveLength(1);
    const row = rows[0] as ClipJob;
    expect(row.kind).toBe('EMOTE');
    expect(row.videoId).toBe(VIDEO);
    // The crop is kept in the light copy's frame, which the worker scales from.
    expect(row.input).toMatchObject({ frame: { width: 1280, height: 720 }, stillAtMs: null });
    expect(row.expiresAt?.getTime()).toBe(Date.parse('2026-11-29T10:00:00Z'));
    expect(active()).toEqual([
      expect.objectContaining({
        meter: 'clips.downloads_per_day',
        units: 1,
        key: `clips.download:${row.id}`,
        refId: row.id,
        meta: { by: TEST_USER },
      }),
    ]);

    expect(outcome.finished).toBe(true);
    expect(outcome.job.status).toBe('DONE');
    expect(outcome.job.result).toEqual({ platform: 'twitch', files: 1, kept: 1, sharp: false });
    const exportPrefix = `clips/${TEST_ORG}/exports/${row.id}/`;
    expect(outcome.emote?.files[0]?.url).toBe(
      `https://files.test/${exportPrefix}emote-twitch-112.gif`,
    );
    expect(outcome.emote?.zip.url).toBe(`https://files.test/${exportPrefix}emote-twitch.zip`);
    expect(storage.signedUrl).toHaveBeenCalledWith(`${exportPrefix}emote-twitch-112.gif`, {
      expiresInSeconds: EMOTE_LINK_SECONDS,
      downloadName: 'emote-twitch-112.gif',
    });
    // Never a key in the job part of the answer.
    expect(JSON.stringify(outcome.job)).not.toContain('clips/');
  });

  it('answers 202 with the job when it is still being made after the wait', async () => {
    const { service, rows } = build();
    const outcome = await service.export(TEST_ORG, TEST_USER, body());
    expect(outcome.finished).toBe(false);
    expect(outcome.emote).toBeNull();
    expect(outcome.job.id).toBe(rows[0]?.id);
  });

  it('answers a too-big failure with the site and the size, and the download given back by the worker', async () => {
    const message = emoteTooBigSentence('twitch', 112);
    const { service } = build({
      worker: (row) =>
        Object.assign(row, { status: 'FAILED', error: { code: 'emote_too_big', message } }),
    });
    const outcome = await service.export(TEST_ORG, TEST_USER, body());
    expect(outcome.finished).toBe(true);
    expect(outcome.job.error).toEqual({ code: 'emote_too_big', message });
  });

  it.each([
    ['longer than 3 seconds', { endMs: 15_500 }, 'emote_too_long'],
    ['outside the picture', { crop: { x: 1000, y: 0, size: 480 } }, 'emote_range_invalid'],
    ['past the end of the video', { startMs: 599_000, endMs: 601_000 }, 'emote_range_invalid'],
    ['off the tenth of a second', { startMs: 12_450 }, 'emote_range_invalid'],
  ] as const)(
    'refuses a stretch %s with 422 and charges nothing',
    async (_name, overrides, code) => {
      const { service, rows, ledger } = build();
      const answer = await refusal(service.export(TEST_ORG, TEST_USER, body(overrides as never)));
      expect(answer.status).toBe(422);
      expect(answer.body).toMatchObject({ code, message: CLIP_ERROR_MESSAGES[code] });
      expect(rows).toHaveLength(0);
      expect(ledger).toHaveLength(0);
    },
  );

  it("refuses past the day's downloads with the typed 402 and writes nothing", async () => {
    const { service, rows, active } = build({
      plan: { 'clips.downloads_per_day': 1 },
      worker: finish(doneOutput()),
    });
    await service.export(TEST_ORG, TEST_USER, body());
    const answer = await refusal(service.export(TEST_ORG, TEST_USER, body()));
    expect(answer.status).toBe(402);
    expect(answer.body).toMatchObject({ code: 'clips_downloads_today' });
    expect(rows).toHaveLength(1);
    expect(active()).toHaveLength(1);
  });

  it('gives the download back when the row is never written', async () => {
    const { service, ledger, scheduling } = build({ failCreate: true });
    await expect(service.export(TEST_ORG, TEST_USER, body())).rejects.toThrow(
      'database unavailable',
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.reversed).toBe(true);
    expect(scheduling.startClipJob).not.toHaveBeenCalled();
  });

  it("answers 404 for another workspace's video and 409 for one still coming in", async () => {
    const theirs = build({ video: videoRow({ status: 'READY', organizationId: OTHER_ORG }) });
    expect((await refusal(theirs.service.export(TEST_ORG, TEST_USER, body()))).status).toBe(404);
    const importing = build({ video: videoRow({ status: 'IMPORTING' }) });
    expect((await refusal(importing.service.export(TEST_ORG, TEST_USER, body()))).status).toBe(409);
    const noProxy = build({ proxyMeta: null });
    expect((await refusal(noProxy.service.export(TEST_ORG, TEST_USER, body()))).status).toBe(409);
    for (const run of [theirs, importing, noProxy]) expect(run.ledger).toHaveLength(0);
  });
});

describe('GET /clips/emotes/:jobId', () => {
  it("answers 404 for another workspace's job, another kind or a malformed id", async () => {
    const { service, rows } = build({ worker: finish(doneOutput()) });
    await service.export(TEST_ORG, TEST_USER, body());
    const id = (rows[0] as ClipJob).id;
    expect((await refusal(service.get(OTHER_ORG, id))).status).toBe(404);
    expect((await refusal(service.get(TEST_ORG, 'not-a-uuid'))).status).toBe(404);
    rows.push(jobRow({ id: randomUUID(), kind: 'DOWNLOAD', status: 'DONE' }));
    expect((await refusal(service.get(TEST_ORG, (rows[1] as ClipJob).id))).status).toBe(404);
  });

  it('lists an extra that could not fit without an address, and every file without one once expired', async () => {
    const over = { ...GIF, name: 'emote-twitch-56.gif', size: 56, fits: false, extra: true };
    const { service, rows } = build({ worker: finish(doneOutput([GIF, over])) });
    await service.export(TEST_ORG, TEST_USER, body());
    const row = rows[0] as ClipJob;
    const fresh = await service.get(TEST_ORG, row.id);
    expect(fresh.emote?.files.map((file) => file.url !== null)).toEqual([true, false]);
    expect(fresh.emote?.expired).toBe(false);

    row.expiresAt = new Date(Date.parse('2026-11-28T09:00:00Z'));
    const old = await service.get(TEST_ORG, row.id);
    expect(old.emote?.expired).toBe(true);
    expect(old.emote?.files.every((file) => file.url === null)).toBe(true);
    expect(old.emote?.zip.url).toBeNull();
  });

  it('never shows a stored sentence we did not write', async () => {
    const { service, rows } = build({
      worker: (row) =>
        Object.assign(row, {
          status: 'FAILED',
          error: { code: 'emote_too_big', message: 'ffmpeg said /tmp/scratch is full' },
        }),
    });
    await service.export(TEST_ORG, TEST_USER, body());
    const view = await service.get(TEST_ORG, (rows[0] as ClipJob).id);
    expect(view.job.error).toEqual({
      code: 'emote_too_big',
      message: CLIP_ERROR_MESSAGES.emote_too_big,
    });
  });
});
