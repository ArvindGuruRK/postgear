/**
 * The operator's plans, overrides, usage and Change Log (Module 19 section 8):
 * values checked by the registry before anything is written, the conflict
 * sentence on a stale screen, the stamps and the record after the commit, an
 * override's end date and its 366 day cap, an expired override no longer
 * applying, adjustments writing both rows once, and the Change Log's words.
 */
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@postgear/db';
import { type Key, resolve } from '@postgear/entitlements';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { OperatorAuditService } from '../operator-audit.service';
import {
  AdjustBelowZeroError,
  type OperatorEntitlementsRepository,
  StaleWrite,
  type WorkspaceRow,
  type WrittenChange,
} from './operator-entitlements.repository';
import {
  adjustUsageSchema,
  changesQuerySchema,
  putOverrideSchema,
  savePlansSchema,
} from './operator-entitlements.schema';
import { OperatorEntitlementsService } from './operator-entitlements.service';

const actor = { id: 'op-1', email: 'demo@postgear.local' };
const ORG = 'seed-demo-org';
const SAVED_AT = '2026-11-01T10:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const REASON = 'Raising storage for the launch.';

const workspace: WorkspaceRow = {
  id: ORG,
  name: 'Demo Workspace',
  createdAt: new Date('2026-01-01'),
  subscription: null,
  adminEmail: 'demo@postgear.local',
  members: 3,
};

function change(over: Partial<WrittenChange> = {}): WrittenChange {
  return {
    id: 'change-1',
    tier: 'PRO',
    organizationId: null,
    key: 'clips.storage_gb',
    action: 'SET',
    oldValue: 50,
    oldMissing: false,
    newValue: 60,
    ...over,
  };
}

function build() {
  const repository = {
    planRows: jest.fn(async () => []),
    endingOverrides: jest.fn(async () => []),
    savePlanCells: jest.fn(async (): Promise<WrittenChange[]> => [change()]),
    workspace: jest.fn(async (): Promise<WorkspaceRow | null> => workspace),
    overrides: jest.fn(async (): Promise<unknown[]> => []),
    emailsOf: jest.fn(async () => new Map([['op-1', 'demo@postgear.local']])),
    putOverride: jest.fn(async () =>
      change({
        tier: null,
        organizationId: ORG,
        key: 'clips.ai_minutes_per_month',
        oldMissing: true,
        oldValue: null,
        newValue: 100,
      }),
    ),
    removeOverride: jest.fn(
      async (): Promise<WrittenChange | null> =>
        change({
          tier: null,
          organizationId: ORG,
          action: 'REMOVE',
          oldValue: 100,
          newValue: null,
        }),
    ),
    entries: jest.fn(async () => []),
    adjust: jest.fn(
      async (_target: unknown, _insert: unknown): Promise<WrittenChange | null> =>
        change({
          tier: null,
          organizationId: ORG,
          key: 'clips.ai_minutes_per_month',
          action: 'ADJUST_USAGE',
          oldValue: 12,
          newValue: 22,
        }),
    ),
    changes: jest.fn(async (): Promise<unknown[]> => []),
  };
  const resolver = {
    invalidatePlans: jest.fn(async () => undefined),
    invalidateOrg: jest.fn(async () => undefined),
    context: jest.fn(async () => ({ planValues: new Map(), overrides: new Map() })),
    meter: jest.fn(async () => ({
      used: 0,
      limit: 30,
      remaining: 30,
      cycleStart: new Date('2026-11-01'),
      cycleEnd: new Date('2026-12-01'),
    })),
    windowFor: jest.fn(async () => ({
      start: new Date('2026-11-01'),
      end: new Date('2026-12-01'),
    })),
  };
  const usage = { adjustWithin: jest.fn(async () => ({ id: 'entry-1', units: 10_000 })) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new OperatorEntitlementsService(
    repository as unknown as OperatorEntitlementsRepository,
    resolver as unknown as EntitlementResolver,
    usage as unknown as UsageService,
    audit as unknown as OperatorAuditService,
  );
  return { service, repository, resolver, usage, audit };
}

describe('OperatorEntitlementsService plans', () => {
  it('saves, then sets the plans stamp and records "Clips Storage, Pro: 50 GB to 60 GB"', async () => {
    const { service, repository, resolver, audit } = build();
    const result = await service.savePlans(
      savePlansSchema.parse({
        cells: [{ tier: 'PRO', key: 'clips.storage_gb', value: 60, updatedAt: SAVED_AT }],
        reason: REASON,
      }),
      actor,
    );
    expect(result.saved).toBe(1);
    expect(repository.savePlanCells).toHaveBeenCalledWith(
      [
        {
          tier: 'PRO',
          key: 'clips.storage_gb',
          value: 60,
          expected: new Date(SAVED_AT),
          action: 'SET',
        },
      ],
      REASON,
      actor,
    );
    expect(resolver.invalidatePlans).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        action: 'plans.saved',
        lines: ['Clips Storage, Pro: 50 GB to 60 GB'],
        reason: REASON,
      }),
    );
  });

  it('refuses a value the registry refuses with its sentence, and writes nothing', async () => {
    const { service, repository } = build();
    const input = savePlansSchema.parse({
      cells: [{ tier: 'PRO', key: 'clips.max_video_minutes', value: 5000, updatedAt: SAVED_AT }],
      reason: REASON,
    });
    await expect(service.savePlans(input, actor)).rejects.toMatchObject({
      response: { message: 'Enter a whole number from 1 to 1,440.', code: 'invalid_value' },
    });
    expect(repository.savePlanCells).not.toHaveBeenCalled();
  });

  it('refuses 4K, which is reserved', async () => {
    const { service } = build();
    const input = savePlansSchema.parse({
      cells: [
        { tier: 'ULTIMATE', key: 'clips.export_max_quality', value: '4k', updatedAt: SAVED_AT },
      ],
      reason: REASON,
    });
    await expect(service.savePlans(input, actor)).rejects.toMatchObject({
      response: { message: '4K is reserved and cannot be saved yet.' },
    });
  });

  it('answers 409 with the conflict sentence on a stale screen, and stamps nothing', async () => {
    const { service, repository, resolver, audit } = build();
    repository.savePlanCells.mockRejectedValueOnce(new StaleWrite());
    const error = await service
      .savePlans(
        savePlansSchema.parse({
          cells: [{ tier: 'PRO', key: 'clips.storage_gb', value: 60, updatedAt: SAVED_AT }],
          reason: REASON,
        }),
        actor,
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      message:
        'Someone else changed these values while you were editing. Reload to see them, then edit again.',
      code: 'operator_conflict',
    });
    expect(resolver.invalidatePlans).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('resets a cell to its seed value', async () => {
    const { service, repository } = build();
    await service.savePlans(
      savePlansSchema.parse({
        cells: [{ tier: 'FREE', key: 'clips.storage_gb', reset: true, updatedAt: SAVED_AT }],
        reason: REASON,
      }),
      actor,
    );
    expect(repository.savePlanCells).toHaveBeenCalledWith(
      [expect.objectContaining({ tier: 'FREE', value: 3, action: 'RESET_TO_SEED' })],
      REASON,
      actor,
    );
  });

  it('needs a reason of at least 10 characters, and refuses the same cell twice', () => {
    const cell = { tier: 'PRO', key: 'clips.storage_gb', value: 60, updatedAt: SAVED_AT };
    expect(savePlansSchema.safeParse({ cells: [cell], reason: 'short' }).success).toBe(false);
    expect(savePlansSchema.safeParse({ cells: [cell, cell], reason: REASON }).success).toBe(false);
    expect(savePlansSchema.safeParse({ cells: [cell], reason: REASON, extra: 1 }).success).toBe(
      false,
    );
  });

  it('shows every key and tier, the seed beside each, and marks a stored value that no longer validates', async () => {
    const { service, repository } = build();
    repository.planRows.mockResolvedValueOnce([
      { tier: 'PRO', key: 'clips.storage_gb', value: 60, updatedAt: new Date(SAVED_AT) },
      {
        tier: 'FREE',
        key: 'clips.max_video_minutes',
        value: 'lots',
        updatedAt: new Date(SAVED_AT),
      },
    ] as never);
    const view = await service.plans();
    expect(view.tiers).toEqual(['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE']);
    const pro = view.cells.find((cell) => cell.tier === 'PRO' && cell.key === 'clips.storage_gb');
    expect(pro).toMatchObject({ value: 60, seed: 50, valid: true });
    const bad = view.cells.find(
      (cell) => cell.tier === 'FREE' && cell.key === 'clips.max_video_minutes',
    );
    expect(bad?.valid).toBe(false);
  });
});

describe('OperatorEntitlementsService overrides', () => {
  const inAWeek = () => new Date(Date.now() + 7 * DAY).toISOString();

  it('needs an end date and a reason (the body refuses either missing)', () => {
    expect(
      putOverrideSchema.safeParse({ value: 100, reason: REASON, updatedAt: null }).success,
    ).toBe(false);
    expect(
      putOverrideSchema.safeParse({
        value: 100,
        expiresAt: inAWeek(),
        reason: 'no',
        updatedAt: null,
      }).success,
    ).toBe(false);
  });

  it('refuses an end date more than 366 days ahead', async () => {
    const { service, repository } = build();
    const input = putOverrideSchema.parse({
      value: 100,
      expiresAt: new Date(Date.now() + 400 * DAY).toISOString(),
      reason: REASON,
      updatedAt: null,
    });
    await expect(
      service.putOverride(ORG, 'clips.ai_minutes_per_month', input, actor),
    ).rejects.toMatchObject({
      response: { message: 'Pick a date at most 366 days from today.', code: 'invalid_end_date' },
    });
    expect(repository.putOverride).not.toHaveBeenCalled();
  });

  it('saves one, sets that workspace stamp only, and records it', async () => {
    const { service, repository, resolver, audit } = build();
    const input = putOverrideSchema.parse({
      value: 100,
      expiresAt: inAWeek(),
      reason: REASON,
      updatedAt: null,
    });
    await service.putOverride(ORG, 'clips.ai_minutes_per_month', input, actor);
    expect(repository.putOverride).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ key: 'clips.ai_minutes_per_month', value: 100, expected: null }),
      REASON,
      actor,
    );
    expect(resolver.invalidateOrg).toHaveBeenCalledWith(ORG);
    expect(resolver.invalidatePlans).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'overrides.saved' }),
    );
  });

  it('answers 404 for a workspace that is not there, whatever cookie came with it', async () => {
    const { service, repository } = build();
    repository.workspace.mockResolvedValueOnce(null);
    const input = putOverrideSchema.parse({
      value: 100,
      expiresAt: inAWeek(),
      reason: REASON,
      updatedAt: null,
    });
    await expect(
      service.putOverride('org-gone', 'clips.ai_minutes_per_month', input, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes one with the conflict check, and 404s an unknown setting', async () => {
    const { service, repository } = build();
    await service.removeOverride(
      ORG,
      'clips.ai_minutes_per_month',
      { reason: REASON, updatedAt: SAVED_AT },
      actor,
    );
    expect(repository.removeOverride).toHaveBeenCalledWith(
      ORG,
      'clips.ai_minutes_per_month',
      new Date(SAVED_AT),
      REASON,
      actor,
    );
    await expect(
      service.removeOverride(ORG, 'clips.nope', { reason: REASON, updatedAt: SAVED_AT }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops applying an override after its end date: the plan value applies again', async () => {
    const { service, repository, resolver } = build();
    const ended = new Date(Date.now() - DAY);
    resolver.context.mockResolvedValueOnce({
      planValues: new Map<Key, unknown>([['clips.ai_minutes_per_month', 30]]),
      overrides: new Map([['clips.ai_minutes_per_month', { value: 100, expiresAt: ended }]]),
    } as never);
    repository.overrides.mockResolvedValueOnce([
      {
        key: 'clips.ai_minutes_per_month',
        value: 100,
        reason: REASON,
        expiresAt: ended,
        createdBy: 'op-1',
        createdAt: new Date(SAVED_AT),
        updatedAt: new Date(SAVED_AT),
      },
    ]);
    const view = await service.workspaceEntitlements(ORG);
    const ai = view.values.find((value) => value.key === 'clips.ai_minutes_per_month');
    expect(ai).toMatchObject({ value: 30, source: 'plan' });
    expect(view.overrides[0]).toMatchObject({ active: false, createdBy: 'demo@postgear.local' });
    // The same rule, straight from the shared resolve.
    expect(
      resolve('clips.ai_minutes_per_month', {
        override: { value: 100, expiresAt: ended },
        planValue: 30,
        now: new Date(),
      }).value,
    ).toBe(30);
  });
});

describe('OperatorEntitlementsService usage', () => {
  const body = () =>
    adjustUsageSchema.parse({
      meter: 'clips.ai_minutes_per_month',
      units: 10,
      reason: 'Gave back minutes after the outage.',
      idempotencyKey: 'adj:0b1c2d3e-4f50',
    });

  it('writes the ledger row through the usage service and its Change Log row, then records it', async () => {
    const { service, repository, usage, resolver, audit } = build();
    repository.adjust.mockImplementationOnce(async (_target: unknown, insert: unknown) => {
      await (insert as (tx: unknown) => Promise<unknown>)('tx');
      return change({
        tier: null,
        organizationId: ORG,
        key: 'clips.ai_minutes_per_month',
        action: 'ADJUST_USAGE',
        oldValue: 12,
        newValue: 22,
      });
    });
    const result = await service.adjustUsage(ORG, body(), actor);
    expect(result.duplicate).toBe(false);
    expect(usage.adjustWithin).toHaveBeenCalledWith('tx', ORG, 'clips.ai_minutes_per_month', 10, {
      reason: 'Gave back minutes after the outage.',
      actorId: 'op-1',
      idempotencyKey: 'adj:0b1c2d3e-4f50',
      cycleStart: new Date('2026-11-01'),
    });
    expect(resolver.invalidateOrg).toHaveBeenCalledWith(ORG);
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: 'usage.adjusted' }),
    );
  });

  it('answers duplicate and records nothing for a second click of the same dialog', async () => {
    const { service, repository, audit } = build();
    repository.adjust.mockResolvedValueOnce(null);
    expect((await service.adjustUsage(ORG, body(), actor)).duplicate).toBe(true);
    repository.adjust.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    expect((await service.adjustUsage(ORG, body(), actor)).duplicate).toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 422 usage_below_zero when the adjustment would take used below zero', async () => {
    const { service, repository, audit, resolver } = build();
    repository.adjust.mockRejectedValueOnce(new AdjustBelowZeroError());
    await expect(service.adjustUsage(ORG, body(), actor)).rejects.toMatchObject({
      status: 422,
      response: { code: 'usage_below_zero' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(resolver.invalidateOrg).not.toHaveBeenCalled();
  });

  it('refuses a setting that is not a meter, zero units and a key the dialog did not make', () => {
    expect(adjustUsageSchema.safeParse({ ...body(), meter: 'clips.storage_gb' }).success).toBe(
      false,
    );
    expect(adjustUsageSchema.safeParse({ ...body(), units: 0 }).success).toBe(false);
    expect(adjustUsageSchema.safeParse({ ...body(), idempotencyKey: 'mine' }).success).toBe(false);
  });
});

describe('OperatorEntitlementsService change log', () => {
  it('reads values in words, "Unlimited" for a stored null and nothing for a missing one', async () => {
    const { service, repository } = build();
    repository.changes.mockResolvedValueOnce([
      {
        id: 'c1',
        createdAt: new Date(SAVED_AT),
        scope: 'PLAN',
        tier: 'ULTIMATE',
        organizationId: null,
        organizationName: null,
        key: 'clips.ai_minutes_per_month',
        action: 'SET',
        oldValue: null,
        newValue: 5000,
        oldMissing: true,
        newMissing: false,
        reason: 'Seed',
        actorEmail: null,
      },
      {
        id: 'c2',
        createdAt: new Date(SAVED_AT),
        scope: 'PLAN',
        tier: 'ULTIMATE',
        organizationId: null,
        organizationName: null,
        key: 'clips.ai_minutes_per_month',
        action: 'SET',
        oldValue: 5000,
        newValue: null,
        oldMissing: false,
        newMissing: false,
        reason: REASON,
        actorEmail: 'demo@postgear.local',
      },
    ]);
    const page = await service.changes(changesQuerySchema.parse({}));
    expect(page.changes[0]).toMatchObject({ old: null, new: '5,000 minutes', label: 'AI Minutes' });
    expect(page.changes[1]).toMatchObject({ old: '5,000 minutes', new: 'Unlimited' });
    expect(page.hasMore).toBe(false);
  });

  it('passes the filters through and pages by 50', async () => {
    const { service, repository } = build();
    await service.changes(
      changesQuerySchema.parse({
        scope: 'ORG',
        key: 'clips.storage_gb',
        orgId: ORG,
        actor: 'demo',
        page: '2',
      }),
    );
    expect(repository.changes).toHaveBeenCalledWith({
      scope: 'ORG',
      key: 'clips.storage_gb',
      orgId: ORG,
      actor: 'demo',
      limit: 51,
      offset: 50,
    });
  });

  it('is append only: the service has no way to edit or delete a change', () => {
    const methods = Object.getOwnPropertyNames(OperatorEntitlementsService.prototype);
    expect(
      methods.filter((name) => /change/i.test(name) && name !== 'changes' && name !== 'logChanges'),
    ).toEqual([]);
  });

  it('answers a negative storage value with 422', async () => {
    const { service } = build();
    const input = savePlansSchema.parse({
      cells: [{ tier: 'PRO', key: 'clips.storage_gb', value: -1, updatedAt: SAVED_AT }],
      reason: REASON,
    });
    await expect(service.savePlans(input, actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
