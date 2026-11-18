/**
 * Cache stamps for plans as data (Sprint 12, research 12 section 6.2).
 *
 * Every API instance keeps the plan table and each workspace's overrides
 * and tier in memory for up to 15 seconds. An edit writes a new random
 * stamp to Redis; instances read the stamp at most once a second, and a
 * stamp that changed drops their copy. So an edit shows everywhere within
 * about a second, and with Redis down the 15 second age still bounds it.
 *
 * Written by: a plan edit (`ent:plans`); an override edit, a subscription
 * change after the Stripe webhook commits, and the expiry step
 * (`ent:org:<orgId>`). Billing writes the org stamp through `RedisService`
 * directly with `touchOrgEntitlements`, so `BillingModule` never imports the
 * entitlements module.
 */
import { randomBytes } from 'node:crypto';

export const PLANS_STAMP_KEY = 'ent:plans';

export function orgStampKey(orgId: string): string {
  return `ent:org:${orgId}`;
}

/** A day: long enough that a stamp outlives every cached copy it guards. */
export const STAMP_TTL_SECONDS = 86_400;

/** The slice of `RedisService` the stamps need. */
export interface StampStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

function nonce(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Tells every API instance that a workspace's plan answer changed (its
 * tier, its overrides). Never throws: a failed write leaves the 15 second
 * age to catch up, and the caller's own transaction already committed.
 */
export async function touchOrgEntitlements(store: StampStore, orgId: string): Promise<void> {
  try {
    await store.set(orgStampKey(orgId), nonce(), STAMP_TTL_SECONDS);
  } catch {
    // The 15 second cache age bounds what a lost stamp can cost.
  }
}

/** Tells every API instance the plan table changed. Never throws. */
export async function touchPlanEntitlements(store: StampStore): Promise<void> {
  try {
    await store.set(PLANS_STAMP_KEY, nonce(), STAMP_TTL_SECONDS);
  } catch {
    // As above.
  }
}
