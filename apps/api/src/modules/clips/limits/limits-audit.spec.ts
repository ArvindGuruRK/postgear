/**
 * The limits audit (Sprint 12, Module 19 section 3): one test per row of the
 * limits table. Each row proves two things:
 *
 * 1. **The wiring**: the place that row names calls its check (read from the
 *    service's own source, so removing a call fails here by name).
 * 2. **The refusal**: that check, with a plan value that refuses, throws the
 *    typed 402 with its code and the sentence from `@postgear/entitlements`,
 *    reading the number from the resolver (never a constant).
 *
 * The behaviour of each check in depth lives in `clip-limits.guard.spec.ts`
 * and the services' own specs; this file is the table, kept whole.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { refusalMessage } from '@postgear/entitlements';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import { ClipChannelsController } from '../channels/clip-channels.controller';
import { ClipItemController } from '../clip/clip-item.controller';
import { BYTES_PER_GB } from '../clips.units';
import { ClipDownloadsController } from '../downloads/clip-downloads.controller';
import { ClipFilesController } from '../files/clip-files.controller';
import { ClipHighlightsController } from '../highlights/clip-highlights.controller';
import { ClipsInternalController } from '../internal/clips-internal.controller';
import { ClipJobsController } from '../jobs/clip-jobs.controller';
import { ClipLayoutsController } from '../layouts/clip-layouts.controller';
import { ClipLibraryController } from '../library/clip-library.controller';
import { ClipSoundsController } from '../library/clip-sounds.controller';
import { ClipStickersController } from '../library/clip-stickers.controller';
import { ClipLinksController } from '../links/clip-links.controller';
import { ClipsStatusController } from '../status/clips-status.controller';
import { TEST_ORG } from '../testing/rows';
import { ClipVideosController } from '../videos/clip-videos.controller';
import { ClipLimitsGuard, DOWNLOADS_METER, IMPORT_METER } from './clip-limits.guard';
import { ClipsEnabledGuard } from './clips-enabled.guard';

const CLIPS_DIR = join(__dirname, '..');
const source = (path: string) => readFileSync(join(CLIPS_DIR, path), 'utf8');

const CODES: Record<string, string> = {
  'clips.enabled': 'clips_not_in_plan',
  'clips.max_video_minutes': 'clips_video_too_long',
  'clips.storage_gb': 'clips_storage_full',
  'clips.upload_max_gb': 'clips_upload_too_big',
  'clips.browse_channels': 'channel_limit',
};

/** A resolver that answers from a plan table and refuses as the real one does. */
function resolverFor(plan: Record<string, unknown>) {
  return {
    get: jest.fn(async (_org: string, key: string) => plan[key]),
    getMany: jest.fn(async (_org: string, keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, plan[key]])),
    ),
    assert: jest.fn(
      async (_org: string, key: string, predicate: (v: unknown) => boolean, d = {}) => {
        const limit = plan[key];
        if (predicate(limit)) return limit;
        const n = typeof limit === 'number' ? limit : undefined;
        const code = CODES[key] ?? 'clips_not_in_plan';
        throw new EntitlementRefusedException(code, refusalMessage(code, { n }), {
          limit: n,
          ...(d as object),
        });
      },
    ),
  };
}

const PLAN = {
  'clips.enabled': true,
  'clips.max_video_minutes': 60,
  'clips.storage_gb': 3,
  'clips.upload_max_gb': 2,
  'clips.retention_days': 7,
};

function guardFor(plan: Record<string, unknown>, usedBytes = 0) {
  const resolver = resolverFor({ ...PLAN, ...plan });
  const usage = { consume: jest.fn(async () => ({ entryId: 'e', duplicate: false })) };
  const guard = new ClipLimitsGuard(
    resolver as unknown as EntitlementResolver,
    usage as unknown as UsageService,
  );
  jest.spyOn(guard, 'storageUsedBytes').mockResolvedValue(usedBytes);
  return { guard, usage, resolver };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code: string; message: string };
      return { status: error.getStatus(), code: body.code, message: body.message };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('Row: the whole feature (clips.enabled, clips_not_in_plan) on every Clips route', () => {
  const GUARDED = [
    ClipVideosController,
    ClipHighlightsController,
    ClipJobsController,
    ClipDownloadsController,
    ClipItemController,
    ClipLayoutsController,
    ClipLibraryController,
    ClipSoundsController,
    ClipStickersController,
    ClipChannelsController,
    ClipLinksController,
  ];

  it.each(GUARDED.map((controller) => [controller.name, controller]))(
    '%s carries ClipsEnabledGuard',
    (_name, controller) => {
      const guards = (Reflect.getMetadata('__guards__', controller) ?? []) as unknown[];
      expect(guards).toContain(ClipsEnabledGuard);
    },
  );

  it('leaves out the status route (it answers enabled: false), the signed files and the worker routes', () => {
    for (const controller of [
      ClipsStatusController,
      ClipFilesController,
      ClipsInternalController,
    ]) {
      const guards = (Reflect.getMetadata('__guards__', controller) ?? []) as unknown[];
      expect(guards).not.toContain(ClipsEnabledGuard);
    }
  });

  it('refuses with 402 clips_not_in_plan when the plan turns Clips off', async () => {
    const resolver = resolverFor({ 'clips.enabled': false });
    const guard = new ClipsEnabledGuard(
      new Reflector(),
      resolver as unknown as EntitlementResolver,
    );
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ activeOrg: { id: TEST_ORG, role: 'USER' } }) }),
    };
    const result = await refusal(guard.canActivate(context as never));
    expect(result).toEqual({
      status: 402,
      code: 'clips_not_in_plan',
      message: "Clips is not part of this workspace's plan.",
    });
    expect(resolver.assert).toHaveBeenCalledWith(TEST_ORG, 'clips.enabled', expect.any(Function));
  });

  it('lets a public route through without reading the plan', async () => {
    const resolver = resolverFor({ 'clips.enabled': false });
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new ClipsEnabledGuard(reflector, resolver as unknown as EntitlementResolver);
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    };
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolver.assert).not.toHaveBeenCalled();
  });
});

describe('Row: probe and import (length, minutes, space)', () => {
  it('is wired: the probe reads the longest video, the import checks then charges', () => {
    expect(source('links/clip-links.service.ts')).toContain("'clips.max_video_minutes'");
    const videos = source('videos/clip-videos.service.ts');
    expect(videos).toMatch(
      /this\.limits\.checkLinkImport\(orgId, durationMs, estimate\.storedBytes\)/,
    );
    expect(videos).toMatch(/this\.limits\.chargeImport\(orgId, jobId, durationMs\)/);
  });

  it('refuses a video over the plan length with clips_video_too_long', async () => {
    const { guard } = guardFor({ 'clips.max_video_minutes': 60 });
    expect(await refusal(guard.checkLinkImport(TEST_ORG, 61 * 60_000, 0))).toMatchObject({
      status: 402,
      code: 'clips_video_too_long',
    });
  });

  it('refuses when the space would overflow with clips_storage_full', async () => {
    const { guard } = guardFor({}, 2.9 * BYTES_PER_GB);
    expect(
      await refusal(guard.checkLinkImport(TEST_ORG, 60_000, 0.5 * BYTES_PER_GB)),
    ).toMatchObject({
      code: 'clips_storage_full',
    });
  });

  it('charges the import minutes on the import meter, keyed by the job (clips_minutes_used comes from the ledger)', async () => {
    const { guard, usage } = guardFor({});
    await guard.chargeImport(TEST_ORG, 'job-1', 90_000);
    expect(usage.consume).toHaveBeenCalledWith(TEST_ORG, IMPORT_METER, 1.5, {
      idempotencyKey: 'clips.import:job-1',
      refId: 'job-1',
      meta: { durationMs: 90_000 },
    });
  });
});

describe('Row: upload start and complete (upload size, space)', () => {
  it('is wired at start and again at complete', () => {
    const uploads = source('videos/clip-uploads.service.ts');
    expect(uploads).toMatch(/this\.limits\.checkUploadStart\(orgId, body\.bytes\)/);
    expect(uploads).toMatch(/this\.limits\.assertUploadSize\(orgId, stored\.bytes\)/);
    expect(uploads).toMatch(/this\.limits\.assertStorage\(orgId, stored\.bytes\)/);
  });

  it('refuses a file over the plan upload size with clips_upload_too_big', async () => {
    const { guard } = guardFor({ 'clips.upload_max_gb': 2 });
    expect(await refusal(guard.checkUploadStart(TEST_ORG, 3 * BYTES_PER_GB))).toMatchObject({
      code: 'clips_upload_too_big',
      message: 'Uploads can be up to 2 GB.',
    });
  });
});

describe('Row: download (length, minutes, downloads a day)', () => {
  it('is wired: checks, then the daily charge, then the import minutes', () => {
    const downloads = source('downloads/clip-downloads.service.ts');
    expect(downloads).toMatch(/this\.limits\.assertCanDownload\(orgId, durationMs,/);
    expect(downloads).toMatch(/this\.limits\.chargeDownload\(orgId, jobId, userId\)/);
    expect(downloads).toMatch(/this\.limits\.chargeImport\(orgId, jobId, durationMs, userId\)/);
  });

  it('refuses a download over the plan length', async () => {
    const { guard } = guardFor({ 'clips.max_video_minutes': 10 });
    expect(await refusal(guard.assertCanDownload(TEST_ORG, 11 * 60_000, 1))).toMatchObject({
      code: 'clips_video_too_long',
    });
  });

  it('counts one download a day on its meter, keyed by the job', async () => {
    const { guard, usage } = guardFor({});
    await guard.chargeDownload(TEST_ORG, 'job-2');
    expect(usage.consume).toHaveBeenCalledWith(TEST_ORG, DOWNLOADS_METER, 1, {
      idempotencyKey: 'clips.download:job-2',
      refId: 'job-2',
    });
  });
});

describe('Row: Find Clips (AI minutes)', () => {
  it('is wired: the run charges the AI meter through UsageService, keyed by the job', () => {
    const highlights = source('highlights/clip-highlights.service.ts');
    expect(highlights).toContain("AI_MINUTES_METER = 'clips.ai_minutes_per_month'");
    expect(highlights).toMatch(/this\.usage\.consume\(orgId, AI_MINUTES_METER, price, \{/);
    expect(highlights).toMatch(/refId: jobId/);
  });
});

describe('Row: sound and sticker uploads (space)', () => {
  it.each(['library/clip-sound-uploads.service.ts', 'library/clip-sticker-uploads.service.ts'])(
    '%s checks the space with the file size',
    (path) => {
      expect(source(path)).toMatch(/this\.limits\.assertStorage\(orgId, file\.buffer\.length\)/);
    },
  );
});

describe('Row: export (best quality, the mark)', () => {
  it('is wired: the quality from the resolver, the mark copied into the job input', () => {
    const exportsSource = source('clip/clip-exports.service.ts');
    expect(exportsSource).toContain("plan['clips.export_max_quality']");
    expect(exportsSource).toContain("'clips_quality_requires_plan'");
    expect(exportsSource).toMatch(/watermark: plan\['clips\.export_watermark'\] === true/);
  });
});

describe('Row: More Video, a wider sharp range (space)', () => {
  it('is wired: the range is checked against the space before it is fetched', () => {
    expect(source('clip/clip-item.service.ts')).toMatch(
      /this\.limits\.assertStorage\(orgId, estimateSegmentBytes\(range\)\)/,
    );
  });
});

describe('Row: channels added (clips.browse_channels, channel_limit)', () => {
  it('is wired through the resolver', () => {
    const channels = source('channels/clip-channels.service.ts');
    expect(channels).toContain("'clips.browse_channels'");
    expect(channels).toMatch(/this\.resolver\.assert\(orgId, 'clips\.browse_channels'/);
  });
});

describe('Row: concurrency and order (no refusal, the job waits)', () => {
  it('is wired: the cap and the priority come from the resolver', () => {
    const jobs = source('jobs/clip-jobs.service.ts');
    expect(jobs).toContain("this.resolver.get(orgId, 'clips.concurrent_imports')");
    expect(jobs).toContain("'clips.queue_priority'");
  });
});

describe('The downgrade rule (Module 19)', () => {
  it('a workspace over its plan gets the over sentence with both numbers; nothing is deleted', async () => {
    const { guard } = guardFor({ 'clips.storage_gb': 3 }, 4.2 * BYTES_PER_GB);
    expect(await refusal(guard.assertStorage(TEST_ORG, 1))).toEqual({
      status: 402,
      code: 'clips_storage_full',
      message:
        "Your videos use 4.2 GB, over your plan's 3 GB. Delete some, or upgrade, to bring in more.",
    });
  });

  it('a plan value changed in the resolver changes the refusal at once', async () => {
    const used = 4.2 * BYTES_PER_GB;
    const { guard } = guardFor({ 'clips.storage_gb': 10 }, used);
    await expect(guard.assertStorage(TEST_ORG, 1)).resolves.toBeUndefined();
    const lower = guardFor({ 'clips.storage_gb': 4 }, used);
    expect((await refusal(lower.guard.assertStorage(TEST_ORG, 1))).code).toBe('clips_storage_full');
  });

  it('exports of existing clips never check the space', () => {
    expect(source('clip/clip-exports.service.ts')).not.toMatch(/assertStorage/);
  });
});
