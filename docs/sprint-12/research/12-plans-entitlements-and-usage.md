# Sprint 12 Research: Plans, Entitlements And Usage

> **Written**: 2026-11-17. The design for decision D4 of the brief: a data-driven set of limits and meters that an operator edits without a deploy, built for Clips and reusable by every later module. Documents only: no code was changed. Code paths were read on 2026-11-17 on branch `instagram-direct-and-threads`. Web sources were read the same day and are cited inline.

## 1. The Short Version

Limits stop being fields on `Plan` in `plans.ts`. They become **entitlement keys**. A key is declared once in code (the registry), its value per plan tier is a row in the database, a workspace can have an override row with an expiry, and every edit writes a change-log row. Allowances that are used up (import minutes, AI minutes, downloads a day) are **meters**: an append-only usage ledger with idempotent charges and reversal rows, summed over a cycle window.

| Piece | Decision |
|---|---|
| Registry | Code, in a new pure package `packages/entitlements`, shared by API and web |
| Stored values | `PlanEntitlement` (tier, key, value), `OrgEntitlementOverride` (expiry required), `EntitlementChange` (append-only log) |
| Usage | `UsageEntry` ledger, integer thousandths, `@@unique([organizationId, idempotencyKey])`, reversal rows |
| Resolution | override (not expired), then plan row, then registry default; cached in process for 15 seconds, invalidated through a Redis stamp |
| Service and web | `apps/api/src/modules/entitlements`; one `GET /entitlements/me` for the browser; the server is always the authority |
| Operator screen | `/operator` (own layout, desktop only), SUPERADMIN only, four tabs |
| `Credits` | Untouched this sprint; moved onto the ledger later (section 4.2) |

## 2. What The Research Says

| Pattern | Evidence | What we do with it |
|---|---|---|
| A feature has a stable lookup key; the product (plan) maps to features, and a webhook announces changes | Stripe Entitlements: each feature has a unique `lookup_key`, features attach to products, and `entitlements.active_entitlement_summary.updated` fires on subscribe, upgrade, downgrade and cancel (https://docs.stripe.com/billing/entitlements, verified 2026-11-17) | Our registry key is the lookup key. Our plan change already arrives as a Stripe event; it only has to invalidate a cache |
| Stripe Entitlements are on or off only, and say to persist them locally for fast resolution | Same page: "We recommend you persist these entitlements internally for faster resolution." A feature list has no number, no usage | We store values (numbers, enums) ourselves and cache them. Stripe stays the source of the plan, not of limits |
| Three kinds of entitlement: boolean gate, configuration value that differs by tier, metered cap; metered needs current usage and a hard or soft decision | Stigg engineer's guide (https://www.stigg.io/blog-posts/the-engineers-guide-to-entitlements-what-they-are-and-why-your-current-setup-isnt-enough, verified 2026-11-17) | Registry types: boolean, number, enum, meter. Each key says hard or soft |
| Flags are for rollout and experiments; limits and plan logic need their own layer with one source of truth | Same guide; a roundup of vendor posts agrees but every source sells a product, so treated as opinion (search, 2026-11-17) | Do not use a flag tool for plan limits. Keep `CLIPS_PLATFORMS`-style env switches for delivery, entitlements for commercial limits |
| Per-customer overrides with explicit precedence, changed without a deploy | Vendor posts (Ordway, Stigg, Schematic) via search, 2026-11-17 | Override table; fixed order; vendors say "most generous wins", we choose "override wins" (section 6.1) so an operator can also lower a value |
| Usage events carry an idempotency key; a repeated key is ignored | Lago: `transaction_id` is the dedupe key, Postgres store rejects a repeat (https://getlago.com/docs/guide/events/ingesting-usage, verified 2026-11-17). Metronome: same id ignored for 34 days (https://docs.metronome.com/api-reference/idempotency, verified 2026-11-17). Stripe: each meter event has an `identifier` (https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api, verified 2026-11-17). Orb: per-event idempotency inside a grace period (https://docs.withorb.com/events-and-metrics/event-ingestion, verified 2026-11-17; its amend page returned 404, not read) | A unique key per workspace on `UsageEntry`. Ours never expires, because it is a unique index on a ledger, not a time window |
| Corrections are new events, not edits | Stripe: fix by recording negative quantities, or cancel an event within 24 hours; usage is decimal (https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure, verified 2026-11-17). Lago `add` and `remove` operations on unique counts | `kind = REVERSAL` rows with negative units and `reversesId`. Nothing is updated or deleted, as in `credits.policy.ts` today |
| Timestamps decide the billing period; drift is tolerated; fail-open or fail-closed is a decision | Stripe: 35 days past, 5 minutes future. Lago: `timestamp` assigns the period. Stigg guide | `cycleStart` comes from the server clock, never the browser; gates fall back to stale values, `consume` fails closed (section 11) |

## 3. What Exists Today

| Fact | Where |
|---|---|
| The tier of a workspace is computed on read from the `Subscription` row; trial is `PRO` while `trialEndsAt` is ahead; no row, expired trial, cancelled and incomplete are `FREE` | `apps/api/src/modules/billing/plans.ts` `resolveEntitlement` |
| Prices, `channels`, `aiCredits`, `members` live on `Plan`. `assertCanConnect` throws a 403; `Subscription.totalChannels` raises the limit for hand-granted plans (an informal override) | `plans.ts`, `entitlements.service.ts` `channelLimitOf` |
| AI credits: a ledger in `Credits` (Int, positive charge, negative refund typed `refund:<type>`), `chargeOnce` in a Serializable transaction, `P2034` retried 3 times, 402 `PaymentRequiredException` | `ai/credits/credits.service.ts`, `credits.repository.ts` |
| Cycle: `cycleFor(anchor, now)`, midnight UTC on the anchor's day of the month clamped to month length; anchor is `subscription.createdAt`, else `organization.createdAt` (so Free is a rolling month from workspace creation, not a calendar month) | `credits.policy.ts`, `credits.service.ts` `context()` |
| Premium gate: 402 with `{ message, code }`; the exception filter passes a snake_case `code` and whole-number `details` under short keys, nothing else | `studio.premium.ts`, `common/filters/http-exception.filter.ts` lines 85 to 126 |
| `User.isSuperAdmin` is a platform flag, default false; `RolesGuard` lets it act in any workspace but only when an org cookie is present and a `@Roles` list exists; `health.controller.ts` checks it inline; the seed creates `demo@postgear.local` as superadmin; nothing in the app can set it | `roles.guard.ts`, `health.controller.ts:60`, `seeds/index.ts:168`, `auth.schema.ts` |
| `apps/api/src/modules/admin/` holds only `.gitkeep`. `RedisService` is global with `get`, `set`, `setIfAbsent`, `delete`, and an in-memory fallback | `redis.module.ts` |

Two consequences. The enum `SubscriptionTier` has no `FREE`, so stored tier names are strings checked in code. The existing class `EntitlementsService` (tier and channels) keeps its name this sprint; the new classes are named differently to avoid a clash (section 6).

## 4. Data Model

Four new tables, one migration `20261117120000_entitlements_and_usage`. Money, prices and the `Subscription` row do not change.

```prisma
/// One row per (tier, key). tier is a string (FREE | STANDARD | ...) because SubscriptionTier has no FREE.
model PlanEntitlement {
  id        String   @id @default(cuid())
  tier      String
  key       String
  value     Json     /// boolean, number, enum member, or null for unlimited where the registry allows it
  updatedBy String?  /// operator User.id; null for the seed
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
  @@unique([tier, key])
}

/// A deal for one workspace. Ignored after expiresAt; the row stays as history.
model OrgEntitlementOverride {
  id             String       @id @default(cuid())
  organizationId String
  key            String
  value          Json
  reason         String
  expiresAt      DateTime     /// required; the service refuses more than 366 days ahead
  createdBy      String
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, key])
  @@index([expiresAt])
}

enum EntitlementChangeAction { SET REMOVE EXPIRE ADJUST_USAGE RESET_TO_SEED }

/// Append-only: no route updates or deletes a row. No relations, so it outlives workspaces and operators.
model EntitlementChange {
  id             String                  @id @default(cuid())
  scope          String                  /// PLAN, ORG or USAGE
  tier           String?
  organizationId String?
  key            String
  action         EntitlementChangeAction
  oldValue       Json?
  newValue       Json?
  reason         String
  actorId        String?                 /// null for the seed and the expiry step
  actorEmail     String?                 /// snapshot
  createdAt      DateTime                @default(now())
  @@index([createdAt])
  @@index([organizationId, createdAt])
  @@index([scope, tier, key, createdAt])
}

enum UsageKind { CHARGE REVERSAL ADJUSTMENT }

/// The usage ledger. Insert only.
model UsageEntry {
  id             String       @id @default(cuid())
  organizationId String
  meter          String       /// a registry meter key
  units          Int          /// thousandths; negative for a reversal
  kind           UsageKind
  idempotencyKey String
  refId          String?      /// a ClipJob id, a post id: for finding the entry, never for security
  reversesId     String?
  cycleStart     DateTime     /// the window it counts in; a reversal copies its original's
  meta           Json?        /// small, no personal data
  createdBy      String?      /// the operator, for ADJUSTMENT
  createdAt      DateTime     @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, idempotencyKey])
  @@index([organizationId, meter, cycleStart])
  @@index([refId])
  @@index([reversesId])
}
// Organization gains the back-relations entitlementOverrides and usageEntries.
```

### 4.1 Integer Thousandths Or Decimal

| Option | Verdict |
|---|---|
| Prisma `Decimal` | Exact, but returns a `Decimal.js` object, breaks `JSON.stringify` and the exception filter's whole-number rule, and `Credits` is an `Int` already |
| `Int` thousandths (recommended) | Exact sums in Postgres and JS, same style as `Credits`, 60 ms resolution for minutes. One constant `MILLI = 1000`, used only in `consume`, `meter` and the display helpers |
| `BigInt` | Needs conversion at every edge; only a meter counting bytes would need it, and none is planned (storage is a gauge, section 5.3) |

### 4.2 Relation To What Exists

| Existing | This sprint | Later |
|---|---|---|
| `Credits` ledger (Int credits, type string) | Unchanged. Text and image AI keep charging it. Every `clip_*` credit type is dropped from the Clips docs (D4) | Backfill each `Credits` row to `UsageEntry` with meter `ai.credits_per_month`, key `legacy:<creditsId>`, then dual write for one cycle, then switch `CreditsRepository` to the ledger and leave `Credits` read only. `type` maps to `meta.type`. `allowanceFor` becomes `get('ai.credits_per_month')` |
| `Subscription`, `plans.ts` | Unchanged. `Subscription` supplies the tier (`resolveEntitlement`) and the cycle anchor; `plans.ts` keeps price, channels, `aiCredits`, `members`, copy. Clips adds nothing to it | `totalChannels` hand grants become overrides on `channels.max`; keys `channels.max`, `ai.credits_per_month`, `members.max` move to the registry; `Plan` keeps price and copy |

## 5. The Registry

### 5.1 Placement

| Option | Verdict |
|---|---|
| Only `apps/api/src/modules/entitlements` | The web would copy key names and types, which drift |
| New pure package `packages/entitlements` plus the Nest module in the API (recommended) | Holds keys, types, defaults, validation, `resolve`, cycle and message templates. No Prisma, Nest or Node built-ins, so `apps/web` imports it like `@postgear/video-engine`. Needs a `paths` entry, a Jest mapping and `transpilePackages` |
| Inside `packages/scheduling` | That package is the API and worker contract and must stay tiny |

### 5.2 Entry Format

```ts
type Common = { key: string; label: string; description: string; scope: 'plan' | 'org' | 'both';
                editors: 'operator'; refusalCode?: string };
export type EntitlementDef = Common & (
  | { type: 'boolean'; default: boolean }
  | { type: 'number'; unit: Unit; default: number | null; min: number; max: number; allowUnlimited?: boolean }
  | { type: 'enum'; options: readonly string[] /* ordered, low to high */; reserved?: string[]; default: string }
  | { type: 'meter'; unit: Unit; window: 'cycle' | 'day'; default: number; min: number; max: number;
      limit: 'hard' | 'soft'; allowUnlimited?: boolean });
type Unit = 'minutes' | 'gigabytes' | 'days' | 'count' | 'credits' | 'none';
```

- `default` is the safest value, the Free one: a missing row can never grant more than Free.
- `scope` says where a stored value may exist. A `plan` key cannot be overridden; an `org` key has no plan column. Clips keys are `both`. `editors` is `operator` now; a later workspace-admin setting would add a second editor.
- Enum `options` are ordered, so "quality at or below the allowed one" is an index comparison. `4k` is listed but `reserved`: the Plans table refuses to store it.
- Every refusing key has a `refusalCode` (snake_case, at most 64 characters, so the filter passes it) and a sentence template in `entitlements.messages.ts`.

### 5.3 The Clips Keys

| Key | Type | Unit | Default (Free) | Min to max | Scope | Kind of check |
|---|---|---|---|---|---|---|
| `clips.enabled` | boolean | none | true | | both | Gate |
| `clips.max_video_minutes` | number | minutes | 60 | 1 to 1440 | both | Per request ceiling |
| `clips.import_minutes_per_month` | meter, `cycle`, hard | minutes | 180 | 0 to 1000000, unlimited allowed | both | Ledger |
| `clips.storage_gb` | number | gigabytes | 3 | 0 to 100000 | both | Gauge: current bytes against the limit, counted by Clips (`SUM(ClipAsset.bytes)`); no ledger |
| `clips.retention_days` | number | days | 7 | 1 to 3650 | both | Read when a clock is set |
| `clips.export_max_quality` | enum `720p, 720p60, 1080p, 1080p60, 4k` (4k reserved) | none | 720p | | both | Per request ceiling |
| `clips.export_watermark` | boolean | none | true | | both | Value copied into the job |
| `clips.ai_minutes_per_month` | meter, `cycle`, hard | minutes | 30 | 0 to 1000000, unlimited allowed | both | Ledger |
| `clips.concurrent_imports` | number | count | 1 | 1 to 50 | both | Scheduler reads it; extra jobs wait (QUEUED), they are not refused |
| `clips.upload_max_gb` | number | gigabytes | 2 | 0.1 to 50 | both | Per request ceiling |
| `clips.downloads_per_day` | meter, `day`, hard | count | 5 | 0 to 100000 | both | Ledger, UTC day window |
| `clips.queue_priority` | enum `low, normal, high` | none | low | | both | Copied into the job at creation |

The seed values per tier are the table in the brief (D4), unchanged. Two notes on the brief's list. `clips.downloads_per_day` is typed `meter` here (a daily window) because a number alone cannot count downloads; its key is unchanged. Gauges (storage, concurrency) stay `number`: the module that owns the rows measures them, the engine only supplies the limit through `assert`.

**Validation on every write.** One function `validateValue(def, value)` in the package, used by the Plans editor (before send), the operator routes (before save) and the migration test. It rejects: wrong JSON type, a number outside `min` and `max`, `null` where `allowUnlimited` is false, an enum member not in `options` or reserved, an unknown key, a tier not in `PLAN_ORDER`, an override on a `scope: 'plan'` key, an override `expiresAt` in the past or more than 366 days ahead, and a blank or short `reason` (at least 10 characters). Read paths also validate: a stored value that no longer passes (a key was tightened in code) is ignored, logged once, and the next layer is used. The API bodies are `.strict()` Zod schemas generated from the registry, as the house rule says.

## 6. Resolution And The Service

### 6.1 Order

1. Override for `(organizationId, key)` with `expiresAt > now`.
2. `PlanEntitlement` for `(tier, key)`.
3. Registry `default`.

The tier is `resolveEntitlement(subscription, now).tier`, so a trial is `PRO`, an expired trial and "no subscription" are `FREE`, a lifetime row is its tier, and `PAST_DUE` keeps its tier. Nothing about tiers is copied: no job flips anything.

Conflicts: the vendor rule "most generous wins" is rejected, because an operator could then never lower a workspace's value (for abuse). The override wins until it expires (recommended); a lowered override is in the log with its reason.

### 6.2 Caching

| Option | Verdict |
|---|---|
| Redis only | A network call on every gate; the dev fallback is a per-process `Map` anyway |
| In process, short TTL, no invalidation | A saved edit shows after the TTL on each instance: a surprise for the operator |
| In process 15 s plus a Redis stamp (recommended) | Instances read one cheap stamp at most once a second; an edit writes a new one, so every instance drops its cache within about a second. With Redis down, the 15 s TTL still bounds staleness |

What is cached: the whole plan table (about 65 rows) as one object, and per workspace its overrides and tier. Stamps: `ent:plans` (set on any plan edit) and `ent:org:<orgId>` (set on an override edit, on a subscription change after the webhook commits, and when the expiry job removes an override). A cache fill remembers the stamps it read under and is discarded if they changed, so a read racing a write cannot keep stale data. The stamp is a random string written with `RedisService.set(key, nonce, 86400)`. The webhook calls `RedisService` directly, so `BillingModule` never imports the new module (no cycle).

`consume` reads its limit through the same cache (at most 15 s old on a lowered limit, about 1 s with the stamp). A limit is never read outside a ledger transaction it is compared in.

### 6.3 Service API

Names avoid the existing `EntitlementsService`. Module `EntitlementsModule` imports `BillingModule` for the tier and exports the classes below.

```ts
class EntitlementResolver {
  get<K extends Key>(orgId: string, key: K): Promise<ValueOf<K>>;
  getMany(orgId: string, keys: Key[]): Promise<Record<Key, unknown>>;
  /** Gauges: storage, upload size, video length. Throws the typed 402 when the predicate fails. */
  assert<K extends Key>(orgId: string, key: K, predicate: (limit: ValueOf<K>) => boolean,
                        refusal?: { used?: number }): Promise<ValueOf<K>>;
  /** { used, limit, remaining, cycleStart, cycleEnd } in whole display units. */
  meter(orgId: string, key: MeterKey, now?: Date): Promise<MeterState>;
  previewTier(tier: PlanTier, keys: Key[]): Promise<Record<Key, unknown>>; // plan change preview
  snapshot(orgId: string): Promise<EntitlementSnapshot>;                   // GET /entitlements/me
}

class UsageService {
  consume(orgId: string, meter: MeterKey, units: number,
          opts: { idempotencyKey: string; refId?: string; meta?: object; now?: Date }):
    Promise<{ entryId: string; duplicate: boolean; state: MeterState }>;
  reverse(entryId: string, opts?: { units?: number }): Promise<{ entryId: string; duplicate: boolean }>;
  adjust(orgId: string, meter: MeterKey, units: number, opts: { reason: string; actorId: string }): Promise<void>;
}
```

**Refusals.** One exception class `EntitlementRefusedException extends HttpException` (402), body `{ message, code, details: { limit, used, remaining? } }`. The filter already passes `code` and whole-number `details`, so `limit`, `used` and `needed` are whole display units (minutes round up for `used`, down for `limit`). The key itself is not sent; the `code` names it. Codes: `clips_video_too_long`, `clips_minutes_used`, `clips_storage_full`, `clips_upload_too_big`, `clips_quality_requires_plan`, `clips_ai_minutes_used`, `clips_downloads_today`, `clips_not_in_plan`. This is the pattern of `PremiumLookRequiredException`; the web already turns a `code` on `ApiError` into the lock dialog.

**What the browser gets.** `GET /entitlements/me` (any member of the active workspace, `@Roles(ADMIN, USER)`):

```json
{ "tier": "PRO", "status": "trialing", "trialEndsAt": "2026-12-01T00:00:00.000Z",
  "values": { "clips.enabled": true, "clips.max_video_minutes": 360, "clips.export_max_quality": "1080p60", "...": "..." },
  "meters": { "clips.ai_minutes_per_month": { "used": 38, "limit": 900, "remaining": 862,
                "cycleStart": "2026-11-03T00:00:00.000Z", "cycleEnd": "2026-12-03T00:00:00.000Z" } } }
```

`Cache-Control: private, max-age=15`, an ETag, and the web store refetches after any 402 carrying one of the codes above. The browser uses it to lock tiles, draw meters and write chips ("38 of 300 AI minutes left"). Gauges (video space used) come from `GET /clips/status`, not from here. Values from this route are never sent back: every route re-resolves on the server, and the worker never resolves anything (the API copies quality, watermark and priority into the job input at creation, so a plan change mid-render does not alter a running job).

## 7. The Usage Meter

### 7.1 The Charge

`consume` is one Serializable transaction, the same shape as `CreditsRepository.chargeOnce`, kept to three statements:

1. Look for `(organizationId, idempotencyKey)`: found, return it with `duplicate: true` and do not charge again.
2. `used = SUM(units)` where `organizationId`, `meter`, `cycleStart = current` (charges and reversals together).
3. If `used + units > limit * 1000`, refuse with the typed 402 (`code`, `limit`, `used`). Else insert the row.

A concurrent duplicate that slips past step 1 hits the unique index (`P2002`): catch it and return the existing row. A concurrent different charge makes Postgres abort one transaction (`P2034`): retry up to three times with a 50 ms backoff, as `CreditsService.tryCharge` does. A `soft` meter inserts and returns a flag `over: true` instead of refusing (none of the Clips meters is soft).

### 7.2 Idempotency Keys

| Charge | Key | Why stable |
|---|---|---|
| Import minutes | `clips.import:<jobId>` | The `ClipJob` id is made in the service before the charge, so a double click, a retried request or a replayed Temporal activity all carry the same key; a retry of a failed video creates a new job and so a new key |
| Signals, listen, read, action | `clips.ai:<step>:<jobId>` | One charge per step per job; "a stretch is charged once per step" falls out of the unique index |
| Translate, voice | `clips.ai:<step>:<clipId>:<revision>:<hashOfInput>` | Same input twice is one charge |
| Download | `clips.download:<downloadJobId>` | One per download job |
| Reversal, adjustment | `rev:<entryId>` (`:<n>` for a partial one); `adj:<uuid>` made once per open dialog | A job that fails twice cannot refund twice; an operator double click is one row |

Keys are scoped to the workspace (`@@unique([organizationId, idempotencyKey])`), so one tenant can never collide with, or probe, another's.

### 7.3 Reversals

`reverse(entryId)` inserts a row with `kind = REVERSAL`, `units = -original` (or a smaller amount for a partial refund), the same `cycleStart` and `meter`, `reversesId`. It refuses when the sum of existing reversals plus this one would exceed the original, and refuses to reverse a reversal. A reversal of an entry from an earlier cycle is stored in that cycle and changes nothing in the current one: allowances never roll over, and history stays exact.

When to reverse: an import that fails, is cancelled or is refused by the post-download checks (in full, as Module 19's failure refund); an AI step that fails before output, or finds no speech or nothing (in full); an AI step partly done (the unused share). Not on a later delete of a finished import: that would allow an import and delete loop. If the request fails after the charge but before the job row exists, the service reverses in a `finally`, and the maintenance sweep reverses any charge older than an hour whose `refId` job does not exist.

### 7.4 Rounding, Cycles And Mid-Cycle Changes

**Rounding.** `toMilli(x) = Math.ceil(x * 1000)`, so fractions are never free. Import minutes charge the probed length (a 61 minute 30 second video costs 61.5 minutes). AI prices are already whole minutes (`ceil(minutes x rate)`, minimum 1). Display: `used` rounds up and `remaining` and `limit` round down, so the page never promises more than the server allows. `units <= 0` or a non-finite number throws; a zero charge is skipped by the caller.

**Windows.** `cycle` meters use `cycleFor(anchor, now)` from `credits.policy.ts` with the same anchor as credits (`subscription.createdAt`, else `organization.createdAt`). So Free is a rolling month from workspace creation, not a calendar month, and the reset date matches the AI credits meter the person already sees. `cycleFor` moves to `packages/entitlements/src/cycle.ts` and `credits.policy.ts` re-exports it, so the credits tests keep passing. `day` meters run midnight UTC to midnight UTC. Summing uses `cycleStart` equality, so a reversal of an old entry never touches the new window. One inherited behaviour: the first subscription or trial moves the anchor to the subscription's day, so the new cycle starts fresh. A trial starts once per workspace (`allowTrial` is turned off), so this cannot be repeated.

**Mid-cycle.** A raised allowance (upgrade, edit, override) applies at once: usage carries over and `remaining` grows. A lowered one below what is used leaves `remaining` at 0, claws nothing back, and refuses new charges until the cycle turns. Upgrade then downgrade in one cycle keeps the cycle and the usage.

## 8. The Operator Surface

### 8.1 Who And Where

| Question | Answer |
|---|---|
| Who, and how granted today | `User.isSuperAdmin` only (the workspace role `SUPERADMIN` is the same flag seen through `RolesGuard`, never invitable). Today only the seed (`demo@postgear.local`) or a SQL update sets it; `registerSchema` rejects it |
| What is needed | (1) A new `@PlatformAdmin()` decorator and `PlatformAdminGuard`, because `RolesGuard` demands a workspace cookie: the guard checks `request.user.isSuperAdmin` and answers 403 with `AUTH_MESSAGES.FORBIDDEN`. (2) A script `npm run operator:grant -- --email <address>` and `operator:revoke` in `packages/db/scripts`, which also writes a log line. (3) In production, `isSuperAdmin` is honoured only when the address is in a new env value `OPERATOR_EMAILS` (a comma list), so a stray database edit alone cannot open the screen. (4) Production never runs the seed: the seeded demo superadmin exists in staging only. (5) The operator routes take the workspace id as a path parameter and ignore the org cookie, so an operator never acts on the wrong workspace by accident |
| API | `apps/api/src/modules/admin/` (the empty folder becomes `AdminModule`): `GET /operator/entitlements/plans`, `PUT /operator/entitlements/plans`, `GET /operator/workspaces?q=`, `GET /operator/workspaces/:orgId/entitlements`, `PUT` and `DELETE /operator/workspaces/:orgId/overrides/:key`, `GET /operator/workspaces/:orgId/usage`, `POST /operator/workspaces/:orgId/usage/adjust`, `GET /operator/changes`. Writes are throttled and need a `reason` |
| Web | `apps/web/src/app/(operator)/operator/` with its own layout: full window, no workspace rail, a back button, like Workflows and Studio (`DashboardShell` `immersion()`); desktop only, 1366 px and up. A non-operator gets the 404 page, so the screen does not announce itself. The only entry is an **Operator** item in the account menu, drawn only when `isSuperAdmin` is true |

### 8.2 Screens

All four are tabs of one page (`Tabs`), a `PageActions` row first, no in-page title (the top bar says "Operator"). Tables use `DataTable`, edits and confirmations use `Dialog`, warnings use `Alert`, read-only blocks use `bg-inset`. Names are Title Case; sentences are sentence case.

| Tab | Content |
|---|---|
| Plans | Rows are keys grouped by module (a group header "Clips"), columns Free, Standard, Pro, Team, Ultimate. A cell shows its value; click to edit in place with a control by type (switch, number with unit, select). Edited cells are marked and counted in the action row. A cell equal to the seed shows nothing; a different one shows a small "Seed 180" hint. Row menu: **Reset To Seed** |
| Workspace Overrides | Search box (workspace name, id or admin email), result list, then that workspace's tier, status and a table of its overrides (key, value, expires, reason, who). **Add Override** opens a dialog; **Remove Override** is a row action |
| Usage | Pick a workspace; one card per meter this cycle (used, limit, remaining, reset date) and a table of its last 50 ledger entries (time, meter, units, kind, reference, note). **Adjust Usage** opens a dialog |
| Change Log | Newest first, filter by scope, key, workspace and actor; columns When, Who, Scope, Key, Old, New, Reason |

### 8.3 Copy

| Where | Text |
|---|---|
| Top bar, tabs | Operator. Plans, Workspace Overrides, Usage, Change Log |
| Plans action row | Button **Review Changes** (disabled until a cell changes), "3 changes waiting" |
| Plans banner (`Alert`, info) | These values apply to every workspace on a plan, within a few seconds of saving. Edits to a plan never delete anything a workspace already has. |
| Review dialog | Title **Review Changes**. Each line reads "Clips Storage, Pro: 50 GB to 60 GB". Label "Reason for this change", placeholder "Enter your reason", help "At least 10 characters. It goes in the Change Log." Buttons **Save Changes**, **Cancel** |
| Inline errors | "Enter a whole number from 1 to 1,440." / "This plan value cannot be empty." / "4K is reserved and cannot be saved yet." |
| Toast, conflict (`Alert`, warning) | Saved 3 changes. They are live now. / Someone else changed these values while you were editing. Reload to see them, then edit again. |
| Add Override dialog | Title **Add Override**. "Workspace" (read only), "Setting", "Value", "Ends on" (help "Required. At most 366 days from today."), "Reason" (placeholder "Enter your reason"). Buttons **Add Override**, **Cancel** |
| Remove dialog | Title **Remove Override**. "This workspace goes back to the value of its plan, now." Buttons **Remove Override**, **Cancel** |
| Search, empty states | Placeholder "Enter your workspace name, id or admin email"; "No workspace matches that." / "This workspace has no overrides. It uses the values of its plan." / "No usage this cycle." / "Nothing has been changed yet." |
| Adjust Usage dialog | Title **Adjust Usage**. "Setting", "Minutes to add or take back" (negative gives minutes back), "Reason" (placeholder "Enter your reason"). `Alert` (warning): "This writes a permanent ledger entry and a Change Log entry. It cannot be edited, only reversed with another adjustment." Buttons **Adjust Usage**, **Cancel** |

Above the Plans table, an `Alert` (warning) appears when an override ends within 7 days ("2 overrides end within 7 days.", linking to that tab), and another when a higher tier is set below a lower one ("Pro now has less than Standard for Clips Storage. Check this is on purpose.").

**Order of writes.** Saving in Plans is one transaction: validate every cell, upsert the `PlanEntitlement` rows, insert one `EntitlementChange` row per cell (old and new), then after commit set the Redis stamp and log. The request carries each cell's `updatedAt`; a mismatch is a 409 with the conflict sentence. Overrides and adjustments follow the same shape.

## 9. Seeding, Migration And Rollout

| Step | Detail |
|---|---|
| Migration | Creates the tables, then inserts 65 rows (5 tiers x 13 keys) with `INSERT ... ON CONFLICT (tier, key) DO NOTHING` and one `EntitlementChange` row per cell ("Seed"). Literal SQL: reviewable, runs everywhere through `migrate:deploy`, never overwrites an operator edit |
| Registry and seed agree | A test parses the migration values and asserts every key has all five tiers, every value passes `validateValue`, and no migration key is missing in code. Later keys ship their own migration; a forgotten seed row resolves to the registry default (the Free value), safe and never generous |
| Existing workspaces | No backfill: no override rows and no usage, so they resolve to their plan's row. Credits do not move |
| `plans.ts` meanwhile | Authoritative for price, `channels`, `aiCredits`, `members`. The plan cards' Clips lines come from `previewTier` on `GET /billing/plans` (gains `entitlements` per plan), so an operator edit changes the card |
| Rollout, kill switch, rollback | Order: migration, package, service and `GET /entitlements/me` (no caller yet), operator API and screen, then the Clips modules; staging first, with the seeded superadmin. `ENTITLEMENTS_SOURCE=seed` (default `db`) makes the resolver answer from the code constant `TIER_SEED` for an incident where a bad edit locks workspaces out (needs a restart; the normal fix is editing the cell). Clips is new, so rollback is "Clips off" (`clips.enabled`, or `CLIPS_PLATFORMS` empty); the migration only adds tables |

## 10. Billing Integration

| Case | Rule |
|---|---|
| Plan change (Stripe webhook, `BILLING_SIMULATION`) | The webhook writes the `Subscription` row in its transaction; after commit it sets `ent:org:<id>`. The next gate on any instance sees the new tier within about a second. Simulation uses the same handler |
| Upgrade | Immediate; meters keep their usage and gain the larger limit (7.4) |
| Scheduled downgrade | Nothing changes until the period end. The change plan dialog gets a server preview from `previewTier` and the gauges: "After this change your videos use 22 GB of 15 GB. Nothing is deleted, but you cannot bring in new videos until you are under the limit." |
| Storage over the new limit | Never delete. New imports, uploads and wider ranges are refused with `clips_storage_full` ("Your videos use {used} GB, over your plan's {limit} GB. Delete some, or upgrade, to bring in more."). A `clips.storage_over_limit` notification goes to admins when the downgrade lands; the Clips page shows an `Alert` until under. Exports of existing clips still work |
| Retention, quality, watermark tightened | Retention applies from the next clock set and never moves a deadline closer than 3 days (Module 19). Quality and watermark apply to the next export; a running render keeps its snapshot |
| Trial (`PRO`, 14 days) | Resolves exactly as `PRO` (no watermark, 1080p60, 900 AI minutes). At expiry the workspace is `FREE`: the downgrade rules above; the meter keeps its usage under the Free limit |
| `FREE`, `PAST_DUE`, lifetime | `FREE` is no subscription and has plan rows like any tier. `PAST_DUE` and lifetime keep their tier |

## 11. Concurrency And Correctness

| Case | Handling |
|---|---|
| Two imports at once with 70 minutes left | Serializable transactions: one aborts with `P2034`, retries, sees the first charge and is refused. At most one passes |
| Same request twice, worker or activity replayed | Keys come from job ids, never attempt numbers: the repeat is `duplicate: true`, no second job, because the job id is fixed before the charge. A second reversal is a no-op through `rev:<entryId>` |
| Charge succeeds, job row fails | `finally` reversal, plus the hourly backstop (7.3) |
| Storage race | Two 10 GB imports at 12 of 20 GB can both pass at the start. `importStore` rechecks; the loser fails with `clips_storage_full` and its minutes are reversed. Overshoot is bounded by `concurrent_imports` |
| Operator edit while a webhook lands, two operators on one cell | Different rows, no shared invariant (tier from `Subscription`, value from plan or override); a cache fill is discarded if a stamp changed during it. The `updatedAt` check returns 409 to the second operator |
| Clock | Windows use the server `now` (injected in tests). Instances may differ by seconds; a boundary entry lands in its server's window and its reversal copies it. The browser never sends a time |
| Database unreachable | Gates answer from the last good cache for up to 5 minutes, then `TIER_SEED`, logged. `consume` fails closed with a 503 ("We could not check your allowance. Please try again in a minute.") and never skips a charge |

## 12. Testing, Observability And Abuse

| Layer | Cases |
|---|---|
| Package unit | `validateValue` per type and edge (min, max, unlimited, reserved 4k, enum order); resolve order incl. expired override and invalid stored value; `toMilli` and display rounding; `cycleFor` with its old tests; messages give whole numbers |
| API unit (fake store, like `fake-billing-store.ts`) | Cache hit, stamp invalidation, fill discarded, stale on error; `consume` charge, refuse, duplicate; `reverse` full, partial, twice, of a reversal, across cycles; `adjust` writes both rows |
| API integration (Postgres) | Two parallel `consume` calls with room for one; 20 parallel duplicates give one row; `P2034` retry; seed passes `validateValue`; Plans save is one transaction; 409 on stale `updatedAt`; property test: `used` is the sum, never negative, never above the limit |
| Routes and billing | Operator routes: 401 no session, 403 ADMIN and USER, 403 superadmin outside `OPERATOR_EMAILS` in production mode, 200 operator; `/entitlements/me` never shows another workspace; a simulated plan change moves `snapshot`; downgrade preview; trial expiry |
| Web and E2E | Plans editor and review dialog, inline errors, `title-case.test.ts` over new strings, the lock dialog per code; `e2e/operator.spec.ts`: edit a cell, add an override, non-operator sees the 404 page |

Observability: `securityLogger` event `entitlement.refused` with `orgId`, `key`, `limit`, `used`, `tier`, `source` (override, plan, default); allowed checks are counted, not logged; never another tenant's values. `entitlement.changed` points at the Change Log row. Counters: `consume` latency, `P2034` retries, duplicates, reversals by meter, refusals by code, cache hit ratio, fallbacks to seed. Alerts: retries above 5 percent of charges, any fallback to `TIER_SEED`, a negative `used`. A daily maintenance step writes `EXPIRE` rows, lists overrides ending in 7 days, and reports charges with no job and reversals with no original.

| Abuse case | Defence |
|---|---|
| Override with no expiry or years long | `expiresAt` required, 366 day cap; renewal is a new logged edit; Plans tab warns 7 days ahead |
| Quiet operator edits, stolen session, DB flag flip | Reason on every write, append-only log with email snapshot, production `OPERATOR_EMAILS`, throttled writes, a mail to `OWNER_EMAIL` per save |
| Member calls operator routes | 403 on the API, 404 page on the web; the org cookie is never trusted |
| Replayed charges, or a price sent from the browser | Keys are per workspace and the workspace comes from the session; the server recomputes prices from the probe and `pricing.ts` |
| Upload and delete loop, trial restart, a tightened registry | Reversal only on failure or cancel; one trial per workspace; invalid stored values are ignored and logged, the lower layer answers |

## 13. What Clips Reads Where

The Clips refusal sentences are templates in `entitlements.messages.ts`; `{n}` is the whole number from the limit.

| Clips check | Key | Enforced in | Sentence on refusal |
|---|---|---|---|
| Whole feature | `clips.enabled` | Clips routes through one guard (Module 01) | "Clips is not part of this workspace's plan." |
| Probe length | `clips.max_video_minutes` | Module 04 `POST /clips/videos`, rechecked by `importInspect`; the probe card in Module 06 greys the button | "This video is longer than your plan allows ({n} minutes). Upgrade the plan to bring in longer videos." |
| Import hours | `clips.import_minutes_per_month` | Module 04 `consume` at `POST /clips/videos` (key per job); Module 18 downloads of a longer range reuse the length check, not this meter | "You have used all {n} import minutes for this month. They come back on {date}, or you can upgrade the plan." |
| Storage | `clips.storage_gb` | Module 04 at import start and upload start; `importStore` recheck; Modules 12 and 14 for sticker and sound uploads; Module 19 for wider ranges | "Your video space is full ({n} GB). Delete a video you no longer need, or upgrade the plan." |
| Upload size | `clips.upload_max_gb` | Module 04 upload start (declared bytes) and `complete` (real bytes) | "Uploads can be up to {n} GB." |
| Retention | `clips.retention_days` | Module 04 `importStore` sets `expiresAt`; Module 19 sweep and touch | No refusal. Video card: "Kept for {n} days after you last use it." |
| Export quality | `clips.export_max_quality` | Module 15 export route (server), the tiles are locked from `/entitlements/me` | "{quality} export needs a higher plan." |
| Watermark | `clips.export_watermark` | Module 15 decides at job creation and copies it into the job input; never in the clip document | No refusal. Export panel: "Exports on this plan carry a small PostGear mark." |
| AI minutes | `clips.ai_minutes_per_month` | Sprint 12 Module 16 (`signals`); Sprint 13 Modules 02 (`listen`), 05 (`read`), 06 (`action`), 09 (`translate`, `voice`) | "This needs {need} AI minutes and you have {n} left. They come back on {date}, or you can upgrade the plan." |
| Downloads a day | `clips.downloads_per_day` | Module 18 download route (`consume`, key per download job) | "You have reached today's limit of {n} downloads. It resets at midnight UTC." |
| Concurrent imports, queue priority | `clips.concurrent_imports`, `clips.queue_priority` | Module 02 `ClipJobsService` and Sprint 13 Module 15's scheduler: `get` when choosing the next QUEUED job; priority is copied into `ClipJob.priority` at creation | No refusal. Job card: "Waiting for its turn" or "Waiting for our turn, about 4 minutes" |

Every refusal is a 402 with the matching `code` and `details`; the web shows the sentence and **See Plans**, the same pattern as the Studio premium lock.

## 14. Changes To The Sprint Documents

### 14.1 Sprint 12

| Module | Change |
|---|---|
| Sprint doc "Limits And Credits" | Replace the table and the `Plan.clips` text with a link here and the brief's seed table; remove `clip_highlights` |
| 01 Contracts And Data | Section 5 "Plans And Credits" is replaced. Remove `Plan.clips`, `clipLimitsFor`, `CLIP_UPLOAD_MAX_BYTES` and the `clip_highlights` ledger entry. Add: `packages/entitlements` (registry, validation, resolve, cycle, messages), the four tables and the seed in one migration, `EntitlementsModule` with the resolver and usage service, `GET /entitlements/me`, `previewTier` on `GET /billing/plans`, the Redis stamps, `ENTITLEMENTS_SOURCE`, and tests. Plan cards read their Clips lines from `previewTier`. Size grows to L (already set in the brief) |
| 04 Import Pipeline | `ClipLimitsService` becomes a thin adapter over the resolver and usage service; codes renamed (`clips_hours_used` becomes `clips_minutes_used`); import minutes charged with `consume` and key `clips.import:<jobId>`; job id created before the charge; reversal on failed or cancelled; `importStore` re-checks storage; `GET /clips/status` returns limits and meters from the snapshot; sentences from section 13 |
| 15 Export | Quality compared by enum order from `clips.export_max_quality` (adds 720p60); `watermark` read from `clips.export_watermark` and copied into the job input; `priority` copied from `clips.queue_priority`; code `clips_quality_requires_plan` with the new sentence; tiles locked from `/entitlements/me` |
| 16 AI Highlights | Replace the credits charge with `consume('clips.ai_minutes_per_month', price)`, price from `video-engine/src/pricing.ts` (`signals` 0.25 per video minute, minimum 1), key `clips.ai:signals:<jobId>`; refund is `reverse`; the button label "Find Clips (15 AI Minutes)" and the chip "38 of 300 AI minutes left"; no ledger type added to `AI_LEDGER_TYPES` |
| 19 Retention, Quotas And Safety | Section 3's table is replaced by section 13 of this page; adds the operator screens (the four tabs), `AdminModule`, `PlatformAdminGuard`, `OPERATOR_EMAILS`, `operator:grant`, the daily override expiry step and reconcile report, the storage over limit notification and `Alert`, and the usage views. "Out: an audit log UI" is removed (the Change Log is that UI). Retention reads `clips.retention_days` |
| 20 Hardening, E2E, Closeout | Add the abuse cases of 12.3 to the security sweep, `e2e/operator.spec.ts`, a simulated plan change test, a load test of parallel imports, and the entitlement items to the completion checklist |
| 02, 12, 14, 18 | 02: `ClipJob.priority` in the contract, concurrent imports read through the resolver. 12 and 14: upload storage checks go through the resolver. 18: downloads a day through `consume` (key per download job) |

### 14.2 Sprint 13

| Module | Change |
|---|---|
| 02 Transcription | Replace the `clip_listen` credit type with the `listen` AI minutes step (1.0 per minute, minimum 2); key `clips.ai:listen:<jobId>`; a covered range charges nothing; "no speech" and failures reverse |
| 05, 06 | 05: `read` step (0.5 per minute); the form's price shows AI minutes and "too few" disables the button with the missing number; Genre and recipes show their price. 06: `action` step 0.5, "Look For Action (+N AI Minutes)", key per job |
| 09 AI Effects | `translate` 0.25 per clip minute and `voice` 1 per 1000 characters through `consume`; hook titles stay free; refunds through `reverse` |
| 15 Scale, Cost And Deploy (renumbered from 14) | Remove "Credits Or Clip Minutes (The Decision)" (settled: AI Minutes); audit every price against `pricing.ts`; read `clips.queue_priority` in the scheduler; fold Sprint 12's limits into the resolver (already there); `GET /admin/clips/costs` sums `UsageEntry` by meter and workspace next to job costs |

## 15. Risks

| Risk | Likelihood | Effect | Handling |
|---|---|---|---|
| A bad plan edit locks paying workspaces out | Medium | High | Validation and a review dialog; the Change Log and "Reset To Seed"; `ENTITLEMENTS_SOURCE=seed` |
| Meter drift (a charge with no matching work) | Medium | Medium | Reversal in `finally`, the hourly backstop, the daily reconcile report |
| Serialization retries under load | Low | Medium | Retry budget, counters and the alert; advisory lock fallback |
| Two meters for AI (credits and minutes) confuse people | Medium | Medium | Clear labels ("AI credits" for text and images, "AI minutes" for video); both chips on the billing page; the later `Credits` migration |
| Operator account compromise | Low | High | Allowlist, throttle, owner notification, append-only log |
| Registry and seed drift, a stale cache, the cycle reset on first subscription, new package wiring | Medium | Low | The consistency test in CI; 15 s TTL plus stamps; documented (same as credits); follow `video-engine`'s setup |

## 16. Contradictions With The Brief, And Open Questions

| Item | Note |
|---|---|
| Brief D4 says "Sprint 13 Module 14 only audits prices and adds queue priority"; D10 renumbers so Module 14 is Creator Tools and Scale is 15 | This page uses 15 for Scale, as D10 says; D4's wording should read "Module 15" |
| `clips.downloads_per_day` is listed as a plain key, but counting needs a ledger | Typed as a daily meter; key and values unchanged |
| Plan cards need Clips lines but `Plan` stays as is; Module 19's doc lists "an audit log UI" as out | Lines come from `previewTier`, not `plans.ts`; the Change Log tab is in scope now |

Open for the owner (none blocks building; each has a default above): confirm that `OPERATOR_EMAILS` is acceptable as a production setting; whether the first subscription should keep or reset the cycle's usage; whether an override longer than 366 days will ever be needed.
