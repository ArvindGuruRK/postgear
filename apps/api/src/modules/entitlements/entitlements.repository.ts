/**
 * The rows behind plans as data (Sprint 12): plan values, workspace
 * overrides, the subscription a tier is read from, and the usage ledger.
 *
 * Ledger writes take a transaction client, so `UsageService` keeps the
 * look-up, the sum and the insert in one Serializable transaction.
 */
import { Injectable } from '@nestjs/common';
import {
  type Prisma,
  type PrismaTransactionClient,
  prisma,
  type UsageEntry,
  UsageKind,
} from '@postgear/db';
import {
  SUBSCRIPTION_ENTITLEMENT_SELECT,
} from '../ai/credits/credits.repository';
import type { SubscriptionLike } from '../ai/credits/credits.policy';

export interface PlanRow {
  tier: string;
  key: string;
  value: unknown;
}

export interface OverrideRow {
  key: string;
  value: unknown;
  expiresAt: Date;
}

export interface OrgBilling {
  organizationCreatedAt: Date;
  subscription: SubscriptionLike | null;
}

export interface NewUsageEntry {
  organizationId: string;
  meter: string;
  units: number;
  kind: UsageKind;
  idempotencyKey: string;
  refId: string | null;
  reversesId: string | null;
  cycleStart: Date;
  meta: Prisma.InputJsonValue | undefined;
  createdBy: string | null;
}

type LedgerClient = Pick<PrismaTransactionClient, 'usageEntry'>;

@Injectable()
export class EntitlementsRepository {
  async planRows(): Promise<PlanRow[]> {
    return prisma.planEntitlement.findMany({ select: { tier: true, key: true, value: true } });
  }

  async planRowsFor(tier: string): Promise<PlanRow[]> {
    return prisma.planEntitlement.findMany({
      where: { tier },
      select: { tier: true, key: true, value: true },
    });
  }

  async overrides(orgId: string): Promise<OverrideRow[]> {
    return prisma.orgEntitlementOverride.findMany({
      where: { organizationId: orgId },
      select: { key: true, value: true, expiresAt: true },
    });
  }

  /** Null when the workspace does not exist. */
  async billing(orgId: string): Promise<OrgBilling | null> {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { createdAt: true, subscription: { select: SUBSCRIPTION_ENTITLEMENT_SELECT } },
    });
    return organization
      ? { organizationCreatedAt: organization.createdAt, subscription: organization.subscription }
      : null;
  }

  // ---- Ledger --------------------------------------------------------------

  findByKey(client: LedgerClient, orgId: string, idempotencyKey: string): Promise<UsageEntry | null> {
    return client.usageEntry.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey } },
    });
  }

  /** Charges, reversals and adjustments together, in thousandths. */
  async sumUnits(client: LedgerClient, orgId: string, meter: string, cycleStart: Date): Promise<number> {
    const result = await client.usageEntry.aggregate({
      where: { organizationId: orgId, meter, cycleStart },
      _sum: { units: true },
    });
    return result._sum.units ?? 0;
  }

  insert(client: LedgerClient, entry: NewUsageEntry): Promise<UsageEntry> {
    return client.usageEntry.create({ data: entry });
  }

  findEntry(client: LedgerClient, orgId: string, entryId: string): Promise<UsageEntry | null> {
    return client.usageEntry.findFirst({ where: { id: entryId, organizationId: orgId } });
  }

  /** How much of an entry was already given back (a negative number of thousandths, or 0). */
  async reversedUnits(client: LedgerClient, entryId: string): Promise<number> {
    const result = await client.usageEntry.aggregate({
      where: { reversesId: entryId, kind: UsageKind.REVERSAL },
      _sum: { units: true },
    });
    return result._sum.units ?? 0;
  }

  /** The charges made for a job (or anything else named by `refId`). */
  chargesFor(orgId: string, refId: string): Promise<UsageEntry[]> {
    return prisma.usageEntry.findMany({
      where: { organizationId: orgId, refId, kind: UsageKind.CHARGE },
      orderBy: { createdAt: 'asc' },
    });
  }
}
