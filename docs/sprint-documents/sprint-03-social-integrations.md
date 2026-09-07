# Sprint 3 — Social Channel Integrations

> **PRD Coverage**: Section 5.2 (Social Media Integration Module).
> **Depends on**: [Sprint 1](sprint-01-foundation-and-data-model.md) (`Channel` model), [Sprint 2](sprint-02-auth-and-organizations.md) (org-scoped auth).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

Connect a social account via OAuth, store its credentials encrypted, publish a post to it, and refresh its token automatically before expiry — for the MVP platform set (X, Instagram, Facebook, LinkedIn, YouTube per PRD 5.2's P0 list; TikTok/Pinterest/Threads as P1 stretch).

## Reference Study Guide

This is the single richest part of Postiz to learn from — it has shipped **32 provider integrations** against one contract. Study the contract and 2–3 concrete providers deeply; don't try to read all 32.

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Provider contract | `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` — exports `IAuthenticator` (`authenticate`, `refreshToken`, `generateAuthUrl`, `analytics?`, `postAnalytics?`), `ISocialMediaIntegration` (`post`, `comment?`), `SocialProvider` (extends both + `checkValidity`, `mention?`, `maxLength`, `scopes`) | This is the exact shape to redesign as PostGear's own `SocialProvider` interface in `packages/social-core/src/abstract/`. Keep the same conceptual split (auth concerns vs. posting concerns) — it's a clean separation worth keeping even in a fresh implementation. |
| Shared HTTP/error handling | `libraries/nestjs-libraries/src/integrations/social.abstract.ts` (`SocialAbstract` class) — `fetch()` wrapper with SSRF-safe dispatcher, rate-limit/retry handling, `RefreshToken`/`BadBody` custom errors | The idea of a shared base class that every provider extends for HTTP calls (so retry/SSRF/error-typing isn't reimplemented per provider) is worth keeping structurally. |
| Concrete provider examples | `integrations/social/x.provider.ts` (`XProvider`, OAuth2 PKCE), `integrations/social/linkedin.provider.ts` + `linkedin.page.provider.ts`, `integrations/social/youtube.provider.ts` | Read these three fully — they cover PKCE OAuth (X), personal-vs-page account duality (LinkedIn), and Google API OAuth (YouTube), which together cover most of the OAuth variations PostGear's MVP set needs (Instagram/Facebook share Meta's Graph API OAuth, similar to Postiz's Facebook/Instagram providers if you want a 4th reference). |
| Registry pattern | `libraries/nestjs-libraries/src/integrations/integration.manager.ts` (`IntegrationManager`) | Maps a `providerIdentifier` string to a provider instance — same registry pattern as Sprint 2's OAuth `providers.manager.ts`. Reuse the *pattern*, write PostGear's own `IntegrationManager` in `packages/social-core/src/manager/`. |
| Token encryption at rest | `libraries/helpers/src/auth/auth.service.ts` (`fixedEncryption`/`fixedDecryption`), used from `libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service.ts` | Confirms AES-256 encrypt-before-write / decrypt-after-read at the persistence boundary — implement the same boundary in PostGear's `Integration` repository (the schema's actual model name for a connected channel — see [Sprint 1](sprint-01-foundation-and-data-model.md)), not scattered across controllers. |
| Token auto-refresh | `libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts` (kicks off a Temporal workflow) + `apps/orchestrator/src/workflows/refresh.token.workflow.ts` (the actual workflow) | The refresh trigger lives in the API layer, the actual refresh execution lives in the worker/orchestrator — same split PostGear should use between `apps/api` and `apps/worker`. Full implementation detail belongs to [Sprint 5](sprint-05-scheduling-and-publishing.md); this sprint only needs the per-provider `refreshToken()` method to exist and be callable. |

## PostGear Implementation Plan

Target locations: `packages/social-core/src/{abstract,manager,providers}/`, `apps/api/src/modules/channels/`, `apps/web/src/app/(dashboard)/[orgId]/channels/`.

### Task 1 — Provider contract & registry
- `packages/social-core/src/abstract/social.abstract.ts`: PostGear's own base class with a shared `fetch()` helper (timeout, retry-on-429, typed errors). Start simple — full SSRF hardening can follow once a self-hosted-target platform (e.g. Mastodon custom instances) is actually in scope.
- `packages/social-core/src/manager/integration.manager.ts`: registry mapping `provider` string → implementation, used by `apps/api/src/modules/channels`.

### Task 2 — MVP providers
Implement against the contract, replacing the current stub `index.ts` files under `packages/social-core/src/providers/{twitter,instagram,facebook,linkedin,youtube}/`:
- Twitter/X: OAuth2 PKCE, text + media + thread posting.
- Meta (Instagram + Facebook): shared Graph API OAuth, page-token handling.
- LinkedIn: personal profile + company page duality.
- YouTube: Google OAuth2, video/short upload.
- TikTok/Pinterest (P1): only if MVP timeline allows; interface is already generic enough to add later without touching Sprint 4/5 code.

### Task 3 — Channel management API & encryption boundary
- `apps/api/src/modules/channels`: connect (OAuth start/callback), list, disconnect, configure posting time slots (stores on `Integration.postingTimes`, the schema's existing field for this — see [Sprint 1](sprint-01-foundation-and-data-model.md)).
- Encrypt/decrypt at the repository boundary, not in controllers.

### Task 4 — Frontend
- `apps/web/src/app/(dashboard)/[orgId]/channels/page.tsx`: connected-channel list, health indicator (token expiring/expired), disconnect action.

## Definition of Done

> **Completion checklist**: [sprint-03-completion-checklist.md](../sprint-completion-checklists/sprint-03-completion-checklist.md) — what shipped, a test command for every item, and the known gaps.

- [~] A user can connect at least X, Instagram/Facebook, LinkedIn, and YouTube via real OAuth and see the account appear in the channel list. **Built for eight providers and verifiable up to the platform redirect; no live consent screen has been completed** because no developer apps are registered — see [Known gaps](../sprint-completion-checklists/sprint-03-completion-checklist.md#known-gaps).
- [~] A test post can be published to each connected MVP platform through the provider's `post()` implementation. **`POST /channels/:id/test-post` reaches every provider's `post()`; it needs a live channel to exercise.** Media publishing depends on Sprint 4's media library, so only text posts are exercisable.
- [x] Tokens are stored encrypted in the DB — verified by inspecting a raw row: every `token` begins `v1:` and is unreadable.
- [x] Disconnecting a channel revokes/clears stored credentials — remote revocation is attempted best-effort, the columns are then emptied, and the row is soft-deleted.

### Added beyond the original scope

- [x] **TikTok and Pinterest**, which this document marked P1 "only if the timeline allows".
- [x] **Two-phase connect** for the five providers where OAuth authorizes a user but a page, account, channel or board must still be chosen — with one configuration surface shared by the fresh-connect and resume-later paths.
- [x] **A reconnect identity guard**: re-authorizing a *different* account than the channel being repaired is refused, rather than silently swapping credentials.
- [x] **Queued posts are moved to `DRAFT` on disconnect**, and the confirmation dialog states how many will be affected.
- [x] **The codebase's first repository layer**, which is what makes the encryption boundary a structural property rather than a convention.
- [x] **A latent multi-tenant bug fixed**: the API scopes on the `pg_org` cookie while the URL names the workspace, and nothing kept them in step on direct navigation. Channels was the first page to fetch workspace-scoped data and so the first to expose it.

### Deviations from this document, and why

| This doc said | What shipped | Why |
|---|---|---|
| X uses "OAuth2 PKCE" like the reference | **OAuth 2.0 PKCE — but the reference does not** | Its current `XProvider` is OAuth 1.0a with HMAC request signing and non-expiring tokens. PKCE was chosen anyway: it issues refresh tokens, so it actually exercises this sprint's refresh goal, and it removes the `twitter-api-v2` dependency. |
| The reference "confirms AES-256 encrypt-before-write at the persistence boundary" | **Written from scratch** | It does not. Its token columns hold **plaintext**; its encryption helper is used for one unrelated column, called from a controller, decrypted inside providers, and is CBC with a fixed IV derived from `JWT_SECRET` via MD5. There was nothing to follow. |
| Token cryptography lives in `integration.manager.ts` | **In `channels.repository.ts`** | That TODO was a stale stub. The registry never touches a database; the boundary belongs where plaintext stops. |
| Five P0 providers | **Eight** | TikTok and Pinterest were the documented stretch; the contract absorbed them without change, which was the point of designing it first. |
| (unstated) | **Queued posts drafted, not deleted, on disconnect** | The reference silently deletes every scheduled post for the channel with no warning and no undo. Drafting preserves the user's writing and stops the calendar claiming they are still scheduled. |
| (unstated) | **`needs_setup` and `needs_reconnect` shown differently** | The reference gives both an identical badge. Same symptom, different fixes — a user who cannot tell them apart cannot act. |

## Risks
- Each platform's OAuth app review process (especially Meta) can take days-to-weeks for production access — start those app registrations in parallel with this sprint's coding, not after. **This is now the critical path**: the code is done, and four Definition-of-Done items cannot close until an app exists to connect against.
- **Placeholder credentials look configured.** `isConfigured()` can only check that a value is present, so a handshake started with `.env.example` defaults reaches the platform and is rejected there. Validating credentials at boot would mean calling every platform on startup; the trade is deliberate but worth knowing when a connect attempt fails unhelpfully.
