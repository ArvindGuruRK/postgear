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
- [ ] A user can connect at least X, Instagram/Facebook, LinkedIn, and YouTube via real OAuth and see the account appear in the channel list.
- [ ] A test post can be published to each connected MVP platform through the provider's `post()` implementation.
- [ ] Tokens are stored encrypted in the DB (verify by inspecting a raw row — it must not be plaintext).
- [ ] Disconnecting a channel revokes/clears stored credentials.

## Risks
- Each platform's OAuth app review process (especially Meta) can take days-to-weeks for production access — start those app registrations in parallel with this sprint's coding, not after.
