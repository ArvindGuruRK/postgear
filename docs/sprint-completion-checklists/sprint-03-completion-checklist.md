# Sprint 3 — Completion Checklist & Test Guide

Companion to [sprint-03-social-integrations.md](../sprint-documents/sprint-03-social-integrations.md).
Status as of **2026-09-07**.

Sprint 3 started from a genuinely empty integration layer. `packages/social-core`
was seven `export {}` provider stubs plus an abstract class with no methods,
`apps/api/src/modules/channels/` held only a `.gitkeep`, and the Channels page
was `return null` — though the sidebar already linked to it and onboarding step 4
showed a disabled *"Connect a channel — coming in Sprint 3"* button.

The genuinely **[Pre-existing]** set worth not re-testing: the AES-256-GCM helper
(`packages/db/src/crypto.ts`, Sprint 1) and its 26 tests, the `Integration` model
and its columns, the guards/decorators/pipes, and the `Channels` nav entry.

**Everything the sprint document asked for is built.** Four items cannot be
*closed* without registered developer apps, and are recorded honestly in
[Known gaps](#known-gaps) rather than ticked.

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO
npm install
npm run db:generate
npm run db:migrate            # no new migration — Integration already had every column
npm run db:seed               # now also seeds two connected channels
```

Then, in separate terminals:

```bash
npm run dev:api               # API on :3001
npm run dev                   # web on :3000
```

Seeded accounts keep the Sprint 2 password **`DemoPassword123!`**. New in this
sprint, on `seed-demo-org`:

| Channel | Provider | State |
|---|---|---|
| Acme Marketing | `linkedin` | Healthy, expires in 60 days |
| Acme on X | `x` | `refreshNeeded` — needs reconnection |

> Both carry **real ciphertext** tokens, written through the same `encrypt()`
> the repository uses. That is what makes the encryption check below meaningful
> rather than circular, and it is why the channels UI can be exercised end to
> end with no platform credentials at all.

---

## 1. Provider contract & registry (Task 1)

| # | Item | Status |
|---|---|---|
| 1.1 | `SocialProvider` contract, split into auth and publishing halves | ✅ [New] |
| 1.2 | `SocialAbstract` — `fetch()` with timeout, bounded retry, typed errors | ✅ [New] |
| 1.3 | Error taxonomy: `RefreshTokenError` / `BadBodyError` / `RetryableError` / `NotEnoughScopesError` | ✅ [New] |
| 1.4 | Shared PKCE (S256) and scope-checking helpers | ✅ [New] |
| 1.5 | `IntegrationManager` registry, dispatching by identifier | ✅ [New] |
| 1.6 | **Zero new runtime dependencies** | ✅ [New] |

### 1.3 — why the errors are plain classes

The reference derives its equivalents from Temporal's `ApplicationFailure`,
which couples the whole provider layer to a workflow engine. PostGear calls
these providers from the API process now, and from the worker only in Sprint 5,
so `@postgear/social-core` stays framework-free and Sprint 5 maps the errors at
its activity boundary.

The split is not cosmetic. Sprint 5's plan branches publishing on exactly this
distinction: 429/5xx retries with backoff, 401 diverts to the refresh workflow.

### 1.6 — no `twitter-api-v2`, no `googleapis`

The reference needs `twitter-api-v2` almost entirely for OAuth 1.0a request
signing. Choosing OAuth 2.0 PKCE removes that: PKCE is a bearer token plus an
S256 challenge, both a few lines of `node:crypto`. YouTube's resumable upload is
a documented two-request protocol. Every provider is plain `fetch`.

**How to test:**

```bash
cd packages/social-core && npx jest
```

Expect **45 passed** across two suites.

---

## 2. The eight providers (Task 2)

| # | Provider | `identifier` | Status |
|---|---|---|---|
| 2.1 | X | `x` | ✅ OAuth 2.0 PKCE, text + threads + media |
| 2.2 | LinkedIn (personal) | `linkedin` | ✅ |
| 2.3 | LinkedIn Page | `linkedin-page` | ✅ Separate registry entry, not a flag |
| 2.4 | Facebook Pages | `facebook` | ✅ Page-token handling |
| 2.5 | Instagram Business | `instagram` | ✅ Container → publish, with poll |
| 2.6 | YouTube | `youtube` | ✅ Resumable upload |
| 2.7 | TikTok | `tiktok` | ✅ P1 stretch, delivered |
| 2.8 | Pinterest | `pinterest` | ✅ P1 stretch, delivered |

The sprint document listed five P0 providers and marked TikTok/Pinterest as
"only if the timeline allows". Both landed.

**The `x` vs `twitter` naming is deliberate.** The folder stays
`providers/twitter/` (that is what was scaffolded) but the identifier is `'x'` —
it is the value written to `Integration.providerIdentifier` and already shipped
in `CHANNEL_OPTIONS`. Folder names are cosmetic; identifiers are data.

**Three platform traps the tests pin**, because each fails silently rather than
loudly:

- **X and `offline.access`** — without that scope X issues no refresh token at
  all, and the channel dies at the first expiry rather than at connect time.
- **Google and `prompt=consent`** — Google issues a refresh token only on the
  *first* consent. Without forcing the screen, a reconnect yields an
  unrefreshable channel.
- **TikTok's `client_key`** — not `client_id`, in every request.

---

## 3. Channels API & the encryption boundary (Task 3)

| # | Item | Status |
|---|---|---|
| 3.1 | 11 routes mapped under `/channels` | ✅ [New] |
| 3.2 | `ChannelsRepository` — **the codebase's first repository layer** | ✅ [New] |
| 3.3 | Encrypt on write / decrypt on read, via `@postgear/db` | ✅ [New] |
| 3.4 | `listForOrg` never decrypts; only `getWithCredentials` does | ✅ [New] |
| 3.5 | Every read filters `deletedAt: null` | ✅ [New] |
| 3.6 | Redis-backed single-use state carrying org, user and PKCE verifier | ✅ [New] |
| 3.7 | Membership re-verified on the callback | ✅ [New] |
| 3.8 | Reconnect identity guard | ✅ [New] |
| 3.9 | Two-phase connect for the five providers that need it | ✅ [New] |
| 3.10 | Disconnect revokes remotely, clears credentials, drafts queued posts | ✅ [New] |
| 3.11 | Posting times on `Integration.postingTimes` | ✅ [New] |
| 3.12 | `ENCRYPTION_KEY_AES256` + 12 platform vars added to `env.ts` | ✅ [New] |

### 3.3 — there was no reference implementation to follow

The sprint document's study guide says the reference "confirms AES-256
encrypt-before-write / decrypt-after-read at the persistence boundary".
**It does not.** Its `Integration.token` and `refreshToken` are plain `String`
columns holding **plaintext**. Its encryption helper is used only for one other
column, is called from an HTTP controller, decrypted inside ~8 provider files,
and is AES-256-CBC with key *and IV* derived deterministically from `JWT_SECRET`
via a legacy MD5 KDF — deterministic, unauthenticated, and named
`encrypt_legacy_using_IV` by its own authors.

So this is the one part of the sprint where the reference was ignored entirely.
PostGear's Sprint 1 helper (GCM, random IV, authenticated, versioned) is
strictly better and the boundary is new work.

### 3.8 — the guard that stops silent account swaps

On a reconnect, if the account just authorized is not the account being
reconnected, the request is refused:

```ts
if (existing && String(details.id) !== String(existing.rootInternalId)) { … }
```

Without it, a user signed into the wrong account in the consent popup silently
swaps that account's credentials into an existing channel, and every subsequent
scheduled post goes somewhere they did not intend.

### 3.9 — five of eight providers cannot connect in one hop

OAuth authorizes a *user*; what gets posted to is a Page, Instagram Business
account, LinkedIn organization, YouTube channel or Pinterest board. Those land in
`inBetweenSteps` with the user token stored (the authorization code is single-use
and the browser is about to navigate away) and are **not publishable** until an
entity is chosen. They appear in the list with a "Finish setup" action rather
than being silently omitted.

**How to test the whole API surface:**

```bash
curl -s -c /tmp/demo.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@postgear.local","password":"DemoPassword123!"}'
curl -s -b /tmp/demo.txt -c /tmp/demo.txt -X POST localhost:3001/orgs/seed-demo-org/switch -o /dev/null

# every provider, with whether this deployment can actually use it
curl -s -b /tmp/demo.txt localhost:3001/channels/providers

# the seeded channels, with derived health — and no credentials in the payload
curl -s -b /tmp/demo.txt localhost:3001/channels
```

Verified: eight providers listed; two channels returned with
`"health":"connected"` and `"health":"needs_reconnect"`; **no `token` or
`refreshToken` key appears in the response at all**.

> **On `"configured": true` against a placeholder `.env`.** Six of the eight
> report configured, because `.env.example`'s placeholders are non-empty strings
> and `isConfigured()` can only check that a credential is *present* — it cannot
> tell `"linkedin-client-id"` from a real one. Only TikTok and Pinterest report
> false, because their variables were added to `.env.example` in this sprint and
> are not in the existing local `.env`. That is the honest behaviour: a
> deployment either has credentials or it does not, and validating them would
> mean calling each platform at boot. The consequence is that a handshake
> started with placeholders reaches the platform and is rejected *there*, which
> is exactly what the next check shows.

```bash
# unauthenticated
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/channels/providers

# a forged state is refused, and the authorization code is never spent
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'localhost:3001/channels/connect/linkedin/callback?code=fake&state=forged'

# a real handshake — server-minted state, and our own callback as redirect_uri
curl -s -b /tmp/demo.txt -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  localhost:3001/channels/connect/linkedin

# an unconfigured provider fails gracefully rather than 500ing
curl -s -b /tmp/demo.txt -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  localhost:3001/channels/connect/tiktok
```

Verified, in order:

- **401**
- **302 → `http://localhost:3000/?error=channel_oauth`**, with a
  `channel.oauth.state_mismatch` line in the API console
- **302 → `https://www.linkedin.com/oauth/v2/authorization?…&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fchannels%2Fconnect%2Flinkedin%2Fcallback&state=0trqJrm…&scope=openid+profile+w_member_social`**
  — note the state is 43 base64url characters from `randomBytes(32)`, not the
  value the provider generated for its own URL
- **302 → `http://localhost:3000/seed-demo-org/channels?error=channel_oauth`**

**RBAC and the disconnect preview:**

```bash
curl -s -b /tmp/demo.txt localhost:3001/channels/seed-channel-linkedin/disconnect-preview

curl -s -c /tmp/m.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"DemoPassword123!"}'
curl -s -b /tmp/m.txt -o /dev/null -w '%{http_code}\n' \
  -X DELETE localhost:3001/channels/seed-channel-linkedin
```

Verified `{"queuedPosts":0}`, and **403** for the `USER`-role member — the same
guard Sprint 2 established, now covering channel management with no extra work.

---

## 4. The encryption Definition of Done — verified against a raw row

This is the one that has to be *seen*, not asserted:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'SELECT "providerIdentifier", name, "refreshNeeded", left(token, 30) AS token_head
   FROM "Integration" ORDER BY "providerIdentifier";'
```

Verified output:

```
 providerIdentifier |      name       | refreshNeeded |          token_head
--------------------+-----------------+---------------+--------------------------------
 linkedin           | Acme Marketing  | f             | v1:XRqzyESOthDA3TE_:LAsvIEoYF9
 x                  | Acme on X       | t             | v1:eA22kHB7BGRALv4v:oJw6tVM6nr
```

Every token starts `v1:` and is unreadable. A plaintext value here would mean the
repository boundary was bypassed somewhere.

```bash
cd apps/api && npx jest channels.repository
```

Expect **19 passed** — including that what reaches Prisma is ciphertext, that
the same token encrypts differently each time, that `listForOrg` never selects
the credential columns, and that disconnect clears them.

---

## 5. Frontend (Task 4)

| # | Item | Status |
|---|---|---|
| 5.1 | Channels page — server component + client island | ✅ [New] |
| 5.2 | Channel card: avatar, corner platform badge, **handle**, health badge | ✅ [New] |
| 5.3 | `needs_setup` and `needs_reconnect` visually **distinct** | ✅ [New] |
| 5.4 | Page-level count of channels needing attention | ✅ [New] |
| 5.5 | Provider picker showing unconfigured platforms disabled, with a reason | ✅ [New] |
| 5.6 | One entity-picker surface for both fresh and resumed setup | ✅ [New] |
| 5.7 | Disconnect confirm stating the number of affected posts | ✅ [New] |
| 5.8 | Posting-times editor | ✅ [New] |
| 5.9 | Non-admins see channels but no management actions | ✅ [New] |
| 5.10 | Onboarding step 4's connect button made real | ✅ [New] |

### 5.3 — the reference's most instructive mistake

It gives `refreshNeeded` and `inBetweenSteps` an **identical** red badge and
scrim. Two completely different problems, one indicator, and no way to tell them
apart without clicking. Here they are red *"Reconnect"* and amber *"Finish
setup"*, each with its own explanation and its own button.

It also has no aggregate view at all — a 15px dot on a 36px avatar is the only
signal that all scheduled posting is broken. Hence 5.4.

### 5.10 — why connecting from onboarding does not complete onboarding

OAuth leaves the app entirely, so there is no half-finished wizard to return to.
But the last survey question has not been asked yet, and completing early to
avoid an awkward return would silently discard it. The button records step 4 and
advances the stored step to 5, so the platform's redirect lands the user back at
the final question with their channel already connected. Skip remains live
throughout — the sprint requires that a user who cannot finish a handshake still
reaches the dashboard.

---

## 6. A latent bug this sprint surfaced and fixed

**Symptom:** signed in as `demo@postgear.local`, the Channels page showed an
empty state despite two seeded channels.

**Cause:** the API scopes workspace-owned requests on the `pg_org` cookie, never
on the `[orgId]` URL segment — deliberately, so a path parameter cannot be used
to read another tenant's data. `OrgSwitcher` keeps the two in step, and its own
comment names the failure mode if they drift. But switching is not the only way
to arrive: a bookmark, a shared link, or signing in as a user who belongs to
**two** workspaces (where login deliberately picks no default) all land on a URL
the cookie does not match.

Nothing noticed until now because **no dashboard page had ever fetched
workspace-scoped data**. Channels is the first.

**Fix:** `[orgId]/layout.tsx` compares the cookie with the segment and, when they
disagree, mounts `SyncActiveWorkspace`, which performs the same server-side
switch the UI switcher does — membership re-verified there, not trusted from the
client. Cookies cannot be written while rendering a Server Component, which is
why the reconcile is a client component.

Every workspace-scoped page in Sprints 4–8 would have hit this.

**How to test:**

```bash
# demo@ belongs to two workspaces, so login sets no pg_org cookie
curl -s -c /tmp/two.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@postgear.local","password":"DemoPassword123!"}'
grep -c pg_org /tmp/two.txt      # 0
```

Then in the browser: sign in as `demo@postgear.local`, navigate straight to
`/seed-demo-org/channels`, and confirm the two channels appear.

---

## 7. Tests

| # | Item | Status |
|---|---|---|
| 7.1 | 19 repository tests — the encryption boundary and lifecycle invariants | ✅ [New] |
| 7.2 | 20 `SocialAbstract` tests — retry, backoff cap, error classification, PKCE | ✅ [New] |
| 7.3 | 25 provider + registry tests | ✅ [New] |
| 7.4 | 6 Playwright channel journeys | ✅ [New] |
| 7.5 | `onboarding.spec.ts` step-4 assertion updated | ✅ [New] |
| 7.6 | 26 crypto tests still green | ✅ [Pre-existing — Sprint 1] |

The repository suite deliberately pins the four things the reference got wrong:
reconnect folds into the existing row rather than duplicating, a machine-driven
write never clobbers `name`/`disabled`/`postingTimes`, the sibling token fan-out
is org-scoped, and disconnect clears credentials.

```bash
npm run validate
```

Expect `Tasks: 28 successful, 28 total`, now covering **191 unit tests**
(120 API + 45 social-core + 26 crypto), up from 127.

```bash
docker compose up -d && npm run db:seed
npm run dev:api:e2e      # note :e2e — relaxed throttles
npm run test:e2e
```

Expect **34 passed**, up from 28.

---

## Known gaps

**1. No platform has been connected over real OAuth.**
All eight providers are implemented and the handshake is verifiable up to the
platform redirect, but `.env` holds placeholder credentials, so no consent screen
has been completed. What placeholders do *not* cover: the live token exchange,
the exact response shapes, and the granted-scope strings. Close it by registering
apps with callback
`http://localhost:3001/channels/connect/<provider>/callback` — where
`<provider>` is one of `x`, `linkedin`, `linkedin-page`, `facebook`,
`instagram`, `youtube`, `tiktok`, `pinterest` — putting real credentials in
`.env`, and connecting. Then reconnect the same channel with a *different*
account to confirm the identity guard in 3.8 refuses it.

**2. No real test post has been published.** `POST /channels/:id/test-post`
exists and reaches each provider's `post()`, but it needs a live channel.

**3. Publishing with media is implemented but not exercisable.** `post()` accepts
media descriptors, and the media library is Sprint 4's. Text-only posts work
today; YouTube and TikTok are video-only platforms, so their implementations
are complete but untestable until then.

**4. Meta app review.** `pages_manage_posts` and `instagram_content_publish` are
review-gated and can take days to weeks. Two separate Meta apps are used
deliberately — `FACEBOOK_APP_*` for publishing, `FACEBOOK_CLIENT_*` for the
Sprint 2 login — so a review problem cannot take down sign-in.

**5. Channel limits are not enforced.** `Subscription.totalChannels` exists and
SCHEMA_NOTES assigns it to Sprint 8. When it lands, the check belongs **before**
the handshake starts and in the same transaction as the insert — the reference
enforces it only at the end of the OAuth round trip, which is both the worst
place for the user and a TOCTOU hole.

**6. Posting times are day-agnostic.** `Integration.postingTimes` is a flat list
applied to every day, so "9am on weekdays, 11am at weekends" is inexpressible.
That is a schema constraint, not a UI choice; a weekday grid would need a column
change. Worth revisiting when Sprint 5's scheduler makes the cost concrete.

**7. The E2E suite is still not in CI** — unchanged from Sprint 2.

---

## Files changed in this pass

**Added — `packages/social-core` (from stubs)**
- `src/abstract/{errors,social.provider.interface}.ts`, `social.abstract.ts` (+ test)
- `src/manager/integration.manager.ts`
- `src/providers/meta/meta.graph.ts` — shared Facebook/Instagram plumbing
- `src/providers/{twitter,linkedin,facebook,instagram,youtube,tiktok,pinterest}/index.ts`
- `src/providers/providers.test.ts`

**Added — API**
- `src/modules/channels/{channels.controller,channels.service,channels.repository,channel-oauth.service,channels.module,channels.messages}.ts`
- `src/modules/channels/channels.repository.spec.ts`, `dto/channels.schema.ts`

**Added — web**
- `src/components/channels/{channels-view,channel-card,channel-health,connect-channel-dialog,finish-setup-dialog,disconnect-dialog,posting-times-dialog}.tsx`
- `src/components/navigation/sync-active-workspace.tsx`
- `src/types/channel.ts`

**Added — tests & docs**
- `e2e/channels.spec.ts`
- `packages/db/prisma/seeds/tsconfig.json`
- this file

**Modified**
- `apps/api/src/config/env.ts` — required `ENCRYPTION_KEY_AES256`, 12 platform vars
- `apps/api/src/app.module.ts` — `ChannelsModule`
- `apps/api/src/common/logging/security-logger.ts` — seven `channel.*` events
- `apps/api/src/modules/onboarding/onboarding.controller.ts` — sets `pg_org` on workspace creation
- `apps/web/src/app/(dashboard)/[orgId]/layout.tsx` — workspace sync
- `apps/web/src/app/(dashboard)/[orgId]/channels/page.tsx` — real page
- `apps/web/src/lib/api.ts` — `channelConnectUrl()`
- `apps/web/src/components/onboarding/onboarding-wizard.tsx` — step 4 wired
- `packages/db/prisma/seeds/index.ts` — two encrypted channel fixtures
- `packages/db/package.json` — seed runs under its own tsconfig
- `packages/social-core/package.json` — dropped the unused `@postgear/db` dependency
- `e2e/onboarding.spec.ts` — step-4 assertion
- `.env.example` — TikTok and Pinterest, plus documented callback URLs
