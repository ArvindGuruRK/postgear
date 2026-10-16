/**
 * An in-memory `BillingRepository` for the billing specs.
 *
 * Holds organizations, their one subscription row, the `BillingEvent`
 * table and the notifications written, with the two behaviours the real
 * repository's transaction has that the handler relies on: a duplicate
 * event id fails the insert with Prisma's `P2002`, and a thrown error
 * rolls every write of that transaction back.
 */
import { Prisma, type Subscription } from '@postgear/db';
import type {
  BillingEventWrite,
  BillingStore,
  NotificationWrite,
  OrgBilling,
  OrganizationWrite,
  SubscriptionWrite,
} from '../billing.repository';

export const NOW = new Date('2026-10-16T12:00:00.000Z');

export function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: 'org_1',
    subscriptionTier: 'STANDARD',
    identifier: 'sub_123',
    cancelAt: null,
    period: 'MONTHLY',
    totalChannels: 5,
    isLifetime: false,
    createdAt: new Date('2026-09-13T15:42:00.000Z'),
    updatedAt: new Date('2026-09-13T15:42:00.000Z'),
    deletedAt: null,
    status: 'ACTIVE',
    currentPeriodEnd: new Date('2026-11-13T15:42:00.000Z'),
    trialEndsAt: null,
    scheduledTier: null,
    scheduledPeriod: null,
    lastStripeEventAt: null,
    ...overrides,
  };
}

export function orgBilling(overrides: Partial<OrgBilling> = {}): OrgBilling {
  return {
    id: 'org_1',
    name: 'PostGear Demo Org',
    paymentId: 'cus_123',
    allowTrial: false,
    isTrailing: false,
    createdAt: new Date('2026-01-05T08:00:00.000Z'),
    subscription: subscriptionRow(),
    adminEmail: 'demo@postgear.local',
    ...overrides,
  };
}

export function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

export class FakeBillingStore implements BillingStore {
  orgs = new Map<string, OrgBilling>();
  events = new Map<string, BillingEventWrite>();
  notifications: NotificationWrite[] = [];
  liveChannels = new Map<string, number>();
  creditsUsed = 0;

  constructor(orgs: OrgBilling[] = []) {
    for (const org of orgs) {
      this.orgs.set(org.id, org);
    }
  }

  // --- BillingStore ---------------------------------------------------------

  async findOrgBilling(orgId: string): Promise<OrgBilling | null> {
    const org = this.orgs.get(orgId);
    return org ? clone(org) : null;
  }

  async findOrgIdByCustomer(customerId: string): Promise<string | null> {
    for (const org of this.orgs.values()) {
      if (org.paymentId === customerId) {
        return org.id;
      }
    }
    return null;
  }

  async findOrgIdBySubscription(identifier: string): Promise<string | null> {
    for (const org of this.orgs.values()) {
      if (org.subscription?.identifier === identifier) {
        return org.id;
      }
    }
    return null;
  }

  async hasEvent(id: string): Promise<boolean> {
    return this.events.has(id);
  }

  async recordEvent(event: BillingEventWrite): Promise<void> {
    if (this.events.has(event.id)) {
      throw uniqueViolation();
    }
    this.events.set(event.id, { ...event });
  }

  async finishEvent(
    id: string,
    result: { organizationId: string | null; outcome: string },
  ): Promise<void> {
    const event = this.events.get(id);
    if (event) {
      this.events.set(id, { ...event, ...result });
    }
  }

  async upsertSubscription(orgId: string, data: SubscriptionWrite): Promise<Subscription> {
    const org = this.require(orgId);
    const existing = org.subscription;
    const row: Subscription = existing
      ? { ...existing, ...stripUndefined(data), updatedAt: NOW }
      : {
          ...subscriptionRow({ id: `sub_row_${orgId}`, organizationId: orgId, createdAt: NOW }),
          identifier: null,
          currentPeriodEnd: null,
          totalChannels: 0,
          ...stripUndefined(data),
        };
    org.subscription = row;
    return clone(row);
  }

  async updateSubscription(orgId: string, data: Partial<SubscriptionWrite>): Promise<void> {
    const org = this.require(orgId);
    if (org.subscription) {
      org.subscription = { ...org.subscription, ...stripUndefined(data) };
    }
  }

  async updateOrganization(orgId: string, data: OrganizationWrite): Promise<void> {
    const org = this.require(orgId);
    Object.assign(org, stripUndefined(data));
  }

  async createNotification(notification: NotificationWrite): Promise<void> {
    this.notifications.push({ ...notification });
  }

  // --- BillingRepository extras ----------------------------------------------

  async transaction<T>(work: (store: BillingStore) => Promise<T>): Promise<T> {
    const snapshot = {
      orgs: new Map([...this.orgs].map(([id, org]) => [id, clone(org)])),
      events: new Map(this.events),
      notifications: [...this.notifications],
    };

    try {
      return await work(this);
    } catch (error) {
      this.orgs = snapshot.orgs;
      this.events = snapshot.events;
      this.notifications = snapshot.notifications;
      throw error;
    }
  }

  async countLiveChannels(orgId: string): Promise<number> {
    return this.liveChannels.get(orgId) ?? 0;
  }

  async hasAnySubscription(orgId: string): Promise<boolean> {
    return this.orgs.get(orgId)?.subscription !== null;
  }

  async sumCreditsUsed(): Promise<number> {
    return this.creditsUsed;
  }

  // --- helpers ---------------------------------------------------------------

  org(orgId = 'org_1'): OrgBilling {
    return this.require(orgId);
  }

  subscription(orgId = 'org_1'): Subscription {
    const row = this.require(orgId).subscription;
    if (!row) {
      throw new Error(`No subscription for ${orgId}`);
    }
    return row;
  }

  private require(orgId: string): OrgBilling {
    const org = this.orgs.get(orgId);
    if (!org) {
      throw new Error(`Unknown org ${orgId}`);
    }
    return org;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
