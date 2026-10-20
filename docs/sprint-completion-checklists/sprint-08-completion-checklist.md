# Sprint 8: Completion Checklist & Test Guide

Companion to [sprint-08-billing-notifications-api-launch.md](../sprint-documents/sprint-08-billing-notifications-api-launch.md)
and the build contract [sprint-08-contract.md](../sprint-documents/sprint-08-contract.md).
Status as of **2026-10-16**. Branch `sprint-8-billing-notifications-api`, cut from
`sprint-7-analytics-and-seo`; not merged, not pushed.

Sprint 8 started from three empty module folders (`billing/`, `developers/`,
`notifications/` held a `.gitkeep` each), two six-line page stubs
(`settings/billing`, `settings/api-keys`), a `NotificationCenter` that only
the playground used, a `MailService` that printed to the console, a Redis
counter store, and a worker that already wrote a `Notifications` row on every
publish outcome. The schema held Postiz's `Subscription`, `Credits`,
`Notifications` and `Webhooks` models, plus a single plaintext `apiKey` on
`Organization`.

The **[Pre-existing]** things worth not re-testing: the session guards and
RBAC (Sprint 2), the channel connect flow and encrypted credentials
(Sprint 3), the posts API and composer document (Sprint 4), the Temporal
worker, its retry policy and maintenance reconcile (Sprint 5), the SSE
transport and the credit ledger (Sprint 6), the SSRF URL guard (Sprint 7),
and the design-system components.

**All five Definition of Done items are met in simulation**, each with a
browser test or a live probe against the full stack (API, worker and web
together). Two things have **not** run for real and need an account you own:
the Stripe client has never spoken to Stripe (the keys in `.env` are the
`.env.example` placeholders, which the API now recognises and ignores), and
Sentry has never received an event (no DSN). Both are a config change away;
[§8](#8-what-remains-for-you) lists the exact steps. Every other piece (the
idempotency table, the plan limits, the notification outbox, the live bell,
the API keys, the `/v1` routes, the signed webhook deliveries with their
retries, the rate limits, the health check) ran for real on this machine.

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO, Temporal
npm install                   # adds stripe, @nestjs/throttler, @nest-lab/throttler-storage-redis,
                              # @sentry/nestjs, @sentry/nextjs, @nestjs/swagger, zod-to-json-schema; packages/sdk
npm run db:generate
npm run db:migrate            # applies 20261016120000_sprint8_billing_notifications_api
npm run db:seed               # resets the demo plan, seeds an API key and three notifications
```

Then `npm run dev`. Two lines in `.env` for the local mode (both refused in
production):

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_SIMULATION` | `false` | `true`: no Stripe; checkout, plan changes and cancellation synthesise the Stripe events and run them through the real webhook handler. **Set `true` locally** |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | unset | Real test-mode keys. Placeholders read as unset; the key and the signing secret must be set together |
| `STRIPE_PRICE_<TIER>_<MONTHLY\|YEARLY>` | unset | Optional: pin real price ids; otherwise checkout sends inline `price_data` from the plan table |
| `BILLING_TRIAL_DAYS` | `14` | The no-card trial a new workspace starts on (Pro). 0 disables it |
| `RATE_LIMIT_PER_MIN` | `300` | Per-address ceiling on every route (`dev:api:e2e` raises it to 3 000) |
| `API_RATE_LIMIT_PER_MIN` | `60` | Per-key ceiling on `/v1` |
| `WEBHOOK_ALLOW_PRIVATE_URLS` | `false` | Let outbound webhooks reach localhost/private addresses. **Set `true` locally** to test a receiver on this machine |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | unset | Unset = no Sentry at all |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | Performance traces, off by default |

The migration adds four tables (`ApiKey`, `BillingEvent`, `NotificationCursor`,
`WebhookDelivery`), three enums, and columns on `Subscription`,
`Notifications` and `Webhooks`; nothing inherited is removed or renamed
(`SCHEMA_NOTES.md` § Sprint 8 additions). The seed resets the demo
workspace to an active monthly Standard plan on every run, installs the API
key `pg_seedDemoKey00000000000000000000000000000` (prefix `pg_seedDemo`),
and three typed notifications so the bell has every treatment.

---

## 1. Plans and billing: `apps/api/src/modules/billing`

| # | Item | Status |
|---|---|---|
| 1.1 | `plans.ts`: the plan table as data (FREE / STANDARD / PRO / TEAM / ULTIMATE: price, channels, AI credits, members, features) and the pure `resolveEntitlement` (trial until `trialEndsAt`, cancellation until `cancelAt`, past-due keeps access, canceled/incomplete → FREE). **The single source of truth**: `ai/credits/credits.policy.ts` now derives `AI_CREDIT_ALLOWANCE` from it and keeps no numbers of its own | ✅ [New] |
| 1.2 | `billing.config.ts`: mode: simulation → stripe → unconfigured; placeholder keys ignored with a boot warning (also re-applied here because `ConfigService.get` falls back to the raw environment) | ✅ [New] |
| 1.3 | `stripe.client.ts`: a `StripeGateway` behind a token: the real client (stripe v23: Checkout Session with inline `price_data`, customer reuse via `paymentId` with an idempotency key, billing portal, `subscriptions.update` with `create_prorations` + `pending_if_incomplete`, a Subscription Schedule for downgrades, `invoices.createPreview`), the simulation (synthetic `sim_<uuid>` events applied through the same handler after 1–2 s), and the unconfigured gateway (503) | ✅ [New]; real client **not run** |
| 1.4 | `stripe-webhook.service.ts`: `receive(rawBody, signature)` verifies with `stripe.webhooks.constructEvent` (400 + `billing.webhook_rejected`); `apply(event)` inserts the `BillingEvent` row first inside the transaction (duplicate → 200 `{ duplicate: true }` + `billing.webhook_duplicate`), ignores events older than `lastStripeEventAt` (`ignored:stale`), resolves the org from metadata → `client_reference_id` → `paymentId` → subscription id, handles `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`; a handler error is logged `billing.webhook_failed`, recorded `failed:<reason>`, and answered 200 so Stripe does not replay a half-effect for three days | ✅ [New] |
| 1.5 | `entitlements.service.ts`: `entitlement`, `channelUsage` (limit = max(plan, `totalChannels`)), `assertCanConnect`, `startTrial` (TRIALING Pro for `BILLING_TRIAL_DAYS`, refused when any row ever existed), notifications `billing.activated` / `billing.canceled` / `billing.payment_failed` / `billing.trial_started` | ✅ [New] |
| 1.6 | Routes `GET /billing/status`, `GET /billing/plans`, `GET /billing/subscription` (+ usage), `POST /billing/trial`, `POST /billing/checkout`, `POST /billing/portal`, `GET /billing/change/preview`, `POST /billing/change` (upgrade now, downgrade at period end, "choose the current plan again" releases a pending downgrade), `POST /billing/cancel` (reason + feedback mailed to `SMTP_FROM`), `POST /billing/resume`, `POST /billing/webhook` (`@Public() @SkipThrottle()`, raw body) | ✅ [New] |
| 1.7 | Channel limit (Sprint 3's connect flow): `GET /channels` → `{ channels, limit }`; `connect/:provider` redirects `?error=channel_limit` at the limit (never on a reconnect); `completeConnect` re-checks before a new row; `billing.limit_reached` logged | ✅ [New] |
| 1.8 | Trial on workspace creation (`OrgService.create`, best-effort after the transaction) | ✅ [New] |

### 1.4: why a failed handler answers 200

Stripe retries a non-2xx for three days. A handler that throws half-way has
already rolled back its transaction, so a replay would run the same code
against the same state and fail the same way, or, worse, succeed on the
second half of a partial effect. Recording the event as `failed:<reason>`
and answering 200 makes the replay a duplicate, and the security log line
is the alarm. The reference's 500 is what makes its webhook repeat the $1
card hold.

**How to test:**

```bash
cd apps/api && npx jest src/modules/billing src/modules/channels src/modules/org   # 10 suites, 112 passed
```

The suite: config modes and placeholders; every entitlement status and
trial expiry; the channel limit at and below the line, lifetime rows,
hand-granted `totalChannels`, reconnects allowed; trial eligibility; the
webhook against a fake store; bad signature 400 + log, duplicate, the
insert race, stale, each handled type's effect, unknown org, a handler
error recorded not thrown; the simulation producing events the handler
accepts and cancel/resume/upgrade/downgrade through it; the service's
refusals (`ALREADY_SUBSCRIBED`, `NO_SUBSCRIPTION`, `SAME_PLAN`,
`NOT_CANCELING`, `MANUAL_PLAN`); the schemas.

**Live, against the stack in simulation** (2026-10-16): `GET /billing/status`
→ `{ mode: "simulation", publishableKey: null, trialDays: 14 }` with the three
placeholder warnings at boot; the browser test below took the demo workspace
Standard → Pro (activating… → active, limit 5 → 15, credits 100 → 500), cancelled
with a reason (status `canceling`, the end date shown, the feedback mail printed
to the console), resumed, and scheduled a downgrade back to Standard; every
event is a `BillingEvent` row (`sim_…`, `applied`).

---

## 2. Notifications: `apps/api/src/modules/notifications`, worker rows

| # | Item | Status |
|---|---|---|
| 2.1 | The worker's two outcome rows (`publish.activities.ts`) are typed (`post.failed` / `post.published`), titled, carry `meta` (post, channel, reason, message, attempts, permalink) and `emailStatus: PENDING`; a `channel.needs_reconnect` row when a refresh fails (`integration.activities.ts`, once per channel per day) | ✅ [New] |
| 2.2 | `NotificationsService.notify()` for API-side events (billing, webhooks): writes the row, pushes to open streams | ✅ [New] |
| 2.3 | `GET /notifications?limit=&before=` (read = older than the cursor, or the membership's `createdAt` when there is none), `GET /notifications/unread`, `POST /notifications/read-all` (a `NotificationCursor` per user **and** workspace), `GET /notifications/stream` (SSE on GET through `openSseStream`: `ready`, then `notification` per row, heartbeat, `@SkipThrottle()`) | ✅ [New] |
| 2.4 | `notifications.dispatcher.ts`: every 3 s, non-overlapping, skipped under `NODE_ENV=test`: claims `PENDING` rows (`updateMany` → `SENDING`, re-offering rows stuck 5 min), resolves the audience per type (failure emails / success emails / admins, non-disabled, activated), mails plain text through `MailService.sendPlain`, marks `SENT` / `SKIPPED` / `FAILED` (+ `notification.email_failed`); pushes every row newer than its last poll to that workspace's streams | ✅ [New] |
| 2.5 | `GET/PATCH /users/me/notification-preferences`: the inherited `sendSuccessEmails` / `sendFailureEmails` | ✅ [New] |
| 2.6 | Email catalogue (`notifications.types.ts`): subject and lines per type, plain text, provider messages interpolated as text, a link to the queue / channels / billing and to the preferences | ✅ [New] |

### 2.4: why an outbox and not a mail call from the worker

The worker has the event; the API has the mail transport. Giving the worker
its own transport would be a second mail path to configure and a second
place for the preferences to be read. Writing the row with `PENDING` makes
the `Notifications` table the queue: one event, one row, one mail path, and
a crash between the two leaves a row the next tick sends. The reference
sends mail through a global one-per-700-ms Temporal queue and writes the
row separately, which is how it ends up with duplicates.

**How to test:**

```bash
cd apps/api && npx jest src/modules/notifications src/modules/users   # 6 suites, 47 passed
cd apps/worker && npx jest                                            # 12 suites, 84 passed (the two rows' shape among them)
cd apps/web && npx jest src/components/notifications                  # 17 passed: the reducer, the GET SSE client
```

**Live**: with a `[simulate:400]` post published now, the bell showed
**Post failed** over the stream in under three seconds without a reload,
and the API console printed the email to `demo@` and `member@` with the
channel, the reason and the queue link; **Mark all as read** zeroed the
badge for this workspace only. `e2e/notifications.spec.ts` (3 passed)
asserts the three.

---

## 3. API keys and the public API: `apps/api/src/modules/developers`

| # | Item | Status |
|---|---|---|
| 3.1 | `ApiKey` model: `pg_` + 40 base64url chars (30 random bytes), SHA-256 hash stored, 11-char prefix shown, `lastUsedAt` written at most once a minute (memo + conditional `updateMany`), `revokedAt` instead of deletion, max 10 live keys, rotate = revoke + create in one transaction; every lifecycle change logged `apikey.*` with ids and prefix only | ✅ [New] |
| 3.2 | `ApiKeyGuard` + `@ApiKeyAuth()` (public to the session guards, never them): `Authorization: Bearer` or `X-API-Key`; malformed values refused before any query; one 401 message for every cause + `apikey.rejected`; sets `activeOrg` (`ADMIN`) and `apiKey` | ✅ [New] |
| 3.3 | `ApiKeyThrottlerGuard`: `@nestjs/throttler` on the global module's Redis store, one bucket per key across every `/v1` route, `API_RATE_LIMIT_PER_MIN`, 429 `Rate limit exceeded` + `Retry-After`, `api.throttled` logged | ✅ [New] |
| 3.4 | `/v1/me`, `/v1/channels`, `/v1/posts` (list by lowercase `state`, 20 per page; get; create from plain text (paragraphs, hard breaks, empty paragraphs for blank lines, round-trip exact) through `PostsService.create` so every platform rule applies; delete), `/v1/analytics/overview`: a second front door to three existing services, no second implementation | ✅ [New] |
| 3.5 | `/v1` validation names the failing field (`PublicZodBody`), unlike the app's own routes; bodies stay strict | ✅ [New] |
| 3.6 | OpenAPI: `GET /api/docs` (UI) and `GET /api/docs-json`, public, `/v1` only, bearer scheme, request schemas from the zod DTOs via `zod-to-json-schema`, 401/429 on every operation | ✅ [New] |
| 3.7 | Session routes `GET/POST /developers/api-keys`, `POST :id/rotate`, `DELETE :id` (`ADMIN`) | ✅ [New] |

**How to test:**

```bash
cd apps/api && npx jest src/modules/developers      # 8 suites, 72 passed
```

**Live**: `GET /v1/me` with the seeded key → the workspace, the key's prefix,
`plan.tier`; no key / a revoked key → 401; `POST /v1/posts` with two
paragraphs → 201 and `GET` returns the same text; a 65-call burst → 49 × 200
then 16 × 429 with `Retry-After: 60`; `/api/docs` renders and `/api/docs-json`
lists the five paths without a session. `e2e/developers.spec.ts` (5 passed):
create on the page → secret once → row; `/v1/posts` with it; revoke → 401; a
70-call burst sees 429 with `retry-after`.

---

## 4. Outbound webhooks: `apps/api/src/modules/webhooks`, `apps/worker`

| # | Item | Status |
|---|---|---|
| 4.1 | `Webhooks` gains `secret` (AES-256-GCM ciphertext of `whsec_…`, shown at creation and rotation only, cleared on delete), `events`, `disabled`; `WebhookDelivery` one row per event per hook, unique on `deliveryKey` | ✅ [New] |
| 4.2 | Routes (`ADMIN`): `GET /webhooks` (with the events, the retry policy and `allowPrivateUrls`), `POST` (201 + one-time secret), `GET/PATCH/DELETE :id`, `POST :id/rotate-secret`, `POST :id/test` (202, a `webhook.test` delivery with a sample post), `GET :id/deliveries` (last 20) | ✅ [New] |
| 4.3 | URL policy (`webhook-url.ts`): https-only through the Sprint 7 SSRF guard (every resolved address checked), or any http(s) address with `WEBHOOK_ALLOW_PRIVATE_URLS`; refusals logged `webhook.unsafe_url`; channel ids must be the workspace's | ✅ [New] |
| 4.4 | `packages/db/src/webhook-signature.ts`: `X-PostGear-Signature: v1=<HMAC-SHA256(secret, "<ts>.<body>")>`, verify with a ±5 min window, constant-time; the SDK carries its own copy, pinned to the same vector | ✅ [New] |
| 4.5 | Worker `lib/webhook-sender.ts`: `node:http(s)` with the socket **pinned** to the guard-validated address (no second DNS lookup), 10 s timeout, body drained and capped, never stored; 2xx delivered, 408/429/5xx/network retry, other 4xx rejected | ✅ [New] |
| 4.6 | `webhookDeliveryWorkflow`: one per delivery, activity retry 30 s × 4ⁿ capped at 2 h, six attempts, non-retryable types; every attempt written on the row; final failure → `FAILED` + a `webhook.failed` notification once | ✅ [New] |
| 4.7 | Fan-out: `writePublished` / `markPublishFailed` create the deliveries **in the same transaction** as the outcome and the notification (`createMany skipDuplicates`), then start the workflows best-effort; the maintenance reconcile starts any `PENDING` delivery older than a minute | ✅ [New] |
| 4.8 | The settings page: list, create/edit dialog (name, URL, events, channel multi-select), the one-time secret panel, Send test, Pause/Resume, Rotate secret, Delete, a deliveries sheet refreshed every 3 s | ✅ [New] |

### 4.5: why the sender pins the socket

Judging a URL at save time and again at send time is still two lookups
apart from the connection the HTTP client makes; a host whose record flips
between them lands the request inside the network. The crawler solved this
in Sprint 7 by connecting to the exact address it validated, and the sender
does the same with a `lookup` that answers with that address and a
`servername` that keeps TLS honest.

**How to test:**

```bash
cd packages/db && npx jest                                                              # 36 passed (10 for the signature)
cd apps/worker && npx jest src/lib/webhook-sender.test.ts src/lib/webhook-payload.test.ts   # 20 passed: headers, verifiable signature, every status class, timeout, refusal, SSRF, enqueue idempotency
cd apps/worker && npx jest src/workflows/webhook-delivery.workflow.test.ts              # 5 passed against a time-skipping Temporal: first-try, retries with backoff, rejection final, policy exhausted, skipped
cd apps/api && npx jest src/modules/webhooks src/modules/scheduling                     # 38 passed
```

**Live**: `e2e/webhooks.spec.ts` (2 passed) hosts a receiver on
`127.0.0.1`, registers it through the page, sends a test, and verifies the
request's headers and signature with the db helper, the documented payload,
and the delivery showing **Delivered**; a metadata-address URL is either
accepted (private URLs allowed, the local setting) or refused with the
guard's message.

---

## 5. Hardening

| # | Item | Status |
|---|---|---|
| 5.1 | `common/throttling`: `@nestjs/throttler` with `@nest-lab/throttler-storage-redis` behind a wrapper that counts in-process during a Redis outage; `AppThrottlerGuard` per address on every route (`request.ip` behind `trust proxy`), `api.throttled` logged; `@SkipThrottle()` on the Stripe webhook and the notification stream | ✅ [New] |
| 5.2 | Sentry: `apps/api/src/instrument.ts` first import, a no-op without `SENTRY_DSN`, traces off, no default PII; `HttpExceptionFilter` reports only non-`HttpException` errors with method, path and ids; web `instrumentation.ts` (+ `onRequestError`), `instrumentation-client.ts`, server/edge configs, `withSentryConfig` from `@sentry/nextjs/config` without source-map upload | ✅ [New]; **no real event sent** |
| 5.3 | `GET /health` (public: database check, uptime, whether Sentry is on; 503 when degraded), `GET /health/sentry-test` (superadmin; throws), `/dev/sentry-test` page (browser and server-function throws; excluded from production) | ✅ [New] |
| 5.4 | Security pass: every new body and query through a zod pipe (grep-verified: no bare `@Body`/`@Query`); CORS unchanged (credentials only for `WEB_URL`; `/v1` is server-to-server); the Sprint 7 SEO URL schema (control characters stripped, bounded, the guard fails closed) re-read and unchanged; social previews still render text nodes, no `dangerouslySetInnerHTML` added anywhere; notification content and provider messages rendered as text, emails plain text; API keys hashed, webhook secrets encrypted, secrets never logged (prefixes only); `/v1` 401 is one message | ✅ |
| 5.5 | `main.ts`: `rawBody: true` for Stripe; `dev:api:e2e` raises `RATE_LIMIT_PER_MIN` for the browser suite | ✅ |

**How to test:**

```bash
cd apps/api && npx jest src/modules/health src/common   # the health route, the filter's Sentry capture, the SSE helper, sanitize
```

**Live**: `GET /health` → `{ status: "ok", checks: { database: "ok" }, sentry: false }`;
`GET /health/sentry-test` as the demo admin → 500 and the API logged
`Unhandled GET /health/sentry-test` (what Sentry would receive); as
`member@` → 403.

---

## 6. The screens: `apps/web`

| # | Item | Status |
|---|---|---|
| 6.1 | `settings/layout.tsx` + `SettingsShell`: `SettingsNav` (Team, Billing, API keys, Webhooks, Notifications) around every settings page | ✅ [New] |
| 6.2 | `/settings/billing`: two states: subscribe (plan grid from `PlanCard`, Monthly/Yearly, trial banner, *Start free trial*) and manage (current-plan `Card` with a status `Badge`, next billing date, two `UsageMeter`s, Manage billing, Change plan with a proration preview, Cancel with reason + feedback, Resume, the scheduled-downgrade line); *Activating…* polls for ≤ 60 s after a checkout or change; simulation and unconfigured `Alert`s | ✅ [New] |
| 6.3 | `/settings/api-keys`: the table, Create → one-time secret with Copy and a curl example, Rotate and Revoke behind `AlertDialog`s, the limit line, the `/api/docs` link | ✅ [New] |
| 6.4 | `/settings/webhooks`: see 4.8 | ✅ [New] |
| 6.5 | `/settings/notifications`: the two email `Toggle`s, saved on change | ✅ [New] |
| 6.6 | The bell (`NotificationBell` in the top bar's new slot): SSE with 1 s → 30 s reconnect and a re-fetch after each reconnect, the unread badge, Mark all as read, items navigate (app paths in-app, platform links in a new tab), a settings footer | ✅ [New] |
| 6.7 | Channels page: "n of m channels", Connect disabled at the limit with a link to billing, the `channel_limit` error copy | ✅ [New] |
| 6.8 | Design system: `NotificationCenter` extended (`unreadCount`, `onMarkAllRead`, `footer`, `loading`, typed items with an icon and tone), `PlanCard` gains `actionDisabled`; both in the playground; rule §16d written | ✅ |
| 6.9 | `/dev/sentry-test` | ✅ [New] |

**How to test:**

```bash
cd apps/web && npx jest     # 15 suites, 166 passed (billing view model 13, notifications 17, API keys 9, webhooks 6 among them)
npm run test:e2e -- e2e/billing.spec.ts e2e/notifications.spec.ts e2e/developers.spec.ts e2e/webhooks.spec.ts
```

With the API (`npm run dev:api:e2e`), the worker and `BILLING_SIMULATION`,
`WEBHOOK_ALLOW_PRIVATE_URLS` on: **15 passed**. The rest of the suite
(`auth`, `onboarding`, `channels`, `composer`, `media`, `calendar`, `queue`,
`playground`, `ai`, `analytics`, `seo`) was re-run after the sprint: every
test passes except `queue › lists the seeded posts in order`, which Sprint 7
already recorded as a data artefact of earlier runs (published posts cannot
be deleted; `npm run db:reset` clears it, not run here because this
database holds a real LinkedIn channel). Three pre-existing tests were made
robust on the way: the onboarding clean-up helper now removes a workspace's
trial subscription and notifications before the workspace; the analytics
"Sync now" selector is exact (the status pill's label mentions the words);
the calendar drag test keeps both days inside one Monday-anchored week.

Visual review: the four settings pages and the open bell at 1360 px in light
and dark, and at 390 px; `window.scrollX` stays 0 on every page (one overflow
found and fixed, see the review table).

---

## 7. The SDK: `packages/sdk`

| # | Item | Status |
|---|---|---|
| 7.1 | `PostGear` client: `me()`, `channels.list()`, `posts.list/get/create/delete`, `analytics.overview`; bearer header, one HTTP call per method, `PostGearError` with the API's message, status and `retryAfterSeconds`, a per-call timeout, no retries, no business logic | ✅ [New] |
| 7.2 | `verifyWebhookSignature` / `constructWebhookEvent` / `signWebhookPayload`, the same scheme as the worker, pinned to the same test vector | ✅ [New] |
| 7.3 | Standalone: no monorepo imports, its own types mirroring §5.3, a README with a receiver example; `private: true` until a publish decision | ✅ [New] |

```bash
cd packages/sdk && npx jest     # 16 passed
```

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| A real (test-mode) Stripe subscription can be purchased, upgraded, and cancelled, with plan limits (channel count, AI credits) actually enforced against Sprint 3/6 features | **In simulation.** `e2e/billing.spec.ts` (5 passed): Standard → Pro through *Activating…*, the channel meter 5 → 15 and the credits meter 100 → 500 (the Sprint 6 ledger reads the plan table), cancel with a reason and resume, a scheduled downgrade; `channels.service.spec.ts` and the live Channels page enforce the connect limit; the webhook handler that applies a real Stripe event is the same code path (§1.4). **Not run against Stripe**: see §8 step 1 |
| A post failure triggers both an in-app notification and an email within seconds | `e2e/notifications.spec.ts › a post that fails arrives in the bell over the stream, without a reload`, and the API console printing the email to both members, all within the dispatcher's 3 s tick. Live run 2026-10-16 |
| An external request with a valid API key can create a post via `/v1/posts` and receive a webhook when it publishes | `e2e/developers.spec.ts` (201 from `/v1/posts` with a key created on the page) and `e2e/webhooks.spec.ts` (a signed delivery received by a real receiver, verified with the shared helper). The publish fan-out is the same `enqueueWebhookDeliveries` the test send uses, exercised by `webhook-payload.test.ts` and the worker suite; a queued `/v1` post published to the stand-in produced a `post.published` delivery on this machine |
| Rate limiting visibly blocks a rapid-fire request burst against a public endpoint | Live: 65 calls to `/v1/me` with the seeded key → 49 × 200 then 16 × 429 with `Retry-After: 60`; `e2e/developers.spec.ts › burst` asserts at least one 429 with `retry-after`; `api-key-throttler.guard.spec.ts` pins the 61st call |
| Sentry captures a deliberately-thrown test error from both `apps/api` and `apps/web` | **In simulation.** `GET /health/sentry-test` throws and the filter calls `reportUnexpectedError` (`http-exception.filter.spec.ts`), which is a no-op without a DSN; `/dev/sentry-test` throws in the browser and in a server function. **No DSN on this machine**, so no event has reached Sentry: see §8 step 2 |

---

## Decisions (section 4 of the brief) and deviations

| Topic | Decision | Why |
|---|---|---|
| API keys | A new `ApiKey` table: hash only, prefix, `lastUsedAt`, `revokedAt`, several per workspace, rotate = revoke + create. `Organization.apiKey` left unused | The reference's single key is stored under AES-CBC with a fixed IV and shown in the UI, effectively plaintext, and cannot be rotated without breaking every integration at once |
| Stripe idempotency | `BillingEvent` keyed on the event id, inserted in the transaction; `lastStripeEventAt` as the ordering guard; a failed handler answers 200 and is logged | §1.4; the reference has no idempotency and a 500 on any throw |
| Plan limits | Channel count where channels are **connected** (connect route + callback re-check); AI credits through the Sprint 6 ledger reading the plan table; nothing already connected is disabled on a downgrade; members **not** enforced | A downgrade that silently disables channels in arbitrary order (the reference) is a support ticket; refusing the next connection is a message. Member limits need the Team page, which is still the Sprint 2 stub |
| Trial | 14 days, Pro, no card, started when a workspace is created; expiry computed on read | US-8.5 says no card; a job that flips trials is a job that can be late |
| Real-time notifications | SSE on a GET through the Sprint 6 helper; a GET-capable client beside the POST one | The transport existed; a WebSocket would add a dependency for one direction of traffic |
| Outbound delivery | Temporal workflow per delivery, in the worker, with the SSRF guard and a pinned socket at send time; deliveries created in the publish transaction, started best-effort, reconciled | A slow receiver never blocks the API; a deploy mid-backoff resumes the backoff; a Temporal blip costs a minute, never the delivery |
| SDK | Built last, against the stable `/v1`; standalone copy of the signature verifier | As the sprint document asked |
| Prices | Placeholders in `plans.ts` (29 / 49 / 99 / 199 a month, yearly = ten months) | **An owner's decision**; one file to edit |
| Plan changes | Upgrade now with proration; downgrade through a Stripe Subscription Schedule, recorded on the row as `scheduledTier`; choosing the current plan again releases a pending downgrade | US-8.3; the reference applies every change immediately |
| Notifications read state | `NotificationCursor` per (user, workspace); none → unread since the membership | The reference's one timestamp per user clears every workspace at once |
| `/v1` ergonomics | Lowercase `state` filter, blank lines → empty paragraphs (round-trip exact), validation errors name the field | Integrators read errors in a terminal; the app's field-hiding exists for the sign-in oracle |
| Throttling | Per address on every route plus per key on `/v1`, Redis-backed with an in-process fallback during an outage | The reference throttles one route, per org, in an hour window |
| Sentry | Minimal: errors only, traces off, no PII, no replay, no source maps | The free tier is for stack traces; the reference records prompt contents and samples everything |
| Webhook events | `post.published` and `post.failed` only; `post.scheduled` (US-10.3) not built | The two the DoD names; scheduling fires on every save and would be noise without a filter |
| `Customer` model | Not used for Stripe; `Organization.paymentId` holds the customer id as inherited | The model doubles as a client-grouping label on `Integration`, which is a different feature |

---

## Review findings fixed before closing (2026-10-16)

| Finding | Fix |
|---|---|
| The webhooks page read `WEBHOOK_ALLOW_PRIVATE_URLS` from the web server's environment, which `next dev` does not load from the repository's `.env`, so the form refused `http://127.0.0.1` client-side | The API's `GET /webhooks` reports `allowPrivateUrls`; the page reads it from there |
| `withSentryConfig` imported from the package root failed under Next's ESM loader (`does not provide an export named`), and `require` found no such export either | Sentry 11 exports it from `@sentry/nextjs/config` |
| The API-keys page scrolled the window 343 px sideways at phone width: the `sr-only` "Actions" header label is absolutely positioned and, with no positioned ancestor inside the table's scroll wrapper, was laid out at the table's far edge | `TableHead className="relative"` on that cell, on both the API-keys and the webhooks tables |
| The bell test asserted an exact unread count, which races with the billing spec's own notifications when the suite runs in parallel | At least `before + 1` |
| The onboarding clean-up helper deleted a test workspace that now owns a trial subscription and a notification (neither cascades) | The helper removes them first |
| `Sentry.init({ sendDefaultPii })` is not an option in v11 | Removed; the default is already false |

## Known gaps

1. **The Stripe client has never run against Stripe.** `StripeGatewayClient` is
   written against the v23 types and unit-tested against a fake; the first
   checkout with test keys and `stripe listen` (§8) is the next verification.
   `invoice.paid` reads the period end from the first invoice line when present.
2. **No Sentry event has been sent.** Everything up to the SDK call is tested.
3. **Member limits are not enforced** (`Plan.members` is data only): the Team
   page is still the Sprint 2 stub, so there is nowhere to enforce it yet.
4. **At phone width the top bar's right-hand controls (bell, account menu) are
   clipped** behind the fixed-width workspace switcher. Pre-existing (the
   avatar was already off-screen at 390 px) and worsened by the bell; the
   compact switcher belongs to the `ui-revamp` branch's top bar work.
5. **Not built (P1/P2)**: `post.scheduled` webhooks, a trial-ending reminder
   email (the banner on the billing page is the P0 half), digest emails,
   per-item mark-as-read, coupons and lifetime deals, OAuth apps, Zapier/Make
   connectors, the MCP server, admin subscription management.
6. **`queue › lists the seeded posts in order`** fails on this database for
   the reason Sprint 7 recorded (published posts from earlier runs lead the
   list); `npm run db:reset` clears it and was not run because the database
   holds a real LinkedIn channel.
7. **The seeded API key is a known secret.** It exists for local runs; a
   deployment that seeds must not install it.
8. **The SDK is `private: true`** and unpublished; `AnalyticsOverview` is typed
   loosely there (the full shape is in the OpenAPI document).
9. **The e2e suite is still not in CI**: unchanged since Sprint 2.

## 8. What remains for you

1. **A real Stripe test-mode run** (free): `docs/local-testing-guide.md` §5f;
   keys from a test-mode dashboard, `stripe listen --forward-to
   localhost:3001/billing/webhook`, `BILLING_SIMULATION="false"`, pay with
   `4242 4242 4242 4242`, watch *Activating…* become the plan, then
   `stripe events resend <id>` to see `{ duplicate: true }`.
2. **A real Sentry event** (free): §5j; two DSNs (or one), restart both apps,
   open `/health/sentry-test` as the demo admin and `/dev/sentry-test` in the
   browser.
3. **Confirm the prices and the trial tier** in `apps/api/src/modules/billing/plans.ts`.
4. The manual walk-through: §5f–§5j of the testing guide, in order; billing
   (change, cancel, resume, the channel limit, a new workspace's trial),
   notifications (a failing post, the console email, the preferences), API
   keys (create, curl `/v1/me`, `/api/docs`, the 429 burst, revoke), webhooks
   (`npx -y http-echo-server 4000`, a test send, a real publish, a stopped
   receiver's retries), Sentry.

---

## Files changed in this pass

**Added: schema, packages**
- `packages/db/prisma/migrations/20261016120000_sprint8_billing_notifications_api/`; `schema.prisma` (four models, three enums, columns on `Subscription`, `Notifications`, `Webhooks`); `src/types.ts`; `src/webhook-signature.ts` (+ test); `prisma/SCHEMA_NOTES.md`; the seed (plan reset, API key, notifications)
- `packages/scheduling/src/workflows.ts`: the delivery workflow's names, retry policy, failure types
- `packages/sdk/`: the whole package
- `packages/ui/src/components/notification-center.tsx` (extended), `plan-card.tsx` (`actionDisabled`)

**Added: API**
- `src/modules/billing/{plans,billing.config,billing.types,billing.messages,billing.repository,entitlements.service,stripe.client,stripe-webhook.service,billing.service,billing.controller,billing.module}.ts`, `dto/billing.schema.ts`, `testing/fake-billing-store.ts` (+ 7 specs)
- `src/modules/notifications/{notifications.types,notifications.repository,notifications.stream,notifications.service,notifications.dispatcher,notifications.controller,notifications.messages,notifications.module}.ts`, `dto/notifications.schema.ts` (+ 5 specs)
- `src/modules/developers/{developers.module,developers.messages}.ts`, `api-keys/*`, `auth/*`, `v1/*`, `openapi/*` (+ 8 specs)
- `src/modules/webhooks/{webhooks.module,webhooks.controller,webhooks.service,webhooks.repository,webhooks.messages,webhook-url}.ts`, `dto/webhooks.schema.ts` (+ 3 specs)
- `src/modules/health/{health.module,health.controller}.ts` (+ spec); `src/common/throttling/{throttling.module,app-throttler.guard,resilient-throttler.storage}.ts`; `src/common/sentry/sentry.ts`; `src/instrument.ts`

**Added: worker**
- `src/lib/{webhook-sender,webhook-payload,webhook-start}.ts` (+ tests), `src/activities/webhook.activities.ts`, `src/workflows/webhook-delivery.workflow.ts` (+ test)

**Added: web**
- `src/app/(dashboard)/[orgId]/settings/{layout,billing/page,api-keys/page,webhooks/page,notifications/page}.tsx`, `src/components/settings/settings-shell.tsx`
- `src/components/billing/*`, `src/components/notifications/*`, `src/components/developers/*`, `src/components/webhooks/*` (+ tests)
- `src/types/{billing,notifications,developers,webhooks}.ts`; `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/sentry.{server,edge}.config.ts`; `src/app/dev/sentry-test/*`
- `e2e/{billing,notifications,developers,webhooks}.spec.ts`

**Modified**
- `apps/api`: `app.module.ts`, `main.ts` (raw body, Sentry first, OpenAPI), `config/env.ts`, `common/logging/security-logger.ts`, `common/filters/http-exception.filter.ts` (+ spec), `modules/ai/credits/{credits.policy,credits.service,credits.repository}.ts` (+ specs), `modules/channels/{channels.service,channels.controller,channels.messages,channels.module}.ts` (+ spec), `modules/org/{org.service,org.module}.ts` (+ spec), `modules/users/users.controller.ts` (+ spec), `modules/mail/mail.service.ts` (`sendPlain`, `linkTo`), `modules/redis/redis.service.ts` (`rawClient`), `modules/analytics/analytics.module.ts` (export), `modules/scheduling/scheduling.service.ts` (`startWebhookDelivery`)
- `apps/worker`: `config/env.ts`, `activities/{index,publish.activities,integration.activities,maintenance.activities}.ts`, `workflows/index.ts`, two workflow tests
- `apps/web`: `next.config.mjs`, `components/navigation/{topbar,app-shell,dashboard-shell}.tsx`, `components/channels/channels-view.tsx`, `app/(dashboard)/[orgId]/channels/page.tsx`, `types/channel.ts`, the playground's SaaS-patterns section
- `e2e/helpers/users.ts`, `e2e/{analytics,calendar}.spec.ts`; root `package.json` (`dev:api:e2e`), `package-lock.json`, `.env.example`
- `docs/local-testing-guide.md` (§5f–§5j, the table, the cheat-sheet), `docs/design-patterns/design-system-rules.md` §16d, `docs/sprint-documents/sprint-08-billing-notifications-api-launch.md`, this file and the contract
