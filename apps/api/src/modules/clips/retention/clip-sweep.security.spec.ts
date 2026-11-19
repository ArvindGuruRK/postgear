/**
 * Security sweep (Sprint 12, Module 20 section 1), the parts of the cleanup
 * sweep that guard the Meters and Limits lines:
 *
 * - **Meters**: a failed or cancelled job is refunded even when its own
 *   refund did not land. `reverseAllFor` only logs a database error, and the
 *   cancel route and the reconcile never call it again, so before this sweep
 *   the backstop only knew charges whose job never existed: a FAILED or
 *   CANCELLED job's charge stayed for ever. The query is raw SQL, so this
 *   test reads its text; the same SQL was run once against the local
 *   Postgres to check it parses and plans (see the Module 20 checklist).
 * - **Limits**: a downgrade below current use deletes nothing. A whole pass
 *   over a workspace that is over its lowered space and whose retention
 *   just dropped writes the notice rows, rings the bell and holds the date,
 *   and removes no video, no file and no row.
 */
import type { PrivateStorage } from '@postgear/storage';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { RedisService } from '../../redis/redis.service';
import { BYTES_PER_GB } from '../clips.units';
import { DAY_MS, NOTICE_BEFORE_MS } from './clip-retention.rules';
import type { ClipRetentionService } from './clip-retention.service';
import { ClipSweepService } from './clip-sweep.service';

const ORG = 'seed-demo-org';
const VIDEO = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-19T12:00:00.000Z');

type Raw = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const raw: {
  calls: Array<{ sql: string; values: unknown[] }>;
  answer: (sql: string) => unknown[];
} = {
  calls: [],
  answer: () => [],
};

const fakePrisma = {
  clipVideo: {
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
  },
  clipAsset: {
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    groupBy: jest.fn(async (): Promise<unknown[]> => []),
  },
  clipJob: { count: jest.fn(async () => 0), findMany: jest.fn(async (): Promise<unknown[]> => []) },
  clipStorageNotice: {
    deleteMany: jest.fn(async () => ({ count: 0 })),
    upsert: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  orgEntitlementOverride: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
  entitlementChange: {
    findFirst: jest.fn(async (): Promise<unknown> => null),
    create: jest.fn(async () => ({})),
  },
  $transaction: jest.fn(
    async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(fakePrisma),
  ),
  $queryRaw: jest.fn((async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    raw.calls.push({ sql, values });
    return raw.answer(sql);
  }) as Raw),
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return fakePrisma;
  },
}));

function build(plan: { storageGb: number; retentionDays: number }) {
  const retention = {
    retentionDays: jest.fn(async () => plan.retentionDays),
    removeVideo: jest.fn(async () => null),
    deleteFiles: jest.fn(async () => undefined),
  };
  const resolver = { get: jest.fn(async (): Promise<unknown> => plan.storageGb) };
  const usage = { reverse: jest.fn(async () => ({ entryId: 'rev-1', duplicate: false })) };
  const notifications = { notify: jest.fn(async () => ({})) };
  const redis = { setIfAbsent: jest.fn(async () => false), set: jest.fn(async () => undefined) };
  const storage = {
    deletePrefix: jest.fn(async () => 0),
    delete: jest.fn(async () => undefined),
    abortUpload: jest.fn(async () => undefined),
    list: jest.fn(async (): Promise<unknown> => ({ objects: [], next: null })),
  };
  const service = new ClipSweepService(
    retention as unknown as ClipRetentionService,
    resolver as unknown as EntitlementResolver,
    usage as unknown as UsageService,
    notifications as unknown as NotificationsService,
    redis as unknown as RedisService,
    storage as unknown as PrivateStorage,
  );
  return { service, retention, usage, notifications, storage };
}

/** The SQL text with its whitespace folded, so a reformat does not fail the test. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

beforeEach(() => {
  jest.clearAllMocks();
  raw.calls = [];
  raw.answer = () => [];
});

describe('the charge backstop (Meters: a failed or cancelled job is refunded once)', () => {
  it('owes back a charge whose job never existed or ended FAILED or CANCELLED, and nothing else', async () => {
    const { service } = build({ storageGb: 3, retentionDays: 7 });
    await service.chargeBackstop(NOW);

    const backstop = raw.calls.find((call) => flat(call.sql).includes('FROM "UsageEntry" u'));
    expect(backstop).toBeDefined();
    const sql = flat(backstop?.sql ?? '');
    // A job that is still open or is DONE keeps its charge: only those rows stop the refund.
    expect(sql).toContain(
      `NOT EXISTS (SELECT 1 FROM "ClipJob" j WHERE j.id = u."refId" AND j.status NOT IN ('FAILED', 'CANCELLED'))`,
    );
    // Only charges, of the job meters, with no refund yet, at least an hour old.
    expect(sql).toContain(`u.kind = 'CHARGE'`);
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "UsageEntry" r WHERE r."reversesId" = u.id)');
    expect(backstop?.values).toEqual(
      expect.arrayContaining([
        'clips.import_minutes_per_month',
        'clips.ai_minutes_per_month',
        'clips.downloads_per_day',
        new Date(NOW.getTime() - 60 * 60_000),
      ]),
    );
  });

  it('gives each one back through the ledger, so a race with a late refund is one row', async () => {
    raw.answer = (sql) =>
      flat(sql).includes('FROM "UsageEntry" u')
        ? [
            { id: 'charge-of-a-failed-job', organizationId: ORG },
            { id: 'charge-already-refunded-by-a-late-call', organizationId: 'other-org' },
          ]
        : [];
    const { service, usage } = build({ storageGb: 3, retentionDays: 7 });
    usage.reverse
      .mockResolvedValueOnce({ entryId: 'rev-1', duplicate: false })
      .mockResolvedValueOnce({ entryId: 'rev-2', duplicate: true });

    expect(await service.chargeBackstop(NOW)).toBe(1);
    // Full refunds keyed by entry (`rev:<entryId>`), each in its own workspace.
    expect(usage.reverse.mock.calls).toEqual([
      [ORG, 'charge-of-a-failed-job'],
      ['other-org', 'charge-already-refunded-by-a-late-call'],
    ]);
  });
});

describe('a downgrade below current use (Limits: nothing is deleted)', () => {
  it('a whole pass over a workspace past its lowered space and retention removes nothing', async () => {
    // 9 GB stored, the plan now allows 3 GB and keeps videos 1 day instead of 30.
    fakePrisma.clipAsset.groupBy.mockResolvedValue([
      { organizationId: ORG, _sum: { bytes: BigInt(9 * BYTES_PER_GB) } },
    ]);
    // The one video the notice query picks: its date (set under the old plan) is two days out, no notice yet.
    const expiresAt = new Date(NOW.getTime() + 2 * DAY_MS);
    fakePrisma.clipVideo.findMany.mockResolvedValueOnce([
      {
        id: VIDEO,
        organizationId: ORG,
        title: 'A Talk',
        lastUsedAt: new Date(NOW.getTime() - 28 * DAY_MS),
        expiresAt,
        expiryNoticeAt: null,
      },
    ]);
    const { service, retention, notifications, storage } = build({
      storageGb: 3,
      retentionDays: 1,
    });

    const answer = await service.sweep({ now: NOW, daily: true });

    expect(answer.failedParts).toEqual([]);
    expect(answer.expired).toBe(0);
    expect(answer.storageNotices).toBe(1);
    // Nothing removed: no video, no row, no file.
    expect(retention.removeVideo).not.toHaveBeenCalled();
    expect(retention.deleteFiles).not.toHaveBeenCalled();
    expect(fakePrisma.clipAsset.deleteMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.deletePrefix).not.toHaveBeenCalled();
    // The video got its notice and keeps at least three more days.
    const held = fakePrisma.clipVideo.updateMany.mock.calls
      .map((call) => (call[0] as { data: { expiresAt?: Date } }).data.expiresAt)
      .find((date) => date !== undefined);
    expect(held?.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + NOTICE_BEFORE_MS);
    // The workspace is told, with both numbers, and asked to delete or upgrade itself.
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clip_storage_over_limit',
        content:
          "Your videos use 9 GB, over your plan's 3 GB. Delete some, or upgrade, to bring in more.",
      }),
    );
  });
});
