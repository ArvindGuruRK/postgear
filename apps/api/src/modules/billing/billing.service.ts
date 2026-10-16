/**
 * The billing routes' logic: what a workspace is on, and the four things an
 * admin can do about it — subscribe, change, cancel, resume — plus the trial
 * and the portal.
 *
 * ## The row is the truth, Stripe is told
 *
 * Every write here goes to Stripe (or the simulation) first and to the row
 * only through the webhook that comes back — except two columns Stripe does
 * not model for us: `scheduledTier`/`scheduledPeriod`, which record a
 * downgrade waiting for period end, and the simulation's stand-in ids. So a
 * change answers with the row as it is *now*, and the page polls
 * `GET /billing/subscription` until the webhook has landed. That is the
 * contract's "pending state rather than optimistic update".
 *
 * ## Checks before calls
 *
 * Each action refuses — unconfigured (503), no workspace (404), nothing to
 * change (422) — before the gateway is touched, so a refused request never
 * creates a customer or a session. A gateway failure that is not already
 * an HTTP error is logged and answered 503 with the catalogue's message:
 * Stripe's own error text can name ids and keys and never reaches a client.
 *
 * ## Hand-granted and simulated plans
 *
 * A row with no `identifier` (the seed's, or one an operator granted) has
 * no Stripe subscription to change. In Stripe mode that is a 422 saying so.
 * In simulation the row is adopted on first use — a `cus_sim_…` customer
 * and a `sub_sim_…` subscription are written — so every flow on the page
 * can be exercised against the seeded workspace.
 */
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';
import { cycleFor } from '../ai/credits/credits.policy';
import { MailService } from '../mail/mail.service';
import { BILLING_CONFIG, type BillingConfig } from './billing.config';
import { BILLING_MESSAGES, CANCEL_REASON_LABELS, planLabel } from './billing.messages';
import { BillingRepository, type OrgBilling } from './billing.repository';
import type {
  BillingStatus,
  ChangePreview,
  PlanChangeRequest,
  SubscriptionResponse,
  SubscriptionSnapshot,
  SubscriptionView,
} from './billing.types';
import type { CancelInput, PlanSelectionInput } from './dto/billing.schema';
import { EntitlementsService, channelLimitOf } from './entitlements.service';
import {
  allowanceFor,
  type Entitlement,
  isUpgrade,
  PLAN_ORDER,
  type Plan,
  planFor,
  resolveEntitlement,
} from './plans';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.client';

/** A row with a Stripe (or simulated) subscription behind it that can still be acted on. */
type ChangeableOrg = OrgBilling & {
  paymentId: string;
  subscription: NonNullable<OrgBilling['subscription']> & { identifier: string };
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly ownerAddress: string;

  constructor(
    private readonly repository: BillingRepository,
    private readonly entitlements: EntitlementsService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(BILLING_CONFIG) private readonly config: BillingConfig,
    private readonly mail: MailService,
    configService: ConfigService<Env, true>,
  ) {
    this.ownerAddress = configService.get('SMTP_FROM', { infer: true });
  }

  /** `GET /billing/status`. */
  status(): BillingStatus {
    return {
      mode: this.config.mode,
      publishableKey: this.config.publishableKey,
      trialDays: this.config.trialDays,
    };
  }

  /** `GET /billing/plans`. */
  plans(): { plans: Plan[]; trialDays: number } {
    return { plans: PLAN_ORDER.map(planFor), trialDays: this.config.trialDays };
  }

  /** `GET /billing/subscription`: the entitlement and both usage meters. */
  async subscription(orgId: string, now: Date = new Date()): Promise<SubscriptionResponse> {
    const org = await this.requireOrg(orgId);
    const entitlement = resolveEntitlement(org.subscription, now);
    const channelsUsed = await this.repository.countLiveChannels(orgId);
    // The cycle anchors on the subscription's day of the month when there is
    // one, else the workspace's — the same rule `credits.service.ts` applies,
    // so the two meters never disagree about the reset date.
    const cycle = cycleFor(org.subscription?.createdAt ?? org.createdAt, now);
    const creditsUsed = await this.repository.sumCreditsUsed(orgId, cycle.start);

    return {
      subscription: this.view(org, entitlement),
      usage: {
        channels: { used: channelsUsed, limit: channelLimitOf(org.subscription, now).limit },
        aiCredits: {
          used: creditsUsed,
          allowance: allowanceFor(entitlement.tier),
          resetsAt: cycle.end.toISOString(),
        },
      },
    };
  }

  /** `POST /billing/trial`. 422 when the workspace is not eligible. */
  async startTrial(orgId: string): Promise<{ subscription: SubscriptionView }> {
    if (this.config.trialDays <= 0) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.TRIALS_DISABLED);
    }

    await this.requireOrg(orgId);
    const started = await this.entitlements.startTrial(orgId);

    if (!started) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.TRIAL_NOT_ELIGIBLE);
    }

    return { subscription: (await this.subscription(orgId)).subscription };
  }

  /** `POST /billing/checkout`: a Checkout Session URL for the browser to go to. */
  async checkout(orgId: string, input: PlanSelectionInput): Promise<{ url: string }> {
    this.requireConfigured();
    const org = await this.requireOrg(orgId);

    if (hasStripeSubscription(org)) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.ALREADY_SUBSCRIBED);
    }

    const customerId = await this.ensureCustomer(org);
    const page = this.billingPageUrl(orgId);

    return this.provider('checkout', () =>
      this.gateway.createCheckoutSession({
        orgId,
        customerId,
        tier: input.tier,
        period: input.period,
        successUrl: `${page}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${page}?checkout=cancel`,
      }),
    );
  }

  /** `POST /billing/portal`. 503 until there is a customer to open it for. */
  async portal(orgId: string): Promise<{ url: string }> {
    this.requireConfigured();
    let org = await this.requireOrg(orgId);

    if (!org.paymentId && this.config.mode === 'simulation' && hasLiveSubscription(org)) {
      org = await this.adoptSimulatedIds(org);
    }

    const customerId = org.paymentId;

    if (!customerId) {
      throw new ServiceUnavailableException(BILLING_MESSAGES.PORTAL_UNAVAILABLE);
    }

    return this.provider('portal', () =>
      this.gateway.createPortalSession({ customerId, returnUrl: this.billingPageUrl(orgId) }),
    );
  }

  /** `GET /billing/change/preview`: what a change would cost and when it lands. */
  async previewChange(
    orgId: string,
    input: PlanSelectionInput,
    now: Date = new Date(),
  ): Promise<{ preview: ChangePreview }> {
    this.requireConfigured();
    const org = await this.requireOrg(orgId);
    const subscription = this.requireLiveSubscription(org);
    const request = changeRequestFor(
      {
        ...snapshotOf(org, subscription, org.paymentId ?? '', subscription.identifier ?? ''),
      },
      input,
    );

    return { preview: await this.provider('preview', () => this.gateway.previewChange(request, now)) };
  }

  /**
   * `POST /billing/change`. An upgrade is applied now with prorations; a
   * downgrade is scheduled for the period end and recorded on the row.
   * Choosing the current plan while a downgrade is pending cancels it.
   */
  async change(orgId: string, input: PlanSelectionInput): Promise<{ subscription: SubscriptionView }> {
    this.requireConfigured();
    const org = await this.requireChangeable(orgId);
    const request = changeRequestFor(snapshotOf(org, org.subscription, org.paymentId, org.subscription.identifier), input);

    await this.provider('change', () => this.gateway.changePlan(request));

    if (request.effective === 'period_end') {
      await this.repository.updateSubscription(orgId, {
        scheduledTier: request.toTier,
        scheduledPeriod: request.toPeriod,
      });
    } else if (org.subscription.scheduledTier) {
      await this.repository.updateSubscription(orgId, { scheduledTier: null, scheduledPeriod: null });
    }

    return { subscription: (await this.subscription(orgId)).subscription };
  }

  /** `POST /billing/cancel`: ends the plan at period end; the feedback goes to the owner. */
  async cancel(orgId: string, input: CancelInput): Promise<{ subscription: SubscriptionView }> {
    this.requireConfigured();
    const org = await this.requireChangeable(orgId);
    const snapshot = snapshotOf(org, org.subscription, org.paymentId, org.subscription.identifier);

    await this.provider('cancel', () => this.gateway.cancelAtPeriodEnd(snapshot));

    if (org.subscription.scheduledTier) {
      await this.repository.updateSubscription(orgId, { scheduledTier: null, scheduledPeriod: null });
    }

    await this.mailFeedback(org, snapshot, input);

    return { subscription: (await this.subscription(orgId)).subscription };
  }

  /** `POST /billing/resume`: undoes a scheduled cancellation. */
  async resume(orgId: string): Promise<{ subscription: SubscriptionView }> {
    this.requireConfigured();
    const org = await this.requireChangeable(orgId);

    if (!org.subscription.cancelAt) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.NOT_CANCELING);
    }

    await this.provider('resume', () =>
      this.gateway.resume(snapshotOf(org, org.subscription, org.paymentId, org.subscription.identifier)),
    );

    return { subscription: (await this.subscription(orgId)).subscription };
  }

  // ---------------------------------------------------------------------------

  private view(org: OrgBilling, entitlement: Entitlement): SubscriptionView {
    const portalAvailable =
      this.config.mode === 'stripe'
        ? org.paymentId !== null
        : this.config.mode === 'simulation' && hasLiveSubscription(org);

    return {
      tier: entitlement.tier,
      status: entitlement.status,
      plan: entitlement.plan,
      period: entitlement.period,
      currentPeriodEnd: iso(entitlement.currentPeriodEnd),
      trialEndsAt: iso(entitlement.trialEndsAt),
      cancelAt: iso(entitlement.cancelAt),
      scheduledTier: entitlement.scheduledTier,
      scheduledPeriod: entitlement.scheduledPeriod,
      isLifetime: entitlement.isLifetime,
      canStartTrial: this.config.trialDays > 0 && org.subscription === null,
      portalAvailable,
    };
  }

  private requireConfigured(): void {
    if (this.config.mode === 'unconfigured') {
      throw new ServiceUnavailableException(BILLING_MESSAGES.NOT_CONFIGURED);
    }
  }

  private async requireOrg(orgId: string): Promise<OrgBilling> {
    const org = await this.repository.findOrgBilling(orgId);

    if (!org) {
      throw new NotFoundException(BILLING_MESSAGES.WORKSPACE_NOT_FOUND);
    }

    return org;
  }

  /** A paid row that is live. A no-card trial is not one: it subscribes through checkout. */
  private requireLiveSubscription(org: OrgBilling): NonNullable<OrgBilling['subscription']> {
    const subscription = org.subscription;

    if (!subscription || !hasLiveSubscription(org)) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.NO_SUBSCRIPTION);
    }

    return subscription;
  }

  /** A live row with the ids a gateway call needs — adopted in simulation, refused in Stripe mode. */
  private async requireChangeable(orgId: string): Promise<ChangeableOrg> {
    let org = await this.requireOrg(orgId);
    this.requireLiveSubscription(org);

    if (!org.paymentId || !org.subscription?.identifier) {
      if (this.config.mode !== 'simulation') {
        throw new UnprocessableEntityException(BILLING_MESSAGES.MANUAL_PLAN);
      }

      org = await this.adoptSimulatedIds(org);
    }

    if (!org.paymentId || !org.subscription?.identifier) {
      throw new UnprocessableEntityException(BILLING_MESSAGES.MANUAL_PLAN);
    }

    return org as ChangeableOrg;
  }

  /** Simulation only: gives a row made outside the flow the ids the flow needs. */
  private async adoptSimulatedIds(org: OrgBilling): Promise<OrgBilling> {
    if (!org.paymentId) {
      await this.ensureCustomer(org);
    }

    if (org.subscription && !org.subscription.identifier) {
      await this.repository.updateSubscription(org.id, {
        identifier: `sub_sim_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      });
    }

    return this.requireOrg(org.id);
  }

  private async ensureCustomer(org: OrgBilling): Promise<string> {
    const customerId = await this.provider('customer', () =>
      this.gateway.ensureCustomer({
        orgId: org.id,
        name: org.name,
        email: org.adminEmail,
        customerId: org.paymentId,
      }),
    );

    if (customerId !== org.paymentId) {
      await this.repository.updateOrganization(org.id, { paymentId: customerId });
    }

    return customerId;
  }

  private billingPageUrl(orgId: string): string {
    return `${this.config.webUrl}/${orgId}/settings/billing`;
  }

  /** Runs a gateway call. A failure that is not already an HTTP error is logged and answered 503. */
  private async provider<T>(label: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        JSON.stringify({
          event: 'billing.provider_failed',
          action: label,
          mode: this.config.mode,
          reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }),
      );
      throw new ServiceUnavailableException(BILLING_MESSAGES.PROVIDER_FAILED);
    }
  }

  /** Best-effort: the cancellation stands whether or not the owner's mail goes out. */
  private async mailFeedback(
    org: OrgBilling,
    snapshot: SubscriptionSnapshot,
    input: CancelInput,
  ): Promise<void> {
    try {
      await this.mail.sendPlain(this.ownerAddress, `Cancellation feedback from ${org.name}`, [
        'A workspace scheduled its PostGear plan to end.',
        '',
        `Workspace: ${org.name} (${org.id})`,
        `Plan: ${planLabel(snapshot.tier)}, billed ${snapshot.period.toLowerCase()}`,
        `Reason: ${CANCEL_REASON_LABELS[input.reason]}`,
        '',
        'Feedback:',
        input.feedback ?? '(none given)',
      ]);
    } catch (error) {
      this.logger.warn(
        `Could not mail cancellation feedback for ${org.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** A live, paid row — ACTIVE or in PAST_DUE grace, not deleted. */
export function hasLiveSubscription(org: OrgBilling): boolean {
  const row = org.subscription;
  return Boolean(row && !row.deletedAt && (row.status === 'ACTIVE' || row.status === 'PAST_DUE'));
}

/** A row Stripe is still billing — a new checkout would make a second subscription. */
export function hasStripeSubscription(org: OrgBilling): boolean {
  const row = org.subscription;
  return Boolean(
    row?.identifier &&
      !row.deletedAt &&
      (row.status === 'ACTIVE' || row.status === 'PAST_DUE' || row.status === 'TRIALING'),
  );
}

function snapshotOf(
  org: OrgBilling,
  subscription: NonNullable<OrgBilling['subscription']>,
  customerId: string,
  subscriptionId: string,
): SubscriptionSnapshot {
  return {
    orgId: org.id,
    customerId,
    subscriptionId,
    tier: subscription.subscriptionTier,
    period: subscription.period,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAt: subscription.cancelAt,
    scheduledTier: subscription.scheduledTier,
    scheduledPeriod: subscription.scheduledPeriod,
  };
}

/**
 * Up the ladder (or monthly to yearly on the same tier) is now, with
 * prorations; down (or yearly to monthly) waits for the period end. The
 * same plan again is a 422 — unless a downgrade is pending, in which case
 * it means "keep my plan" and is applied now by releasing the schedule.
 */
export function changeRequestFor(
  snapshot: SubscriptionSnapshot,
  input: PlanSelectionInput,
): PlanChangeRequest {
  const unchanged = input.tier === snapshot.tier && input.period === snapshot.period;

  if (unchanged && !snapshot.scheduledTier) {
    throw new UnprocessableEntityException(BILLING_MESSAGES.SAME_PLAN);
  }

  const upgrade =
    unchanged ||
    isUpgrade(snapshot.tier, input.tier) ||
    (input.tier === snapshot.tier && snapshot.period === 'MONTHLY' && input.period === 'YEARLY');

  return {
    ...snapshot,
    toTier: input.tier,
    toPeriod: input.period,
    effective: upgrade ? 'now' : 'period_end',
  };
}
