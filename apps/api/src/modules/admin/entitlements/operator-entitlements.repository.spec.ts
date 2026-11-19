/**
 * The operator's writes and their Change Log rows (Module 19 section 8,
 * "Order of writes"): a plan save is one transaction with one change row a
 * cell, a stale `updatedAt` ends it with `StaleWrite`, an adjustment writes
 * the ledger row and its change row together, and the Change Log is only
 * ever inserted into.
 */
import { Prisma } from '@postgear/db';
import {
  AdjustBelowZeroError,
  OperatorEntitlementsRepository,
  StaleWrite,
} from './operator-entitlements.repository';

const actor = { id: 'op-1', email: 'demo@postgear.local' };
const SAVED_AT = new Date('2026-11-01T10:00:00.000Z');

interface Row {
  value: unknown;
  updatedAt: Date;
}

/** A fake transaction client over in-memory plan rows; every write is listed. */
function fakeDb(plans: Map<string, Row>) {
  const writes: Array<{ table: string; op: string; data: unknown }> = [];
  let transactions = 0;
  const tx = {
    planEntitlement: {
      findUnique: jest.fn(
        async ({ where }: { where: { tier_key: { tier: string; key: string } } }) => {
          const row = plans.get(`${where.tier_key.tier}|${where.tier_key.key}`);
          return row ? { ...row } : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: { tier: string; key: string } }) => {
        writes.push({ table: 'planEntitlement', op: 'create', data });
        return data;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { tier: string; key: string; updatedAt: Date };
          data: unknown;
        }) => {
          const row = plans.get(`${where.tier}|${where.key}`);
          if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
          writes.push({ table: 'planEntitlement', op: 'update', data });
          return { count: 1 };
        },
      ),
    },
    entitlementChange: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        writes.push({ table: 'entitlementChange', op: 'create', data });
        return { id: `change-${writes.length}` };
      }),
    },
    usageEntry: {
      findUnique: jest.fn(async (): Promise<unknown> => null),
      aggregate: jest.fn(async () => ({ _sum: { units: 12_000 } })),
    },
  };
  const $transaction = jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
    transactions += 1;
    return fn(tx);
  });
  return { tx, $transaction, writes, transactions: () => transactions };
}

let db: ReturnType<typeof fakeDb>;
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    $transaction: (...args: unknown[]) =>
      (db.$transaction as (...a: unknown[]) => unknown)(...args),
  },
}));

describe('OperatorEntitlementsRepository', () => {
  const repository = new OperatorEntitlementsRepository();

  it('saves every cell in one transaction with one Change Log row per cell', async () => {
    db = fakeDb(
      new Map([
        ['PRO|clips.storage_gb', { value: 50, updatedAt: SAVED_AT }],
        ['FREE|clips.storage_gb', { value: 3, updatedAt: SAVED_AT }],
      ]),
    );
    const written = await repository.savePlanCells(
      [
        { tier: 'PRO', key: 'clips.storage_gb', value: 60, expected: SAVED_AT, action: 'SET' },
        { tier: 'FREE', key: 'clips.storage_gb', value: 4, expected: SAVED_AT, action: 'SET' },
        { tier: 'TEAM', key: 'clips.retention_days', value: 45, expected: null, action: 'SET' },
      ],
      'Raising storage for the launch.',
      actor,
    );

    expect(db.transactions()).toBe(1);
    expect(written).toHaveLength(3);
    const changes = db.writes.filter((write) => write.table === 'entitlementChange');
    expect(changes).toHaveLength(3);
    expect(changes[0]?.data).toMatchObject({
      scope: 'PLAN',
      tier: 'PRO',
      key: 'clips.storage_gb',
      action: 'SET',
      oldValue: 50,
      newValue: 60,
      actorId: 'op-1',
      actorEmail: 'demo@postgear.local',
      reason: 'Raising storage for the launch.',
    });
    // A row that did not exist: no old value (SQL NULL), told apart from unlimited.
    expect(changes[2]?.data).toMatchObject({ tier: 'TEAM', oldValue: Prisma.DbNull, newValue: 45 });
    expect(written[2]?.oldMissing).toBe(true);
  });

  it('ends the save with StaleWrite when a row moved since the screen read it', async () => {
    db = fakeDb(
      new Map([['PRO|clips.storage_gb', { value: 55, updatedAt: new Date('2026-11-02') }]]),
    );
    await expect(
      repository.savePlanCells(
        [{ tier: 'PRO', key: 'clips.storage_gb', value: 60, expected: SAVED_AT, action: 'SET' }],
        'Raising storage for the launch.',
        actor,
      ),
    ).rejects.toBeInstanceOf(StaleWrite);
    expect(db.writes).toHaveLength(0);
  });

  it('ends the save with StaleWrite when a row appeared that the screen never saw', async () => {
    db = fakeDb(new Map([['PRO|clips.storage_gb', { value: 55, updatedAt: SAVED_AT }]]));
    await expect(
      repository.savePlanCells(
        [{ tier: 'PRO', key: 'clips.storage_gb', value: 60, expected: null, action: 'SET' }],
        'Raising storage for the launch.',
        actor,
      ),
    ).rejects.toBeInstanceOf(StaleWrite);
  });

  it('writes no row and no record for a cell already at that value', async () => {
    db = fakeDb(new Map([['PRO|clips.storage_gb', { value: 50, updatedAt: SAVED_AT }]]));
    const written = await repository.savePlanCells(
      [{ tier: 'PRO', key: 'clips.storage_gb', value: 50, expected: SAVED_AT, action: 'SET' }],
      'Raising storage for the launch.',
      actor,
    );
    expect(written).toEqual([]);
    expect(db.writes).toHaveLength(0);
  });

  it('stores unlimited as a JSON null, never as a missing value', async () => {
    db = fakeDb(
      new Map([['ULTIMATE|clips.ai_minutes_per_month', { value: 5000, updatedAt: SAVED_AT }]]),
    );
    await repository.savePlanCells(
      [
        {
          tier: 'ULTIMATE',
          key: 'clips.ai_minutes_per_month',
          value: null,
          expected: SAVED_AT,
          action: 'SET',
        },
      ],
      'Ultimate gets unlimited AI.',
      actor,
    );
    const change = db.writes.find((write) => write.table === 'entitlementChange');
    expect(change?.data).toMatchObject({ oldValue: 5000, newValue: Prisma.JsonNull });
  });

  it('writes the ledger row and its Change Log row in one transaction', async () => {
    db = fakeDb(new Map());
    const insert = jest.fn(async () => ({ id: 'entry-1', units: 10_000 }) as never);
    const change = await repository.adjust(
      {
        orgId: 'org-1',
        meter: 'clips.ai_minutes_per_month',
        cycleStart: SAVED_AT,
        idempotencyKey: 'adj:abcdef12',
      },
      insert,
      'Gave back minutes after the outage.',
      actor,
    );
    expect(db.transactions()).toBe(1);
    expect(insert).toHaveBeenCalledWith(db.tx);
    expect(change).toMatchObject({ key: 'clips.ai_minutes_per_month', oldValue: 12, newValue: 22 });
    const changes = db.writes.filter((write) => write.table === 'entitlementChange');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.data).toMatchObject({
      scope: 'USAGE',
      action: 'ADJUST_USAGE',
      organizationId: 'org-1',
    });
  });

  it('refuses an adjustment that would take used below zero, writing no Change Log row', async () => {
    db = fakeDb(new Map());
    // 12 minutes used; taking 13 back would leave -1.
    const insert = jest.fn(async () => ({ id: 'entry-1', units: -13_000 }) as never);
    await expect(
      repository.adjust(
        {
          orgId: 'org-1',
          meter: 'clips.ai_minutes_per_month',
          cycleStart: SAVED_AT,
          idempotencyKey: 'adj:abcdef12',
        },
        insert,
        'Took back minutes by mistake.',
        actor,
      ),
    ).rejects.toBeInstanceOf(AdjustBelowZeroError);
    expect(db.writes.filter((write) => write.table === 'entitlementChange')).toHaveLength(0);
  });

  it('allows an adjustment that lands exactly on zero', async () => {
    db = fakeDb(new Map());
    const insert = jest.fn(async () => ({ id: 'entry-1', units: -12_000 }) as never);
    const change = await repository.adjust(
      {
        orgId: 'org-1',
        meter: 'clips.ai_minutes_per_month',
        cycleStart: SAVED_AT,
        idempotencyKey: 'adj:abcdef12',
      },
      insert,
      'Gave back every minute after the outage.',
      actor,
    );
    expect(change).toMatchObject({ oldValue: 12, newValue: 0 });
  });

  it('writes nothing for an adjustment whose key was already used', async () => {
    db = fakeDb(new Map());
    db.tx.usageEntry.findUnique.mockResolvedValueOnce({ id: 'entry-0' });
    const insert = jest.fn();
    const change = await repository.adjust(
      {
        orgId: 'org-1',
        meter: 'clips.ai_minutes_per_month',
        cycleStart: SAVED_AT,
        idempotencyKey: 'adj:abcdef12',
      },
      insert,
      'Gave back minutes after the outage.',
      actor,
    );
    expect(change).toBeNull();
    expect(insert).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it('never updates or deletes a Change Log row', () => {
    const source = OperatorEntitlementsRepository.toString();
    expect(source).not.toMatch(/entitlementChange\.(update|delete|upsert)/);
  });
});
