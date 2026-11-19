/**
 * `UsageService.adjustWithin` (Module 19): the operator's ADJUSTMENT written
 * inside the caller's transaction, in thousandths, signed, with the dialog's
 * key and the reason in `meta`. Nothing else of the ledger is tested here.
 */
import { UsageKind } from '@postgear/db';
import type { EntitlementResolver } from './entitlement-resolver';
import type { EntitlementsRepository } from './entitlements.repository';
import { UsageService } from './usage.service';

function build() {
  const repository = {
    insert: jest.fn(async (_client: unknown, data: unknown) => ({
      id: 'entry-1',
      ...(data as object),
    })),
  };
  const service = new UsageService(
    repository as unknown as EntitlementsRepository,
    {} as unknown as EntitlementResolver,
  );
  return { service, repository };
}

const options = {
  reason: 'Gave back minutes after the outage.',
  actorId: 'op-1',
  idempotencyKey: 'adj:0b1c2d3e-4f50',
  cycleStart: new Date('2026-11-01T00:00:00.000Z'),
};

describe('UsageService.adjustWithin', () => {
  it('writes one ADJUSTMENT through the caller transaction, in thousandths', async () => {
    const { service, repository } = build();
    const tx = { usageEntry: {} };
    await service.adjustWithin(tx as never, 'org-1', 'clips.ai_minutes_per_month', 10, options);
    expect(repository.insert).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      meter: 'clips.ai_minutes_per_month',
      units: 10_000,
      kind: UsageKind.ADJUSTMENT,
      idempotencyKey: 'adj:0b1c2d3e-4f50',
      refId: null,
      reversesId: null,
      cycleStart: options.cycleStart,
      meta: { reason: 'Gave back minutes after the outage.' },
      createdBy: 'op-1',
    });
  });

  it('gives minutes back with a negative amount', async () => {
    const { service, repository } = build();
    await service.adjustWithin(
      { usageEntry: {} } as never,
      'org-1',
      'clips.ai_minutes_per_month',
      -2.5,
      options,
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ units: -2_500 }),
    );
  });

  it('refuses zero, a setting that is not a meter, and a key that is not a ledger key', async () => {
    const { service, repository } = build();
    await expect(
      service.adjustWithin(
        { usageEntry: {} } as never,
        'org-1',
        'clips.ai_minutes_per_month',
        0,
        options,
      ),
    ).rejects.toThrow();
    await expect(
      service.adjustWithin(
        { usageEntry: {} } as never,
        'org-1',
        'clips.storage_gb' as never,
        5,
        options,
      ),
    ).rejects.toThrow();
    await expect(
      service.adjustWithin({ usageEntry: {} } as never, 'org-1', 'clips.ai_minutes_per_month', 5, {
        ...options,
        idempotencyKey: 'has spaces',
      }),
    ).rejects.toThrow();
    expect(repository.insert).not.toHaveBeenCalled();
  });
});
