/**
 * The rows behind the operator's plan, override, usage and Change Log screens
 * (Sprint 12, Module 19 section 8). The only file in the admin module that
 * touches these tables.
 *
 * ## Writes and the Change Log
 *
 * Every write runs in one transaction with its `EntitlementChange` rows (old
 * and new value, the operator's id and an email snapshot), so a value never
 * changes without its record, and a record never names a change that did
 * not happen. The Change Log is insert only: nothing here updates or deletes
 * a change row.
 *
 * ## Stale screens
 *
 * The screen sends the `updatedAt` it read each row with. A row whose
 * `updatedAt` moved since (another operator saved first), a row that
 * appeared, or one that went away, ends the transaction with `StaleWrite`,
 * so nothing of the save is kept and the service answers 409. The check is
 * the `updatedAt` in the `WHERE` of the write itself, so two saves racing
 * between the read and the write cannot both pass.
 *
 * Operator routes are about the whole platform, so nothing here is scoped by
 * the org cookie: the workspace is always the id from the path.
 */
import { Injectable } from '@nestjs/common';
import {
  EntitlementChangeAction,
  Prisma,
  type PrismaTransactionClient,
  prisma,
  Role,
  type UsageEntry,
} from '@postgear/db';
import {
  displayUsed,
  type EntitlementValue,
  type Key,
  type MeterKey,
  type Tier,
} from '@postgear/entitlements';
import type { SubscriptionLike } from '../../ai/credits/credits.policy';
import { SUBSCRIPTION_ENTITLEMENT_SELECT } from '../../ai/credits/credits.repository';
import type { ChangeScope } from './operator-entitlements.schema';

/** A write whose screen was out of date: the transaction rolls back and the route answers 409. */
export class StaleWrite extends Error {
  constructor() {
    super('stale');
    this.name = 'StaleWrite';
  }
}

/** An adjustment that would take a meter's used below zero: rolls back, the route answers 422. */
export class AdjustBelowZeroError extends Error {
  constructor() {
    super('below zero');
    this.name = 'AdjustBelowZeroError';
  }
}

/** Who made a change, as the Change Log keeps it. */
export interface Actor {
  id: string;
  email: string;
}

export interface PlanRowView {
  tier: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

/** One cell of a plan save, already validated. */
export interface PlanWrite {
  tier: Tier;
  key: Key;
  value: EntitlementValue;
  /** The `updatedAt` the screen read; null when it saw no row. */
  expected: Date | null;
  action: 'SET' | 'RESET_TO_SEED';
}

/** A change that was written, for the record and the log. */
export interface WrittenChange {
  id: string;
  tier: Tier | null;
  organizationId: string | null;
  key: string;
  action: EntitlementChangeAction;
  oldValue: unknown;
  /** True when there was no value before (no row). */
  oldMissing: boolean;
  newValue: unknown;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: Date;
  subscription: SubscriptionLike | null;
  adminEmail: string | null;
  members: number;
}

export interface OverrideRow {
  key: string;
  value: unknown;
  reason: string;
  expiresAt: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndingOverrideRow {
  organizationId: string;
  organizationName: string;
  key: string;
  expiresAt: Date;
}

export interface ChangeRow {
  id: string;
  createdAt: Date;
  scope: string;
  tier: string | null;
  organizationId: string | null;
  organizationName: string | null;
  key: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  oldMissing: boolean;
  newMissing: boolean;
  reason: string;
  actorEmail: string | null;
}

export interface ChangeFilter {
  scope?: ChangeScope;
  key?: string;
  orgId?: string;
  actor?: string;
  limit: number;
  offset: number;
}

type ChangeClient = Pick<PrismaTransactionClient, 'entitlementChange'>;

/** A JSON value as Prisma stores it: a JSON `null` is `JsonNull`, never a missing value. */
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/** `%` and `_` typed into a filter are letters, not wildcards. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function isUniqueClash(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const WORKSPACE_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  subscription: { select: SUBSCRIPTION_ENTITLEMENT_SELECT },
  users: {
    where: { role: Role.ADMIN, disabled: false },
    select: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
  _count: { select: { users: true } },
} satisfies Prisma.OrganizationSelect;

type WorkspaceSelected = Prisma.OrganizationGetPayload<{ select: typeof WORKSPACE_SELECT }>;

function toWorkspace(row: WorkspaceSelected): WorkspaceRow {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    subscription: row.subscription,
    adminEmail: row.users[0]?.user.email ?? null,
    members: row._count.users,
  };
}

/** Workspaces a search lists at most. */
export const WORKSPACE_RESULTS = 20;

/** Ledger entries the Usage tab lists. */
export const USAGE_ENTRIES = 50;

@Injectable()
export class OperatorEntitlementsRepository {
  // ---- Plans -------------------------------------------------------------------

  planRows(): Promise<PlanRowView[]> {
    return prisma.planEntitlement.findMany({
      select: { tier: true, key: true, value: true, updatedAt: true },
    });
  }

  /** Overrides still running that end at or before `until`, soonest first. */
  async endingOverrides(now: Date, until: Date): Promise<EndingOverrideRow[]> {
    const rows = await prisma.orgEntitlementOverride.findMany({
      where: { expiresAt: { gt: now, lte: until } },
      select: {
        organizationId: true,
        key: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    return rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      key: row.key,
      expiresAt: row.expiresAt,
    }));
  }

  /**
   * Saves the edited cells and their Change Log rows in one transaction. A
   * cell whose value is already saved is skipped (no row, no record).
   * Throws `StaleWrite` (everything rolled back) when any row moved since
   * the screen read it.
   */
  async savePlanCells(cells: PlanWrite[], reason: string, actor: Actor): Promise<WrittenChange[]> {
    try {
      return await prisma.$transaction(async (tx) => {
        const written: WrittenChange[] = [];
        for (const cell of cells) {
          const where = { tier_key: { tier: cell.tier, key: cell.key } };
          const row = await tx.planEntitlement.findUnique({
            where,
            select: { value: true, updatedAt: true },
          });
          if (!row) {
            if (cell.expected) throw new StaleWrite();
            await tx.planEntitlement.create({
              data: {
                tier: cell.tier,
                key: cell.key,
                value: json(cell.value),
                updatedBy: actor.id,
              },
            });
          } else {
            if (!cell.expected || row.updatedAt.getTime() !== cell.expected.getTime()) {
              throw new StaleWrite();
            }
            if (row.value === cell.value) continue;
            const { count } = await tx.planEntitlement.updateMany({
              where: { tier: cell.tier, key: cell.key, updatedAt: row.updatedAt },
              data: { value: json(cell.value), updatedBy: actor.id },
            });
            if (count !== 1) throw new StaleWrite();
          }
          written.push(
            await this.record(tx, {
              scope: 'PLAN',
              tier: cell.tier,
              organizationId: null,
              key: cell.key,
              action: EntitlementChangeAction[cell.action],
              oldValue: row ? row.value : undefined,
              newValue: cell.value,
              reason,
              actor,
            }),
          );
        }
        return written;
      });
    } catch (error) {
      if (isUniqueClash(error)) throw new StaleWrite();
      throw error;
    }
  }

  // ---- Workspaces ----------------------------------------------------------------

  /** By id, name or an admin's address; the newest workspaces when `q` is empty. */
  async searchWorkspaces(q: string): Promise<WorkspaceRow[]> {
    const text = q.trim();
    const where: Prisma.OrganizationWhereInput = text
      ? {
          OR: [
            { id: text },
            { name: { contains: text, mode: 'insensitive' } },
            {
              users: {
                some: {
                  role: Role.ADMIN,
                  disabled: false,
                  user: { email: { contains: text, mode: 'insensitive' } },
                },
              },
            },
          ],
        }
      : {};
    const rows = await prisma.organization.findMany({
      where,
      select: WORKSPACE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: WORKSPACE_RESULTS,
    });
    return rows.map(toWorkspace);
  }

  async workspace(orgId: string): Promise<WorkspaceRow | null> {
    const row = await prisma.organization.findUnique({
      where: { id: orgId },
      select: WORKSPACE_SELECT,
    });
    return row ? toWorkspace(row) : null;
  }

  // ---- Overrides -----------------------------------------------------------------

  overrides(orgId: string): Promise<OverrideRow[]> {
    return prisma.orgEntitlementOverride.findMany({
      where: { organizationId: orgId },
      select: {
        key: true,
        value: true,
        reason: true,
        expiresAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /** Operators' addresses by user id, for the "who" of an override. */
  async emailsOf(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
  }

  /**
   * Adds or changes one override with its SET row. `expected` is the
   * existing override's `updatedAt`, or null for a new one.
   */
  async putOverride(
    orgId: string,
    write: { key: Key; value: EntitlementValue; expiresAt: Date; expected: Date | null },
    reason: string,
    actor: Actor,
  ): Promise<WrittenChange> {
    try {
      return await prisma.$transaction(async (tx) => {
        const where = { organizationId_key: { organizationId: orgId, key: write.key } };
        const row = await tx.orgEntitlementOverride.findUnique({
          where,
          select: { value: true, updatedAt: true },
        });
        const data = {
          value: json(write.value),
          reason,
          expiresAt: write.expiresAt,
          createdBy: actor.id,
        };
        if (!row) {
          if (write.expected) throw new StaleWrite();
          await tx.orgEntitlementOverride.create({
            data: { organizationId: orgId, key: write.key, ...data },
          });
        } else {
          if (!write.expected || row.updatedAt.getTime() !== write.expected.getTime()) {
            throw new StaleWrite();
          }
          const { count } = await tx.orgEntitlementOverride.updateMany({
            where: { organizationId: orgId, key: write.key, updatedAt: row.updatedAt },
            data,
          });
          if (count !== 1) throw new StaleWrite();
        }
        return this.record(tx, {
          scope: 'ORG',
          tier: null,
          organizationId: orgId,
          key: write.key,
          action: EntitlementChangeAction.SET,
          oldValue: row ? row.value : undefined,
          newValue: write.value,
          reason,
          actor,
        });
      });
    } catch (error) {
      if (isUniqueClash(error)) throw new StaleWrite();
      throw error;
    }
  }

  /**
   * Removes one override with its REMOVE row. Null when there is none;
   * `StaleWrite` when it changed since the screen read it.
   */
  async removeOverride(
    orgId: string,
    key: Key,
    expected: Date,
    reason: string,
    actor: Actor,
  ): Promise<WrittenChange | null> {
    return prisma.$transaction(async (tx) => {
      const row = await tx.orgEntitlementOverride.findUnique({
        where: { organizationId_key: { organizationId: orgId, key } },
        select: { value: true, updatedAt: true },
      });
      if (!row) return null;
      if (row.updatedAt.getTime() !== expected.getTime()) throw new StaleWrite();
      const { count } = await tx.orgEntitlementOverride.deleteMany({
        where: { organizationId: orgId, key, updatedAt: row.updatedAt },
      });
      if (count !== 1) throw new StaleWrite();
      return this.record(tx, {
        scope: 'ORG',
        tier: null,
        organizationId: orgId,
        key,
        action: EntitlementChangeAction.REMOVE,
        oldValue: row.value,
        newValue: undefined,
        reason,
        actor,
      });
    });
  }

  // ---- Usage -------------------------------------------------------------------------

  /** The workspace's newest ledger entries, any meter, any cycle. */
  entries(orgId: string): Promise<UsageEntry[]> {
    return prisma.usageEntry.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: USAGE_ENTRIES,
    });
  }

  /**
   * An operator's adjustment and its Change Log row (used this cycle before
   * and after, in display units) in one Serializable transaction, the
   * ledger's own isolation. `insert` writes the ledger row through
   * `UsageService.adjustWithin`. Null when the key was already used (a
   * second click of the same dialog): nothing is written. A concurrent
   * charge aborts it with `P2034` and a key that won a race with `P2002`;
   * the service decides.
   */
  adjust(
    target: { orgId: string; meter: MeterKey; cycleStart: Date; idempotencyKey: string },
    insert: (client: Pick<PrismaTransactionClient, 'usageEntry'>) => Promise<UsageEntry>,
    reason: string,
    actor: Actor,
  ): Promise<WrittenChange | null> {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.usageEntry.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: target.orgId,
              idempotencyKey: target.idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (existing) return null;
        const before = await tx.usageEntry.aggregate({
          where: {
            organizationId: target.orgId,
            meter: target.meter,
            cycleStart: target.cycleStart,
          },
          _sum: { units: true },
        });
        const usedBefore = before._sum.units ?? 0;
        const entry = await insert(tx);
        // Used never goes below zero (Module 20 sweep): a credit above the plan
        // is an override's job. Throwing rolls the ledger row back.
        if (usedBefore + entry.units < 0) throw new AdjustBelowZeroError();
        return this.record(tx, {
          scope: 'USAGE',
          tier: null,
          organizationId: target.orgId,
          key: target.meter,
          action: EntitlementChangeAction.ADJUST_USAGE,
          oldValue: displayUsed(usedBefore),
          newValue: displayUsed(usedBefore + entry.units),
          reason,
          actor,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 },
    );
  }

  // ---- The Change Log ------------------------------------------------------------------

  /**
   * Newest first, filtered. Raw SQL so a value that was never there (no row
   * before a first save, nothing after a removal) can be told apart from a
   * stored JSON `null` (unlimited): Prisma reads both as `null`.
   */
  async changes(filter: ChangeFilter): Promise<ChangeRow[]> {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.scope) where.push(Prisma.sql`c.scope = ${filter.scope}`);
    if (filter.key) where.push(Prisma.sql`c.key = ${filter.key}`);
    if (filter.orgId) where.push(Prisma.sql`c."organizationId" = ${filter.orgId}`);
    if (filter.actor) {
      where.push(Prisma.sql`c."actorEmail" ILIKE ${likePattern(filter.actor)}`);
    }
    return prisma.$queryRaw<ChangeRow[]>`
      SELECT c.id, c."createdAt", c.scope, c.tier, c."organizationId", o.name AS "organizationName",
             c.key, c.action::text AS action, c."oldValue", c."newValue",
             (c."oldValue" IS NULL) AS "oldMissing", (c."newValue" IS NULL) AS "newMissing",
             c.reason, c."actorEmail"
      FROM "EntitlementChange" c
      LEFT JOIN "Organization" o ON o.id = c."organizationId"
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY c."createdAt" DESC, c.id DESC
      LIMIT ${filter.limit} OFFSET ${filter.offset}`;
  }

  // ---- Internals -----------------------------------------------------------------------

  /** One append-only Change Log row. `undefined` is "no value" (SQL NULL); `null` is unlimited. */
  private async record(
    client: ChangeClient,
    change: {
      scope: ChangeScope;
      tier: Tier | null;
      organizationId: string | null;
      key: string;
      action: EntitlementChangeAction;
      oldValue: unknown;
      newValue: unknown;
      reason: string;
      actor: Actor;
    },
  ): Promise<WrittenChange> {
    const row = await client.entitlementChange.create({
      data: {
        scope: change.scope,
        tier: change.tier,
        organizationId: change.organizationId,
        key: change.key,
        action: change.action,
        oldValue: change.oldValue === undefined ? Prisma.DbNull : json(change.oldValue),
        newValue: change.newValue === undefined ? Prisma.DbNull : json(change.newValue),
        reason: change.reason,
        actorId: change.actor.id,
        actorEmail: change.actor.email,
      },
      select: { id: true },
    });
    return {
      id: row.id,
      tier: change.tier,
      organizationId: change.organizationId,
      key: change.key,
      action: change.action,
      oldValue: change.oldValue ?? null,
      oldMissing: change.oldValue === undefined,
      newValue: change.newValue ?? null,
    };
  }
}
