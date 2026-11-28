/**
 * Download in any format (Module 18) against fakes: the real limits guard
 * over a fake resolver that throws the real typed refusal, a ledger that
 * keeps charges by idempotency key and reverses them by job, the real job
 * builder (so every input is checked against the engine's schema), an
 * in-memory table of DOWNLOAD rows and a probe that answers from the link.
 * No database, no network, no platform.
 */
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import type { PrivateStorage } from '@postgear/storage';
import type { LinkFormat, LinkInfo } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipLinkProber } from '../links/clip-links.types';
import { jobRow, TEST_ORG, TEST_USER } from '../testing/rows';
import type { ClipDownloadsRepository } from './clip-downloads.repository';
import { ClipDownloadsService, DOWNLOAD_LINK_SECONDS } from './clip-downloads.service';
import { SAVE_TO_MEDIA_STALE_MS } from './clip-downloads.view';

jest.mock('../clips.tx', () => {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    serializable: (work: (client: unknown) => Promise<unknown>) => {
      const run = chain.then(() => work({}));
      chain = run.catch(() => undefined);
      return run;
    },
  };
});

const OTHER_ORG = 'seed-second-org';
const MB = 1024 * 1024;

const FORMATS: LinkFormat[] = [
  {
    id: 'h1440',
    label: '1440p',
    height: 1440,
    fps: 30,
    ext: 'mp4',
    bytes: 900 * MB,
    audioOnly: false,
  },
  {
    id: 'h1080',
    label: '1080p',
    height: 1080,
    fps: 30,
    ext: 'mp4',
    bytes: 412 * MB,
    audioOnly: false,
  },
  { id: 'h720', label: '720p', height: 720, fps: 30, ext: 'mp4', bytes: null, audioOnly: false },
  { id: 'h360', label: '360p', height: 360, fps: 30, ext: 'mp4', bytes: 20 * MB, audioOnly: false },
  {
    id: 'audio',
    label: 'Audio',
    height: null,
    fps: null,
    ext: 'm4a',
    bytes: 9 * MB,
    audioOnly: true,
  },
];

/** The link's id is its last path part, so two links are two videos. */
function infoFor(url: string, durationMs: number): LinkInfo {
  const externalId = url.split(/[=/]/).pop() || 'simtalk0001';
  return {
    platform: 'youtube',
    kind: 'video',
    externalId,
    canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`,
    title: 'Talk:\u0007 "Plans"   for 2027',
    channelName: 'Acme',
    durationMs,
    live: false,
    thumbnailUrl: null,
    formats: FORMATS,
  };
}

const CODES: Record<string, string> = {
  'clips.enabled': 'clips_not_in_plan',
  'clips.max_video_minutes': 'clips_video_too_long',
  'clips.storage_gb': 'clips_storage_full',
};

const PLAN: Record<string, unknown> = {
  'clips.enabled': true,
  'clips.max_video_minutes': 60,
  'clips.storage_gb': 5,
  'clips.retention_days': 14,
  'clips.queue_priority': 'normal',
  'clips.downloads_per_day': 5,
  'clips.import_minutes_per_month': 600,
};

interface Entry {
  id: string;
  meter: string;
  units: number;
  key: string;
  refId: string;
  reversed: boolean;
}

function build(options: { plan?: Record<string, unknown>; durationMs?: number } = {}) {
  const table = { ...PLAN, ...options.plan };
  const rows: ClipJob[] = [];
  const ledger: Entry[] = [];

  const resolver = {
    assert: jest.fn(
      async (_org: string, key: string, predicate: (v: unknown) => boolean, details = {}) => {
        const limit = table[key];
        if (predicate(limit)) return limit;
        const n = typeof limit === 'number' ? limit : undefined;
        const code = CODES[key] as string;
        throw new EntitlementRefusedException(code, refusalMessage(code, { n }), {
          limit: n,
          ...(details as object),
        });
      },
    ),
    get: jest.fn(async (_org: string, key: string) => table[key]),
    getMany: jest.fn(async (_org: string, keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, table[key]])),
    ),
  } as unknown as EntitlementResolver;

  const METER_CODES: Record<string, string> = {
    'clips.downloads_per_day': 'clips_downloads_today',
    'clips.import_minutes_per_month': 'clips_minutes_used',
  };
  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        meter: string,
        units: number,
        opts: { idempotencyKey: string; refId: string },
      ) => {
        const twin = ledger.find((entry) => entry.key === opts.idempotencyKey);
        if (twin) return { entryId: twin.id, duplicate: true };
        const used = ledger
          .filter((entry) => entry.meter === meter && !entry.reversed)
          .reduce((sum, entry) => sum + entry.units, 0);
        const limit = Number(table[meter]);
        if (used + units > limit) {
          const code = METER_CODES[meter] as string;
          throw new EntitlementRefusedException(code, refusalMessage(code, { n: limit }), {
            limit,
          });
        }
        const entry = {
          id: randomUUID(),
          meter,
          units,
          key: opts.idempotencyKey,
          refId: opts.refId,
          reversed: false,
        };
        ledger.push(entry);
        return { entryId: entry.id, duplicate: false };
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
  jest.spyOn(limits, 'storageUsedBytes').mockResolvedValue(0);

  const jobsRepository = {
    create: jest.fn(async (job: NewClipJob) => {
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
    cancelOpen: jest.fn(async () => true),
  };
  const scheduling = {
    startClipJob: jest.fn(async () => true),
    cancelClipJob: jest.fn(async () => 'signalled' as const),
    startClipSaveDownload: jest.fn(async () => true),
  };
  const storage = {
    signedUrl: jest.fn(async (key: string) => `https://files.test/${key}`),
    deletePrefix: jest.fn(async () => 1),
  };
  const jobs = new ClipJobsService(
    jobsRepository as unknown as ClipJobsRepository,
    scheduling as unknown as SchedulingService,
    resolver,
    usage as unknown as UsageService,
    storage as unknown as PrivateStorage,
  );

  const visible = (row: ClipJob) => row.stage !== 'removed';
  const repository = {
    list: jest.fn(async (org: string) =>
      rows
        .filter((row) => row.organizationId === org && row.status !== 'CANCELLED' && visible(row))
        .reverse(),
    ),
    find: jest.fn(
      async (org: string, id: string) =>
        rows.find((row) => row.id === id && row.organizationId === org && visible(row)) ?? null,
    ),
    countOpen: jest.fn(
      async (org: string) =>
        rows.filter(
          (row) =>
            row.organizationId === org && (row.status === 'QUEUED' || row.status === 'RUNNING'),
        ).length,
    ),
    startSaving: jest.fn(async (org: string, id: string) => {
      const row = rows.find((entry) => entry.id === id && entry.organizationId === org);
      if (!row) return { outcome: 'not_ready' };
      const output = row.output as Record<string, unknown>;
      if (output.media) return { outcome: 'already', job: row };
      row.output = {
        ...output,
        media: { status: 'saving', mediaId: null, startedAt: new Date().toISOString() },
      };
      return { outcome: 'started', job: row };
    }),
    saveNotStarted: jest.fn(async () => undefined),
    removeFileRow: jest.fn(async () => undefined),
    markRemoved: jest.fn(async (org: string, id: string) => {
      const row = rows.find((entry) => entry.id === id && entry.organizationId === org);
      if (row) row.stage = 'removed';
      return Boolean(row);
    }),
    uploadOriginal: jest.fn(),
  };

  const durationMs = options.durationMs ?? 10 * 60_000;
  const prober = {
    probe: jest.fn(async (_org: string, url: string) => {
      const info = infoFor(url, durationMs);
      return { link: info, info, existingVideoId: null };
    }),
  };

  const service = new ClipDownloadsService(
    repository as unknown as ClipDownloadsRepository,
    jobs,
    jobsRepository as unknown as ClipJobsRepository,
    limits,
    usage as unknown as UsageService,
    scheduling as unknown as SchedulingService,
    prober as unknown as ClipLinkProber,
    storage as unknown as PrivateStorage,
  );
  const active = (meter: string) =>
    ledger.filter((entry) => entry.meter === meter && !entry.reversed);
  return { service, rows, ledger, active, repository, scheduling, storage, prober, usage };
}

const LINK = 'https://www.youtube.com/watch?v=simtalk0001';

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

/** A finished download row, as the worker leaves it. */
function doneRow(overrides: Partial<ClipJob> = {}, output: Record<string, unknown> = {}): ClipJob {
  const id = randomUUID();
  return jobRow({
    id,
    kind: 'DOWNLOAD',
    status: 'DONE',
    videoId: null,
    createdAt: new Date(),
    finishedAt: new Date(),
    expiresAt: new Date(Date.now() + 23 * 60 * 60_000),
    input: {
      link: {
        platform: 'youtube',
        kind: 'video',
        externalId: 'done0001',
        canonicalUrl: 'https://www.youtube.com/watch?v=done0001',
      },
      formatId: 'h720',
      label: '720p',
      audioOnly: false,
      title: 'Talk',
      durationMs: 600_000,
      expectedBytes: null,
      maxBytes: 5e9,
      rights: { byUserId: TEST_USER, at: '2026-11-19T10:00:00.000Z', textVersion: '1' },
    },
    output: {
      assetId: randomUUID(),
      key: `clips/${TEST_ORG}/downloads/${id}/file.mp4`,
      bytes: 80 * MB,
      ext: 'mp4',
      fileName: 'Talk.mp4',
      durationMs: 600_000,
      width: 1280,
      height: 720,
      fps: 30,
      ...output,
    },
    ...overrides,
  });
}

describe('ClipDownloadsService.start', () => {
  it('refuses without the rights tick and charges nothing', async () => {
    const { service, ledger } = build();
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h720' }),
    );
    expect(status).toBe(422);
    expect(body.code).toBe('rights_required');
    expect(ledger).toHaveLength(0);
  });

  it('answers format_gone for a quality the fresh probe does not offer, or one above 1080p', async () => {
    const { service, ledger } = build();
    for (const formatId of ['h2160', 'h1440']) {
      const { status, body } = await refusal(
        service.start(TEST_ORG, TEST_USER, { url: LINK, formatId, rightsConfirmed: true }),
      );
      expect(status).toBe(422);
      expect(body).toMatchObject({
        code: 'format_gone',
        message: 'This quality is no longer offered for this video. Pick another.',
      });
    }
    expect(ledger).toHaveLength(0);
  });

  it('refuses a video longer than the plan allows with the typed 402', async () => {
    const { service, ledger } = build({ durationMs: 90 * 60_000 });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h720', rightsConfirmed: true }),
    );
    expect(status).toBe(402);
    expect(body.code).toBe('clips_video_too_long');
    expect(ledger).toHaveLength(0);
  });

  it('refuses when the prepared file would not fit in the space left', async () => {
    const { service, ledger } = build({ plan: { 'clips.storage_gb': 0.1 } });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h1080', rightsConfirmed: true }),
    );
    expect(status).toBe(402);
    expect(body.code).toBe('clips_storage_full');
    expect(ledger).toHaveLength(0);
  });

  it('passes on a platform refusal from the probe (paused, resting) and charges nothing', async () => {
    const { service, prober, ledger } = build();
    prober.probe.mockRejectedValueOnce(
      new ClipErrorException(503, 'platform_paused', { platform: 'youtube' }),
    );
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h720', rightsConfirmed: true }),
    );
    expect(status).toBe(503);
    expect(body.code).toBe('platform_paused');
    expect(ledger).toHaveLength(0);
  });

  it('makes one DOWNLOAD job, charges one download and the length in import minutes, and starts it', async () => {
    const { service, rows, active, scheduling } = build();
    const outcome = await service.start(TEST_ORG, TEST_USER, {
      url: LINK,
      formatId: 'h720',
      rightsConfirmed: true,
    });

    expect(outcome.existing).toBe(false);
    expect(rows).toHaveLength(1);
    const row = rows[0] as ClipJob;
    expect(row.kind).toBe('DOWNLOAD');
    expect(row.videoId).toBeNull();
    expect(row.input).toMatchObject({
      formatId: 'h720',
      label: '720p',
      audioOnly: false,
      title: 'Talk: "Plans" for 2027',
      durationMs: 600_000,
      expectedBytes: null,
      rights: { byUserId: TEST_USER, textVersion: '1' },
    });
    expect((row.input as { maxBytes: number }).maxBytes).toBe(5_000_000_000);

    expect(active('clips.downloads_per_day')).toEqual([
      expect.objectContaining({ units: 1, key: `clips.download:${row.id}`, refId: row.id }),
    ]);
    expect(active('clips.import_minutes_per_month')).toEqual([
      expect.objectContaining({ units: 10, key: `clips.import:${row.id}`, refId: row.id }),
    ]);
    expect(scheduling.startClipJob).toHaveBeenCalledWith(row.id, TEST_ORG, 'DOWNLOAD');
    expect(outcome.download).toMatchObject({ id: row.id, state: 'preparing', label: '720p' });
  });

  it('names Audio Only as such and delivers it as MP3', async () => {
    const { service, rows } = build();
    const outcome = await service.start(TEST_ORG, TEST_USER, {
      url: LINK,
      formatId: 'audio',
      rightsConfirmed: true,
    });
    expect(rows[0]?.input).toMatchObject({ label: 'Audio Only', audioOnly: true });
    expect(outcome.download).toMatchObject({ label: 'Audio Only', audioOnly: true, ext: 'mp3' });
  });

  it('answers the same file asked for twice with the first download, charged once', async () => {
    const { service, rows, active } = build();
    const body = { url: LINK, formatId: 'h720', rightsConfirmed: true };
    const first = await service.start(TEST_ORG, TEST_USER, body);
    const second = await service.start(TEST_ORG, TEST_USER, body);

    expect(second.existing).toBe(true);
    expect(second.download.id).toBe(first.download.id);
    expect(rows).toHaveLength(1);
    expect(active('clips.downloads_per_day')).toHaveLength(1);
    expect(active('clips.import_minutes_per_month')).toHaveLength(1);
  });

  it('answers two clicks at once with one download and gives the loser its charges back', async () => {
    const { service, rows, active } = build();
    const body = { url: LINK, formatId: 'h720', rightsConfirmed: true };
    const [a, b] = await Promise.all([
      service.start(TEST_ORG, TEST_USER, body),
      service.start(TEST_ORG, TEST_USER, body),
    ]);
    expect(rows).toHaveLength(1);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(a.download.id).toBe(b.download.id);
    expect(active('clips.downloads_per_day')).toHaveLength(1);
    expect(active('clips.import_minutes_per_month')).toHaveLength(1);
  });

  it('counts a day of downloads and refuses past the plan number with its sentence', async () => {
    const { service, rows, active } = build({ plan: { 'clips.downloads_per_day': 2 } });
    for (const id of ['a0001', 'a0002']) {
      await service.start(TEST_ORG, TEST_USER, {
        url: `https://www.youtube.com/watch?v=${id}`,
        formatId: 'h720',
        rightsConfirmed: true,
      });
    }
    for (const row of rows) row.status = 'DONE';

    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, {
        url: 'https://www.youtube.com/watch?v=a0003',
        formatId: 'h720',
        rightsConfirmed: true,
      }),
    );
    expect(status).toBe(402);
    expect(body).toMatchObject({
      code: 'clips_downloads_today',
      message: "You have reached today's limit of 2 downloads. It resets at midnight UTC.",
    });
    expect(rows).toHaveLength(2);
    expect(active('clips.downloads_per_day')).toHaveLength(2);
    expect(active('clips.import_minutes_per_month')).toHaveLength(2);
  });

  it('gives the download back when the import minutes are used up', async () => {
    const { service, rows, active } = build({ plan: { 'clips.import_minutes_per_month': 5 } });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h720', rightsConfirmed: true }),
    );
    expect(status).toBe(402);
    expect(body.code).toBe('clips_minutes_used');
    expect(rows).toHaveLength(0);
    expect(active('clips.downloads_per_day')).toHaveLength(0);
  });

  it('refuses a fourth download while three are being prepared', async () => {
    const { service, rows, active } = build();
    for (const id of ['b0001', 'b0002', 'b0003']) {
      await service.start(TEST_ORG, TEST_USER, {
        url: `https://www.youtube.com/watch?v=${id}`,
        formatId: 'h360',
        rightsConfirmed: true,
      });
    }
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, {
        url: 'https://www.youtube.com/watch?v=b0004',
        formatId: 'h360',
        rightsConfirmed: true,
      }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'downloads_busy',
      message: 'Three downloads are already being prepared. Wait for one to finish.',
    });
    expect(rows).toHaveLength(3);
    expect(active('clips.downloads_per_day')).toHaveLength(3);
  });

  it('reverses both charges when the busy cap is reached inside the transaction', async () => {
    const { service, repository, rows, ledger, active } = build();
    repository.countOpen.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const { status } = await refusal(
      service.start(TEST_ORG, TEST_USER, { url: LINK, formatId: 'h720', rightsConfirmed: true }),
    );
    expect(status).toBe(409);
    expect(rows).toHaveLength(0);
    expect(ledger).toHaveLength(2);
    expect(active('clips.downloads_per_day')).toHaveLength(0);
    expect(active('clips.import_minutes_per_month')).toHaveLength(0);
  });
});

describe('ClipDownloadsService file, save, delete and original', () => {
  it('lists only this workspace, newest first, with the state and the expiry', async () => {
    const { service, rows } = build();
    rows.push(doneRow(), doneRow({ organizationId: OTHER_ORG }));
    const { downloads } = await service.list(TEST_ORG);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({
      state: 'ready',
      bytes: 80 * MB,
      ext: 'mp4',
      canSaveToMedia: true,
      media: null,
    });
    expect(downloads[0]?.expiresAt).toEqual(expect.any(String));
  });

  it('redirects a ready file to a five minute signed address named after the video', async () => {
    const { service, rows, storage } = build();
    const row = doneRow({}, { fileName: 'Talk Plans for 2027.mp4' });
    rows.push(row);
    const url = await service.fileUrl(TEST_ORG, row.id);
    const key = (row.output as { key: string }).key;
    expect(url).toBe(`https://files.test/${key}`);
    expect(storage.signedUrl).toHaveBeenCalledWith(key, {
      expiresInSeconds: DOWNLOAD_LINK_SECONDS,
      downloadName: 'Talk Plans for 2027.mp4',
    });
    expect(DOWNLOAD_LINK_SECONDS).toBe(300);
  });

  it('answers 409 while the file is being prepared', async () => {
    const { service, rows } = build();
    const row = doneRow({ status: 'RUNNING', output: null, expiresAt: null });
    rows.push(row);
    const { status, body } = await refusal(service.fileUrl(TEST_ORG, row.id));
    expect(status).toBe(409);
    expect(body.code).toBe('download_not_ready');
  });

  it('answers 404 for another workspace, a failed one, a deleted one and a bad id', async () => {
    const { service, rows } = build();
    const theirs = doneRow({ organizationId: OTHER_ORG });
    const failed = doneRow({ status: 'FAILED', output: null });
    const removed = doneRow({ stage: 'removed' });
    rows.push(theirs, failed, removed);
    for (const id of [theirs.id, failed.id, removed.id, 'not-a-uuid']) {
      const { status, body } = await refusal(service.fileUrl(TEST_ORG, id));
      expect(status).toBe(404);
      expect(body.code).toBe('download_not_found');
    }
  });

  it('answers 410 for an expired file and removes the file there and then', async () => {
    const { service, rows, storage, repository } = build();
    const row = doneRow({ expiresAt: new Date(Date.now() - 60_000) });
    rows.push(row);
    const { status, body } = await refusal(service.fileUrl(TEST_ORG, row.id));
    expect(status).toBe(410);
    expect(body).toMatchObject({
      code: 'download_expired',
      message: 'This download has expired. Prepare it again.',
    });
    expect(storage.deletePrefix).toHaveBeenCalledWith(`clips/${TEST_ORG}/downloads/${row.id}/`);
    expect(repository.removeFileRow).toHaveBeenCalledWith(
      TEST_ORG,
      (row.output as { key: string }).key,
    );
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });

  it('starts Save To Media on a ready MP4 and answers the row as saving', async () => {
    const { service, rows, scheduling } = build();
    const row = doneRow();
    rows.push(row);
    const { download } = await service.saveToMedia(TEST_ORG, row.id);
    expect(scheduling.startClipSaveDownload).toHaveBeenCalledWith(row.id, TEST_ORG);
    expect(download).toMatchObject({
      canSaveToMedia: false,
      media: { status: 'saving', mediaId: null },
    });

    // A second click while it saves starts nothing new.
    await service.saveToMedia(TEST_ORG, row.id);
    expect(scheduling.startClipSaveDownload).toHaveBeenCalledTimes(1);
  });

  it('reads a save stuck past its time limit as failed, so the button comes back', async () => {
    const { service, rows } = build();
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    const stuck = doneRow(
      {},
      { media: { status: 'saving', mediaId: null, startedAt: at(SAVE_TO_MEDIA_STALE_MS + 1_000) } },
    );
    const running = doneRow(
      {},
      { media: { status: 'saving', mediaId: null, startedAt: at(60_000) } },
    );
    rows.push(stuck, running);
    const { downloads } = await service.list(TEST_ORG);
    const view = (id: string) => downloads.find((download) => download.id === id);
    expect(view(stuck.id)).toMatchObject({
      canSaveToMedia: true,
      media: { status: 'failed', mediaId: null },
    });
    expect(view(running.id)).toMatchObject({
      canSaveToMedia: false,
      media: { status: 'saving', mediaId: null },
    });
  });

  it('refuses Save To Media for Audio Only and for a file over the Media limit', async () => {
    const { service, rows, scheduling } = build();
    const audio = doneRow({}, { ext: 'mp3', key: 'clips/x/file.mp3', width: null, height: null });
    const big = doneRow({}, { bytes: 412 * MB });
    rows.push(audio, big);

    const a = await refusal(service.saveToMedia(TEST_ORG, audio.id));
    expect(a.status).toBe(422);
    expect(a.body.code).toBe('download_audio_only');

    const b = await refusal(service.saveToMedia(TEST_ORG, big.id));
    expect(b.status).toBe(422);
    expect(b.body).toMatchObject({
      code: 'media_too_big',
      message: 'This file is 412 MB. Media takes videos up to 250 MB.',
    });
    expect(scheduling.startClipSaveDownload).not.toHaveBeenCalled();
  });

  it('gives the Save To Media button back when the worker cannot be reached', async () => {
    const { service, rows, scheduling, repository } = build();
    scheduling.startClipSaveDownload.mockResolvedValueOnce(false);
    const row = doneRow();
    rows.push(row);
    const { status, body } = await refusal(service.saveToMedia(TEST_ORG, row.id));
    expect(status).toBe(503);
    expect(body.code).toBe('tools_offline');
    expect(repository.saveNotStarted).toHaveBeenCalledWith(TEST_ORG, row.id);
  });

  it('deletes a finished download: the file goes, the row stays as the rights record, nothing is given back', async () => {
    const { service, rows, storage, usage, repository } = build();
    const row = doneRow();
    rows.push(row);
    await expect(service.remove(TEST_ORG, row.id)).resolves.toEqual({
      message: 'Download deleted.',
    });
    expect(storage.deletePrefix).toHaveBeenCalledWith(`clips/${TEST_ORG}/downloads/${row.id}/`);
    expect(repository.markRemoved).toHaveBeenCalledWith(TEST_ORG, row.id, expect.any(Date));
    expect(usage.reverseAllFor).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect((await service.list(TEST_ORG)).downloads).toHaveLength(0);
  });

  it('cancels a download still being prepared through its workflow', async () => {
    const { service, rows, scheduling, storage } = build();
    const row = doneRow({ status: 'RUNNING', output: null, expiresAt: null });
    rows.push(row);
    await service.remove(TEST_ORG, row.id);
    expect(scheduling.cancelClipJob).toHaveBeenCalledWith(row.id);
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it('offers Download Original only for an uploaded video, named after it with its own extension', async () => {
    const { service, repository, storage } = build();
    const videoId = randomUUID();
    repository.uploadOriginal.mockResolvedValueOnce({ outcome: 'not_an_upload' });
    const linked = await refusal(service.downloadOriginal(TEST_ORG, videoId));
    expect(linked.status).toBe(422);
    expect(linked.body.code).toBe('not_an_upload');

    repository.uploadOriginal.mockResolvedValueOnce({ outcome: 'not_found' });
    expect((await refusal(service.downloadOriginal(TEST_ORG, videoId))).status).toBe(404);
    expect((await refusal(service.downloadOriginal(TEST_ORG, 'nope'))).status).toBe(404);

    repository.uploadOriginal.mockResolvedValueOnce({
      outcome: 'found',
      original: {
        title: 'Q3: "Plan" / Final?',
        key: `clips/${TEST_ORG}/videos/${videoId}/original.mov`,
      },
    });
    const { url } = await service.downloadOriginal(TEST_ORG, videoId);
    expect(url).toContain('original.mov');
    expect(storage.signedUrl).toHaveBeenLastCalledWith(
      `clips/${TEST_ORG}/videos/${videoId}/original.mov`,
      { expiresInSeconds: 300, downloadName: 'Q3 Plan Final.mov' },
    );
  });
});
