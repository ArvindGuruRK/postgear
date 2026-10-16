# Sprint 8 — Billing, Notifications, Public API & Launch Hardening

> **PRD Coverage**: Section 5.8 (Billing & Subscription), Section 5.9 (Notifications & Communication), Section 5.10 (Webhooks, API & Integrations), remainder of Section 5.12 (Platform & Infrastructure).
> **Depends on**: Sprints 2–7 (this sprint monetizes and exposes everything built so far).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

Users can subscribe/pay via Stripe with plan-based limits enforced, receive in-app and email notifications on post outcomes, and external developers can integrate via a documented public API and API keys. The platform is hardened enough for a real launch.

## Reference Study Guide

### Billing

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Stripe service surface | `libraries/nestjs-libraries/src/services/stripe.service.ts` — `createSubscription`, `updateSubscription`, `createOrGetCustomer`, `createCheckoutSession`/`createEmbeddedCheckout`, `createBillingPortalLink`, `prorate`, `cancelSubscription`, `lifetimeDeal` | Full surface a billing service needs — checkout, portal, proration, cancellation, lifetime deals (P2 for PostGear). Use as a checklist of methods to design, not code to port. |
| Webhook handling | `apps/backend/src/api/routes/stripe.controller.ts` (`@Post('/')` inbound webhook, verified via `stripe.webhooks.constructEvent`) | Signature verification + idempotent event handling pattern — critical to get right (a replayed or unverified webhook is a real payment-integrity risk). |
| Plan/tier definitions | `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts`, `subscription.service.ts` | Structure for defining tiers (channel limits, AI credit allocation per tier) — PostGear's tiers are already sketched in `prd.md` §5.8 (FREE → STANDARD → PRO → TEAM → ULTIMATE-equivalent); this file shows how to encode that as data rather than scattered conditionals. |
| Billing UI | `apps/frontend/src/components/billing/{billing.component.tsx,main.billing.component.tsx,embedded.billing.tsx,first.billing.component.tsx}` | Separation between "first-time subscribe" flow and "manage existing subscription" flow — worth keeping as two distinct UI states in `apps/web/.../settings/billing/`. |

### Notifications

- Postiz's `notifications.controller.ts` (in `apps/backend/src/api/routes/`) + its email dispatcher (Resend/Nodemailer, per `complete_codebase_and_architecture_analysis.md` §4.9/§5) — study the in-app notification model (org-scoped, simple content + link fields) and the pattern of triggering an email alert from the same event that creates the in-app notification (single event → dual delivery), rather than building two separate notification paths.

### Public API, Webhooks & SDK

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Versioned public API | `apps/backend/src/public-api/public.api.module.ts`, `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` | Public API is a **separate module** from the internal `api/` routes, under its own `/v1/` namespace with its own auth (API key, not session cookie) — mirror this separation in `apps/api/src/modules/developers/` rather than reusing session-auth guards on public routes. |
| Outbound webhooks | `apps/backend/src/api/routes/webhooks.controller.ts`, frontend `apps/frontend/src/components/webhooks/webhooks.tsx` | Org-configurable webhook URLs firing on post events (published/failed) — straightforward event-subscription model to reproduce. |
| SDK as thin client | `apps/sdk/src/index.ts` — a single-file `Postiz` class wrapping `fetch` calls to the public API (no business logic in the SDK at all) | Confirms the SDK should be a pure HTTP client generated/hand-written against PostGear's own public API — build it last, once the public API is stable, not in parallel. |
| Swagger/OpenAPI docs | `libraries/helpers/src/swagger/load.swagger.ts`, wired in `apps/backend/src/main.ts` | `@nestjs/swagger` auto-generation from DTOs — same library PostGear's `apps/api` should use for its `/api/docs`. |

### Platform Hardening

- Rate limiting: Postiz uses `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` for distributed, Redis-backed limits — same combination is a reasonable default for PostGear's `apps/api`.
- Error tracking: Sentry (`@sentry/nestjs`, `@sentry/nextjs`) across backend and frontend — worth adopting directly (it's an ops tool, not core product logic, so there's no "reinvent it" argument here).

## PostGear Implementation Plan

### Task 1 — Billing
- `apps/api/src/modules/billing/`: checkout session creation, Stripe webhook handler (signature-verified, idempotent), plan/tier data module encoding channel + AI-credit limits per tier, billing portal redirect, 14-day trial logic.
- `apps/web/.../settings/billing/`: subscribe flow + manage-subscription flow as two distinct views.

### Task 2 — Notifications
- `apps/api/src/modules/notifications/`: org-scoped in-app notification model (reuses Sprint 1 schema addition if not already present), single event triggers both in-app record + email send.
- Real-time delivery: WebSocket or SSE for the in-app notification dropdown.
- Email provider integration (Resend or SMTP/Nodemailer — pick one for MVP).

### Task 3 — Public API, webhooks & SDK
- `apps/api/src/modules/developers/`: API-key-authenticated `/v1/posts`, `/v1/channels`, `/v1/analytics` endpoints, separate from the session-authenticated internal API.
- API keys: the inherited schema (per [Sprint 1](sprint-01-foundation-and-data-model.md)) models this the same way Postiz does — a single `apiKey` string field on `Organization`, not a dedicated table. Decide here whether PostGear's "generate, rotate, revoke, multiple keys" requirement (PRD §5.10) needs a proper `ApiKey` model added to the schema now — if so, this is exactly the kind of incremental schema addition Sprint 1 flagged as expected, not a break from the "keep the inherited schema" decision.
- API key management UI (generate/mask/copy/revoke) in `apps/web/.../settings/api-keys/`.
- Outbound webhook config + dispatch on post published/failed events.
- Swagger/OpenAPI docs at `/api/docs`.
- SDK (`packages/` — new `sdk` package, or defer to post-launch since it's explicitly a "build last" item per the reference note above).

### Task 4 — Hardening & launch checklist
- Redis-backed rate limiting on all public-facing routes.
- Sentry wired into `apps/api` and `apps/web`.
- Security pass: CORS policy, input validation/sanitization on all user-submitted content (especially the SEO analyzer's URL input from Sprint 7 and any HTML rendered from social previews).
- Load/E2E smoke test of the full path: signup → connect channel → compose → schedule → publish → billing checkout.

## Definition of Done

**Closed 2026-10-16** — in simulation. See the [completion checklist](../sprint-completion-checklists/sprint-08-completion-checklist.md) for the evidence per item and §8 there for the two things that still need an account you own.

- [x] A real (test-mode) Stripe subscription can be purchased, upgraded, and cancelled, with plan limits (channel count, AI credits) actually enforced against Sprint 3/6 features. **Built and proven with `BILLING_SIMULATION`** — the synthetic events go through the same signature-verified, idempotent webhook handler a real delivery hits; the real Stripe client is unit-tested but has not been run against Stripe (no key on this machine). Browser test: `billing.spec.ts`.
- [x] A post failure triggers both an in-app notification and an email within seconds. Browser test: `notifications.spec.ts › a post that fails arrives in the bell over the stream`; the email prints to the API console (the local mail mode).
- [x] An external request with a valid API key can create a post via `/v1/posts` and receive a webhook when it publishes. Browser tests: `developers.spec.ts` and `webhooks.spec.ts` (a real receiver, a verified signature).
- [x] Rate limiting visibly blocks a rapid-fire request burst against a public endpoint. Live: 65 calls → 49 × 200, 16 × 429 with `Retry-After`; `developers.spec.ts › burst`.
- [x] Sentry captures a deliberately-thrown test error from both `apps/api` and `apps/web`. **Wired and tested up to the SDK call** (`GET /health/sentry-test`, `/dev/sentry-test`); no DSN on this machine, so no event has reached Sentry yet.

## Deviations from this document, and why

> **Build contract**: [sprint-08-contract.md](sprint-08-contract.md) — the shapes everything was built to, and §0 there for the Postiz study.

| This doc said | What shipped | Why |
|---|---|---|
| "Decide whether … a proper `ApiKey` model" | An `ApiKey` table: hash, prefix, `lastUsedAt`, `revokedAt`, several per workspace | The inherited single plaintext-equivalent key cannot be rotated or revoked per integration |
| Lifetime deals, discount/coupon system (P2 in the PRD) | Not built; `isLifetime` rows are honoured by the entitlement rule | P2, and both need Stripe dashboard objects to design against |
| "WebSocket or SSE for the in-app notification dropdown" | SSE, through the Sprint 6 transport, on a GET | The transport existed; one more dependency for one direction of traffic is not worth it |
| "Resend or SMTP/Nodemailer — pick one" | The existing Nodemailer `MailService`, with a plain-text `sendPlain`; console transport locally | Already there since Sprint 2; Resend is a config change on top of SMTP, not a feature |
| "Outbound webhook config + dispatch on post published/failed events" | Signed (HMAC-SHA256, per-hook secret), delivered by a Temporal workflow per delivery with backoff, SSRF-guarded at save and send time, a delivery history | The reference sends unsigned, unchecked, unretried; the DoD says "receive a webhook", which a fire-and-forget fetch does not guarantee |
| "Load/E2E smoke test of the full path: signup → connect channel → compose → schedule → publish → billing checkout" | The existing specs cover signup/onboarding, channels, composer, scheduling and publishing; billing has its own spec; no single spec strings them together | Connecting a channel needs a real OAuth consent screen no test can click through; each link of the chain is tested where it lives |
| Plan tiers "FREE → STANDARD → PRO → TEAM → ULTIMATE" with numbers | As listed, with **placeholder prices** in `plans.ts` | A product decision for the owner; one file to change |

## Risks
- Stripe webhook race conditions (delayed event vs. optimistic UI) — process webhooks idempotently keyed on Stripe's event ID, and let the UI show a "pending" state rather than assuming instant activation. **Done**: `BillingEvent` keyed on the event id inside the transaction, `lastStripeEventAt` as the ordering guard, and an *Activating…* state that polls until the handler has applied the event.
