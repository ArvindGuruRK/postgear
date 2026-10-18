/**
 * AI credits: how many a workspace has this cycle, and charging and
 * refunding them.
 *
 * ## Charged before the work, refunded when it fails
 *
 * A generation is charged *before* the model is called. The alternative, 
 * charge on success, lets a workspace with one credit left run any number
 * of generations in parallel. When the work then fails before producing
 * anything, the whole charge is refunded; when only the image failed, the
 * image's share is. A refund is a negative ledger row (`credits.policy.ts`).
 *
 * ## Exhaustion is a 402
 *
 * Nest has no `PaymentRequiredException`, so one is defined here. The
 * message carries the reset date, which is the one thing a person who has run
 * out can act on. The UI disables the button before this is reached; the
 * status is for clients that did not.
 */
import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@postgear/db';
import { AI_MESSAGES } from '../ai.messages';
import {
  AI_CREDIT_COSTS,
  type AiCredits,
  type AiCreditType,
  type AiTier,
  allowanceFor,
  buildCredits,
  cycleFor,
  tierOf,
} from './credits.policy';
import { CreditsRepository } from './credits.repository';

/** How many times a charge is retried after a serialization failure. */
const CHARGE_ATTEMPTS = 3;
const CHARGE_RETRY_DELAY_MS = 50;

export class PaymentRequiredException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.PAYMENT_REQUIRED);
  }
}

/** The cycle a workspace is in, plus what the AI routes need to know about it. */
export interface CreditContext {
  workspaceName: string;
  tier: AiTier;
  allowance: number;
  cycleStart: Date;
  resetsAt: Date;
}

export type ChargeResult = { ok: true; credits: AiCredits } | { ok: false; credits: AiCredits };

@Injectable()
export class CreditsService {
  constructor(private readonly repository: CreditsRepository) {}

  /** The tier and cycle, read once per request. Also where the workspace's name comes from. */
  async context(orgId: string, now: Date = new Date()): Promise<CreditContext> {
    const billing = await this.repository.findBillingContext(orgId);

    if (!billing) {
      throw new NotFoundException(AI_MESSAGES.WORKSPACE_NOT_FOUND);
    }

    const tier = tierOf(billing.subscription, now);
    // The subscription's day of the month when there is one; otherwise the
    // workspace's. A cancelled subscription keeps anchoring the cycle, so a
    // downgrade to the trial allowance does not also move the reset date.
    const anchor = billing.subscription?.createdAt ?? billing.organizationCreatedAt;
    const cycle = cycleFor(anchor, now);

    return {
      workspaceName: billing.workspaceName,
      tier,
      allowance: allowanceFor(tier),
      cycleStart: cycle.start,
      resetsAt: cycle.end,
    };
  }

  /** `GET /ai/credits`. */
  async summary(orgId: string, now: Date = new Date()): Promise<AiCredits> {
    const context = await this.context(orgId, now);
    return this.summaryFor(orgId, context);
  }

  async summaryFor(orgId: string, context: CreditContext): Promise<AiCredits> {
    const used = await this.repository.sumUsed(orgId, context.cycleStart);
    return buildCredits({ tier: context.tier, used, resetsAt: context.resetsAt });
  }

  /**
   * Charges, or refuses with a 402.
   *
   * `amount` defaults to the type's cost; `generate_post` with an image passes
   * the combined price so the check and the row are one unit.
   */
  async charge(
    orgId: string,
    type: AiCreditType,
    amount: number = AI_CREDIT_COSTS[type],
    context?: CreditContext,
  ): Promise<AiCredits> {
    const result = await this.tryCharge(orgId, type, amount, context);

    if (!result.ok) {
      throw new PaymentRequiredException(
        AI_MESSAGES.outOfCredits(new Date(result.credits.resetsAt)),
      );
    }

    return result.credits;
  }

  /**
   * Charges if the cycle can afford it. For the copilot's tools, which report
   * "not enough credits" back to the model rather than failing the request.
   */
  async tryCharge(
    orgId: string,
    type: AiCreditType,
    amount: number = AI_CREDIT_COSTS[type],
    context?: CreditContext,
  ): Promise<ChargeResult> {
    const resolved = context ?? (await this.context(orgId));

    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await this.repository.chargeOnce({
          orgId,
          type,
          amount,
          since: resolved.cycleStart,
          allowance: resolved.allowance,
        });

        const credits = buildCredits({
          tier: resolved.tier,
          used: outcome.used,
          resetsAt: resolved.resetsAt,
        });

        return outcome.outcome === 'charged' ? { ok: true, credits } : { ok: false, credits };
      } catch (error) {
        // P2034: Postgres aborted this transaction to keep a concurrent charge
        // serializable. Nothing stale was read that a retry could repeat.
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

        if (!serializationFailure || attempt >= CHARGE_ATTEMPTS) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, CHARGE_RETRY_DELAY_MS * attempt));
      }
    }
  }

  /** Returns credits for work that did not happen. Never throws for a zero amount. */
  async refund(orgId: string, type: AiCreditType, amount: number): Promise<void> {
    if (amount <= 0) {
      return;
    }

    await this.repository.refund({ orgId, type, amount });
  }
}
