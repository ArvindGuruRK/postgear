/**
 * The operator's plans, overrides, usage and Change Log (Sprint 12, Module 19
 * section 8, research 12 section 8).
 *
 * ## Order of writes
 *
 * Every write is the same shape: validate each value with the registry
 * (`validatePlanValue`, `validateOverride`), write the rows and their Change
 * Log rows in one transaction (the repository), then after the commit drop
 * the resolver's cache and set the Redis stamp (`ent:plans` or
 * `ent:org:<id>`) so every API instance sees the change within about a
 * second, log `entitlement.changed` per row, and record the save
 * (`operator.action` and one mail to the owner, printed to the console
 * outside production).
 *
 * A screen that read a row before someone else saved it gets 409 with the
 * conflict sentence, and nothing of its save is kept.
 *
 * ## Never a lock-out
 *
 * The resolver skips a stored value that no longer validates (and logs it),
 * so a bad cell can never lock a workspace out; this screen shows such a
 * cell as "Not valid" so the operator can fix it. `ENTITLEMENTS_SOURCE=seed`
 * stays the escape hatch.
 *
 * The workspace is always the path's id, never the org cookie.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@postgear/db';
import {
  defaultValue,
  type EntitlementValue,
  formatEntitlementValue,
  getDef,
  isTier,
  KEYS,
  type Key,
  METER_KEYS,
  type MeterKey,
  MILLI,
  REGISTRY,
  type ResolveSource,
  resolve,
  seedValue,
  TIERS,
  type Tier,
  validateOverride,
  validatePlanValue,
} from '@postgear/entitlements';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { securityLogger } from '../../../common/logging/security-logger';
import { resolveEntitlement } from '../../billing/plans';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { OperatorAuditService } from '../operator-audit.service';
import { OPERATOR_ENTITLEMENT_MESSAGES } from './operator-entitlements.messages';
import {
  type Actor,
  AdjustBelowZeroError,
  OperatorEntitlementsRepository,
  StaleWrite,
  type WorkspaceRow,
  type WrittenChange,
} from './operator-entitlements.repository';
import {
  type AdjustUsageInput,
  CHANGES_PAGE_SIZE,
  type ChangesQuery,
  type DeleteOverrideInput,
  ORG_ID_PATTERN,
  type PutOverrideInput,
  type SavePlansInput,
} from './operator-entitlements.schema';

/** How far ahead the Plans tab warns about overrides that are about to end. */
export const ENDING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Retries of an adjustment that a concurrent charge aborted (`P2034`). */
const LEDGER_RETRIES = 3;

// ---- Views (mirrored in apps/web/src/types/operator.ts) ----------------------------

export interface PlanCellView {
  tier: Tier;
  key: Key;
  /** The stored value, or the registry default when there is no row. */
  value: unknown;
  /** The row's `updatedAt`, sent back with an edit; null when there is no row. */
  updatedAt: Date | null;
  seed: unknown;
  /** False when the stored value no longer validates: the resolver skips it. */
  valid: boolean;
}

export interface PlansView {
  tiers: Tier[];
  keys: Array<{ key: Key; label: string; group: string; description: string }>;
  cells: PlanCellView[];
  endingSoon: Array<{
    organizationId: string;
    organizationName: string;
    key: string;
    label: string;
    expiresAt: Date;
  }>;
}

export interface WorkspaceSummaryView {
  id: string;
  name: string;
  tier: Tier;
  status: string;
  trialEndsAt: Date | null;
  adminEmail: string | null;
  members: number;
  createdAt: Date;
}

export interface ResolvedValueView {
  key: Key;
  label: string;
  value: unknown;
  source: ResolveSource;
  /** What the plan alone would give (its row, or the default). */
  planValue: unknown;
}

export interface OverrideView {
  key: string;
  label: string;
  value: unknown;
  expiresAt: Date;
  reason: string;
  /** The operator's address, or their id when the account is gone. */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** False once its end date has passed (the row stays as history until replaced or removed). */
  active: boolean;
}

export interface WorkspaceEntitlementsView {
  workspace: WorkspaceSummaryView;
  values: ResolvedValueView[];
  overrides: OverrideView[];
}

export interface MeterView {
  key: MeterKey;
  label: string;
  unit: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  cycleStart: Date;
  cycleEnd: Date;
}

export interface UsageEntryView {
  id: string;
  createdAt: Date;
  meter: string;
  label: string;
  /** Display units, signed (a reversal is negative). */
  units: number;
  kind: string;
  /** The job or row it was for, or the entry a reversal gives back. */
  reference: string | null;
  note: string | null;
}

export interface UsageView {
  workspace: WorkspaceSummaryView;
  meters: MeterView[];
  entries: UsageEntryView[];
}

export interface ChangeView {
  id: string;
  createdAt: Date;
  scope: string;
  tier: string | null;
  organizationId: string | null;
  organizationName: string | null;
  key: string;
  label: string;
  action: string;
  /** Formatted ("50 GB", "Unlimited", "On"); null when there was no value. */
  old: string | null;
  new: string | null;
  reason: string;
  actorEmail: string | null;
}

export interface ChangesPage {
  changes: ChangeView[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

type ActorUser = Pick<AuthenticatedUser, 'id' | 'email'>;

/** "Pro", "Free": a tier as a person reads it. */
export function tierName(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

function labelOf(key: string): string {
  return getDef(key)?.label ?? key;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class OperatorEntitlementsService {
  private readonly logger = new Logger(OperatorEntitlementsService.name);

  constructor(
    private readonly repository: OperatorEntitlementsRepository,
    private readonly resolver: EntitlementResolver,
    private readonly usage: UsageService,
    private readonly audit: OperatorAuditService,
  ) {}

  // ---- Plans -------------------------------------------------------------------

  /** `GET /operator/entitlements/plans`: every key, every tier, the seed beside each value. */
  async plans(now: Date = new Date()): Promise<PlansView> {
    const [rows, ending] = await Promise.all([
      this.repository.planRows(),
      this.repository.endingOverrides(now, new Date(now.getTime() + ENDING_SOON_DAYS * DAY_MS)),
    ]);
    const stored = new Map(rows.map((row) => [`${row.tier}|${row.key}`, row]));
    const cells: PlanCellView[] = [];
    for (const key of KEYS) {
      for (const tier of TIERS) {
        const row = stored.get(`${tier}|${key}`);
        const def = REGISTRY[key];
        const valid = !row || validatePlanValue({ tier, key, value: row.value }).ok;
        if (!valid) {
          this.logger.warn(
            JSON.stringify({ event: 'entitlement.value_ignored', scope: `tier:${tier}`, key }),
          );
        }
        cells.push({
          tier,
          key,
          value: row ? row.value : def.default,
          updatedAt: row?.updatedAt ?? null,
          seed: seedValue(tier, key),
          valid,
        });
      }
    }
    return {
      tiers: [...TIERS],
      keys: KEYS.map((key) => ({
        key,
        label: REGISTRY[key].label,
        group: REGISTRY[key].group,
        description: REGISTRY[key].description,
      })),
      cells,
      endingSoon: ending.map((row) => ({ ...row, label: labelOf(row.key) })),
    };
  }

  /** `PUT /operator/entitlements/plans`: the edited cells, one transaction, one record. */
  async savePlans(
    input: SavePlansInput,
    user: ActorUser,
  ): Promise<{ saved: number; plans: PlansView }> {
    const actor: Actor = { id: user.id, email: user.email };
    const writes = input.cells.map((cell) => {
      const reset = 'reset' in cell;
      const value = reset ? seedValue(cell.tier, cell.key) : cell.value;
      const checked = validatePlanValue({ tier: cell.tier, key: cell.key, value });
      if (!checked.ok) {
        throw new UnprocessableEntityException({
          message: checked.issues[0]?.message ?? OPERATOR_ENTITLEMENT_MESSAGES.NOTHING_CHANGED,
          code: 'invalid_value',
        });
      }
      return {
        tier: cell.tier,
        key: cell.key,
        value: checked.value.value,
        expected: cell.updatedAt ? new Date(cell.updatedAt) : null,
        action: reset ? ('RESET_TO_SEED' as const) : ('SET' as const),
      };
    });

    let written: WrittenChange[];
    try {
      written = await this.repository.savePlanCells(writes, input.reason, actor);
    } catch (error) {
      throw this.conflictOr(error, { scope: 'PLAN', actorId: actor.id });
    }

    if (written.length > 0) {
      await this.resolver.invalidatePlans();
      this.logChanges(written, actor);
      await this.audit.record(actor, {
        action: 'plans.saved',
        summary: `${written.length} plan ${written.length === 1 ? 'value' : 'values'} changed`,
        lines: written.map(
          (change) =>
            `${labelOf(change.key)}, ${tierName(change.tier ?? '')}: ${this.shown(change.key, change.oldMissing ? defaultValue(change.key as Key) : change.oldValue)} to ${this.shown(change.key, change.newValue)}`,
        ),
        reason: input.reason,
        target: { cells: written.length, changeIds: written.map((change) => change.id) },
      });
    }
    return { saved: written.length, plans: await this.plans() };
  }

  // ---- Workspaces -----------------------------------------------------------------

  /** `GET /operator/workspaces?q=`. */
  async searchWorkspaces(q: string | undefined): Promise<{ workspaces: WorkspaceSummaryView[] }> {
    const rows = await this.repository.searchWorkspaces(q ?? '');
    return { workspaces: rows.map((row) => this.summary(row)) };
  }

  /** `GET /operator/workspaces/:orgId/entitlements`: what applies, where it came from, the deals. */
  async workspaceEntitlements(
    orgId: string,
    now: Date = new Date(),
  ): Promise<WorkspaceEntitlementsView> {
    const workspace = await this.requireWorkspace(orgId);
    const [state, rows] = await Promise.all([
      this.resolver.context(orgId, now),
      this.repository.overrides(orgId),
    ]);

    const values: ResolvedValueView[] = KEYS.map((key) => {
      const planValue = state.planValues.get(key);
      const resolved = resolve(key, { override: state.overrides.get(key) ?? null, planValue, now });
      for (const layer of resolved.rejected) {
        this.logger.warn(
          JSON.stringify({
            event: 'entitlement.value_ignored',
            scope: `org:${orgId}`,
            key,
            layer: layer.source,
          }),
        );
      }
      return {
        key,
        label: REGISTRY[key].label,
        value: resolved.value,
        source: resolved.source,
        planValue: resolve(key, { planValue, now }).value,
      };
    });

    const emails = await this.repository.emailsOf([...new Set(rows.map((row) => row.createdBy))]);
    const overrides: OverrideView[] = rows.map((row) => ({
      key: row.key,
      label: labelOf(row.key),
      value: row.value,
      expiresAt: row.expiresAt,
      reason: row.reason,
      createdBy: emails.get(row.createdBy) ?? row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      active: row.expiresAt.getTime() > now.getTime(),
    }));

    return { workspace: this.summary(workspace, now), values, overrides };
  }

  /** `PUT /operator/workspaces/:orgId/overrides/:key`: add or change one deal. */
  async putOverride(
    orgId: string,
    rawKey: string,
    input: PutOverrideInput,
    user: ActorUser,
  ): Promise<WorkspaceEntitlementsView> {
    const workspace = await this.requireWorkspace(orgId);
    const now = new Date();
    const checked = validateOverride(
      { key: rawKey, value: input.value, expiresAt: input.expiresAt, reason: input.reason },
      now,
    );
    if (!checked.ok) {
      const issue = checked.issues[0];
      throw new UnprocessableEntityException({
        message: issue?.message ?? OPERATOR_ENTITLEMENT_MESSAGES.NOTHING_CHANGED,
        code: issue?.field === 'expiresAt' ? 'invalid_end_date' : 'invalid_value',
      });
    }
    const actor: Actor = { id: user.id, email: user.email };
    let change: WrittenChange;
    try {
      change = await this.repository.putOverride(
        orgId,
        {
          key: checked.value.key,
          value: checked.value.value,
          expiresAt: checked.value.expiresAt,
          expected: input.updatedAt ? new Date(input.updatedAt) : null,
        },
        checked.value.reason,
        actor,
      );
    } catch (error) {
      throw this.conflictOr(error, { scope: 'ORG', orgId, actorId: actor.id });
    }

    await this.resolver.invalidateOrg(orgId);
    this.logChanges([change], actor);
    await this.audit.record(actor, {
      action: 'overrides.saved',
      summary: `an override for ${workspace.name}`,
      lines: [
        `${labelOf(change.key)}, ${workspace.name}: ${change.oldMissing ? 'the plan value' : this.shown(change.key, change.oldValue)} to ${this.shown(change.key, change.newValue)}`,
        `Ends on: ${checked.value.expiresAt.toISOString().slice(0, 10)}`,
        `Workspace: ${orgId}`,
      ],
      reason: checked.value.reason,
      target: { orgId, key: change.key, changeId: change.id },
    });
    return this.workspaceEntitlements(orgId);
  }

  /** `DELETE /operator/workspaces/:orgId/overrides/:key`: the workspace goes back to its plan, now. */
  async removeOverride(
    orgId: string,
    rawKey: string,
    input: DeleteOverrideInput,
    user: ActorUser,
  ): Promise<WorkspaceEntitlementsView> {
    const workspace = await this.requireWorkspace(orgId);
    if (!getDef(rawKey))
      throw new NotFoundException(OPERATOR_ENTITLEMENT_MESSAGES.OVERRIDE_NOT_FOUND);
    const key = rawKey as Key;
    const actor: Actor = { id: user.id, email: user.email };
    let change: WrittenChange | null;
    try {
      change = await this.repository.removeOverride(
        orgId,
        key,
        new Date(input.updatedAt),
        input.reason,
        actor,
      );
    } catch (error) {
      throw this.conflictOr(error, { scope: 'ORG', orgId, actorId: actor.id });
    }
    if (!change) throw new NotFoundException(OPERATOR_ENTITLEMENT_MESSAGES.OVERRIDE_NOT_FOUND);

    await this.resolver.invalidateOrg(orgId);
    this.logChanges([change], actor);
    await this.audit.record(actor, {
      action: 'overrides.removed',
      summary: `an override removed from ${workspace.name}`,
      lines: [
        `${labelOf(key)}, ${workspace.name}: ${this.shown(key, change.oldValue)} removed. The plan's value applies now.`,
        `Workspace: ${orgId}`,
      ],
      reason: input.reason,
      target: { orgId, key, changeId: change.id },
    });
    return this.workspaceEntitlements(orgId);
  }

  // ---- Usage -------------------------------------------------------------------------

  /** `GET /operator/workspaces/:orgId/usage`: each meter this cycle and the last 50 entries. */
  async usageOf(orgId: string, now: Date = new Date()): Promise<UsageView> {
    const workspace = await this.requireWorkspace(orgId);
    const [meters, entries] = await Promise.all([
      Promise.all(
        METER_KEYS.map(async (key): Promise<MeterView> => {
          const meter = await this.resolver.meter(orgId, key, now);
          return { key, label: REGISTRY[key].label, unit: REGISTRY[key].unit, ...meter };
        }),
      ),
      this.repository.entries(orgId),
    ]);
    return {
      workspace: this.summary(workspace, now),
      meters,
      entries: entries.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        meter: entry.meter,
        label: labelOf(entry.meter),
        units: entry.units / MILLI,
        kind: entry.kind,
        reference: entry.refId ?? entry.reversesId,
        note: noteOf(entry.meta),
      })),
    };
  }

  /**
   * `POST /operator/workspaces/:orgId/usage/adjust`: an ADJUSTMENT on the
   * ledger and its Change Log row (used before and after), in one
   * Serializable transaction. The key the dialog made makes a double click
   * one row: the second answers `duplicate: true` and writes nothing.
   */
  async adjustUsage(
    orgId: string,
    input: AdjustUsageInput,
    user: ActorUser,
  ): Promise<{ duplicate: boolean; usage: UsageView }> {
    const workspace = await this.requireWorkspace(orgId);
    if (!getDef(input.meter) || REGISTRY[input.meter].type !== 'meter') {
      throw new BadRequestException(OPERATOR_ENTITLEMENT_MESSAGES.NOT_A_METER);
    }
    const actor: Actor = { id: user.id, email: user.email };
    const now = new Date();
    const window = await this.resolver.windowFor(orgId, input.meter, now);

    let change: WrittenChange | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        change = await this.repository.adjust(
          {
            orgId,
            meter: input.meter,
            cycleStart: window.start,
            idempotencyKey: input.idempotencyKey,
          },
          (tx) =>
            this.usage.adjustWithin(tx, orgId, input.meter, input.units, {
              reason: input.reason,
              actorId: actor.id,
              idempotencyKey: input.idempotencyKey,
              cycleStart: window.start,
            }),
          input.reason,
          actor,
        );
        break;
      } catch (error) {
        // The same key, saved by a click that won the race: that row is the answer.
        if (isPrismaCode(error, 'P2002')) {
          change = null;
          break;
        }
        if (isPrismaCode(error, 'P2034') && attempt < LEDGER_RETRIES) continue;
        if (error instanceof AdjustBelowZeroError) {
          throw new UnprocessableEntityException({
            message: OPERATOR_ENTITLEMENT_MESSAGES.ADJUST_BELOW_ZERO,
            code: 'usage_below_zero',
          });
        }
        throw error;
      }
    }

    if (change) {
      await this.resolver.invalidateOrg(orgId);
      this.logChanges([change], actor);
      const sign = input.units > 0 ? '+' : '';
      await this.audit.record(actor, {
        action: 'usage.adjusted',
        summary: `usage adjusted for ${workspace.name}`,
        lines: [
          `${labelOf(input.meter)}, ${workspace.name}: ${sign}${input.units} (${this.shown(input.meter, change.oldValue)} to ${this.shown(input.meter, change.newValue)} used this cycle)`,
          `Workspace: ${orgId}`,
        ],
        reason: input.reason,
        target: { orgId, meter: input.meter, changeId: change.id },
      });
    }
    return { duplicate: change === null, usage: await this.usageOf(orgId) };
  }

  // ---- The Change Log ------------------------------------------------------------------

  /** `GET /operator/changes`: newest first, read only. */
  async changes(query: ChangesQuery): Promise<ChangesPage> {
    const rows = await this.repository.changes({
      scope: query.scope,
      key: query.key,
      orgId: query.orgId,
      actor: query.actor || undefined,
      limit: CHANGES_PAGE_SIZE + 1,
      offset: (query.page - 1) * CHANGES_PAGE_SIZE,
    });
    return {
      changes: rows.slice(0, CHANGES_PAGE_SIZE).map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        scope: row.scope,
        tier: row.tier,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        key: row.key,
        label: labelOf(row.key),
        action: row.action,
        old: row.oldMissing ? null : this.shown(row.key, row.oldValue),
        new: row.newMissing ? null : this.shown(row.key, row.newValue),
        reason: row.reason,
        actorEmail: row.actorEmail,
      })),
      page: query.page,
      pageSize: CHANGES_PAGE_SIZE,
      hasMore: rows.length > CHANGES_PAGE_SIZE,
    };
  }

  // ---- Internals -----------------------------------------------------------------------

  private async requireWorkspace(orgId: string): Promise<WorkspaceRow> {
    if (!ORG_ID_PATTERN.test(orgId)) {
      throw new NotFoundException(OPERATOR_ENTITLEMENT_MESSAGES.WORKSPACE_NOT_FOUND);
    }
    const workspace = await this.repository.workspace(orgId);
    if (!workspace) throw new NotFoundException(OPERATOR_ENTITLEMENT_MESSAGES.WORKSPACE_NOT_FOUND);
    return workspace;
  }

  private summary(row: WorkspaceRow, now: Date = new Date()): WorkspaceSummaryView {
    const entitlement = resolveEntitlement(row.subscription, now);
    return {
      id: row.id,
      name: row.name,
      tier: isTier(entitlement.tier) ? entitlement.tier : 'FREE',
      status: entitlement.status,
      trialEndsAt: entitlement.trialEndsAt,
      adminEmail: row.adminEmail,
      members: row.members,
      createdAt: row.createdAt,
    };
  }

  /** A value as the record reads it: "50 GB", "Unlimited", "On". */
  private shown(key: string, value: unknown): string {
    return formatEntitlementValue(key, value as EntitlementValue);
  }

  private logChanges(changes: WrittenChange[], actor: Actor): void {
    for (const change of changes) {
      securityLogger.log('entitlement.changed', {
        changeId: change.id,
        scope: change.organizationId
          ? change.action === 'ADJUST_USAGE'
            ? 'USAGE'
            : 'ORG'
          : 'PLAN',
        action: change.action,
        tier: change.tier,
        orgId: change.organizationId,
        key: change.key,
        actorId: actor.id,
      });
    }
  }

  /** 409 with the conflict sentence for a stale screen; anything else passes through. */
  private conflictOr(error: unknown, context: Record<string, unknown>): unknown {
    if (error instanceof StaleWrite) {
      this.logger.log(JSON.stringify({ event: 'operator.write_conflict', ...context }));
      return new ConflictException({
        message: OPERATOR_ENTITLEMENT_MESSAGES.CONFLICT,
        code: 'operator_conflict',
      });
    }
    return error;
  }
}

/** The reason an operator gave for an adjustment, the only note a ledger entry carries. */
function noteOf(meta: unknown): string | null {
  if (meta && typeof meta === 'object' && 'reason' in meta) {
    const reason = (meta as { reason: unknown }).reason;
    return typeof reason === 'string' ? reason : null;
  }
  return null;
}
