/**
 * The ledger under load (Sprint 12, Module 20 section 3): twenty imports
 * charged at once against a meter with room for three. This runs against the
 * real Postgres, with real Serializable transactions, because a mock cannot
 * show what racing transactions do. Three imports are charged and the other
 * seventeen are refused. Past the retries, a request may instead get a 503
 * and is never charged. `used` never goes above the limit or below zero.
 *
 * It needs the local database (docker compose up) with every migration
 * applied, so it runs only when CLIPS_LEDGER_DB_TEST=1:
 *
 *   CLIPS_LEDGER_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js usage.load
 *
 * CI has no Postgres service, so there it shows as skipped. The test makes
 * one throwaway Free workspace and deletes it at the end (its ledger rows go
 * with it through the cascade).
 */
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import type { Env } from '../../config/env';
import type { RedisService } from '../redis/redis.service';
import { EntitlementRefusedException } from './entitlement-refused.exception';
import { EntitlementResolver } from './entitlement-resolver';
import { EntitlementsRepository } from './entitlements.repository';
import { UsageService } from './usage.service';

const RUN = process.env.CLIPS_LEDGER_DB_TEST === '1';
const METER = 'clips.import_minutes_per_month' as const;
const AT_ONCE = 20;

(RUN ? describe : describe.skip)('the usage ledger under load (real Postgres)', () => {
  const orgId = `ledger-load-${Date.now().toString(36)}`;
  let resolver: EntitlementResolver;
  let usage: UsageService;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: 'Ledger Load Test' } });
    // No Redis: every stamp reads as unknown, so the resolver reads the database.
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

  async function ledgerMilli(): Promise<{ sum: number; rows: number }> {
    const totals = await prisma.usageEntry.aggregate({
      where: { organizationId: orgId, meter: METER },
      _sum: { units: true },
      _count: true,
    });
    return { sum: totals._sum.units ?? 0, rows: totals._count };
  }

  it('charges three of twenty imports sent at once with room for three, and never goes past the limit or below zero', async () => {
    const meter = await resolver.exactMeter(orgId, METER);
    const limit = meter.limitValue;
    if (limit === null)
      throw new Error('The Free plan import minutes are unlimited here; this test needs a number.');
    // Room for exactly three: 3 x units fits, 4 x units does not.
    const units = Math.round((limit / 3.5) * 1_000) / 1_000;

    const results = await Promise.allSettled(
      Array.from({ length: AT_ONCE }, (_, index) =>
        usage.consume(orgId, METER, units, {
          idempotencyKey: `load:import:${index}`,
          refId: `load-${index}`,
        }),
      ),
    );

    const charged = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof EntitlementRefusedException,
    );
    const unavailable = results.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof ServiceUnavailableException,
    );
    const other = results.filter(
      (result) =>
        result.status === 'rejected' &&
        !(result.reason instanceof EntitlementRefusedException) &&
        !(result.reason instanceof ServiceUnavailableException),
    );

    expect(other).toEqual([]);
    expect(charged).toHaveLength(3);
    expect(refused.length + unavailable.length).toBe(AT_ONCE - 3);

    const ledger = await ledgerMilli();
    expect(ledger.rows).toBe(3);
    expect(ledger.sum).toBe(3 * Math.round(units * 1_000));
    expect(ledger.sum).toBeLessThanOrEqual(limit * 1_000);
    expect(ledger.sum).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('gives every charge back once, even when every reversal is sent twice at once, and ends at zero', async () => {
    const charges = await prisma.usageEntry.findMany({
      where: { organizationId: orgId, meter: METER, reversesId: null },
      select: { id: true },
    });
    expect(charges).toHaveLength(3);

    const results = await Promise.allSettled(
      charges.flatMap((charge) => [
        usage.reverse(orgId, charge.id),
        usage.reverse(orgId, charge.id),
      ]),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);

    const ledger = await ledgerMilli();
    expect(ledger.rows).toBe(6);
    expect(ledger.sum).toBe(0);
  }, 60_000);
});
