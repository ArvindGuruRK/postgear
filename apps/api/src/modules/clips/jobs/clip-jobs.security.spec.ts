/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): the API
 * copies quality, the mark and the priority into the job, so the worker
 * never resolves a plan.
 *
 * `ClipJobsService.build` is the one place a job row is made. It must take
 * the priority from the plan (or the caller's fixed one, a preview's `low`)
 * and refuse any input its kind's strict schema does not accept: a render
 * with no mark or no quality, an import with no limits, or one that carries
 * a key of its own (a tier, a plan) for the worker to read instead. The
 * worker parses the same schemas before it runs a job.
 *
 * Where the values come from is pinned elsewhere: the export's quality, mark
 * and priority in `clip-exports.service.spec.ts` ("freezes ... the plan
 * values into a RENDER job"), the import limits in `clip-limits.guard.spec.ts`
 * ("copies the plan into the job as whole values").
 */
import { HttpException, Logger } from '@nestjs/common';
import type { PrivateStorage } from '@postgear/storage';
import { createClipDocument } from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipJobsRepository } from './clip-jobs.repository';
import { ClipJobsService } from './clip-jobs.service';

const VIDEO = videoRow().id;
const CLIP = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';

const RENDER_INPUT = {
  clipId: CLIP,
  videoId: VIDEO,
  revision: 3,
  document: createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' }),
  quality: '720p',
  proof: false,
  watermark: true,
  name: 'A clip.mp4',
};

function build(planPriority: unknown = 'high') {
  const resolver = { get: jest.fn(async () => planPriority) };
  const service = new ClipJobsService(
    {} as unknown as ClipJobsRepository,
    {} as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
    {} as unknown as UsageService,
    {} as unknown as PrivateStorage,
  );
  return { service, resolver };
}

const renderJob = (input: unknown, priority?: 'low' | 'normal' | 'high') => ({
  id: JOB,
  orgId: TEST_ORG,
  userId: TEST_USER,
  kind: 'RENDER' as const,
  input: input as typeof RENDER_INPUT,
  clipId: CLIP,
  videoId: VIDEO,
  ...(priority ? { priority } : {}),
});

let errors: jest.SpyInstance;

beforeEach(() => {
  errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the job row carries the plan values', () => {
  it("copies the workspace's queue priority from the plan, and the mark and quality as given", async () => {
    const { service, resolver } = build('high');
    const row = await service.build(renderJob(RENDER_INPUT) as never);
    expect(resolver.get).toHaveBeenCalledWith(TEST_ORG, 'clips.queue_priority');
    expect(row.priority).toBe('high');
    expect(row.input).toMatchObject({ quality: '720p', watermark: true, proof: false });
  });

  it("uses the caller's fixed priority (a preview's low) without reading the plan", async () => {
    const { service, resolver } = build('high');
    const row = await service.build(renderJob({ ...RENDER_INPUT, proof: true }, 'low') as never);
    expect(resolver.get).not.toHaveBeenCalled();
    expect(row.priority).toBe('low');
  });
});

describe('a job the worker would have to complete itself is never written', () => {
  const { watermark: _mark, ...noMark } = RENDER_INPUT;
  const { quality: _quality, ...noQuality } = RENDER_INPUT;

  it.each([
    ['no mark', noMark],
    ['no quality', noQuality],
    ['a mark that is not yes or no', { ...RENDER_INPUT, watermark: 'plan' }],
    ['a quality the plans do not have', { ...RENDER_INPUT, quality: '4k' }],
    ['a tier for the worker to resolve', { ...RENDER_INPUT, tier: 'PRO' }],
    ['plan values of its own', { ...RENDER_INPUT, plan: { 'clips.export_watermark': false } }],
  ])(
    'refuses a render with %s (422 tool_failed), logging only the paths',
    async (_label, input) => {
      const { service } = build();
      expect(await refusal(service.build(renderJob(input) as never))).toEqual({
        status: 422,
        code: 'tool_failed',
      });
      const logged = String(errors.mock.calls[0]?.[0] ?? '');
      expect(logged).toContain('clips.job.input_invalid');
      expect(logged).not.toContain('PRO');
      expect(logged).not.toContain('A clip.mp4');
    },
  );

  it('refuses an import with no limits copied in, or limits that are not whole numbers', async () => {
    const { service } = build();
    const importJob = (input: unknown) =>
      ({ id: JOB, orgId: TEST_ORG, userId: TEST_USER, kind: 'IMPORT', input }) as never;
    const valid = {
      videoId: VIDEO,
      origin: { type: 'upload', originalKey: `clips/${TEST_ORG}/videos/${VIDEO}/original.mp4` },
      limits: { maxVideoMs: 3_600_000, storageBytes: 3_000_000_000, retentionDays: 7 },
      expectedBytes: null,
    };
    // The same input with the API's limits is written: the refusals below are about the limits.
    await expect(service.build(importJob(valid))).resolves.toMatchObject({ kind: 'IMPORT' });

    const { limits: _limits, ...noLimits } = valid;
    for (const input of [
      noLimits,
      { ...valid, limits: { ...valid.limits, storageBytes: Number.POSITIVE_INFINITY } },
      { ...valid, limits: { ...valid.limits, maxVideoMs: null } },
      { ...valid, limits: { ...valid.limits, tier: 'PRO' } },
    ]) {
      expect(await refusal(service.build(importJob(input)))).toEqual({
        status: 422,
        code: 'tool_failed',
      });
    }
  });
});
