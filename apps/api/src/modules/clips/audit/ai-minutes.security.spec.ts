/**
 * Security sweep, the AI Minutes meter (Sprint 13, Module 16 section 1).
 *
 * Already proven, and not repeated here:
 * - consumed before the job, the shown price is what is charged, a repeat
 *   press charges once, a failure gives everything back once, too few minutes
 *   refuses before anything starts: `ai-routes.audit.spec.ts`, one block per
 *   AI route;
 * - every charge site and its key: `ai-charge-sites.audit.spec.ts`;
 * - no free run through the worker-facing routes or the reconcile:
 *   `no-free-route.audit.spec.ts`;
 * - the ledger's own rules (the same key is one row also when it lost the
 *   race, a reversal never passes its original, never reverses a reversal,
 *   lands in its original's window): `entitlements/usage.service.security.spec.ts`,
 *   and twenty imports at once against the real Postgres in
 *   `entitlements/usage.load.spec.ts`.
 *
 * Added here:
 * 1. The price comes from the server: every AI body refuses a price, a
 *    minute count or a cost, at the top and inside a setup.
 * 2. Against the real Postgres, on the AI meter with AI keys (only with
 *    `CLIPS_AI_LEDGER_DB_TEST=1`; it makes one throwaway workspace and
 *    deletes it, and never resets or seeds anything):
 *    - twenty presses at once with the same key make one row;
 *    - two charges at once with room for one admit one;
 *    - a failed run's reversal, sent three times at once, gives back exactly
 *      the charge: `used` returns to where it was, never below, and the
 *      worker-facing read sees nothing left to work on;
 *    - a lowered limit leaves `remaining` at 0 and takes nothing back;
 *    - a reversal of last cycle's charge leaves this cycle as it was.
 *
 *   CLIPS_AI_LEDGER_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js ai-minutes.security
 */
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma, UsageKind } from '@postgear/db';
import { DEFAULT_AUTO_EDIT_RECIPE, defaultClipSetup } from '@postgear/video-engine';
import type { ZodType } from 'zod';
import type { Env } from '../../../config/env';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { EntitlementsRepository } from '../../entitlements/entitlements.repository';
import { UsageService } from '../../entitlements/usage.service';
import type { RedisService } from '../../redis/redis.service';
import { autoEditSchema } from '../auto-edit/clip-auto-edit.schema';
import { addCaptionsSchema, translateCaptionsSchema } from '../captions/clip-captions.schema';
import { liveChargeFor, liveChargeUnder } from '../clips-ai-charges';
import { setupPriceSchema, startHighlightsSchema } from '../highlights/clip-highlights.schema';
import { hookTitlesBodySchema } from '../hook-titles/clip-hook-titles.schema';
import { ensureTranscriptSchema } from '../transcripts/clip-transcripts.schema';
import { makeVoiceSchema } from '../voice/clip-voice.schema';

/** Every AI route's body, with a body it takes. */
const BODIES: Array<[string, ZodType, Record<string, unknown>]> = [
  ['POST /clips/videos/:videoId/transcript', ensureTranscriptSchema, { fromMs: 0, toMs: 60_000 }],
  ['POST /clips/:clipId/captions', addCaptionsSchema, { language: 'en' }],
  ['POST /clips/:clipId/captions/translate', translateCaptionsSchema, { language: 'ta' }],
  [
    'POST /clips/videos/:videoId/highlights',
    startHighlightsSchema,
    { setup: defaultClipSetup(120_000) },
  ],
  [
    'POST /clips/videos/:videoId/setup/price',
    setupPriceSchema,
    { setup: defaultClipSetup(120_000) },
  ],
  ['POST /clips/videos/:videoId/auto-edit', autoEditSchema, { recipeId: DEFAULT_AUTO_EDIT_RECIPE }],
  [
    'POST /clips/:clipId/voice',
    makeVoiceSchema,
    { text: 'Wait for it', voiceId: 'sim-meadow', revision: 3 },
  ],
  ['POST /clips/:clipId/hook-titles', hookTitlesBodySchema, { attempt: 1 }],
];

/** What a browser could add to set its own price. */
const PRICE_KEYS = ['aiMinutes', 'price', 'cost', 'minutes', 'units', 'charge', 'quote'];

describe('the price comes from the server, never the browser', () => {
  it.each(BODIES)('%s takes its body and refuses a price in it', (_route, schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
    for (const key of PRICE_KEYS) {
      expect(schema.safeParse({ ...body, [key]: 0 }).success).toBe(false);
      expect(schema.safeParse({ ...body, [key]: 0.001 }).success).toBe(false);
    }
  });

  it('refuses a price inside a setup too', () => {
    for (const schema of [startHighlightsSchema, setupPriceSchema]) {
      for (const key of PRICE_KEYS) {
        const setup = { ...defaultClipSetup(120_000), [key]: 0 };
        expect(schema.safeParse({ setup }).success).toBe(false);
      }
    }
  });
});

const RUN = process.env.CLIPS_AI_LEDGER_DB_TEST === '1';
const METER = 'clips.ai_minutes_per_month' as const;
const AT_ONCE = 20;
const DAY = 24 * 60 * 60_000;

(RUN ? describe : describe.skip)('the AI minutes ledger under load (real Postgres)', () => {
  const orgId = `ai-ledger-${Date.now().toString(36)}`;
  let resolver: EntitlementResolver;
  let usage: UsageService;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: 'AI Ledger Test' } });
    // No Redis: every stamp reads as unknown, so the resolver reads the database each time.
    const redis = { get: async () => null, set: async () => undefined } as unknown as RedisService;
    const config = { get: () => 'db' } as unknown as ConfigService<Env, true>;
    const repository = new EntitlementsRepository();
    resolver = new EntitlementResolver(repository, redis, config);
    usage = new UsageService(repository, resolver);
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  /** The workspace's own AI minutes limit, as the operator screen writes it. */
  async function setLimit(minutes: number): Promise<void> {
    await prisma.orgEntitlementOverride.upsert({
      where: { organizationId_key: { organizationId: orgId, key: METER } },
      create: {
        organizationId: orgId,
        key: METER,
        value: minutes,
        reason: 'AI ledger test',
        expiresAt: new Date(Date.now() + 30 * DAY),
        createdBy: 'ai-ledger-test',
      },
      update: { value: minutes },
    });
    await resolver.invalidateOrg(orgId);
  }

  /** The ledger's rows and sum (thousandths) in the window `now` falls in. */
  async function windowLedger(now = new Date()): Promise<{ sum: number; rows: number }> {
    const { cycleStart } = await resolver.exactMeter(orgId, METER, now);
    const totals = await prisma.usageEntry.aggregate({
      where: { organizationId: orgId, meter: METER, cycleStart },
      _sum: { units: true },
      _count: true,
    });
    return { sum: totals._sum.units ?? 0, rows: totals._count };
  }

  /** Each result is a charge (fulfilled), a refusal (402) or a fail-closed 503, never anything else. */
  function sorted(results: PromiseSettledResult<Awaited<ReturnType<UsageService['consume']>>>[]) {
    const reason = (result: PromiseSettledResult<unknown>) =>
      result.status === 'rejected' ? (result.reason as unknown) : null;
    return {
      fulfilled: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      refused: results.filter((result) => reason(result) instanceof EntitlementRefusedException),
      unavailable: results.filter(
        (result) => reason(result) instanceof ServiceUnavailableException,
      ),
      other: results.filter(
        (result) =>
          result.status === 'rejected' &&
          !(reason(result) instanceof EntitlementRefusedException) &&
          !(reason(result) instanceof ServiceUnavailableException),
      ),
    };
  }

  it('makes one row of twenty presses at once with the same key', async () => {
    await setLimit(100);
    const jobId = randomUUID();
    const key = `clips.ai:listen:${jobId}`;
    const before = await windowLedger();
    const results = sorted(
      await Promise.allSettled(
        Array.from({ length: AT_ONCE }, () =>
          usage.consume(orgId, METER, 2, { idempotencyKey: key, refId: jobId }),
        ),
      ),
    );
    expect(results.other).toEqual([]);
    expect(results.refused).toEqual([]);
    expect(results.fulfilled.length).toBeGreaterThan(0);
    // Every answer names the one row, and at most one of them made it.
    expect(new Set(results.fulfilled.map((result) => result.entryId)).size).toBe(1);
    expect(results.fulfilled.filter((result) => !result.duplicate).length).toBeLessThanOrEqual(1);

    const rows = await prisma.usageEntry.findMany({
      where: { organizationId: orgId, idempotencyKey: key },
    });
    expect(rows).toHaveLength(1);
    const after = await windowLedger();
    expect(after.sum - before.sum).toBe(2_000);
    expect(await liveChargeUnder(orgId, key)).toBe(2_000);
  }, 60_000);

  it('admits one of two charges sent at once with room for one', async () => {
    const before = await windowLedger();
    // Room for exactly one 3 minute charge on top of what is used.
    await setLimit(Math.ceil(before.sum / 1_000) + 4);
    const jobs = [randomUUID(), randomUUID()];
    const results = sorted(
      await Promise.allSettled(
        jobs.map((jobId) =>
          usage.consume(orgId, METER, 3, {
            idempotencyKey: `clips.ai:signals:${jobId}`,
            refId: jobId,
          }),
        ),
      ),
    );
    expect(results.other).toEqual([]);
    expect(results.fulfilled).toHaveLength(1);
    expect(results.refused.length + results.unavailable.length).toBe(1);
    const after = await windowLedger();
    expect(after.rows - before.rows).toBe(1);
    expect(after.sum - before.sum).toBe(3_000);
  }, 60_000);

  it("gives a failed run's charge back exactly once, however often it is asked at once", async () => {
    await setLimit(1_000);
    const jobId = randomUUID();
    const before = await windowLedger();
    const charge = await usage.consume(orgId, METER, 5, {
      idempotencyKey: `clips.ai:read:${jobId}`,
      refId: jobId,
    });
    // The worker, the cancel route and the reconcile all ask at once.
    const back = await Promise.allSettled([
      usage.reverse(orgId, charge.entryId),
      usage.reverse(orgId, charge.entryId),
      usage.reverseAllFor(orgId, jobId),
    ]);
    expect(back.filter((result) => result.status === 'rejected')).toEqual([]);
    // A second give-back later is a no-op.
    expect((await usage.reverse(orgId, charge.entryId)).duplicate).toBe(true);
    expect(await usage.reverseAllFor(orgId, jobId)).toBe(0);

    const reversals = await prisma.usageEntry.findMany({
      where: { organizationId: orgId, reversesId: charge.entryId },
    });
    expect(reversals).toHaveLength(1);
    expect(reversals[0]?.kind).toBe(UsageKind.REVERSAL);
    expect(reversals[0]?.units).toBe(-5_000);
    const after = await windowLedger();
    expect(after.sum).toBe(before.sum);
    expect(after.sum).toBeGreaterThanOrEqual(0);
    // The worker-facing reads see nothing left to work on: no free run after a give-back.
    expect(await liveChargeFor(orgId, jobId)).toBe(0);
    expect(await liveChargeUnder(orgId, `clips.ai:read:${jobId}`)).toBe(0);
  }, 60_000);

  it('never gives back more than was charged, in parts sent at once', async () => {
    const jobId = randomUUID();
    const charge = await usage.consume(orgId, METER, 4, {
      idempotencyKey: `clips.ai:action:${jobId}`,
      refId: jobId,
    });
    const parts = await Promise.allSettled([
      usage.reverse(orgId, charge.entryId, { units: 3, part: 1 }),
      usage.reverse(orgId, charge.entryId, { units: 3, part: 2 }),
      usage.reverse(orgId, charge.entryId),
    ]);
    expect(parts.some((result) => result.status === 'fulfilled')).toBe(true);
    const back = await prisma.usageEntry.aggregate({
      where: { organizationId: orgId, reversesId: charge.entryId },
      _sum: { units: true },
    });
    expect(-(back._sum.units ?? 0)).toBeLessThanOrEqual(4_000);
    expect(await liveChargeUnder(orgId, `clips.ai:action:${jobId}`)).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('leaves remaining at 0 when the limit is lowered below what is used, and takes nothing back', async () => {
    const before = await windowLedger();
    expect(before.sum).toBeGreaterThan(0);
    await setLimit(0);
    const meter = await resolver.meter(orgId, METER);
    expect(meter.remaining).toBe(0);
    expect(meter.used).toBe(Math.floor(before.sum / 1_000));

    const jobId = randomUUID();
    await expect(
      usage.consume(orgId, METER, 1, { idempotencyKey: `clips.ai:listen:${jobId}`, refId: jobId }),
    ).rejects.toBeInstanceOf(EntitlementRefusedException);
    const after = await windowLedger();
    expect(after).toEqual(before);
  }, 60_000);

  it("leaves this cycle as it was when last cycle's charge is given back", async () => {
    await setLimit(1_000);
    const lastCycle = new Date(Date.now() - 40 * DAY);
    const { cycleStart: thisStart } = await resolver.exactMeter(orgId, METER);
    const jobId = randomUUID();
    const old = await usage.consume(orgId, METER, 6, {
      idempotencyKey: `clips.ai:listen:${jobId}`,
      refId: jobId,
      now: lastCycle,
    });
    expect(old.state.cycleStart.getTime()).toBeLessThan(thisStart.getTime());

    const before = await windowLedger();
    await usage.reverse(orgId, old.entryId);
    const after = await windowLedger();
    expect(after).toEqual(before);
    const reversal = await prisma.usageEntry.findFirst({
      where: { organizationId: orgId, reversesId: old.entryId },
    });
    expect(reversal?.cycleStart.getTime()).toBe(old.state.cycleStart.getTime());
    expect((await windowLedger(lastCycle)).sum).toBe(0);
  }, 60_000);
});
