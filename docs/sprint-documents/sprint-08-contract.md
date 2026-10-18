# Sprint 8: Build Contract

> Companion to [sprint-08-billing-notifications-api-launch.md](sprint-08-billing-notifications-api-launch.md).
> Written **before** the code, on 2026-10-16, after reading the Postiz reference for
> billing, notifications, the public API, outbound webhooks, the SDK, Swagger and
> hardening. This is the agreement every workstream builds against: shared types,
> route shapes, schema changes and module boundaries. Where it says *decision*, the
> reasoning is recorded so the completion checklist can repeat it.

## 0. What the Postiz study found, and what PostGear does instead

| Area | Postiz (reference, studied) | PostGear (this sprint) |
|---|---|---|
| Stripe webhook | Signature verified, **no idempotency** (event id never stored), no ordering, a 500 on any throw makes Stripe replay side effects | `BillingEvent` table keyed on the Stripe event id, inserted in the same transaction as the state change; stale events (older than `Subscription.lastStripeEventAt`) ignored; a verified-but-unprocessable event answers 200 and is logged, so Stripe does not replay it forever |
| Prices | Products/prices looked up by name at request time, created on demand, no pagination, race on first call | The plan table in `apps/api/src/modules/billing/plans.ts` is the single source of truth. Checkout and plan changes send inline `price_data` from that table, so no dashboard setup is needed; `STRIPE_PRICE_<TIER>_<PERIOD>` can pin real price ids later |
| Trial | 7 days with a card and a $1 hold; `allowTrial`/`isTrailing` flags | 14 days, **no card** (US-8.5): a `Subscription` row with `status = TRIALING` and `trialEndsAt`, started when a workspace is created; expiry is computed on read, no cron |
| Downgrade | Channels past the new limit are disabled in arbitrary order, never re-enabled | Nothing is disabled. The limit is enforced where channels are **connected** (Sprint 3's connect flow); existing channels keep publishing. A downgrade takes effect at period end and is shown as *scheduled* |
| Pending state | Client polls every second with no cap; UI updates the tier optimistically before the webhook | The billing page shows *Activating…* after checkout and polls `GET /billing/subscription` every 2 s for at most 60 s; the tier only changes when the webhook has been processed |
| Notifications | Org-scoped rows; read state is one timestamp per **user** (reading org A clears org B); the list GET marks everything read; content rendered with `dangerouslySetInnerHTML`; no push | Rows stay org-scoped (Sprint 5 already writes them); read state is a `NotificationCursor` per (user, workspace); an explicit `POST /notifications/read-all`; content rendered as text; live delivery over **SSE** (the Sprint 6 transport) |
| Email on events | Sent from the orchestrator through a global one-email-per-700 ms queue; the `Notifications` row and the email are two separate writes | **Outbox**: the worker writes the row with `emailStatus = PENDING`; the API's dispatcher claims pending rows and sends through the existing `MailService`. One event, one row, one mail path |
| API key | One plaintext-equivalent key per org (`AES-CBC` with a fixed IV, shown in the UI); `Math.random()`; no rotation history, no last-used; bad keys never throttled | `ApiKey` table: SHA-256 hash only, a visible prefix, `lastUsedAt`, `revokedAt`, several keys per workspace, rotate = revoke + create; unauthenticated `/v1` hits are throttled per IP |
| Public API | `/public/v1`, the whole org as `SUPERADMIN`, untyped bodies, `type==='draft' \|\| true` bug | `/v1`, a dedicated `ApiKeyGuard` (never the session guards), every body a strict zod schema, a plain-text post shape designed for integrators |
| Outbound webhooks | No secret, no signature, no retry, `response.ok` unchecked, payload lookup keyed on the wrong id, URL only checked at save time | Per-webhook HMAC-SHA256 secret, `X-PostGear-Signature`, a `WebhookDelivery` row per occurrence, a Temporal workflow per delivery with backoff, the SSRF guard at save time **and** at send time |
| Swagger | Whole app documented at `/docs`, no security scheme | Only `/v1` documented at `/api/docs`, with the bearer scheme declared; schemas generated from the zod DTOs |
| Throttling | Globally registered but only applied to `POST /public/v1/posts`, per org, 1 h window | Redis-backed `@nestjs/throttler`: per IP on every route, per **API key** on `/v1` |
| Sentry | 100 % traces, OpenAI inputs recorded, replay unmasked | No-op without a DSN; traces off by default; no PII options turned on; the global filter reports only unexpected (non-`HttpException`) errors |

## 1. Schema changes (additive only; nothing inherited is removed or renamed)

Migration: `packages/db/prisma/migrations/20261016120000_sprint8_billing_notifications_api/`.

```prisma
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED INCOMPLETE }
enum NotificationEmailStatus { NONE PENDING SENDING SENT SKIPPED FAILED }
enum WebhookDeliveryStatus { PENDING DELIVERED FAILED }

model Subscription {           // inherited fields unchanged; added:
  status            SubscriptionStatus @default(ACTIVE)
  currentPeriodEnd  DateTime?
  trialEndsAt       DateTime?
  scheduledTier     SubscriptionTier?   // a downgrade waiting for period end
  scheduledPeriod   Period?
  lastStripeEventAt DateTime?           // ordering guard for webhooks
}
// Inherited meanings kept: `identifier` = Stripe subscription id, `cancelAt` = when a
// scheduled cancellation ends access, `totalChannels` = the channel entitlement,
// `Organization.paymentId` = Stripe customer id, `Organization.isTrailing` = trial live.

model BillingEvent {           // processed Stripe events: the idempotency table
  id             String   @id          // Stripe `event.id`, or `sim_<uuid>` in simulation
  type           String
  organizationId String?
  outcome        String                // 'applied' | 'ignored:<reason>'
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
}

model Notifications {          // inherited fields unchanged; added:
  type        String                  @default("info")   // see §3 catalogue
  title       String?
  meta        Json?                                      // what an email needs: post group, channel, reason
  emailStatus NotificationEmailStatus @default(NONE)
  emailedAt   DateTime?
  @@index([emailStatus])
}

model NotificationCursor {     // read marker per (user, workspace)
  id             String   @id @default(uuid())
  userId         String
  organizationId String
  lastReadAt     DateTime @default(now())
  createdAt / updatedAt
  @@unique([userId, organizationId])
}
// No cursor row → "unread" is everything newer than the membership's createdAt.

model ApiKey {
  id             String    @id @default(uuid())
  organizationId String
  name           String
  prefix         String                 // "pg_" + first 8 chars of the secret, for identification
  keyHash        String    @unique      // SHA-256 hex of the full secret
  createdById    String?
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt / updatedAt
  @@index([organizationId])
}

model Webhooks {               // inherited fields unchanged; added:
  secret     String   @default("")     // AES-256-GCM ciphertext (packages/db crypto) of the signing secret
  events     String[] @default(["post.published", "post.failed"])
  disabled   Boolean  @default(false)
  deliveries WebhookDelivery[]
}

model WebhookDelivery {
  id             String  @id @default(uuid())
  organizationId String
  webhookId      String
  event          String
  deliveryKey    String  @unique       // `${webhookId}:${event}:${subjectId}`: one per occurrence
  payload        Json
  status         WebhookDeliveryStatus @default(PENDING)
  attempts       Int     @default(0)
  lastStatusCode Int?
  lastError      String?
  lastAttemptAt  DateTime?
  deliveredAt    DateTime?
  createdAt / updatedAt
  @@index([organizationId, createdAt]) @@index([status, createdAt]) @@index([webhookId, createdAt])
}
```

`Organization` gains back-relations `notificationCursors`, `apiKeys`, `webhookDeliveries`; `User` gains `notificationCursors`. All new rows cascade with their organization. `packages/db/src/types.ts` re-exports the three enums and four model types.

## 2. Plans: the single source of truth

`apps/api/src/modules/billing/plans.ts` (pure data + functions, no Nest, no Prisma):

```ts
type PlanTier = 'FREE' | SubscriptionTier;   // FREE = no live entitlement
interface Plan { tier; name; description; monthlyPriceCents; yearlyPriceCents; channels; aiCredits; members; features: string[]; highlighted: boolean }
```

| Tier | $/mo | $/yr | Channels | AI credits | Members |
|---|---|---|---|---|---|
| FREE | 0 | 0 | 1 | 25 | 1 |
| STANDARD | 29 | 290 | 5 | 100 | 1 |
| PRO | 49 | 490 | 15 | 500 | 3 |
| TEAM | 99 | 990 | 40 | 2 000 | 10 |
| ULTIMATE | 199 | 1 990 | 100 | 10 000 | unlimited |

**Prices are placeholders** (a product decision for the owner, recorded in the checklist). The AI credit numbers are the ones `credits.policy.ts` already enforces; `credits.policy.ts` now reads `allowanceFor` from this table and keeps no numbers of its own (`'NONE'` maps to `FREE`). The trial tier is **PRO** for `BILLING_TRIAL_DAYS` (default 14).

`resolveEntitlement(subscription | null, now)` → `{ tier: PlanTier, status: 'none' | 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'canceling' | 'canceled' | 'incomplete', plan, trialEndsAt, currentPeriodEnd, cancelAt }`:
- no row, or `deletedAt` set → FREE / `none` (or `canceled` when the row was canceled)
- `TRIALING` and `trialEndsAt > now` → row's tier / `trialing`; else FREE / `trial_expired`
- `ACTIVE` → tier / `active` (`canceling` when `cancelAt` is set); `PAST_DUE` → tier / `past_due` (grace, access kept); `INCOMPLETE` → FREE / `incomplete`

## 3. Module boundaries and ownership

| Module | Owns | Imports | Exports |
|---|---|---|---|
| `billing` | plans, entitlements, Stripe client + simulation, webhook handler, `BillingEvent`, trial, checkout/portal/change/cancel, web billing page | `NotificationsModule`, `MailModule` | `EntitlementsService` (tier, channel limit, `startTrial`) |
| `notifications` | list/unread/read-all/stream, the outbox dispatcher, preferences, the bell, the preferences page | `MailModule` | `NotificationsService.notify()` (writes a row for API-side events) |
| `developers` | `ApiKey` CRUD, `ApiKeyGuard`, `/v1/*`, the per-key throttle, Swagger document, the API-keys page | `ChannelsModule`, `PostsModule`, `AnalyticsModule`, `BillingModule` | - |
| `webhooks` | `Webhooks` CRUD, secret rotation, test send, deliveries list, the webhooks page; worker delivery workflow | `SchedulingModule` | - |
| `common/throttling` | global per-IP throttler module + guard | `RedisModule` | - |
| `common/sentry` | init + capture in the exception filter; `/health` | - | - |
| `channels` (edit) | enforces the channel limit on connect | `BillingModule` | - |
| `ai/credits` (edit) | allowance from `plans.ts` | - | - |
| worker | `publish.activities.ts` writes `type`/`emailStatus`/`meta` on its two rows and enqueues webhook deliveries; `webhook-delivery.workflow.ts`; maintenance reconcile also restarts stuck deliveries | - | - |
| `packages/sdk` | built last against the stable `/v1` | - | - |

Files that several workstreams touch are **pre-created by the coordinator** before the parallel build: `config/env.ts`, `app.module.ts`, `security-logger.ts` events, the migration, `packages/db/src/types.ts`, the web `types/*.ts`, the settings layout and nav. Workstreams add to their own module folders only.

## 4. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_SIMULATION` | `false` | `true`: no Stripe; checkout, plan changes and cancellation synthesise the Stripe events and run them through the real webhook handler. Refused in production |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | unset | Real test-mode keys. The `.env.example` placeholders (`sk_test_stripe_secret_key` …) are recognised and read as unset |
| `STRIPE_PRICE_<TIER>_<MONTHLY\|YEARLY>` | unset | Optional: pin a real Stripe price id instead of inline `price_data` |
| `BILLING_TRIAL_DAYS` | `14` | Trial length |
| `RATE_LIMIT_PER_MIN` | `300` | Per-IP ceiling on every route |
| `API_RATE_LIMIT_PER_MIN` | `60` | Per-API-key ceiling on `/v1` |
| `WEBHOOK_ALLOW_PRIVATE_URLS` | `false` | Let outbound webhooks target localhost/private addresses (local testing only; refused in production) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | unset | Sentry for the API and the web app; unset = no-op |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | Performance traces, off unless asked |

Mode precedence for billing, as for AI: `BILLING_SIMULATION=true` → simulation; else a real key → stripe; else unconfigured (`/billing/status` says so, checkout answers 503, the page explains).

## 5. API shapes

Every error is `{ error, statusCode }` (the global filter). Every body is a strict zod schema. All session routes resolve the workspace from `@CurrentOrg()`.

### 5.1 Billing (session; reads any member, writes `ADMIN`)

| Route | Body → Response |
|---|---|
| `GET /billing/status` | `{ status: { mode: 'simulation'\|'stripe'\|'unconfigured', publishableKey: string\|null, trialDays } }` |
| `GET /billing/plans` | `{ plans: Plan[], trialDays }` |
| `GET /billing/subscription` | `{ subscription: SubscriptionView, usage: { channels: { used, limit }, aiCredits: { used, allowance, resetsAt } } }` |
| `POST /billing/trial` | → `{ subscription }` (422 when not eligible: a row already exists) |
| `POST /billing/checkout` | `{ tier: 'STANDARD'\|'PRO'\|'TEAM'\|'ULTIMATE', period: 'MONTHLY'\|'YEARLY' }` → `{ url }` (the browser navigates there; simulation returns the billing page with `?checkout=success`) |
| `POST /billing/portal` | → `{ url }` (503 when no Stripe customer / unconfigured) |
| `GET /billing/change/preview?tier=&period=` | `{ preview: { effective: 'now'\|'period_end', amountDueCents, currency, periodEnd } }` |
| `POST /billing/change` | `{ tier, period }` → `{ subscription }`: upgrade now with proration, downgrade scheduled for period end |
| `POST /billing/cancel` | `{ reason: 'too_expensive'\|'missing_features'\|'not_using'\|'switching'\|'other', feedback?: string ≤ 1000 }` → `{ subscription }`; access kept until `cancelAt`; feedback mailed to `SMTP_FROM` |
| `POST /billing/resume` | → `{ subscription }`: undoes a scheduled cancellation |
| `POST /billing/webhook` | `@Public()`, raw body, `stripe-signature` verified → `{ received: true, duplicate?: true }`; 400 on a bad signature |

```ts
interface SubscriptionView {
  tier: PlanTier; status: EntitlementStatus; plan: Plan;
  period: 'MONTHLY' | 'YEARLY' | null; currentPeriodEnd: string | null; trialEndsAt: string | null;
  cancelAt: string | null; scheduledTier: PlanTier | null; scheduledPeriod: 'MONTHLY' | 'YEARLY' | null;
  isLifetime: boolean; canStartTrial: boolean; portalAvailable: boolean;
}
```

Stripe events handled: `checkout.session.completed` (metadata `organizationId`, `tier`, `period`; links the customer, creates/activates the row), `customer.subscription.created|updated` (status, period end, cancel_at, tier from metadata), `customer.subscription.deleted` (CANCELED + `deletedAt`), `invoice.payment_failed` (PAST_DUE + notification `billing.payment_failed`), `invoice.paid` (ACTIVE). Everything else is recorded `ignored:unhandled`.

### 5.2 Notifications (session; any member)

| Route | Response |
|---|---|
| `GET /notifications?limit=20&before=<iso>` | `{ notifications: NotificationView[], unread, lastReadAt }` |
| `GET /notifications/unread` | `{ unread }` |
| `POST /notifications/read-all` | `{ unread: 0, lastReadAt }` |
| `GET /notifications/stream` | SSE: `ready { unread }`, then `notification { notification, unread }` per new row for this workspace; `: ping` heartbeat |
| `GET /users/me/notification-preferences` | `{ preferences: { successEmails, failureEmails } }` (the inherited `sendSuccessEmails` / `sendFailureEmails`) |
| `PATCH /users/me/notification-preferences` | same shape in and out |

```ts
interface NotificationView { id; type: NotificationType; title: string | null; content: string; link: string | null; createdAt: string; read: boolean }
type NotificationType = 'post.published' | 'post.failed' | 'channel.needs_reconnect' | 'billing.activated' | 'billing.payment_failed' | 'billing.canceled' | 'billing.trial_started' | 'webhook.failed' | 'info';
```

Email audience per type: `post.failed`, `channel.needs_reconnect` → members with `sendFailureEmails`; `post.published` → members with `sendSuccessEmails`; `billing.*`, `webhook.failed` → `ADMIN` members. Only non-disabled memberships. Plain-text mail through `MailService.sendPlain(to, subject, lines)`; the console transport stays the local mode.

The dispatcher (`notifications.dispatcher.ts`) runs in the API every 3 s: claims `emailStatus = PENDING` rows (`updateMany → SENDING`, so two API instances never both send), mails, marks `SENT`/`SKIPPED`/`FAILED`; and pushes every row newer than its last poll to the open SSE streams of that workspace.

### 5.3 Developers (session, `ADMIN`) and the public API (`/v1`, API key)

| Route | Body → Response |
|---|---|
| `GET /developers/api-keys` | `{ keys: ApiKeyView[] }` newest first, revoked included |
| `POST /developers/api-keys` | `{ name: 1..60 }` → 201 `{ key: ApiKeyView, secret }`; the only time the secret is shown; max 10 live keys (422) |
| `POST /developers/api-keys/:id/rotate` | → `{ key, secret, revokedKeyId }` |
| `DELETE /developers/api-keys/:id` | → `{ key }` (revoked, never deleted) |

```ts
interface ApiKeyView { id; name; prefix; createdAt; lastUsedAt: string | null; revokedAt: string | null }
```

Secret format: `pg_` + 40 base64url chars (30 random bytes). `prefix` = first 11 chars. Stored as `sha256(secret)`; looked up by hash; `lastUsedAt` written at most once a minute.

Auth on `/v1`: `Authorization: Bearer pg_…` (also `X-API-Key: pg_…`). `@ApiKeyAuth()` = `@Public()` for the session guards + `ApiKeyGuard` + `ApiKeyThrottlerGuard`; the guard sets `request.activeOrg = { id, role: 'ADMIN' }` and `request.apiKey`. 401 `{ error: 'Invalid API key' }` for missing, unknown or revoked. 429 with `Retry-After` past `API_RATE_LIMIT_PER_MIN`.

| Route | Body → Response |
|---|---|
| `GET /v1/me` | `{ workspace: { id, name }, key: { id, name, prefix }, plan: { tier } }` |
| `GET /v1/channels` | `{ channels: [{ id, provider, providerName, name, profile, picture, health, disabled }] }` |
| `GET /v1/posts?state=&page=` | `{ posts: PublicPostSummary[], page, pageCount, total }` (the queue, 20 per page) |
| `GET /v1/posts/:id` | `{ post: PublicPost }` (`id` is the group) |
| `POST /v1/posts` | `{ text: 1..70000, channelIds: 1..20 ids, publishAt?: iso, state?: 'draft'\|'queue' (default queue), mediaIds?: uuid[] }` → 201 `{ post }`; text becomes a document (blank line = paragraph, newline = hard break); queued posts must be in the future and pass every platform rule (422 with the rule's message) |
| `DELETE /v1/posts/:id` | `{ deleted: true }` |
| `GET /v1/analytics/overview?range=7\|30\|90` | the same overview `GET /analytics/overview` returns |

```ts
interface PublicPostSummary { id; state: 'DRAFT'|'QUEUE'|'PUBLISHED'|'ERROR'; publishAt; updatedAt; preview; channels: [{ channelId, name, provider, state, url: string|null }] }
interface PublicPost extends PublicPostSummary { parts: [{ text, media: [{ id, url }] }] }
```

Swagger: `GET /api/docs` (UI) and `GET /api/docs-json`, public, documenting `/v1` only, bearer scheme `apiKey`, schemas from the zod DTOs via `zod-to-json-schema`.

*As built (2026-10-16):* `GET /v1/posts?state=` takes the lowercase `draft|queue|published|error` (case-insensitive) to match the create body; responses keep the uppercase `state`. In `POST /v1/posts`, a blank line in `text` becomes an **empty paragraph** rather than just a paragraph break, so `renderPlainText(textToDocument(text)) === text` and an integrator's spacing is published as sent. `/v1` validation errors name the failing field (`PublicZodBody`), unlike the app's own routes, whose field-hiding exists for the sign-in oracle. The throttle bucket is one per key across every `/v1` route. The seed installs the key `pg_seedDemoKey00000000000000000000000000000` on the demo workspace for local use.

### 5.4 Outbound webhooks (session, `ADMIN`)

| Route | Body → Response |
|---|---|
| `GET /webhooks` | `{ webhooks: WebhookView[] }` |
| `POST /webhooks` | `{ name: 1..60, url: https (http only with WEBHOOK_ALLOW_PRIVATE_URLS), events: subset of ['post.published','post.failed'] (≥ 1), channelIds?: string[] }` → 201 `{ webhook, secret }`; the secret is shown once; URL refused by the SSRF guard → 422 |
| `PATCH /webhooks/:id` | any of the above → `{ webhook }` |
| `DELETE /webhooks/:id` | → `{ webhook }` (soft delete) |
| `POST /webhooks/:id/rotate-secret` | → `{ webhook, secret }` |
| `POST /webhooks/:id/test` | → `{ delivery }`: enqueues a `webhook.test` delivery with a sample payload |
| `GET /webhooks/:id/deliveries` | `{ deliveries: DeliveryView[] }` (last 20) |

```ts
interface WebhookView { id; name; url; events; channelIds: string[]; disabled; createdAt; lastDelivery: { status, at, statusCode } | null }
interface DeliveryView { id; event; status; attempts; lastStatusCode; lastError; lastAttemptAt; deliveredAt; createdAt }
```

Delivery request: `POST url`, `Content-Type: application/json`, `User-Agent: PostGear-Webhooks/1.0`, `X-PostGear-Event`, `X-PostGear-Delivery` (id), `X-PostGear-Timestamp` (unix seconds), `X-PostGear-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`. 10 s timeout. 2xx = delivered; 408/429/5xx/network = retry; any other 4xx = failed at once. Retries: 6 attempts, 30 s × 4ⁿ, capped at 2 h (Temporal activity retry on `webhookDeliveryWorkflow`, id `webhook-delivery:<deliveryId>`). Final failure → `FAILED` + a `webhook.failed` notification.

Payload:
```json
{ "id": "<deliveryId>", "event": "post.published", "createdAt": "<iso>", "workspaceId": "<orgId>",
  "data": { "post": { "id": "<group>", "rootId": "<postId>", "state": "PUBLISHED", "publishAt": "<iso>", "url": "<releaseURL|null>", "preview": "<text>",
                      "channel": { "id": "<integrationId>", "name": "Acme Marketing", "provider": "linkedin" } },
            "error": { "reason": "needs_reconnect", "message": "…", "attempts": 1 } } }
```
(`error` only on `post.failed`; `webhook.test` carries a sample `post`.)

Where it fires: the worker's `writePublished` / `markPublishFailed` create `WebhookDelivery` rows in the same transaction as the notification (`createMany skipDuplicates` on `deliveryKey`), then start one workflow per row best-effort; the maintenance reconcile starts workflows for any `PENDING` delivery older than a minute, so a Temporal blip never loses one. The API's test button creates the row and starts the workflow through `SchedulingService.startWebhookDelivery`.

### 5.5 Hardening

- `GET /health` (`@Public()`): `{ status: 'ok', checks: { database: 'ok'|'down' } }`.
- `GET /health/sentry-test` (superadmin): throws a deliberate `Error('Sentry test error from apps/api')` → 500 and a Sentry event when a DSN is set. Web: `/dev/sentry-test` page with a button that throws in the browser and a server action that throws on the server.
- Global `AppThrottlerGuard` (per IP, `RATE_LIMIT_PER_MIN`), Redis storage when `REDIS_URL` is set, in-memory otherwise; `@SkipThrottle()` on the Stripe webhook and the SSE stream; the login throttle stays as is.
- CORS unchanged: credentials only for `WEB_URL`; `/v1` is server-to-server and needs no browser origin.
- Sentry: `@sentry/nestjs` initialised in `instrument.ts` (first import of `main.ts`) only with `SENTRY_DSN`; `HttpExceptionFilter` captures non-`HttpException` errors. `@sentry/nextjs` through `instrumentation-client.ts`, `sentry.server.config.ts`, `instrumentation.ts`, gated on `NEXT_PUBLIC_SENTRY_DSN`.

### 5.6 Channels (edit)

`GET /channels` now returns `{ channels, limit: { used, max, tier } }`. `GET /channels/connect/:provider` redirects to `/channels?error=channel_limit` when `used >= max` and the handshake is not a reconnect; `completeConnect` re-checks before creating a new row and redirects the same way. The channels page shows *n of m channels* and disables **Connect a channel** at the limit with a link to billing.

## 6. Web

- Shared types: `apps/web/src/types/{billing,notifications,developers,webhooks}.ts` mirror the shapes above (the codebase never imports `@postgear/db` into the browser).
- `settings/layout.tsx` wraps every settings page in a two-column layout with `SettingsNav` (Team · Billing · API keys · Webhooks · Notifications). Team stays the Sprint 2 stub.
- `settings/billing`: two states as the sprint document asks: **subscribe** (plan grid from `PlanCard`, Monthly/Yearly toggle, trial banner or *Start free trial*) and **manage** (current-plan card with status `Badge`, next billing date, two `UsageMeter`s, Manage billing → portal, Change plan with a proration preview dialog, Cancel with a reason + feedback dialog, Resume, scheduled-downgrade notice). `?checkout=success` → *Activating…* polling; simulation banner via `Alert`.
- `settings/api-keys`: list (`Table`), Create dialog, the one-time secret in a copy box, Rotate (confirm dialog warning about live integrations) and Revoke; the `/api/docs` link and a curl example.
- `settings/webhooks`: list, Create/Edit dialog (name, URL, events checkboxes, channel multi-select), one-time secret, Test, Deliveries sheet, Rotate secret, Delete.
- `settings/notifications`: two `Toggle`s for the email preferences.
- The bell: `NotificationBell` in the top bar (a new `notifications` slot on `TopBar`), fed by `useNotifications` (SSE with reconnect, `read-all`, unread badge), rendering `NotificationCenter` (extended with `onMarkAllRead` and `onItemClick` navigation).
- Channels page: the limit line and the `channel_limit` error copy.
- Every screen uses `@postgear/ui` components and tokens; new components go to the playground.

## 7. Tests

- Unit (jest): plans/entitlements (every status, trial expiry, limits); webhook signature verification and idempotency (duplicate event → `duplicate`, stale event ignored, each handled type); channel-limit enforcement; API-key generation, hashing, prefix, guard (missing/unknown/revoked/live, `lastUsedAt` throttle); the per-key and per-IP throttler guards; HMAC signing and the SDK's verifier; the outbound delivery activity (2xx/4xx/5xx/timeout); the notifications dispatcher (claim, audience by preference, SSE push); the text→document mapper.
- E2E (Playwright, simulation): billing subscribe → activating → active, change plan, cancel/resume; the bell receives a failed post's notification within seconds; an API key creates a post through `/v1/posts` and the webhook delivery is recorded; a burst against `/v1` gets 429; `/health/sentry-test` captures (asserted against the API's log when no DSN).
- `npm run typecheck`, `npm run lint`, every jest suite, and the e2e specs pass before the checklist is written.

## 8. Build order

schema + plans + env + skeleton modules (coordinator) → billing ‖ notifications ‖ developers (three agents against this contract) → outbound webhooks → Swagger → throttling + Sentry + health → security pass → SDK → run the stack and exercise every DoD item → checklist.
