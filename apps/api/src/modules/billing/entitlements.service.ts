/**
 * What a workspace is entitled to, and the one place other modules ask.
 *
 * Exported from `BillingModule` for the channels module (the connect limit)
 * and the org module (the trial on workspace creation). Everything here is
 * computed on read from the subscription row through the plan table's
 * `resolveEntitlement`; nothing is cached, nothing is cron-driven.
 *
 * ## The channel limit honours a hand-granted entitlement
 *
 * `Subscription.totalChannels` is inherited from the reference schema, where
 * an operator could set it by hand. The limit is the larger of the plan's
 * number and that column while the entitlement is live, and a lifetime row
 * is live for ever, so a grant made outside Stripe keeps working and a
 * downgrade never counts against channels that were granted on purpose.
 *
 * ## The trial is a row, not a flag
 *
 * `startTrial` creates a `TRIALING` subscription with `trialEndsAt`; expiry
 * is `resolveEntitlement`'s job on every read. It refuses when any row
 * exists for the workspace, deleted or not: a trial is for a workspace that
 * has never had a plan, and the reference's `allowTrial` flag is set false
 * here for the same reason. `BILLING_TRIAL_DAYS=0` turns trials off.
 */
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { securityLogger } from '../../common/logging/security-logger';
import { BILLING_CONFIG, type BillingConfig } from './billing.config';
import { BILLING_MESSAGES, BILLING_NOTIFICATIONS, planLabel } from './billing.messages';
import { BillingRepository, type OrgBilling } from './billing.repository';
import type { ChannelUsage } from './billing.types';
import {
  channelLimitFor,
  type Entitlement,
  resolveEntitlement,
  type SubscriptionLike,
  TRIAL_TIER,
} from './plans';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Thrown by `assertCanConnect`. A `ForbiddenException`, so a direct API call
 * gets a 403 with the catalogue's message; the channels controller catches
 * it and redirects the browser instead, since connect is a navigation.
 */
export class ChannelLimitReachedError extends ForbiddenException {
  constructor(readonly usage: ChannelUsage) {
    super(BILLING_MESSAGES.CHANNEL_LIMIT);
  }
}

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly repository: BillingRepository,
    @Inject(BILLING_CONFIG) private readonly config: BillingConfig,
  ) {}

  /** The tier a workspace is on right now. FREE for a workspace that does not exist. */
  async entitlement(orgId: string, now: Date = new Date()): Promise<Entitlement> {
    const org = await this.repository.findOrgBilling(orgId);
    return resolveEntitlement(org?.subscription ?? null, now);
  }

  /** Connected channels against the plan's limit. */
  async channelUsage(orgId: string, now: Date = new Date()): Promise<ChannelUsage> {
    const [org, used] = await Promise.all([
      this.repository.findOrgBilling(orgId),
      this.repository.countLiveChannels(orgId),
    ]);

    return { used, ...channelLimitOf(org?.subscription ?? null, now) };
  }

  /** Whether one more channel may be connected. Logs a refusal; never throws. */
  async checkConnect(orgId: string): Promise<{ allowed: boolean; usage: ChannelUsage }> {
    const usage = await this.channelUsage(orgId);
    const allowed = usage.used < usage.limit;

    if (!allowed) {
      securityLogger.log('billing.limit_reached', {
        orgId,
        limit: 'channels',
        used: usage.used,
        max: usage.limit,
        tier: usage.tier,
      });
    }

    return { allowed, usage };
  }

  /** Refuses a new connection at the limit. A reconnect of an existing channel never comes here. */
  async assertCanConnect(orgId: string): Promise<ChannelUsage> {
    const { allowed, usage } = await this.checkConnect(orgId);

    if (!allowed) {
      throw new ChannelLimitReachedError(usage);
    }

    return usage;
  }

  /** Whether `startTrial` would succeed, without starting one. */
  async canStartTrial(orgId: string): Promise<boolean> {
    if (this.config.trialDays <= 0) {
      return false;
    }

    const org = await this.repository.findOrgBilling(orgId);
    return org !== null && org.subscription === null;
  }

  /**
   * Starts the no-card trial. Returns the entitlement it grants, or `null`
   * when the workspace is not eligible (a row already exists, trials are
   * off, or the workspace does not exist). Best-effort callers (the org
   * service after creating a workspace) treat `null` as "nothing to do".
   */
  async startTrial(orgId: string, now: Date = new Date()): Promise<Entitlement | null> {
    if (this.config.trialDays <= 0) {
      return null;
    }

    const org = await this.repository.findOrgBilling(orgId);

    if (!org || org.subscription !== null) {
      return null;
    }

    const trialEndsAt = new Date(now.getTime() + this.config.trialDays * DAY_MS);
    const notice = BILLING_NOTIFICATIONS.trialStarted(planLabel(TRIAL_TIER), this.config.trialDays);

    try {
      const row = await this.repository.transaction(async (store) => {
        const subscription = await store.upsertSubscription(orgId, {
          subscriptionTier: TRIAL_TIER,
          period: 'MONTHLY',
          status: 'TRIALING',
          identifier: null,
          trialEndsAt,
          cancelAt: null,
          currentPeriodEnd: null,
          scheduledTier: null,
          scheduledPeriod: null,
          totalChannels: channelLimitFor(TRIAL_TIER),
          isLifetime: false,
          deletedAt: null,
        });
        await store.updateOrganization(orgId, { isTrailing: true, allowTrial: false });
        await store.createNotification({
          organizationId: orgId,
          type: 'billing.trial_started',
          title: notice.title,
          content: notice.content,
          link: `/${orgId}/settings/billing`,
          meta: { tier: TRIAL_TIER, period: 'MONTHLY', trialEndsAt: trialEndsAt.toISOString() },
        });
        return subscription;
      });

      this.logger.log(
        JSON.stringify({ event: 'billing.trial_started', orgId, trialEndsAt, days: this.config.trialDays }),
      );

      return resolveEntitlement(row, now);
    } catch (error) {
      // Two creates racing for the same workspace: the unique organizationId
      // settles it, and the loser has nothing left to do.
      this.logger.warn(
        `Could not start a trial for ${orgId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** For the billing service, which has the org already. */
  describe(org: OrgBilling | null, now: Date = new Date()): Entitlement {
    return resolveEntitlement(org?.subscription ?? null, now);
  }
}

/**
 * The channel ceiling for a subscription row: the plan's number, raised by
 * `totalChannels` while the entitlement is live (a lifetime row always is).
 */
export function channelLimitOf(
  subscription: (SubscriptionLike & { totalChannels: number }) | null,
  now: Date = new Date(),
): Pick<ChannelUsage, 'limit' | 'tier'> {
  const entitlement = resolveEntitlement(subscription, now);
  const planLimit = channelLimitFor(entitlement.tier);

  if (entitlement.tier === 'FREE' || !subscription) {
    return { limit: planLimit, tier: entitlement.tier };
  }

  return { limit: Math.max(planLimit, subscription.totalChannels), tier: entitlement.tier };
}
