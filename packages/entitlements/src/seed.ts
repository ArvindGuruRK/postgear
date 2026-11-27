/**
 * The seed: each tier's value for every key.
 *
 * Two jobs. It is the data the migration `20261117120000_entitlements_and_usage`
 * inserts (literal SQL, so it is reviewable; a test reads that file and checks
 * every row equals this table), and it is what the resolver answers from when
 * `ENTITLEMENTS_SOURCE=seed` is set in an incident where a bad edit locks
 * workspaces out.
 *
 * The values are placeholders the operator edits. Once seeded, the database
 * rows are the truth; this table is never read to decide a limit while the
 * kill switch is off.
 *
 * ## Why the tiers are listed here
 *
 * `PLAN_ORDER` lives in the API's `billing/plans.ts`, which this package may
 * not import (it is pure and the web app reads it). `TIERS` repeats that
 * order, and the API checks the two match, so a tier added to one and not
 * the other fails a test instead of resolving quietly to the default.
 */
import { type Key, KEYS, type ValueOf } from './registry';

/** The plan tiers, low to high: the same order as `PLAN_ORDER` in `billing/plans.ts`. */
export const TIERS = ['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE'] as const;

/** A plan tier. `FREE` is a workspace with no live subscription. */
export type Tier = (typeof TIERS)[number];

/** Whether a stored string names a tier (stored tiers are strings because `SubscriptionTier` has no FREE). */
export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/** One tier's value for every key. */
export type TierValues = { readonly [K in Key]: ValueOf<K> };

/** Every tier's values. Keep in step with the migration; the agreement test says where they differ. */
export const TIER_SEED: Readonly<Record<Tier, TierValues>> = Object.freeze({
  FREE: Object.freeze({
    'clips.enabled': true,
    'clips.max_video_minutes': 60,
    'clips.import_minutes_per_month': 180,
    'clips.storage_gb': 3,
    'clips.retention_days': 7,
    'clips.export_max_quality': '720p',
    'clips.export_watermark': true,
    'clips.ai_minutes_per_month': 30,
    'clips.concurrent_imports': 1,
    'clips.upload_max_gb': 2,
    'clips.downloads_per_day': 5,
    'clips.queue_priority': 'low',
    'clips.browse_channels': 1,
    'members.editors_max': 0,
  }),
  STANDARD: Object.freeze({
    'clips.enabled': true,
    'clips.max_video_minutes': 180,
    'clips.import_minutes_per_month': 900,
    'clips.storage_gb': 15,
    'clips.retention_days': 14,
    'clips.export_max_quality': '1080p',
    'clips.export_watermark': false,
    'clips.ai_minutes_per_month': 300,
    'clips.concurrent_imports': 2,
    'clips.upload_max_gb': 2,
    'clips.downloads_per_day': 20,
    'clips.queue_priority': 'normal',
    'clips.browse_channels': 3,
    'members.editors_max': 1,
  }),
  PRO: Object.freeze({
    'clips.enabled': true,
    'clips.max_video_minutes': 360,
    'clips.import_minutes_per_month': 2400,
    'clips.storage_gb': 50,
    'clips.retention_days': 30,
    'clips.export_max_quality': '1080p60',
    'clips.export_watermark': false,
    'clips.ai_minutes_per_month': 900,
    'clips.concurrent_imports': 2,
    'clips.upload_max_gb': 2,
    'clips.downloads_per_day': 20,
    'clips.queue_priority': 'normal',
    'clips.browse_channels': 5,
    'members.editors_max': 3,
  }),
  TEAM: Object.freeze({
    'clips.enabled': true,
    'clips.max_video_minutes': 360,
    'clips.import_minutes_per_month': 7200,
    'clips.storage_gb': 150,
    'clips.retention_days': 30,
    'clips.export_max_quality': '1080p60',
    'clips.export_watermark': false,
    'clips.ai_minutes_per_month': 3000,
    'clips.concurrent_imports': 3,
    'clips.upload_max_gb': 2,
    'clips.downloads_per_day': 50,
    'clips.queue_priority': 'high',
    'clips.browse_channels': 10,
    'members.editors_max': 10,
  }),
  ULTIMATE: Object.freeze({
    'clips.enabled': true,
    'clips.max_video_minutes': 360,
    'clips.import_minutes_per_month': 18000,
    'clips.storage_gb': 400,
    'clips.retention_days': 60,
    'clips.export_max_quality': '1080p60',
    'clips.export_watermark': false,
    'clips.ai_minutes_per_month': 10000,
    'clips.concurrent_imports': 4,
    'clips.upload_max_gb': 2,
    'clips.downloads_per_day': 100,
    'clips.queue_priority': 'high',
    'clips.browse_channels': 20,
    'members.editors_max': 25,
  }),
});

/** A tier's seeded value for a key: the kill switch's answer. */
export function seedValue<K extends Key>(tier: Tier, key: K): ValueOf<K> {
  return TIER_SEED[tier][key];
}

/** A tier's seeded values for every key, as a fresh object the caller may keep. */
export function seedValues(tier: Tier): Record<Key, ValueOf<Key>> {
  const values = {} as Record<Key, ValueOf<Key>>;
  for (const key of KEYS) {
    values[key] = TIER_SEED[tier][key];
  }
  return values;
}

/** Every seeded cell, in the migration's order (tier, then key): the rows the agreement test compares. */
export function seedRows(): { tier: Tier; key: Key; value: ValueOf<Key> }[] {
  return TIERS.flatMap((tier) => KEYS.map((key) => ({ tier, key, value: TIER_SEED[tier][key] })));
}
