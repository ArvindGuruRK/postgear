/**
 * Persistence for the AI credit ledger.
 *
 * The ledger is the existing `Credits` table, used as-is: one row per charge
 * (positive) or refund (negative), typed by what it was for. Nothing here
 * updates or deletes a row — see `credits.policy.ts` for why the history is
 * kept whole.
 *
 * ## The charge is one serializable transaction
 *
 * "Sum what was used, compare with the allowance, insert the charge" is a
 * read-then-write, and two generations started together could both pass the
 * check and overspend. Under `Serializable` Postgres aborts one of them
 * (`P2034`), and the service retries it — the same pattern
 * `posts.repository.ts` uses for creates. The transaction is kept to those
 * three statements so the retry is cheap.
 *
 * `orgId` is in every `where`, as everywhere else in this codebase.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, prisma, type SubscriptionTier } from '@postgear/db';
import { AI_LEDGER_TYPES, type AiCreditType, refundTypeFor } from './credits.policy';

/** What the cycle and the tier are computed from. */
export interface BillingContext {
  workspaceName: string;
  organizationCreatedAt: Date;
  subscription: {
    subscriptionTier: SubscriptionTier;
    createdAt: Date;
    deletedAt: Date | null;
  } | null;
}

export type ChargeOutcome =
  | { outcome: 'charged'; used: number }
  | { outcome: 'exhausted'; used: number };

const CHARGE_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 5_000,
} as const;

@Injectable()
export class CreditsRepository {
  async findBillingContext(orgId: string): Promise<BillingContext | null> {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        createdAt: true,
        subscription: { select: { subscriptionTier: true, createdAt: true, deletedAt: true } },
      },
    });

    return organization
      ? {
          workspaceName: organization.name,
          organizationCreatedAt: organization.createdAt,
          subscription: organization.subscription,
        }
      : null;
  }

  /** Credits used since `since`: charges minus refunds, over this module's row types only. */
  async sumUsed(orgId: string, since: Date): Promise<number> {
    return sumUsed(prisma, orgId, since);
  }

  /**
   * One attempt at a charge. Throws Prisma's `P2034` when a concurrent charge
   * won the serialization race; the service retries.
   */
  async chargeOnce(params: {
    orgId: string;
    type: AiCreditType;
    amount: number;
    since: Date;
    allowance: number;
  }): Promise<ChargeOutcome> {
    return prisma.$transaction(async (tx) => {
      const used = await sumUsed(tx, params.orgId, params.since);

      if (used + params.amount > params.allowance) {
        return { outcome: 'exhausted', used };
      }

      await tx.credits.create({
        data: { organizationId: params.orgId, credits: params.amount, type: params.type },
      });

      return { outcome: 'charged', used: used + params.amount };
    }, CHARGE_OPTIONS);
  }

  /** A refund is a negative row, never a deletion. */
  async refund(params: { orgId: string; type: AiCreditType; amount: number }): Promise<void> {
    await prisma.credits.create({
      data: {
        organizationId: params.orgId,
        credits: -params.amount,
        type: refundTypeFor(params.type),
      },
    });
  }
}

async function sumUsed(
  client: Pick<typeof prisma, 'credits'>,
  orgId: string,
  since: Date,
): Promise<number> {
  const result = await client.credits.aggregate({
    where: {
      organizationId: orgId,
      type: { in: [...AI_LEDGER_TYPES] },
      createdAt: { gte: since },
    },
    _sum: { credits: true },
  });

  return result._sum.credits ?? 0;
}
