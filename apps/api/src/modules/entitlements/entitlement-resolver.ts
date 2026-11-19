/**
 * What a workspace's plan allows, right now (Sprint 12, research 12
 * section 6).
 *
 * ## Order
 *
 * An unexpired workspace override, then the tier's `PlanEntitlement` row,
 * then the registry default (the Free value, so a missing row can never
 * grant more than Free). A stored value that no longer validates is
 * skipped, logged once, and the next layer answers. The tier is
 * `resolveEntitlement(subscription, now).tier`: a trial is PRO, an expired
 * trial and no subscription are FREE. The rules themselves are the pure
 * `resolve` in `@postgear/entitlements`; this class only fetches and caches.
 *
 * ## Caching
 *
 * The whole plan table, and per workspace its overrides and subscription,
 * are kept for 15 seconds. A Redis stamp per scope (`ent:plans`,
 * `ent:org:<orgId>`) is read at most once a second; a stamp that changed
 * drops the copy, so an edit shows everywhere within about a second. A fill
 * that raced a write (the stamp moved while it read) is used for that one
 * answer and not kept. With the database down, a copy that is too old but
 * present still answers (stale beats locked out); with no copy at all the
 * call fails closed with a 503, never with a guess.
 *
 * ## Kill switch
 *
 * `ENTITLEMENTS_SOURCE=seed` answers every plan value from `TIER_SEED` and
 * ignores the tables and overrides, for an incident where a bad edit locks
 * workspaces out. Meters still count on the ledger.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import {
  type EntitlementDef,
  getDef,
  isTier,
  KEYS,
  type Key,
  METER_KEYS,
  type MeterKey,
  meterAmounts,
  meterWindow,
  REGISTRY,
  refusalCodeOf,
  refusalMessage,
  resolve,
  type StoredOverride,
  TIER_SEED,
  type Tier,
  type ValueOf,
} from '@postgear/entitlements';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import { resolveEntitlement } from '../billing/plans';
import { RedisService } from '../redis/redis.service';
import { EntitlementRefusedException } from './entitlement-refused.exception';
import {
  orgStampKey,
  PLANS_STAMP_KEY,
  touchOrgEntitlements,
  touchPlanEntitlements,
} from './entitlement-stamps';
import { CLIPS_ALLOWANCE_UNAVAILABLE } from './entitlements.messages';
import { EntitlementsRepository, type OrgBilling } from './entitlements.repository';

const CACHE_MS = 15_000;
const STAMP_CHECK_MS = 1_000;
/** Workspaces kept in memory; the oldest is dropped past this. */
const ORG_CACHE_MAX = 5_000;

/** A meter in display units: `used` rounds up, `limit` and `remaining` round down. */
export interface MeterState {
  used: number;
  limit: number | null;
  remaining: number | null;
  cycleStart: Date;
  cycleEnd: Date;
}

/** Internal: the same meter with the exact thousandths, for the ledger's own checks. */
export interface ExactMeter extends MeterState {
  usedMilli: number;
  limitValue: number | null;
}

/** The body of `GET /entitlements/me`, before JSON. */
export interface EntitlementSnapshot {
  tier: Tier;
  status: string;
  trialEndsAt: Date | null;
  values: Record<Key, unknown>;
  meters: Record<MeterKey, MeterState>;
}

/** The workspace facts every answer is computed from. */
export interface OrgPlanState {
  tier: Tier;
  status: string;
  trialEndsAt: Date | null;
  /** The cycle anchor: the subscription's start, else the workspace's. */
  anchor: Date;
  planValues: ReadonlyMap<string, unknown>;
  overrides: ReadonlyMap<string, StoredOverride>;
}

interface PlanCache {
  byTier: Map<string, Map<string, unknown>>;
  stamp: string | null;
  at: number;
}

interface OrgCache {
  overrides: Map<string, StoredOverride>;
  billing: OrgBilling;
  stamp: string | null;
  at: number;
}

/** Refusal sentence values a caller can add (the quality asked for, as a label). */
export interface AssertRefusal {
  used?: number;
  needed?: number;
  quality?: string;
}

@Injectable()
export class EntitlementResolver {
  private readonly logger = new Logger(EntitlementResolver.name);
  private readonly source: 'db' | 'seed';
  private plans: PlanCache | null = null;
  private readonly orgs = new Map<string, OrgCache>();
  private readonly stamps = new Map<string, { value: string | null; at: number }>();
  private readonly loggedRejections = new Set<string>();

  constructor(
    private readonly repository: EntitlementsRepository,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.source = config.get('ENTITLEMENTS_SOURCE', { infer: true });
    if (this.source === 'seed') {
      this.logger.warn(
        JSON.stringify({ event: 'entitlement.source_seed', note: 'answering from TIER_SEED' }),
      );
    }
  }

  // ---- Reading values ------------------------------------------------------

  async get<K extends Key>(orgId: string, key: K, now: Date = new Date()): Promise<ValueOf<K>> {
    return this.valueIn(await this.state(orgId, now), key, now, orgId);
  }

  async getMany(
    orgId: string,
    keys: readonly Key[],
    now: Date = new Date(),
  ): Promise<Record<Key, unknown>> {
    const state = await this.state(orgId, now);
    const values = {} as Record<Key, unknown>;
    for (const key of keys) values[key] = this.valueIn(state, key, now, orgId);
    return values;
  }

  /**
   * A ceiling or a gate: answers the limit when `predicate(limit)` holds, and
   * throws the typed 402 otherwise. `null` (unlimited) is handed to the
   * predicate too, so it decides what unlimited means for its check.
   */
  async assert<K extends Key>(
    orgId: string,
    key: K,
    predicate: (limit: ValueOf<K>) => boolean,
    refusal: AssertRefusal = {},
  ): Promise<ValueOf<K>> {
    const limit = await this.get(orgId, key);
    if (predicate(limit)) return limit;

    const code = refusalCodeOf(key) ?? 'clips_not_in_plan';
    const numeric = typeof limit === 'number' ? limit : undefined;
    this.logRefusal(orgId, key, code, numeric ?? null, refusal.used);
    throw new EntitlementRefusedException(
      code,
      refusalMessage(code, { n: numeric, need: refusal.needed, quality: refusal.quality }),
      { limit: numeric, used: refusal.used, needed: refusal.needed },
    );
  }

  /** A meter's state now, in whole display units. */
  async meter(orgId: string, key: MeterKey, now: Date = new Date()): Promise<MeterState> {
    const {
      usedMilli: _used,
      limitValue: _limit,
      ...state
    } = await this.exactMeter(orgId, key, now);
    return state;
  }

  /** The meter with its exact thousandths, for `UsageService`. */
  async exactMeter(orgId: string, key: MeterKey, now: Date = new Date()): Promise<ExactMeter> {
    const state = await this.state(orgId, now);
    return this.exactMeterIn(state, key, now, orgId);
  }

  /** The window a meter counts in for this workspace (`cycleStart` is the ledger's grouping). */
  async windowFor(
    orgId: string,
    key: MeterKey,
    now: Date = new Date(),
  ): Promise<{ start: Date; end: Date }> {
    const state = await this.state(orgId, now);
    return meterWindow(this.meterDef(key).window, state.anchor, now);
  }

  /** A tier's plan values with no workspace in view: the plan cards and the change plan dialog. */
  async previewTier(tier: Tier, keys: readonly Key[] = KEYS): Promise<Record<Key, unknown>> {
    const planValues = await this.planValuesFor(tier);
    const now = new Date();
    const values = {} as Record<Key, unknown>;
    for (const key of keys) {
      const resolved = resolve(key, { planValue: planValues.get(key), now });
      this.noteRejections(`tier:${tier}`, key, resolved.rejected);
      values[key] = resolved.value;
    }
    return values;
  }

  /** Everything `GET /entitlements/me` answers. */
  async snapshot(orgId: string, now: Date = new Date()): Promise<EntitlementSnapshot> {
    const state = await this.state(orgId, now);
    const values = {} as Record<Key, unknown>;
    for (const key of KEYS) values[key] = this.valueIn(state, key, now, orgId);

    const meters = {} as Record<MeterKey, MeterState>;
    await Promise.all(
      METER_KEYS.map(async (key) => {
        const {
          usedMilli: _used,
          limitValue: _limit,
          ...meter
        } = await this.exactMeterIn(state, key, now, orgId);
        meters[key] = meter;
      }),
    );

    return {
      tier: state.tier,
      status: state.status,
      trialEndsAt: state.trialEndsAt,
      values,
      meters,
    };
  }

  /** The workspace's tier and cycle anchor (also what the ledger groups by). */
  async context(orgId: string, now: Date = new Date()): Promise<OrgPlanState> {
    return this.state(orgId, now);
  }

  // ---- Invalidation ----------------------------------------------------------

  /** After an override edit or a subscription change: every instance re-reads this workspace. */
  async invalidateOrg(orgId: string): Promise<void> {
    this.orgs.delete(orgId);
    this.stamps.delete(orgStampKey(orgId));
    await touchOrgEntitlements(this.redis, orgId);
  }

  /** After a plan table edit: every instance re-reads the table. */
  async invalidatePlans(): Promise<void> {
    this.plans = null;
    this.stamps.delete(PLANS_STAMP_KEY);
    await touchPlanEntitlements(this.redis);
  }

  // ---- Internals ---------------------------------------------------------------

  private valueIn<K extends Key>(
    state: OrgPlanState,
    key: K,
    now: Date,
    orgId: string,
  ): ValueOf<K> {
    const resolved = resolve(key, {
      override: state.overrides.get(key) ?? null,
      planValue: state.planValues.get(key),
      now,
    });
    this.noteRejections(`org:${orgId}`, key, resolved.rejected);
    return resolved.value;
  }

  private async exactMeterIn(
    state: OrgPlanState,
    key: MeterKey,
    now: Date,
    orgId: string,
  ): Promise<ExactMeter> {
    const window = meterWindow(this.meterDef(key).window, state.anchor, now);
    const limit = this.valueIn(state, key, now, orgId) as number | null;
    let usedMilli: number;
    try {
      usedMilli = await this.repository.sumUnits(prisma, orgId, key, window.start);
    } catch (error) {
      this.logFailure('meter', error);
      throw new ServiceUnavailableException({
        message: CLIPS_ALLOWANCE_UNAVAILABLE,
        code: 'allowance_unavailable',
      });
    }
    const amounts = meterAmounts(usedMilli, limit);
    return {
      ...amounts,
      cycleStart: window.start,
      cycleEnd: window.end,
      usedMilli,
      limitValue: limit,
    };
  }

  private meterDef(key: MeterKey): Extract<EntitlementDef, { type: 'meter' }> {
    const def = REGISTRY[key] as EntitlementDef;
    if (def.type !== 'meter') throw new Error(`${key} is not a meter`);
    return def;
  }

  /** The workspace's plan facts, from the cache when it is fresh. */
  private async state(orgId: string, now: Date): Promise<OrgPlanState> {
    const [org, planCache] = await Promise.all([this.orgCache(orgId), this.planCache()]);
    const entitlement = resolveEntitlement(org.billing.subscription, now);
    const tier: Tier = isTier(entitlement.tier) ? entitlement.tier : 'FREE';
    return {
      tier,
      status: entitlement.status,
      trialEndsAt: entitlement.trialEndsAt,
      anchor: org.billing.subscription?.createdAt ?? org.billing.organizationCreatedAt,
      planValues: planCache.byTier.get(tier) ?? new Map(),
      overrides: org.overrides,
    };
  }

  private async planValuesFor(tier: Tier): Promise<Map<string, unknown>> {
    return (await this.planCache()).byTier.get(tier) ?? new Map();
  }

  private async planCache(): Promise<PlanCache> {
    if (this.source === 'seed') return seedPlanCache();

    const cached = this.plans;
    if (cached && Date.now() - cached.at < CACHE_MS) {
      const stamp = await this.stamp(PLANS_STAMP_KEY);
      if (stamp === cached.stamp) return cached;
    }

    try {
      const before = await this.stamp(PLANS_STAMP_KEY, true);
      const rows = await this.repository.planRows();
      const byTier = new Map<string, Map<string, unknown>>();
      for (const row of rows) {
        if (!getDef(row.key)) continue;
        let tier = byTier.get(row.tier);
        if (!tier) {
          tier = new Map();
          byTier.set(row.tier, tier);
        }
        tier.set(row.key, row.value);
      }
      const fill: PlanCache = { byTier, stamp: before, at: Date.now() };
      const after = await this.stamp(PLANS_STAMP_KEY, true);
      if (after === before) this.plans = fill;
      return fill;
    } catch (error) {
      if (cached) {
        this.logFailure('plans', error);
        return cached;
      }
      throw this.unavailable('plans', error);
    }
  }

  private async orgCache(orgId: string): Promise<OrgCache> {
    const cached = this.orgs.get(orgId);
    const key = orgStampKey(orgId);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      const stamp = await this.stamp(key);
      if (stamp === cached.stamp) return cached;
    }

    try {
      const before = await this.stamp(key, true);
      const [billing, overrideRows] = await Promise.all([
        this.repository.billing(orgId),
        this.source === 'seed' ? Promise.resolve([]) : this.repository.overrides(orgId),
      ]);
      const overrides = new Map<string, StoredOverride>();
      for (const row of overrideRows) {
        overrides.set(row.key, { value: row.value, expiresAt: row.expiresAt });
      }
      const fill: OrgCache = {
        overrides,
        // A workspace that is not there reads as Free; the guards already
        // refused any request for a workspace the caller is not in.
        billing: billing ?? { organizationCreatedAt: new Date(), subscription: null },
        stamp: before,
        at: Date.now(),
      };
      const after = await this.stamp(key, true);
      if (after === before) this.remember(orgId, fill);
      return fill;
    } catch (error) {
      if (cached) {
        this.logFailure('org', error);
        return cached;
      }
      throw this.unavailable('org', error);
    }
  }

  private remember(orgId: string, fill: OrgCache): void {
    this.orgs.delete(orgId);
    this.orgs.set(orgId, fill);
    if (this.orgs.size > ORG_CACHE_MAX) {
      const oldest = this.orgs.keys().next().value;
      if (oldest !== undefined) this.orgs.delete(oldest);
    }
  }

  /** A stamp, read from Redis at most once a second (or now, when `fresh`). Null when unknown. */
  private async stamp(key: string, fresh = false): Promise<string | null> {
    const memo = this.stamps.get(key);
    if (!fresh && memo && Date.now() - memo.at < STAMP_CHECK_MS) return memo.value;
    let value: string | null;
    try {
      value = await this.redis.get(key);
    } catch {
      value = memo?.value ?? null;
    }
    this.stamps.set(key, { value, at: Date.now() });
    if (this.stamps.size > ORG_CACHE_MAX * 2) {
      const oldest = this.stamps.keys().next().value;
      if (oldest !== undefined) this.stamps.delete(oldest);
    }
    return value;
  }

  private noteRejections(
    scope: string,
    key: string,
    rejected: readonly { source: string; code: string }[],
  ): void {
    for (const layer of rejected) {
      const id = `${scope}|${key}|${layer.source}|${layer.code}`;
      if (this.loggedRejections.has(id)) continue;
      this.loggedRejections.add(id);
      this.logger.warn(
        JSON.stringify({
          event: 'entitlement.value_ignored',
          scope,
          key,
          layer: layer.source,
          code: layer.code,
        }),
      );
    }
  }

  private logRefusal(
    orgId: string,
    key: string,
    code: string,
    limit: number | null,
    used?: number,
  ): void {
    securityLogger.log('entitlement.refused', { orgId, key, code, limit, used: used ?? null });
  }

  private logFailure(scope: string, error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'entitlement.read_failed',
        scope,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private unavailable(scope: string, error: unknown): ServiceUnavailableException {
    this.logFailure(scope, error);
    return new ServiceUnavailableException({
      message: CLIPS_ALLOWANCE_UNAVAILABLE,
      code: 'allowance_unavailable',
    });
  }
}

let seedCache: PlanCache | null = null;

/** The kill switch's plan table: `TIER_SEED`, built once. */
function seedPlanCache(): PlanCache {
  if (!seedCache) {
    const byTier = new Map<string, Map<string, unknown>>();
    for (const [tier, values] of Object.entries(TIER_SEED)) {
      byTier.set(tier, new Map(Object.entries(values)));
    }
    seedCache = { byTier, stamp: null, at: Number.POSITIVE_INFINITY };
  }
  return seedCache;
}
