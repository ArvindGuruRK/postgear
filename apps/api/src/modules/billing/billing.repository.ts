/**
 * Persistence for billing: the subscription row, the organization's Stripe
 * ids, the `BillingEvent` idempotency table, and the notifications billing
 * writes.
 *
 * ## One store interface, two bindings
 *
 * The webhook handler applies an event as one transaction — the event row,
 * the subscription, the organization flags and the notification succeed or
 * fail together. So the operations are declared once as `BillingStore`, and
 * the repository provides them twice: bound to the shared client for plain
 * reads and writes, and bound to a transaction client inside
 * `transaction()`. A test hands the handler an in-memory store of the same
 * shape and never touches Prisma.
 *
 * ## No imports from other modules
 *
 * `BillingModule` must never import `ChannelsModule`, `AiModule` or
 * `OrgModule` (they import it), so the two numbers it needs from their
 * tables — live channels and AI credits used — are small queries here. The
 * credits query mirrors `ai/credits/credits.repository.ts`'s `sumUsed` over
 * the same ledger types, read from the pure `credits.policy.ts`.
 */
import { Injectable } from '@nestjs/common';
import {
  type Period,
  Prisma,
  type PrismaTransactionClient,
  prisma,
  type Subscription,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '@postgear/db';
import { AI_LEDGER_TYPES } from '../ai/credits/credits.policy';

export interface OrgBilling {
  id: string;
  name: string;
  paymentId: string | null;
  allowTrial: boolean;
  isTrailing: boolean;
  createdAt: Date;
  /** The one subscription row, deleted or not; `null` when none was ever made. */
  subscription: Subscription | null;
  /** The address billing mail (a trial notice, a receipt) would go to. */
  adminEmail: string | null;
}

/** Every column a webhook or the trial may set. The upsert fills the rest. */
export interface SubscriptionWrite {
  subscriptionTier: SubscriptionTier;
  period: Period;
  status: SubscriptionStatus;
  identifier?: string | null;
  cancelAt?: Date | null;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  scheduledTier?: SubscriptionTier | null;
  scheduledPeriod?: Period | null;
  totalChannels?: number;
  isLifetime?: boolean;
  deletedAt?: Date | null;
  lastStripeEventAt?: Date | null;
}

export interface OrganizationWrite {
  paymentId?: string | null;
  isTrailing?: boolean;
  allowTrial?: boolean;
}

export interface BillingEventWrite {
  id: string;
  type: string;
  organizationId: string | null;
  outcome: string;
}

export interface NotificationWrite {
  organizationId: string;
  type: string;
  title: string;
  content: string;
  link: string;
  meta: Record<string, unknown>;
}

/** The operations the webhook handler and the trial run, inside or outside a transaction. */
export interface BillingStore {
  findOrgBilling(orgId: string): Promise<OrgBilling | null>;
  findOrgIdByCustomer(customerId: string): Promise<string | null>;
  findOrgIdBySubscription(identifier: string): Promise<string | null>;
  hasEvent(id: string): Promise<boolean>;
  /** Throws Prisma's `P2002` when the id was already recorded. */
  recordEvent(event: BillingEventWrite): Promise<void>;
  finishEvent(id: string, result: { organizationId: string | null; outcome: string }): Promise<void>;
  upsertSubscription(orgId: string, data: SubscriptionWrite): Promise<Subscription>;
  updateSubscription(orgId: string, data: Partial<SubscriptionWrite>): Promise<void>;
  updateOrganization(orgId: string, data: OrganizationWrite): Promise<void>;
  createNotification(notification: NotificationWrite): Promise<void>;
}

type Client = PrismaTransactionClient | typeof prisma;

const ORG_SELECT = {
  id: true,
  name: true,
  paymentId: true,
  allowTrial: true,
  isTrailing: true,
  createdAt: true,
  subscription: true,
  users: {
    where: { role: 'ADMIN' as const, disabled: false },
    orderBy: { createdAt: 'asc' as const },
    take: 1,
    select: { user: { select: { email: true } } },
  },
} as const;

/** The store over any Prisma client — the shared one or a transaction's. */
class PrismaBillingStore implements BillingStore {
  constructor(protected readonly client: Client) {}

  async findOrgBilling(orgId: string): Promise<OrgBilling | null> {
    const organization = await this.client.organization.findUnique({
      where: { id: orgId },
      select: ORG_SELECT,
    });

    if (!organization) {
      return null;
    }

    return {
      id: organization.id,
      name: organization.name,
      paymentId: organization.paymentId,
      allowTrial: organization.allowTrial,
      isTrailing: organization.isTrailing,
      createdAt: organization.createdAt,
      subscription: organization.subscription,
      adminEmail: organization.users[0]?.user.email ?? null,
    };
  }

  async findOrgIdByCustomer(customerId: string): Promise<string | null> {
    const organization = await this.client.organization.findFirst({
      where: { paymentId: customerId },
      select: { id: true },
    });

    return organization?.id ?? null;
  }

  async findOrgIdBySubscription(identifier: string): Promise<string | null> {
    const subscription = await this.client.subscription.findFirst({
      where: { identifier },
      select: { organizationId: true },
    });

    return subscription?.organizationId ?? null;
  }

  async hasEvent(id: string): Promise<boolean> {
    const event = await this.client.billingEvent.findUnique({ where: { id }, select: { id: true } });
    return event !== null;
  }

  async recordEvent(event: BillingEventWrite): Promise<void> {
    await this.client.billingEvent.create({ data: event });
  }

  async finishEvent(
    id: string,
    result: { organizationId: string | null; outcome: string },
  ): Promise<void> {
    await this.client.billingEvent.update({ where: { id }, data: result });
  }

  async upsertSubscription(orgId: string, data: SubscriptionWrite): Promise<Subscription> {
    const { totalChannels, ...rest } = data;

    return this.client.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        ...rest,
        // Required on create; on update it is only written when given, so a
        // hand-granted entitlement is not quietly reset by an event that did
        // not mean to touch it.
        totalChannels: totalChannels ?? 0,
      },
      update: { ...rest, ...(totalChannels === undefined ? {} : { totalChannels }) },
    });
  }

  async updateSubscription(orgId: string, data: Partial<SubscriptionWrite>): Promise<void> {
    await this.client.subscription.updateMany({ where: { organizationId: orgId }, data });
  }

  async updateOrganization(orgId: string, data: OrganizationWrite): Promise<void> {
    await this.client.organization.update({ where: { id: orgId }, data });
  }

  async createNotification(notification: NotificationWrite): Promise<void> {
    await this.client.notifications.create({
      data: {
        organizationId: notification.organizationId,
        type: notification.type,
        title: notification.title,
        content: notification.content,
        link: notification.link,
        meta: notification.meta as Prisma.InputJsonObject,
        emailStatus: 'PENDING',
      },
    });
  }
}

@Injectable()
export class BillingRepository extends PrismaBillingStore {
  constructor() {
    super(prisma);
  }

  /**
   * Runs `work` against a store bound to one transaction. Everything the
   * callback writes lands together or not at all; a thrown error rolls it
   * back and is rethrown.
   */
  async transaction<T>(work: (store: BillingStore) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => work(new PrismaBillingStore(tx)), {
      timeout: 10_000,
    });
  }

  /** Live (not disconnected) channels. The number the channel limit is checked against. */
  async countLiveChannels(orgId: string): Promise<number> {
    return prisma.integration.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  /** Whether any subscription row — live, cancelled or deleted — was ever made for the org. */
  async hasAnySubscription(orgId: string): Promise<boolean> {
    const row = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: { id: true },
    });

    return row !== null;
  }

  /** AI credits used since `since`: charges minus refunds, over the AI ledger's row types. */
  async sumCreditsUsed(orgId: string, since: Date): Promise<number> {
    const result = await prisma.credits.aggregate({
      where: {
        organizationId: orgId,
        type: { in: [...AI_LEDGER_TYPES] },
        createdAt: { gte: since },
      },
      _sum: { credits: true },
    });

    return result._sum.credits ?? 0;
  }
}

/** Prisma's unique-constraint failure — the second delivery of one Stripe event. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
