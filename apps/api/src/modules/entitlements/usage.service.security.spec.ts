/**
 * Security sweep, the Meters line (Sprint 12, Module 20 section 1).
 *
 * The real `UsageService`, the real `EntitlementResolver` and the real
 * `EntitlementsRepository`, over an in-memory `UsageEntry` table that keeps
 * the unique index on (workspace, key) and answers each `where` field by
 * field. So a repository that forgot the workspace in a look-up, a charge
 * that skipped the limit, a refund that gave back more than was charged or a
 * database error that let a charge through fails here.
 *
 * What must hold:
 * - a charge is one Serializable transaction, never makes `used` negative and
 *   never pushes it over a hard limit (the typed 402 with the meter's code);
 * - `P2034` is retried, then fails closed; any other database error is a 503
 *   that charges nothing and says nothing of the database;
 * - the same key twice is one row, also when the second one won the race;
 * - keys are per workspace: another workspace's key, entry or job is never
 *   answered, refunded or counted;
 * - a reversal never exceeds its original, never reverses a reversal, lands
 *   in its original's window, and a failed or cancelled job is refunded once
 *   however often it is asked.
 */
import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, UsageKind } from '@postgear/db';
import type { MeterKey } from '@postgear/entitlements';
import type { Env } from '../../config/env';
import type { RedisService } from '../redis/redis.service';
import { EntitlementResolver } from './entitlement-resolver';
import { CLIPS_ALLOWANCE_UNAVAILABLE } from './entitlements.messages';
import { EntitlementsRepository } from './entitlements.repository';
import { UsageService } from './usage.service';

// ---- The in-memory ledger ----------------------------------------------------------

interface Row {
  id: string;
  organizationId: string;
  meter: string;
  units: number;
  kind: UsageKind;
  idempotencyKey: string;
  refId: string | null;
  reversesId: string | null;
  cycleStart: Date;
  meta: unknown;
  createdBy: string | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** Every field of the `where` must match: a look-up that leaves the workspace out matches across workspaces. */
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([field, value]) => same(row[field as keyof Row], value));
}

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`fake ${code}`, { code, clientVersion: 'test' });
}

const ledger = {
  rows: [] as Row[],
  sequence: 0,
  /** Errors the next transactions throw before running, one per call. */
  failNext: [] as Error[],
  /** Runs inside the next `create`, before the row is written (a racing request). */
  beforeCreate: null as ((data: Omit<Row, 'id' | 'createdAt'>) => void) | null,
  transactions: [] as Array<{ isolationLevel?: string }>,
  planRowsFail: false,
  sumFail: false,
  plan: new Map<string, unknown>(),
};

function insertRow(data: Omit<Row, 'id' | 'createdAt'>): Row {
  if (
    ledger.rows.some(
      (row) =>
        row.organizationId === data.organizationId && row.idempotencyKey === data.idempotencyKey,
    )
  ) {
    throw knownError('P2002');
  }
  ledger.sequence += 1;
  const row: Row = {
    ...data,
    meta: data.meta ?? null,
    id: `entry-${ledger.sequence}`,
    createdAt: new Date(1_800_000_000_000 + ledger.sequence),
  };
  ledger.rows.push(row);
  return row;
}

const usageEntry = {
  findUnique: jest.fn(
    async (args: {
      where: { organizationId_idempotencyKey: { organizationId: string; idempotencyKey: string } };
    }) => {
      const { organizationId, idempotencyKey } = args.where.organizationId_idempotencyKey;
      return (
        ledger.rows.find(
          (row) => row.organizationId === organizationId && row.idempotencyKey === idempotencyKey,
        ) ?? null
      );
    },
  ),
  findFirst: jest.fn(
    async (args: { where: Where }) => ledger.rows.find((row) => matches(row, args.where)) ?? null,
  ),
  findMany: jest.fn(async (args: { where: Where }) =>
    ledger.rows
      .filter((row) => matches(row, args.where))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  ),
  aggregate: jest.fn(async (args: { where: Where }) => {
    if (ledger.sumFail) throw new Error('connection to 10.0.0.5:5432 refused');
    const hits = ledger.rows.filter((row) => matches(row, args.where));
    return {
      _sum: { units: hits.length > 0 ? hits.reduce((sum, row) => sum + row.units, 0) : null },
    };
  }),
  create: jest.fn(async (args: { data: Omit<Row, 'id' | 'createdAt'> }) => {
    const hook = ledger.beforeCreate;
    ledger.beforeCreate = null;
    hook?.(args.data);
    return insertRow(args.data);
  }),
};

const ORG_CREATED = new Date('2026-01-05T00:00:00.000Z');

const fakePrisma = {
  usageEntry,
  $transaction: jest.fn(
    async (work: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) => {
      ledger.transactions.push(options ?? {});
      const failure = ledger.failNext.shift();
      if (failure) throw failure;
      return work({ usageEntry });
    },
  ),
  planEntitlement: {
    findMany: jest.fn(async () => {
      if (ledger.planRowsFail) throw new Error('relation PlanEntitlement is gone');
      return [...ledger.plan].map(([key, value]) => ({ tier: 'FREE', key, value }));
    }),
  },
  orgEntitlementOverride: { findMany: jest.fn(async () => []) },
  organization: {
    findUnique: jest.fn(async () => {
      if (ledger.planRowsFail) throw new Error('relation Organization is gone');
      return { createdAt: ORG_CREATED, subscription: null };
    }),
  },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return fakePrisma;
  },
}));

// ---- Building the service --------------------------------------------------------------

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const IMPORT: MeterKey = 'clips.import_minutes_per_month';
const AI: MeterKey = 'clips.ai_minutes_per_month';
const DOWNLOADS: MeterKey = 'clips.downloads_per_day';
const NOW = new Date('2026-11-19T12:00:00.000Z');

function build(plan: Record<string, unknown> = {}) {
  ledger.plan = new Map(
    Object.entries({
      [IMPORT]: 10,
      [AI]: 30,
      [DOWNLOADS]: 5,
      ...plan,
    }),
  );
  const config = { get: () => 'db' } as unknown as ConfigService<Env, true>;
  const redis = { get: async () => null } as unknown as RedisService;
  const repository = new EntitlementsRepository();
  const resolver = new EntitlementResolver(repository, redis, config);
  const usage = new UsageService(repository, resolver);
  return { usage, resolver };
}

/** The ledger sum for a workspace's meter in a window, in thousandths. */
function used(orgId: string, meter: string, cycleStart?: Date): number {
  return ledger.rows
    .filter(
      (row) =>
        row.organizationId === orgId &&
        row.meter === meter &&
        (cycleStart === undefined || row.cycleStart.getTime() === cycleStart.getTime()),
    )
    .reduce((sum, row) => sum + row.units, 0);
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected the call to be refused');
}

let quiet: jest.SpyInstance[] = [];

beforeEach(() => {
  ledger.rows = [];
  ledger.sequence = 0;
  ledger.failNext = [];
  ledger.beforeCreate = null;
  ledger.transactions = [];
  ledger.planRowsFail = false;
  ledger.sumFail = false;
  // The service logs refusals and failures; the test only reads what it answers.
  quiet = (['log', 'error', 'warn', 'debug'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
});

// ---- The charge ----------------------------------------------------------------------------

describe('a charge', () => {
  it('runs as one Serializable transaction and writes one CHARGE row in thousandths', async () => {
    const { usage } = build();
    const result = await usage.consume(ORG_A, IMPORT, 2.5, {
      idempotencyKey: 'clips.import:job-1',
      refId: 'job-1',
      now: NOW,
    });
    expect(result).toMatchObject({ duplicate: false, over: false });
    expect(result.state).toMatchObject({ used: 3, limit: 10, remaining: 7 });
    expect(ledger.transactions).toEqual([{ isolationLevel: 'Serializable', timeout: 5_000 }]);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ units: 2_500, kind: UsageKind.CHARGE, refId: 'job-1' });
  });

  it.each([
    [IMPORT, 'clips_minutes_used'],
    [AI, 'clips_ai_minutes_used'],
    [DOWNLOADS, 'clips_downloads_today'],
  ] as const)(
    'refuses a %s charge past the limit with the typed 402 %s and writes nothing',
    async (meter, code) => {
      const { usage } = build({ [meter]: 3 });
      await usage.consume(ORG_A, meter, 3, { idempotencyKey: `${meter}:first`, now: NOW });
      const refused = await failure(
        usage.consume(ORG_A, meter, 1, { idempotencyKey: `${meter}:second`, now: NOW }),
      );
      expect(refused.getStatus()).toBe(402);
      expect(refused.getResponse()).toMatchObject({
        code,
        details: { limit: 3, used: 3, needed: 1, remaining: 0 },
      });
      expect(ledger.rows).toHaveLength(1);
      expect(used(ORG_A, meter)).toBe(3_000);
    },
  );

  it('lets a charge reach the limit exactly, and not a thousandth past it', async () => {
    const { usage } = build({ [IMPORT]: 10 });
    await usage.consume(ORG_A, IMPORT, 9.999, { idempotencyKey: 'k:1', now: NOW });
    await usage.consume(ORG_A, IMPORT, 0.001, { idempotencyKey: 'k:2', now: NOW });
    expect(used(ORG_A, IMPORT)).toBe(10_000);
    expect(
      (
        await failure(usage.consume(ORG_A, IMPORT, 0.001, { idempotencyKey: 'k:3', now: NOW }))
      ).getStatus(),
    ).toBe(402);
    expect(used(ORG_A, IMPORT)).toBe(10_000);
  });

  it.each([0, -1, -0.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %p before opening a transaction, so a charge can never lower used',
    async (units) => {
      const { usage } = build();
      await expect(
        usage.consume(ORG_A, IMPORT, units, { idempotencyKey: 'k:bad', now: NOW }),
      ).rejects.toThrow(RangeError);
      expect(ledger.transactions).toEqual([]);
      expect(ledger.rows).toEqual([]);
    },
  );

  it('refuses a key that is not one of ours before opening a transaction', async () => {
    const { usage } = build();
    for (const key of ['', 'ab', 'has space', "x'; DROP TABLE", 'k'.repeat(201)]) {
      await expect(
        usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: key, now: NOW }),
      ).rejects.toThrow(RangeError);
    }
    expect(ledger.transactions).toEqual([]);
  });

  it('keeps used between zero and the limit through 400 mixed charges and refunds in two workspaces', async () => {
    const limit = 30;
    const { usage } = build({ [IMPORT]: limit });
    // A small fixed-seed generator (Park and Miller), so a failure always replays the same way.
    let seed = 20261119;
    const next = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return Math.floor((seed / 2_147_483_647) * n);
    };
    const amounts = [0.5, 1, 2.5, 4, 7.25, 12];
    const parts = new Map<string, number>();
    const seen = { refused: 0, tooLarge: 0 };

    for (let step = 0; step < 400; step += 1) {
      const org = next(2) === 0 ? ORG_A : ORG_B;
      const action = next(4);
      try {
        if (action <= 1) {
          const key = next(40);
          await usage.consume(org, IMPORT, amounts[next(amounts.length)] as number, {
            idempotencyKey: `clips.import:job-${key}`,
            refId: `job-${key % 15}`,
            now: NOW,
          });
        } else if (action === 2) {
          const charges = ledger.rows.filter(
            (row) => row.organizationId === org && row.kind === UsageKind.CHARGE,
          );
          const charge = charges[next(Math.max(1, charges.length))];
          if (charge) {
            if (next(2) === 0) {
              await usage.reverse(org, charge.id);
            } else {
              const part = (parts.get(charge.id) ?? 0) + 1;
              parts.set(charge.id, part);
              await usage.reverse(org, charge.id, { units: (1 + next(50)) / 10, part });
            }
          }
        } else {
          await usage.reverseAllFor(org, `job-${next(15)}`);
        }
      } catch (error) {
        const status = error instanceof HttpException ? error.getStatus() : 0;
        expect([400, 402]).toContain(status);
        if (status === 402) seen.refused += 1;
        if (status === 400) seen.tooLarge += 1;
      }

      for (const workspace of [ORG_A, ORG_B]) {
        const sum = used(workspace, IMPORT);
        expect(sum).toBeGreaterThanOrEqual(0);
        expect(sum).toBeLessThanOrEqual(limit * 1000);
      }
    }

    // No charge was ever given back more than it took, and no key was written twice.
    for (const charge of ledger.rows.filter((row) => row.kind === UsageKind.CHARGE)) {
      const back = ledger.rows
        .filter((row) => row.reversesId === charge.id)
        .reduce((sum, row) => sum + row.units, 0);
      expect(-back).toBeLessThanOrEqual(charge.units);
      expect(
        ledger.rows
          .filter((row) => row.reversesId === charge.id)
          .every((row) => row.organizationId === charge.organizationId),
      ).toBe(true);
    }
    const keys = ledger.rows.map((row) => `${row.organizationId}|${row.idempotencyKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The run really reached the limit, refused, refunded and refused a refund.
    expect(ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL).length).toBeGreaterThan(10);
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.tooLarge).toBeGreaterThan(0);
  });
});

// ---- Idempotency and the race ---------------------------------------------------------------

describe('the same key twice', () => {
  it('is one row: the second call answers the first one as a duplicate', async () => {
    const { usage } = build();
    const first = await usage.consume(ORG_A, IMPORT, 2, {
      idempotencyKey: 'clips.import:job-1',
      now: NOW,
    });
    const second = await usage.consume(ORG_A, IMPORT, 2, {
      idempotencyKey: 'clips.import:job-1',
      now: NOW,
    });
    expect(second).toMatchObject({ entryId: first.entryId, duplicate: true });
    expect(ledger.rows).toHaveLength(1);
    expect(used(ORG_A, IMPORT)).toBe(2_000);
  });

  it('is one row when the other request won the race (P2002 answers its row)', async () => {
    const { usage } = build();
    ledger.beforeCreate = (data) => {
      insertRow({ ...data, refId: 'the-winner' });
    };
    const answer = await usage.consume(ORG_A, IMPORT, 2, {
      idempotencyKey: 'clips.import:job-1',
      now: NOW,
    });
    expect(answer.duplicate).toBe(true);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.refId).toBe('the-winner');
    expect(answer.entryId).toBe(ledger.rows[0]?.id);
  });
});

// ---- Failing closed ----------------------------------------------------------------------------

describe('a database that says no', () => {
  it('retries a serialization failure (P2034) and charges once', async () => {
    const { usage } = build();
    ledger.failNext = [knownError('P2034'), knownError('P2034')];
    const answer = await usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:retry', now: NOW });
    expect(answer.duplicate).toBe(false);
    expect(ledger.transactions).toHaveLength(3);
    expect(ledger.rows).toHaveLength(1);
  });

  it('fails closed with 503 when P2034 keeps coming, and charges nothing', async () => {
    const { usage } = build();
    ledger.failNext = [
      knownError('P2034'),
      knownError('P2034'),
      knownError('P2034'),
      knownError('P2034'),
    ];
    const refused = await failure(
      usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:busy', now: NOW }),
    );
    expect(refused).toBeInstanceOf(ServiceUnavailableException);
    expect(refused.getResponse()).toEqual({
      message: CLIPS_ALLOWANCE_UNAVAILABLE,
      code: 'allowance_unavailable',
    });
    expect(ledger.transactions).toHaveLength(4);
    expect(ledger.rows).toEqual([]);
  });

  it('answers any other database error with the plain 503, never the database text, and charges nothing', async () => {
    const { usage } = build();
    ledger.failNext = [new Error('connection to 10.0.0.5:5432 refused, password for postgres')];
    const refused = await failure(
      usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:down', now: NOW }),
    );
    expect(refused.getStatus()).toBe(503);
    expect(JSON.stringify(refused.getResponse())).not.toMatch(
      /10\.0\.0\.5|password|postgres|connection/,
    );
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.rows).toEqual([]);
  });

  it('fails closed with 503 when the meter cannot be read, before any transaction', async () => {
    const { usage } = build();
    ledger.sumFail = true;
    const refused = await failure(
      usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:sum', now: NOW }),
    );
    expect(refused.getStatus()).toBe(503);
    expect(refused.getResponse()).toMatchObject({ code: 'allowance_unavailable' });
    expect(ledger.transactions).toEqual([]);
    expect(ledger.rows).toEqual([]);
  });

  it('fails closed with 503 when the plan cannot be read and nothing is in memory, never with a guess', async () => {
    const { usage, resolver } = build();
    ledger.planRowsFail = true;
    const refused = await failure(
      usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:plan', now: NOW }),
    );
    expect(refused.getStatus()).toBe(503);
    expect(JSON.stringify(refused.getResponse())).not.toMatch(
      /relation|PlanEntitlement|Organization/,
    );
    expect(ledger.rows).toEqual([]);
    expect((await failure(resolver.meter(ORG_A, IMPORT, NOW))).getStatus()).toBe(503);
  });
});

// ---- Workspaces --------------------------------------------------------------------------------

describe('keys are per workspace', () => {
  it("never answers another workspace's row for the same key", async () => {
    const { usage } = build();
    const mine = await usage.consume(ORG_A, IMPORT, 4, {
      idempotencyKey: 'clips.import:job-1',
      refId: 'job-1',
      now: NOW,
    });
    const theirs = await usage.consume(ORG_B, IMPORT, 1, {
      idempotencyKey: 'clips.import:job-1',
      refId: 'job-1',
      now: NOW,
    });
    expect(theirs.duplicate).toBe(false);
    expect(theirs.entryId).not.toBe(mine.entryId);
    expect(theirs.state.used).toBe(1);
    expect(used(ORG_A, IMPORT)).toBe(4_000);
    expect(used(ORG_B, IMPORT)).toBe(1_000);
  });

  it("cannot refund another workspace's charge, by entry or by job", async () => {
    const { usage } = build();
    const mine = await usage.consume(ORG_A, IMPORT, 4, {
      idempotencyKey: 'clips.import:job-1',
      refId: 'job-1',
      now: NOW,
    });
    const refused = await failure(usage.reverse(ORG_B, mine.entryId));
    expect(refused).toBeInstanceOf(NotFoundException);
    expect(refused.getResponse()).toMatchObject({ code: 'entry_not_found' });
    expect(await usage.reverseAllFor(ORG_B, 'job-1')).toBe(0);
    expect(ledger.rows).toHaveLength(1);
    expect(used(ORG_A, IMPORT)).toBe(4_000);
  });

  it("does not count another workspace's charges against this one's limit", async () => {
    const { usage } = build({ [IMPORT]: 5 });
    await usage.consume(ORG_A, IMPORT, 5, { idempotencyKey: 'k:a', now: NOW });
    await expect(
      usage.consume(ORG_B, IMPORT, 5, { idempotencyKey: 'k:b', now: NOW }),
    ).resolves.toMatchObject({ duplicate: false });
  });
});

// ---- Refunds ---------------------------------------------------------------------------------

describe('a reversal', () => {
  it('gives a charge back once: a second full refund is the same row', async () => {
    const { usage } = build();
    const charge = await usage.consume(ORG_A, IMPORT, 3, { idempotencyKey: 'k:1', now: NOW });
    const first = await usage.reverse(ORG_A, charge.entryId);
    const again = await usage.reverse(ORG_A, charge.entryId);
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ entryId: first.entryId, duplicate: true });
    expect(ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL)).toHaveLength(1);
    expect(used(ORG_A, IMPORT)).toBe(0);
  });

  it('never gives back more than was charged, in parts or at once', async () => {
    const { usage } = build();
    const charge = await usage.consume(ORG_A, IMPORT, 5, { idempotencyKey: 'k:1', now: NOW });
    const tooMuch = await failure(usage.reverse(ORG_A, charge.entryId, { units: 5.001, part: 1 }));
    expect(tooMuch).toBeInstanceOf(BadRequestException);
    expect(tooMuch.getResponse()).toMatchObject({ code: 'reversal_too_large' });

    await usage.reverse(ORG_A, charge.entryId, { units: 2, part: 1 });
    await usage.reverse(ORG_A, charge.entryId, { units: 3, part: 2 });
    expect(
      (
        await failure(usage.reverse(ORG_A, charge.entryId, { units: 0.001, part: 3 }))
      ).getResponse(),
    ).toMatchObject({ code: 'reversal_too_large' });
    // A full refund after the parts finds nothing left and writes nothing.
    await expect(usage.reverse(ORG_A, charge.entryId)).resolves.toMatchObject({ duplicate: true });
    expect(used(ORG_A, IMPORT)).toBe(0);
    expect(ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL)).toHaveLength(2);
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a refund of %p units',
    async (units) => {
      const { usage } = build();
      const charge = await usage.consume(ORG_A, IMPORT, 5, { idempotencyKey: 'k:1', now: NOW });
      await expect(usage.reverse(ORG_A, charge.entryId, { units, part: 1 })).rejects.toThrow(
        RangeError,
      );
      expect(used(ORG_A, IMPORT)).toBe(5_000);
    },
  );

  it('never reverses a reversal or an operator adjustment', async () => {
    const { usage } = build();
    const charge = await usage.consume(ORG_A, IMPORT, 5, { idempotencyKey: 'k:1', now: NOW });
    const reversal = await usage.reverse(ORG_A, charge.entryId);
    const refused = await failure(usage.reverse(ORG_A, reversal.entryId));
    expect(refused.getStatus()).toBe(400);
    expect(refused.getResponse()).toMatchObject({ code: 'reversal_not_allowed' });

    const adjustment = insertRow({
      organizationId: ORG_A,
      meter: IMPORT,
      units: 2_000,
      kind: UsageKind.ADJUSTMENT,
      idempotencyKey: 'adj:1',
      refId: null,
      reversesId: null,
      cycleStart: ledger.rows[0]?.cycleStart ?? NOW,
      meta: null,
      createdBy: 'op-1',
    });
    expect((await failure(usage.reverse(ORG_A, adjustment.id))).getResponse()).toMatchObject({
      code: 'reversal_not_allowed',
    });
    expect(used(ORG_A, IMPORT)).toBe(2_000);
  });

  it("lands in its original's window, so a refund of last month changes nothing this month", async () => {
    const { usage } = build({ [IMPORT]: 10 });
    const october = new Date('2026-10-20T12:00:00.000Z');
    const charge = await usage.consume(ORG_A, IMPORT, 10, {
      idempotencyKey: 'k:oct',
      now: october,
    });
    const novemberCharge = await usage.consume(ORG_A, IMPORT, 10, {
      idempotencyKey: 'k:nov',
      now: NOW,
    });
    await usage.reverse(ORG_A, charge.entryId);

    const octoberStart = ledger.rows.find((row) => row.id === charge.entryId)?.cycleStart as Date;
    const novemberStart = ledger.rows.find((row) => row.id === novemberCharge.entryId)
      ?.cycleStart as Date;
    expect(octoberStart.getTime()).not.toBe(novemberStart.getTime());
    expect(ledger.rows.find((row) => row.kind === UsageKind.REVERSAL)?.cycleStart).toEqual(
      octoberStart,
    );
    expect(used(ORG_A, IMPORT, novemberStart)).toBe(10_000);
    // November is still full: the old refund did not make room.
    expect(
      (
        await failure(usage.consume(ORG_A, IMPORT, 1, { idempotencyKey: 'k:nov2', now: NOW }))
      ).getStatus(),
    ).toBe(402);
  });
});

describe('a failed or cancelled job', () => {
  it('is refunded once however often the worker, the cancel route and the reconcile ask', async () => {
    const { usage } = build();
    await usage.consume(ORG_A, IMPORT, 4, {
      idempotencyKey: 'clips.import:job-9',
      refId: 'job-9',
      now: NOW,
    });
    await usage.consume(ORG_A, DOWNLOADS, 1, {
      idempotencyKey: 'clips.download:job-9',
      refId: 'job-9',
      now: NOW,
    });

    expect(await usage.reverseAllFor(ORG_A, 'job-9')).toBe(2);
    expect(await usage.reverseAllFor(ORG_A, 'job-9')).toBe(0);
    expect(await usage.reverseAllFor(ORG_A, 'job-9')).toBe(0);

    const reversals = ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL);
    expect(reversals).toHaveLength(2);
    expect(reversals.map((row) => row.idempotencyKey).sort()).toEqual(
      ledger.rows
        .filter((row) => row.kind === UsageKind.CHARGE)
        .map((row) => `rev:${row.id}`)
        .sort(),
    );
    expect(used(ORG_A, IMPORT)).toBe(0);
    expect(used(ORG_A, DOWNLOADS)).toBe(0);
  });

  it('is refunded once when two refunds race (the second one hits the key and answers the first row)', async () => {
    const { usage } = build();
    const charge = await usage.consume(ORG_A, IMPORT, 4, {
      idempotencyKey: 'clips.import:job-9',
      refId: 'job-9',
      now: NOW,
    });
    ledger.beforeCreate = (data) => {
      insertRow(data);
    };
    await expect(usage.reverse(ORG_A, charge.entryId)).resolves.toMatchObject({ duplicate: true });
    expect(ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL)).toHaveLength(1);
    expect(used(ORG_A, IMPORT)).toBe(0);
  });

  it('never throws from reverseAllFor: a database error is logged and the sweep gives it back later', async () => {
    const { usage } = build();
    await usage.consume(ORG_A, IMPORT, 4, {
      idempotencyKey: 'clips.import:job-9',
      refId: 'job-9',
      now: NOW,
    });
    ledger.failNext = [new Error('connection lost')];
    await expect(usage.reverseAllFor(ORG_A, 'job-9')).resolves.toBe(0);
    expect(ledger.rows.filter((row) => row.kind === UsageKind.REVERSAL)).toHaveLength(0);
    // The next ask (the sweep's backstop, or a retried bookkeeping call) gives it back, once.
    await expect(usage.reverseAllFor(ORG_A, 'job-9')).resolves.toBe(1);
    await expect(usage.reverseAllFor(ORG_A, 'job-9')).resolves.toBe(0);
  });
});
