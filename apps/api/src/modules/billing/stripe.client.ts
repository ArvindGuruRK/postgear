/**
 * The Stripe gateway: the few calls billing makes to Stripe, behind one
 * interface with three implementations.
 *
 * - **`StripeGatewayClient`** — the real SDK. Checkout Sessions with inline
 *   `price_data` from the plan table (or a pinned `STRIPE_PRICE_*` id), the
 *   billing portal, prorated upgrades, scheduled downgrades, cancellation
 *   at period end. Every object it creates carries `{ organizationId, tier,
 *   period }` in its metadata, which is how the webhook knows whose event
 *   it is reading.
 * - **`SimulatedStripeGateway`** — no Stripe. Each call synthesises the
 *   events Stripe would send and hands them, after a short delay, to the
 *   same `StripeWebhookService.apply` a real webhook goes through. So the
 *   idempotency table, the state machine, the notifications and the
 *   "Activating…" state on the page are all exercised with no account.
 * - **`UnconfiguredGateway`** — every call answers 503 with the catalogue's
 *   message. `BillingService` checks the mode first; this is the backstop.
 *
 * The service is handed one of them behind `STRIPE_GATEWAY` and never
 * knows which. A test hands it a fake.
 *
 * ## Why a downgrade is a Subscription Schedule
 *
 * An upgrade is `subscriptions.update` with prorations: the customer pays
 * the difference now and gets the plan now. A downgrade must *not* refund
 * the difference or take effect early (the contract: nothing is disabled,
 * the change lands at period end). Stripe's way to say "at the end of this
 * period, switch to this price" is a schedule with two phases — the current
 * one, repeated exactly, and the new one — released afterwards so the
 * subscription carries on alone. The second phase carries the new tier in
 * its metadata, so when it starts, `customer.subscription.updated` arrives
 * with the new tier and the handler applies it like any other change.
 */
import { randomUUID } from 'node:crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Period, SubscriptionTier } from '@postgear/db';
import Stripe from 'stripe';
import { type BillingConfig, describeBillingMode, priceKeyFor } from './billing.config';
import { BILLING_MESSAGES } from './billing.messages';
import type {
  BillingWebhookEvent,
  ChangePreview,
  CheckoutRequest,
  PlanChangeRequest,
  SubscriptionSnapshot,
} from './billing.types';
import { planFor, priceFor } from './plans';

export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');
export const STRIPE_EVENT_VERIFIER = Symbol('STRIPE_EVENT_VERIFIER');

/** The plan table prices in US cents; Stripe wants the code lower-case. */
export const BILLING_CURRENCY = 'usd';

export interface StripeGateway {
  /** The Stripe customer for a workspace — reused when the org already has one. */
  ensureCustomer(params: {
    orgId: string;
    name: string;
    email: string | null;
    customerId: string | null;
  }): Promise<string>;
  createCheckoutSession(request: CheckoutRequest): Promise<{ url: string }>;
  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  previewChange(request: PlanChangeRequest, now: Date): Promise<ChangePreview>;
  /** Applies (now) or schedules (period end) the change; with an unchanged plan, only releases a pending schedule. */
  changePlan(request: PlanChangeRequest): Promise<void>;
  cancelAtPeriodEnd(snapshot: SubscriptionSnapshot): Promise<void>;
  resume(snapshot: SubscriptionSnapshot): Promise<void>;
}

/** Verifies a webhook delivery. Throws `WebhookVerificationError` on anything but a good signature. */
export type StripeEventVerifier = (
  rawBody: Buffer | undefined,
  signature: string | undefined,
) => BillingWebhookEvent;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/** Where the simulation sends the events it makes. `StripeWebhookService` fills it. */
export interface SimulatedEventSink {
  apply(event: BillingWebhookEvent): Promise<unknown>;
}

/** What every Stripe object carries, and what the webhook reads back. Indexable, as Stripe's `MetadataParam` wants. */
type PlanMetadata = Record<string, string> & {
  organizationId: string;
  tier: SubscriptionTier;
  period: Period;
};

function metadataFor(orgId: string, tier: SubscriptionTier, period: Period): PlanMetadata {
  return { organizationId: orgId, tier, period };
}

function intervalFor(period: Period): 'month' | 'year' {
  return period === 'YEARLY' ? 'year' : 'month';
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1_000) : null;
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** When the period that starts at `from` ends: one calendar month or year on, UTC. */
export function periodEndFor(period: Period, from: Date): Date {
  const end = new Date(from.getTime());
  if (period === 'YEARLY') {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end;
}

/** The start of the period that ends at `end`. */
function periodStartFor(period: Period, end: Date): Date {
  const start = new Date(end.getTime());
  if (period === 'YEARLY') {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  return start;
}

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

export class StripeGatewayClient implements StripeGateway {
  constructor(
    private readonly stripe: Stripe,
    private readonly config: BillingConfig,
  ) {}

  async ensureCustomer(params: {
    orgId: string;
    name: string;
    email: string | null;
    customerId: string | null;
  }): Promise<string> {
    if (params.customerId) {
      return params.customerId;
    }

    // The idempotency key makes a double-submitted checkout create one
    // customer, not two, even before the first response has been stored.
    const customer = await this.stripe.customers.create(
      {
        name: params.name,
        ...(params.email ? { email: params.email } : {}),
        metadata: { organizationId: params.orgId },
      },
      { idempotencyKey: `customer:${params.orgId}` },
    );

    return customer.id;
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<{ url: string }> {
    const metadata = metadataFor(request.orgId, request.tier, request.period);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: request.customerId,
      client_reference_id: request.orgId,
      line_items: [{ quantity: 1, ...this.checkoutPrice(request.tier, request.period) }],
      metadata,
      subscription_data: { metadata },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });

    if (!session.url) {
      throw new Error('Stripe returned a checkout session without a URL');
    }

    return { url: session.url };
  }

  async createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  }

  async previewChange(request: PlanChangeRequest, _now: Date): Promise<ChangePreview> {
    if (request.effective === 'period_end') {
      return {
        effective: 'period_end',
        amountDueCents: priceFor(request.toTier, request.toPeriod),
        currency: BILLING_CURRENCY,
        periodEnd: iso(request.currentPeriodEnd),
      };
    }

    const subscription = await this.stripe.subscriptions.retrieve(request.subscriptionId);
    const item = requireItem(subscription);
    const invoice = await this.stripe.invoices.createPreview({
      customer: request.customerId,
      subscription: request.subscriptionId,
      subscription_details: {
        items: [{ id: item.id, ...this.itemPrice(request.toTier, request.toPeriod, productOf(item)) }],
        proration_behavior: 'create_prorations',
      },
    });

    return {
      effective: 'now',
      amountDueCents: invoice.amount_due,
      currency: invoice.currency,
      periodEnd: iso(toDate(item.current_period_end)),
    };
  }

  async changePlan(request: PlanChangeRequest): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(request.subscriptionId);
    const item = requireItem(subscription);

    // A pending downgrade is undone by any new decision — an upgrade, a
    // cancellation, or choosing the current plan again.
    await this.releaseSchedule(subscription);

    const unchanged = request.toTier === request.tier && request.toPeriod === request.period;

    if (unchanged) {
      return;
    }

    if (request.effective === 'now') {
      await this.stripe.subscriptions.update(request.subscriptionId, {
        items: [{ id: item.id, ...this.itemPrice(request.toTier, request.toPeriod, productOf(item)) }],
        proration_behavior: 'create_prorations',
        payment_behavior: 'pending_if_incomplete',
        metadata: metadataFor(request.orgId, request.toTier, request.toPeriod),
      });
      return;
    }

    const schedule = await this.stripe.subscriptionSchedules.create({
      from_subscription: request.subscriptionId,
    });
    const current = schedule.phases[0];

    if (!current) {
      throw new Error('Stripe created a schedule with no current phase');
    }

    await this.stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      phases: [
        {
          start_date: current.start_date,
          end_date: current.end_date,
          items: current.items.map((phaseItem) => ({
            price: idOf(phaseItem.price) ?? undefined,
            quantity: phaseItem.quantity ?? 1,
          })),
          metadata: metadataFor(request.orgId, request.tier, request.period),
        },
        {
          items: [{ quantity: 1, ...this.itemPrice(request.toTier, request.toPeriod, productOf(item)) }],
          // One billing period of the new plan, then the schedule releases
          // and the subscription carries on at that price by itself.
          duration: { interval: intervalFor(request.toPeriod), interval_count: 1 },
          metadata: metadataFor(request.orgId, request.toTier, request.toPeriod),
        },
      ],
    });
  }

  async cancelAtPeriodEnd(snapshot: SubscriptionSnapshot): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(snapshot.subscriptionId);
    // Stripe refuses to cancel a subscription a schedule manages; and a
    // cancellation supersedes the downgrade anyway.
    await this.releaseSchedule(subscription);
    await this.stripe.subscriptions.update(snapshot.subscriptionId, { cancel_at_period_end: true });
  }

  async resume(snapshot: SubscriptionSnapshot): Promise<void> {
    await this.stripe.subscriptions.update(snapshot.subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  /** A checkout line: a pinned dashboard price, or the plan table inline (the product made on the fly). */
  private checkoutPrice(tier: SubscriptionTier, period: Period) {
    const pinned = this.config.priceIds[priceKeyFor(tier, period)];

    if (pinned) {
      return { price: pinned };
    }

    return {
      price_data: {
        currency: BILLING_CURRENCY,
        unit_amount: priceFor(tier, period),
        recurring: { interval: intervalFor(period) },
        product_data: { name: `PostGear ${planFor(tier).name}`, metadata: { tier } },
      },
    };
  }

  /** A subscription item's price: a pinned id, or inline against the product the subscription already has. */
  private itemPrice(tier: SubscriptionTier, period: Period, product: string) {
    const pinned = this.config.priceIds[priceKeyFor(tier, period)];

    if (pinned) {
      return { price: pinned };
    }

    return {
      price_data: {
        currency: BILLING_CURRENCY,
        unit_amount: priceFor(tier, period),
        recurring: { interval: intervalFor(period) },
        product,
      },
    };
  }

  private async releaseSchedule(subscription: Stripe.Subscription): Promise<void> {
    const scheduleId = idOf(subscription.schedule);

    if (scheduleId) {
      await this.stripe.subscriptionSchedules.release(scheduleId);
    }
  }
}

function requireItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem {
  const item = subscription.items.data[0];

  if (!item) {
    throw new Error(`Stripe subscription ${subscription.id} has no items`);
  }

  return item;
}

function productOf(item: Stripe.SubscriptionItem): string {
  const product = idOf(item.price.product);

  if (!product) {
    throw new Error(`Stripe subscription item ${item.id} has no product`);
  }

  return product;
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

/** Long enough for "Activating…" to be seen, short enough not to be waited for. */
const SIMULATION_DELAY_MIN_MS = 1_000;
const SIMULATION_DELAY_MAX_MS = 2_000;

export interface SimulationOptions {
  /** Milliseconds before the synthesised events are applied. Tests pass `() => 0`. */
  delayMs?: () => number;
  now?: () => Date;
  logger?: Pick<Logger, 'warn'>;
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/** The subscription object the simulation sends, with just the fields the handler reads. */
export interface SimulatedSubscription {
  id: string;
  object: 'subscription';
  customer: string;
  status: 'active';
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  trial_end: null;
  metadata: PlanMetadata;
  items: { data: Array<{ current_period_end: number }> };
}

export class SimulatedStripeGateway implements StripeGateway {
  private readonly delayMs: () => number;
  private readonly now: () => Date;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly sink: SimulatedEventSink,
    options: SimulationOptions = {},
  ) {
    this.delayMs =
      options.delayMs ??
      (() =>
        SIMULATION_DELAY_MIN_MS +
        Math.floor(Math.random() * (SIMULATION_DELAY_MAX_MS - SIMULATION_DELAY_MIN_MS)));
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? new Logger('BillingSimulation');
  }

  async ensureCustomer(params: {
    orgId: string;
    name: string;
    email: string | null;
    customerId: string | null;
  }): Promise<string> {
    return params.customerId ?? `cus_sim_${shortId()}`;
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<{ url: string }> {
    const sessionId = `cs_sim_${shortId()}`;
    const subscriptionId = `sub_sim_${shortId()}`;
    const metadata = metadataFor(request.orgId, request.tier, request.period);
    const periodEnd = periodEndFor(request.period, this.now());

    this.emit([
      this.event('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        mode: 'subscription',
        customer: request.customerId,
        subscription: subscriptionId,
        client_reference_id: request.orgId,
        metadata,
      }),
      this.event(
        'customer.subscription.created',
        this.subscription({
          id: subscriptionId,
          customer: request.customerId,
          metadata,
          periodEnd,
          cancelAt: null,
        }),
      ),
    ]);

    return { url: request.successUrl.replace('{CHECKOUT_SESSION_ID}', sessionId) };
  }

  async createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const url = new URL(params.returnUrl);
    url.searchParams.set('portal', 'simulated');
    return { url: url.toString() };
  }

  async previewChange(request: PlanChangeRequest, now: Date): Promise<ChangePreview> {
    return simulatedPreview(request, now);
  }

  async changePlan(request: PlanChangeRequest): Promise<void> {
    const applied = request.effective === 'now';

    this.emit([
      this.event(
        'customer.subscription.updated',
        this.subscription({
          id: request.subscriptionId,
          customer: request.customerId,
          metadata: metadataFor(
            request.orgId,
            applied ? request.toTier : request.tier,
            applied ? request.toPeriod : request.period,
          ),
          periodEnd: request.currentPeriodEnd ?? periodEndFor(request.period, this.now()),
          cancelAt: null,
        }),
      ),
    ]);
  }

  async cancelAtPeriodEnd(snapshot: SubscriptionSnapshot): Promise<void> {
    const periodEnd = snapshot.currentPeriodEnd ?? periodEndFor(snapshot.period, this.now());

    this.emit([
      this.event(
        'customer.subscription.updated',
        this.subscription({
          id: snapshot.subscriptionId,
          customer: snapshot.customerId,
          metadata: metadataFor(snapshot.orgId, snapshot.tier, snapshot.period),
          periodEnd,
          cancelAt: periodEnd,
        }),
      ),
    ]);
  }

  async resume(snapshot: SubscriptionSnapshot): Promise<void> {
    this.emit([
      this.event(
        'customer.subscription.updated',
        this.subscription({
          id: snapshot.subscriptionId,
          customer: snapshot.customerId,
          metadata: metadataFor(snapshot.orgId, snapshot.tier, snapshot.period),
          periodEnd: snapshot.currentPeriodEnd ?? periodEndFor(snapshot.period, this.now()),
          cancelAt: null,
        }),
      ),
    ]);
  }

  /** Waits for every emission in flight. For tests, which pass a zero delay. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private subscription(params: {
    id: string;
    customer: string;
    metadata: PlanMetadata;
    periodEnd: Date;
    cancelAt: Date | null;
  }): SimulatedSubscription {
    return {
      id: params.id,
      object: 'subscription',
      customer: params.customer,
      status: 'active',
      cancel_at: params.cancelAt ? toSeconds(params.cancelAt) : null,
      cancel_at_period_end: params.cancelAt !== null,
      trial_end: null,
      metadata: params.metadata,
      items: { data: [{ current_period_end: toSeconds(params.periodEnd) }] },
    };
  }

  private event(type: string, object: unknown): BillingWebhookEvent {
    return {
      id: `sim_${randomUUID()}`,
      type,
      created: toSeconds(this.now()),
      data: { object },
    };
  }

  /** Applies the events in order after the delay; a failure is logged, never thrown at the caller. */
  private emit(events: BillingWebhookEvent[]): void {
    const run = new Promise<void>((resolve) => {
      setTimeout(async () => {
        for (const event of events) {
          try {
            await this.sink.apply(event);
          } catch (error) {
            this.logger.warn(
              `Simulated ${event.type} could not be applied: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        resolve();
      }, this.delayMs());
    });

    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }
}

/**
 * What an upgrade costs now, as a stand-in for Stripe's proration: the
 * unused share of the current plan is credited against the same share of
 * the new one. A change of billing period pays the new price minus the
 * credit, as Stripe does. A downgrade costs nothing now and the new price
 * from the period end.
 */
export function simulatedPreview(request: PlanChangeRequest, now: Date): ChangePreview {
  const periodEnd = request.currentPeriodEnd ?? periodEndFor(request.period, now);

  if (request.effective === 'period_end') {
    return {
      effective: 'period_end',
      amountDueCents: priceFor(request.toTier, request.toPeriod),
      currency: BILLING_CURRENCY,
      periodEnd: periodEnd.toISOString(),
    };
  }

  const periodStart = periodStartFor(request.period, periodEnd);
  const length = periodEnd.getTime() - periodStart.getTime();
  const remaining =
    length > 0 ? Math.min(1, Math.max(0, (periodEnd.getTime() - now.getTime()) / length)) : 0;
  const credit = priceFor(request.tier, request.period) * remaining;
  const charge =
    request.toPeriod === request.period
      ? priceFor(request.toTier, request.toPeriod) * remaining
      : priceFor(request.toTier, request.toPeriod);

  return {
    effective: 'now',
    amountDueCents: Math.max(0, Math.round(charge - credit)),
    currency: BILLING_CURRENCY,
    periodEnd: periodEnd.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Unconfigured
// ---------------------------------------------------------------------------

class UnconfiguredGateway implements StripeGateway {
  private refuse(): never {
    throw new ServiceUnavailableException(BILLING_MESSAGES.NOT_CONFIGURED);
  }

  async ensureCustomer(): Promise<string> {
    return this.refuse();
  }
  async createCheckoutSession(): Promise<{ url: string }> {
    return this.refuse();
  }
  async createPortalSession(): Promise<{ url: string }> {
    return this.refuse();
  }
  async previewChange(): Promise<ChangePreview> {
    return this.refuse();
  }
  async changePlan(): Promise<void> {
    return this.refuse();
  }
  async cancelAtPeriodEnd(): Promise<void> {
    return this.refuse();
  }
  async resume(): Promise<void> {
    return this.refuse();
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Builds the gateway for the configured mode, logging the mode once. */
export function createStripeGateway(
  config: BillingConfig,
  sink: SimulatedEventSink,
  logger: Logger = new Logger('Billing'),
): StripeGateway {
  for (const warning of config.warnings) {
    logger.warn(warning);
  }

  switch (config.mode) {
    case 'stripe':
      logger.log(describeBillingMode(config));
      return new StripeGatewayClient(new Stripe(config.secretKey ?? ''), config);
    case 'simulation':
      logger.warn(describeBillingMode(config));
      return new SimulatedStripeGateway(sink);
    case 'unconfigured':
      logger.warn(describeBillingMode(config));
      return new UnconfiguredGateway();
  }
}

/**
 * The verifier for `POST /billing/webhook`. Only a Stripe-mode deployment
 * can verify anything; in the other modes every delivery is refused, since
 * there is no secret a signature could be checked against.
 */
export function createEventVerifier(config: BillingConfig): StripeEventVerifier {
  if (config.mode !== 'stripe' || !config.webhookSecret || !config.secretKey) {
    return () => {
      throw new WebhookVerificationError('Webhook verification is not configured');
    };
  }

  const stripe = new Stripe(config.secretKey);
  const secret = config.webhookSecret;

  return (rawBody, signature) => {
    if (!rawBody || !signature) {
      throw new WebhookVerificationError('Missing raw body or stripe-signature header');
    }

    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      throw new WebhookVerificationError(error instanceof Error ? error.message : String(error));
    }
  };
}
