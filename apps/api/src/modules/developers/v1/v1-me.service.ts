/**
 * `GET /v1/me`: who am I, and what may I do (Sprint 8).
 *
 * The workspace name and the plan tier are read here with one Prisma query
 * rather than through `BillingModule`. The contract's module table lists
 * billing among this module's imports, but the only thing `/v1/me` needs
 * from it is `resolveEntitlement`, which is a pure function in `plans.ts`
 * with no Nest in it: importing the whole billing module (Stripe client,
 * webhook handler, mail) for one tier label would couple the public API's
 * boot to billing's, and the two workstreams are being built in parallel.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { resolveEntitlement } from '../../billing/plans';
import type { ApiKeyPrincipal } from '../auth/api-key.guard';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import type { PublicMe } from './v1.types';

@Injectable()
export class V1MeService {
  async me(orgId: string, key: ApiKeyPrincipal): Promise<PublicMe> {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        subscription: {
          select: {
            subscriptionTier: true,
            status: true,
            period: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            cancelAt: true,
            deletedAt: true,
            isLifetime: true,
            scheduledTier: true,
            scheduledPeriod: true,
          },
        },
      },
    });

    // A key outlives its workspace only in the instant between the two
    // cascading deletes; answering as the guard would is the honest result.
    if (!organization) {
      throw new UnauthorizedException(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    }

    const entitlement = resolveEntitlement(organization.subscription, new Date());

    return {
      workspace: { id: organization.id, name: organization.name },
      key: { id: key.id, name: key.name, prefix: key.prefix },
      plan: { tier: entitlement.tier },
    };
  }
}
