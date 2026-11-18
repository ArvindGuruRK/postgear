/**
 * The Clips limits against a fake resolver that answers from a table and
 * throws the real typed refusal, as the real one does: the documented order,
 * the whole-number details, and the import charge's key.
 */
import { refusalMessage } from '@postgear/entitlements';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import { BYTES_PER_GB } from '../clips.units';
import { TEST_ORG } from '../testing/rows';
import {
  ClipLimitsGuard,
  estimateImport,
  importChargeKey,
  importMinutes,
} from './clip-limits.guard';

const CODES: Record<string, string> = {
  'clips.enabled': 'clips_not_in_plan',
  'clips.max_video_minutes': 'clips_video_too_long',
  'clips.storage_gb': 'clips_storage_full',
  'clips.upload_max_gb': 'clips_upload_too_big',
};

function fakeResolver(table: Record<string, unknown>) {
  const asked: string[] = [];
  const resolver = {
    assert: jest.fn(
      async (_org: string, key: string, predicate: (v: unknown) => boolean, details = {}) => {
        asked.push(key);
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
  };
  return { resolver: resolver as unknown as EntitlementResolver, asked };
}

const PLAN = {
  'clips.enabled': true,
  'clips.max_video_minutes': 60,
  'clips.storage_gb': 5,
  'clips.upload_max_gb': 2,
  'clips.retention_days': 14,
  'clips.export_max_quality': '1080p',
};

function guardWith(table: Record<string, unknown> = PLAN, usedBytes = 0) {
  const { resolver, asked } = fakeResolver({ ...PLAN, ...table });
  const usage = { consume: jest.fn(async () => ({ entryId: 'entry-1', duplicate: false })) };
  const guard = new ClipLimitsGuard(resolver, usage as unknown as UsageService);
  jest.spyOn(guard, 'storageUsedBytes').mockResolvedValue(usedBytes);
  return { guard, asked, usage };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementRefusedException);
    const body = (error as EntitlementRefusedException).getResponse() as {
      code: string;
      details: Record<string, unknown>;
    };
    expect((error as EntitlementRefusedException).getStatus()).toBe(402);
    return body;
  }
  throw new Error('expected a refusal');
}

describe('ClipLimitsGuard', () => {
  it('passes a video inside every limit, checking in the documented order', async () => {
    const { guard, asked } = guardWith();
    await guard.checkLinkImport(TEST_ORG, 30 * 60_000, 100_000_000);
    expect(asked).toEqual(['clips.enabled', 'clips.max_video_minutes', 'clips.storage_gb']);
  });

  it('refuses a plan without Clips first, before the length is looked at', async () => {
    const { guard, asked } = guardWith({ 'clips.enabled': false });
    const body = await refusal(guard.checkLinkImport(TEST_ORG, 600 * 60_000, 1));
    expect(body.code).toBe('clips_not_in_plan');
    expect(asked).toEqual(['clips.enabled']);
  });

  it('refuses a video longer than the plan allows, with the whole minutes needed', async () => {
    const { guard } = guardWith();
    const body = await refusal(guard.checkLinkImport(TEST_ORG, 61 * 60_000 + 1, 1));
    expect(body.code).toBe('clips_video_too_long');
    expect(body.details).toEqual(expect.objectContaining({ limit: 60, needed: 62 }));
  });

  it('lets an unknown length through (the worker checks the real one)', async () => {
    const { guard, asked } = guardWith();
    await guard.assertLength(TEST_ORG, null);
    expect(asked).toEqual([]);
  });

  it('refuses when the space used plus the estimate passes the plan', async () => {
    const { guard } = guardWith({}, 4.5 * BYTES_PER_GB);
    const body = await refusal(guard.checkLinkImport(TEST_ORG, 60_000, 0.6 * BYTES_PER_GB));
    expect(body.code).toBe('clips_storage_full');
    expect(body.details).toEqual(expect.objectContaining({ limit: 5, used: 5 }));
  });

  it('refuses an upload bigger than the plan allows, before the space', async () => {
    const { guard, asked } = guardWith();
    const body = await refusal(guard.checkUploadStart(TEST_ORG, 3 * BYTES_PER_GB));
    expect(body.code).toBe('clips_upload_too_big');
    expect(asked).toEqual(['clips.enabled', 'clips.upload_max_gb']);
  });

  it('charges the import minutes once per job, under its own key', async () => {
    const { guard, usage } = guardWith();
    await guard.chargeImport(TEST_ORG, 'job-1', 90_000);
    expect(usage.consume).toHaveBeenCalledWith(TEST_ORG, 'clips.import_minutes_per_month', 1.5, {
      idempotencyKey: importChargeKey('job-1'),
      refId: 'job-1',
      meta: { durationMs: 90_000 },
    });
    expect(importChargeKey('job-1')).toBe('clips.import:job-1');
  });

  it('copies the plan into the job as whole values', async () => {
    const { guard } = guardWith();
    await expect(guard.importLimits(TEST_ORG)).resolves.toEqual({
      maxVideoMs: 60 * 60_000,
      storageBytes: 5 * BYTES_PER_GB,
      retentionDays: 14,
    });
  });
});

describe('import estimates', () => {
  it('reads minutes from milliseconds, never zero', () => {
    expect(importMinutes(61.5 * 60_000)).toBe(61.5);
    expect(importMinutes(0)).toBeGreaterThan(0);
  });

  it('uses the platform size of the format nearest the light copy', () => {
    const estimate = estimateImport({
      durationMs: 60_000,
      formats: [
        {
          id: 'a',
          label: '1080p',
          height: 1080,
          fps: 30,
          ext: 'mp4',
          bytes: 900,
          audioOnly: false,
        },
        { id: 'b', label: '720p', height: 720, fps: 30, ext: 'mp4', bytes: 500, audioOnly: false },
      ],
    });
    expect(estimate.expectedBytes).toBe(500);
    expect(estimate.storedBytes).toBeGreaterThan(500);
  });

  it('falls back to a typical bit rate when no size is known', () => {
    const estimate = estimateImport({ durationMs: 60_000, formats: [] });
    expect(estimate.expectedBytes).toBeNull();
    expect(estimate.storedBytes).toBeGreaterThan(10_000_000);
  });
});
