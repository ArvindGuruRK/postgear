# Sprint 2 — Completion Checklist & Test Guide

Companion to [sprint-02-auth-and-organizations.md](../sprint-documents/sprint-02-auth-and-organizations.md).
Status as of **2026-09-05**.

Sprint 2 started from a **much emptier position than the sprint document assumes**.
`apps/api` was a pure scaffold: `src/main.ts` was `console.log('TODO')` and every
`modules/*` and `common/*` directory held only a `.gitkeep`. There was no HTTP
framework, no validation, no Redis client, no mailer, and no password hashing
anywhere in the repo. On the web side the three auth screens existed but were
deliberately inert, `src/lib`, `src/hooks` and `src/store` were empty, and there
was **no route protection of any kind**.

So almost everything below is **[New]**. The genuinely **[Pre-existing]** set is
short and worth knowing so you skip re-testing it: the inert auth screens and
their two-panel shell, `OnboardingStepper`, the design tokens, `packages/db`'s
client/crypto/types, the seed's zero-organization user, and the CI pipeline.

**Everything in Sprint 2 is complete**, including four security requirements
added on top of the original scope. Three items are deliberately deferred with
reasons recorded — see [Known gaps](#known-gaps).

---

## Prerequisites

Run once before any test below:

```bash
docker compose up -d          # Postgres, Redis, MinIO
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```

Then, in a second terminal:

```bash
npm run dev:api               # API on :3001
```

And a third, for anything browser-based:

```bash
npm run dev                   # web on :3000
```

Seeded accounts, all with password **`DemoPassword123!`**:

| Email | Role | State |
|---|---|---|
| `demo@postgear.local` | `ADMIN` in two orgs, **superadmin** | Onboarded |
| `member@postgear.local` | `USER` in `seed-demo-org` | Onboarded |
| `onboarding@postgear.local` | — none — | **Zero organizations, not onboarded** |

---

## 1. Local auth (Task 1)

| # | Item | Status |
|---|---|---|
| 1.1 | NestJS 11 API boots, 25 routes mapped | ✅ [New] |
| 1.2 | `POST /auth/register` — Zod-validated, sanitized, argon2id, `activated: false`, **zero** `UserOrganization` rows | ✅ [New] |
| 1.3 | `GET /auth/activate` — single-use, 24h expiry | ✅ [New] |
| 1.4 | `POST /auth/login` — JWT in an httpOnly `sameSite=lax` cookie | ✅ [New] |
| 1.5 | `POST /auth/logout` — clears both cookies | ✅ [New] |
| 1.6 | `GET /auth/me` — session probe, never serializes the password hash | ✅ [New] |
| 1.7 | Password reset request / reset / change | ✅ [New] |
| 1.8 | Activation + reset email, via a console transport until SMTP is configured | ✅ [New] |
| 1.9 | Global `HttpExceptionFilter` normalises every error body | ✅ [New] |

**How to test** — the whole password lifecycle, end to end:

```bash
# 1. register
curl -s -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-9-battery","name":"Alice Smith"}'
```

Expect `{"message":"Check your email to confirm your account"}` with **201**.

The activation link is printed to the **API console**. Copy the token out of it:

```bash
curl -s "localhost:3001/auth/activate?token=<TOKEN>"          # 200, confirmed
curl -s "localhost:3001/auth/activate?token=<TOKEN>"          # 400, single-use
```

```bash
curl -s -c /tmp/c.txt -X POST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-9-battery"}'
curl -s -b /tmp/c.txt localhost:3001/auth/me
curl -s -b /tmp/c.txt -X POST localhost:3001/auth/logout
curl -s -b /tmp/c.txt localhost:3001/auth/me                  # 401 after logout
```

Verified output for the second command:

```json
{"user":{"id":"…","email":"alice@example.com","name":"Alice Smith",
         "isSuperAdmin":false,"onboardingStep":1,"onboardingCompletedAt":null}}
```

> `onboardingStep: 1` and no organization is the **correct** post-registration
> state, not a bug. See section 6.

---

## 2. OAuth login (Task 2)

| # | Item | Status |
|---|---|---|
| 2.1 | `AuthProvider` interface — `getAuthUrl()` / `handleCallback()` | ✅ [New] |
| 2.2 | Google + GitHub implementations | ✅ [New] |
| 2.3 | `ProvidersManager` dispatches by name | ✅ [New] |
| 2.4 | `state` is random, stored in Redis, and **consumed** on callback | ✅ [New] |
| 2.5 | Existing user attached **by email across providers**; new user otherwise | ✅ [New] |
| 2.6 | Unverified provider emails rejected | ✅ [New] |
| 2.7 | Tested against real Google/GitHub apps | ⏸️ Deferred — see [Known gaps](#known-gaps) |

### 2.5 — the model conflict this had to resolve

The sprint doc's DoD says OAuth must "attach to an existing user by email", but
`User` is unique on **`[email, providerName]`**, which positively permits the
same address twice under different providers — one person, two accounts, two
sets of workspaces.

Resolved by looking up on **email alone** and reusing whatever row is found,
leaving its original `providerName` untouched (rewriting it would break that
user's password login). The safety condition is 2.6: both providers refuse to
return an unverified address. Without that check, matching on email would be an
account-takeover path — register the victim's address at a provider, sign in,
inherit their workspaces.

**How to test:**

```bash
curl -s localhost:3001/auth/providers
```

Expect `{"providers":["GOOGLE","GITHUB"]}` — this lists only providers with a
client id configured, and it is what the login screen renders buttons from.

```bash
# The handshake redirects to the provider rather than returning JSON.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3001/auth/oauth/google
```

Expect `302 https://accounts.google.com/o/oauth2/v2/auth?...&state=...`.

```bash
# A callback with a forged/absent state is refused and never spends the code.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'localhost:3001/auth/oauth/google/callback?code=fake&state=forged'
```

Expect `302 http://localhost:3000/login?error=oauth`, and an
`oauth.state_mismatch` line in the API console.

---

## 3. Organizations & membership (Task 3)

| # | Item | Status |
|---|---|---|
| 3.1 | `POST /orgs` — creates org + `UserOrganization(ADMIN)` in one transaction | ✅ [New] |
| 3.2 | `GET /orgs` — the caller's workspaces; **empty array is valid** | ✅ [New] |
| 3.3 | `POST /orgs/:id/switch` — verifies membership, then sets `pg_org` | ✅ [New] |
| 3.4 | `GET /orgs/:id/members` | ✅ [New] |
| 3.5 | Invite / change role / remove member, all `ADMIN`-only | ✅ [New] |
| 3.6 | Last-admin protection on demote and remove | ✅ [New] |
| 3.7 | `@CurrentOrg()` resolves per request from a cookie, **not** from the JWT | ✅ [New] |
| 3.8 | Org switcher wired to real data | ✅ [New] |
| 3.9 | Invitation acceptance for a not-yet-registered address | ⏸️ Deferred — see [Known gaps](#known-gaps) |

**How to test:**

```bash
curl -s -c /tmp/demo.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@postgear.local","password":"DemoPassword123!"}'

curl -s -b /tmp/demo.txt localhost:3001/orgs
curl -s -b /tmp/demo.txt -c /tmp/demo.txt -X POST localhost:3001/orgs/seed-second-org/switch
grep -o 'pg_org.*' /tmp/demo.txt
curl -s -b /tmp/demo.txt -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/orgs/no-such-org/switch
```

Verified: two organizations listed, the switch returns the second, `pg_org`
becomes `seed-second-org`, and an unknown org returns **404**.

> **404, not 403, is deliberate.** A 403 would confirm the workspace exists and
> let a caller enumerate ids by watching the status change. "Not a member" and
> "does not exist" are indistinguishable from outside.

`demo@` belongs to two orgs, so **no** `pg_org` cookie is set at login — with
several workspaces there is no obvious default. A user with exactly one gets it
pre-selected, which is what `member@postgear.local` exercises.

---

## 4. RBAC guard (Task 4)

| # | Item | Status |
|---|---|---|
| 4.1 | Hand-rolled `RolesGuard` over three roles — **no CASL** | ✅ [New] |
| 4.2 | `JwtAuthGuard` + `RolesGuard` registered globally; auth is the default | ✅ [New] |
| 4.3 | `@Public()`, `@Roles()`, `@CurrentUser()`, `@CurrentOrg()` | ✅ [New] |
| 4.4 | Superadmin bypass; disabled membership refused; foreign org refused | ✅ [New] |
| 4.5 | 11 unit tests covering the whole decision table | ✅ [New] |

Guards are registered **globally**, so authentication is the default for every
route in every module, present and future. A controller added in Sprint 5 is
protected the moment it exists; opting out takes an explicit `@Public()`. The
opposite arrangement fails silently — a forgotten decorator leaves an open
endpoint and no error.

**How to test** — the sprint's Definition of Done, directly:

```bash
curl -s -c /tmp/member.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"DemoPassword123!"}'

# USER against an ADMIN-only route
curl -s -b /tmp/member.txt -o /dev/null -w 'invite (expect 403): %{http_code}\n' \
  -X POST localhost:3001/orgs/seed-demo-org/invites \
  -H 'Content-Type: application/json' -d '{"email":"x@y.com","role":"USER"}'

# the same USER against a members-list route
curl -s -b /tmp/member.txt -o /dev/null -w 'members (expect 200): %{http_code}\n' \
  localhost:3001/orgs/seed-demo-org/members

# tenant isolation: an org they are not in
curl -s -b /tmp/member.txt -o /dev/null -w 'foreign org (expect 404): %{http_code}\n' \
  localhost:3001/orgs/seed-second-org/members
```

Verified: **403**, **200**, **404**. The 403 body is
`{"error":"You do not have permission to do that","statusCode":403}`.

> `member@postgear.local` is seeded with `isSuperAdmin: false` on purpose. The
> demo admin *is* a superadmin and bypasses `RolesGuard` entirely, so it can
> never demonstrate a 403.

```bash
cd apps/api && npx jest roles.guard
```

Expect **11 passed**, and `rbac.denied` lines in the output — that is the
security logger doing its job, not a failure.

---

## 5. Frontend wiring (Task 5)

| # | Item | Status |
|---|---|---|
| 5.1 | Auth screens exist, in `packages/ui` components, two-panel shell | ✅ [Pre-existing — Sprint 0] |
| 5.2 | Login / register / reset forms wired to the API | ✅ [New] |
| 5.3 | `/verify` and `/reset-password/[token]` landing pages | ✅ [New] |
| 5.4 | OAuth buttons start a real handshake | ✅ [New] |
| 5.5 | **Route gate 1** — not authenticated → `/login` | ✅ [New] |
| 5.6 | **Route gate 2** — authenticated, not onboarded → `/onboarding` | ✅ [New] |
| 5.7 | Session-aware `/` routing | ✅ [New] |
| 5.8 | Signed-in visitors bounced off `/login` and `/register` | ✅ [New] |
| 5.9 | Real org switcher + working sign-out in the top bar | ✅ [New] |
| 5.10 | `WorkspaceProvider` carrying org, role and user | ✅ [New] |

### 5.2 — two things the inert forms would have tripped on

`Button` defaults to `type="button"`, so a submit button must pass
`type="submit"` explicitly or the form never submits and Enter does nothing.
And `FormField` has no error wiring, so `FormErrorMessage` is rendered by hand.

Errors are shown **once, above the fields**, never per field — the API returns a
single generic message for every login failure, so there is no per-field
information to render, and inventing one would undo the property that makes the
API useless for account enumeration.

### 5.5 / 5.6 — where the gates live, and why there is no `proxy.ts`

- Gate 1 is [`(dashboard)/layout.tsx`](../../apps/web/src/app/(dashboard)/layout.tsx).
- Gate 2 is the first statement in [`(dashboard)/[orgId]/layout.tsx`](../../apps/web/src/app/(dashboard)/[orgId]/layout.tsx).
- `/onboarding` sits at `(dashboard)/onboarding`, a **sibling** of `[orgId]`, so
  it clears gate 1 and never reaches gate 2.

That is SCHEMA_NOTES' "between the two layouts" placement achieved **without
moving the eleven existing `[orgId]` page files** into a new route group.

Next 16 renamed `middleware.ts` to `proxy.ts` and its own docs recommend
avoiding it "unless no other options exist". A proxy would have to re-verify the
JWT signature itself — duplicating what the API already does, with the shared
secret handled in two places that can disagree. Layout gates cannot be bypassed:
a nested route always renders its parent layouts first, and reading `cookies()`
opts the route into dynamic rendering, so there is no cached HTML to hand an
anonymous visitor.

**How to test:**

```bash
npm run test:e2e
```

Expect **28 passed**. See section 9 for what the suite needs.

By hand, at <http://localhost:3000>:

1. Visit `/seed-demo-org/calendar` signed out → lands on `/login`.
2. Sign in as `member@postgear.local` → lands on `/seed-demo-org/calendar`.
3. Navigate back to `/login` → bounced into the app.
4. Avatar menu → **Log out** → back at `/login`; re-visiting the calendar
   redirects again.

---

## 6. Onboarding flow (Task 6)

| # | Item | Status |
|---|---|---|
| 6.1 | `OnboardingStepper` exists in `packages/ui` | ✅ [Pre-existing — Sprint 0] |
| 6.2 | **Where onboarding-completion lives — decided** | ✅ [New] |
| 6.3 | Five-step wizard composed over the existing stepper | ✅ [New] |
| 6.4 | **Five survey questions persisted** to a new `OnboardingResponse` model | ✅ [New] |
| 6.5 | Channel step is skippable | ✅ [New] |
| 6.6 | An abandoned flow resumes at the right step | ✅ [New] |
| 6.7 | Zero-organization user still valid throughout | ✅ [New] |

### 6.2 — the decision SCHEMA_NOTES left open

**`User.onboardingCompletedAt`, plus `User.onboardingStep`, plus an
`OnboardingResponse` row.** Not the derived "has ≥ 1 `UserOrganization`" check.

The reason is not obvious until the flow has more than one step. Onboarding is
five steps and **creating the workspace is step 1** — so a derived check flips
to "onboarded" the instant step 1 finishes, gate 2 stops redirecting, and steps
2 through 5 become permanently unreachable. Someone who closes the tab at step 3
would never be asked the rest.

`onboardingStep` only ever moves forward, so resuming is exact rather than
inferred. Recorded in
[SCHEMA_NOTES](../../packages/db/prisma/SCHEMA_NOTES.md#where-onboarding-completion-lives--decided-sprint-2).

### 6.4 — the five questions

Each is a Prisma enum, so the allowed values are defined once in
`schema.prisma` and the API validates against them with `z.nativeEnum` — the
database and the API cannot drift apart.

| Step | # | Question | Column |
|---|---|---|---|
| 2 | Q1 | What best describes you? | `role` |
| 2 | Q2 | How big is your team? | `teamSize` |
| 3 | Q3 | What do you most want from PostGear? | `primaryGoal` |
| 3 | Q4 | How often do you post today? | `postingFrequency` |
| 5 | Q5 | How did you hear about PostGear? | `referralSource` |

Step 4 additionally records `interestedChannels` (a `String[]`), which is not
counted as one of the five.

**How to test** — the whole wizard through the API:

```bash
curl -s -c /tmp/o.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"onboarding@postgear.local","password":"DemoPassword123!"}'

J() { curl -s -b /tmp/o.txt -c /tmp/o.txt -H 'Content-Type: application/json' "$@"; echo; }

J localhost:3001/onboarding/state
J -X POST localhost:3001/onboarding/workspace -d '{"name":"Alice Media"}'
J -X POST localhost:3001/onboarding/answers   -d '{"role":"AGENCY","teamSize":"SIZE_2_10"}'
J -X POST localhost:3001/onboarding/answers   -d '{"primaryGoal":"SAVE_TIME","postingFrequency":"DAILY"}'
J -X POST localhost:3001/onboarding/channels  -d '{"interestedChannels":["x","linkedin"]}'
J -X POST localhost:3001/onboarding/answers   -d '{"referralSource":"SEARCH"}'
J -X POST localhost:3001/onboarding/complete
J -X POST localhost:3001/onboarding/answers   -d '{"role":"HACKER"}'
```

Verified: `step` advances 1 → 2 → 3 → 4 → 5, answers accumulate without earlier
ones being nulled out, `complete` returns the organization id, and the invalid
enum is rejected with `{"error":"Invalid input","statusCode":400}`.

Confirm the answers landed:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'SELECT u.email, o.role, o."teamSize", o."primaryGoal", o."postingFrequency",
          o."referralSource", o."interestedChannels"
   FROM "OnboardingResponse" o JOIN "User" u ON u.id = o."userId";'
```

Re-seed afterwards to restore the un-onboarded account:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'DELETE FROM "OnboardingResponse" WHERE "userId" = '"'"'seed-onboarding-user'"'"';
   DELETE FROM "UserOrganization"  WHERE "userId" = '"'"'seed-onboarding-user'"'"';
   UPDATE "User" SET "onboardingStep" = 1, "onboardingCompletedAt" = NULL
    WHERE id = '"'"'seed-onboarding-user'"'"';'
```

### 6.7 — the zero-organization state still holds

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'SELECT u.email, count(uo.id) AS org_count, u."onboardingCompletedAt" IS NULL AS needs_onboarding
   FROM "User" u LEFT JOIN "UserOrganization" uo ON uo."userId" = u.id
   GROUP BY u.email, u."onboardingCompletedAt" ORDER BY org_count;'
```

Expected:

```
           email           | org_count | needs_onboarding
---------------------------+-----------+------------------
 onboarding@postgear.local |         0 | t
 member@postgear.local     |         1 | f
 demo@postgear.local       |         2 | f
```

---

## 7. Schema & seed changes

| # | Item | Status |
|---|---|---|
| 7.1 | Migration `20260905160000_sprint2_auth_onboarding` | ✅ [New] |
| 7.2 | 10 new `User` columns — tokens, lockout, onboarding | ✅ [New] |
| 7.3 | `OnboardingResponse` + 5 enums | ✅ [New] |
| 7.4 | Seed gives every user a real argon2id password | ✅ [New] |
| 7.5 | Seed adds a `USER`-role member and a second org | ✅ [New] |
| 7.6 | Seed's zero-organization user preserved | ✅ [Pre-existing — Sprint 1] |
| 7.7 | SCHEMA_NOTES updated | ✅ [New] |

`activated` keeps its inherited `@default(true)`. Flipping the default would
have silently deactivated the seeded users; registration sets `activated: false`
explicitly instead.

**How to test:**

```bash
npm run db:migrate                                   # "Database schema is up to date!"
grep -c '^model ' packages/db/prisma/schema.prisma   # 22 (was 21)
npm run db:seed && npm run db:seed                   # idempotent
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  "SELECT 'User' t, count(*) FROM \"User\"
   UNION ALL SELECT 'Organization', count(*) FROM \"Organization\"
   UNION ALL SELECT 'UserOrganization', count(*) FROM \"UserOrganization\"
   UNION ALL SELECT 'OnboardingResponse', count(*) FROM \"OnboardingResponse\";"
```

Expect `User 3`, `Organization 2`, `UserOrganization 3`, `OnboardingResponse 1`
— stable across runs.

---

## 8. Security requirements (added beyond the sprint doc)

All four were designed into new code rather than retrofitted, which is the one
real advantage of having started from an empty `apps/api`.

### 8.1 — Server-side validation & sanitization

| # | Item | Status |
|---|---|---|
| 8.1.1 | Zod schemas on every auth route, enforced by a `ZodBody` pipe | ✅ [New] |
| 8.1.2 | Email normalized and strictly pattern-checked | ✅ [New] |
| 8.1.3 | Display/org names HTML-, script- and control-character-stripped | ✅ [New] |
| 8.1.4 | `.strict()` everywhere — unknown keys rejected, not ignored | ✅ [New] |
| 8.1.5 | Generic `Invalid input` response naming no field | ✅ [New] |
| 8.1.6 | Every failure logged server-side with field paths | ✅ [New] |
| 8.1.7 | 23 sanitization + 20 schema unit tests | ✅ [New] |

> **Passwords are deliberately never sanitized.** Not trimmed, not HTML-stripped,
> not "special character" filtered. Stripping characters silently weakens the
> secret the user chose and breaks password managers, and there is nothing to
> defend against: a password is never rendered, never interpolated into a query,
> and never stored — only its argon2id digest is. Passwords are *validated*
> (12–128 chars, must contain a digit) and hashed verbatim. This is a stated
> exception to "strip special characters from every field", and
> `auth.schema.spec.ts` has a test asserting the password comes back byte-identical.

The brief's "username" field does not exist — the schema has `name` and
`lastName`, and those get the full treatment.

**How to test:**

```bash
cd apps/api && npx jest sanitize auth.schema
```

Expect **43 passed** across the two suites.

```bash
# XSS in a name, and a mass-assignment attempt — both generic 400s
curl -s -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"x@y.com","password":"correct-horse-9-battery","name":"<script>alert(1)</script>"}'
curl -s -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"z@y.com","password":"correct-horse-9-battery","name":"Evil","isSuperAdmin":true}'
```

Both return `{"error":"Invalid input","statusCode":400}`, and the API console
shows a `validation.failed` line naming the offending path — detail the response
withholds on purpose.

### 8.2 — Rate limiting, lockout, progressive delay

| # | Item | Status |
|---|---|---|
| 8.2.1 | `/auth/login` limited to 10 requests / IP / minute | ✅ [New] |
| 8.2.2 | `/auth/password/reset-request` limited to 3 / IP / minute | ✅ [New] |
| 8.2.3 | 5 consecutive failures → 15-minute lock | ✅ [New] |
| 8.2.4 | Progressive delay, doubling and capped at 4s | ✅ [New] |
| 8.2.5 | IP counters in Redis, with an in-process fallback | ✅ [New] |
| 8.2.6 | Lockout state in **Postgres** | ✅ [New] |
| 8.2.7 | Lockout email carrying a reset link | ✅ [New] |
| 8.2.8 | Lockout indistinguishable from a wrong password | ✅ [New] |

**The two stores are split on purpose.** IP throttling is ephemeral and belongs
in Redis. Account lockout does **not** — if it lived there, restarting or
evicting Redis would be a lockout bypass. Losing an IP counter merely resets a
one-minute window.

**The delay is capped at 4s**, and that cap is a security control rather than a
convenience. An uncapped exponential backoff that holds the HTTP connection open
while it sleeps is itself a DoS vector: an attacker who deliberately fails pins
one worker per request, and the longer the delay grows the cheaper the attack
gets.

**How to test** — needs the API on **default** limits (`npm run dev:api`, not
`dev:api:e2e`):

```bash
for i in $(seq 1 7); do
  START=$(date +%s%N)
  R=$(curl -s -o /tmp/b.txt -w '%{http_code}' -X POST localhost:3001/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"member@postgear.local","password":"definitely-wrong-9"}')
  echo "attempt $i: $R $(cat /tmp/b.txt)  [$(( ($(date +%s%N) - START) / 1000000 ))ms]"
done
```

Verified output — note the delay doubling then flattening at the cap, and that
all seven bodies are byte-identical:

```
attempt 1: 401 {"error":"Incorrect email or password","statusCode":401}  [144ms]
attempt 2: 401 {"error":"Incorrect email or password","statusCode":401}  [388ms]
attempt 3: 401 {"error":"Incorrect email or password","statusCode":401}  [655ms]
attempt 4: 401 {"error":"Incorrect email or password","statusCode":401}  [1175ms]
attempt 5: 401 {"error":"Incorrect email or password","statusCode":401}  [2155ms]
attempt 6: 401 {"error":"Incorrect email or password","statusCode":401}  [4168ms]
attempt 7: 401 {"error":"Incorrect email or password","statusCode":401}  [4163ms]
```

Then the decisive check — **the correct password, while locked**:

```bash
curl -s -X POST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"DemoPassword123!"}'
```

Still `{"error":"Incorrect email or password","statusCode":401}`. The API
console shows the lockout email; the database shows the state:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'SELECT email, "failedLoginAttempts", "lockedUntil" IS NOT NULL AS locked
   FROM "User" WHERE email = '"'"'member@postgear.local'"'"';'
```

IP throttling, on a fresh minute:

```bash
for i in $(seq 1 14); do
  printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3001/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"nobody-'"$i"'@example.com","password":"x"}')"
done; echo
for i in $(seq 1 5); do
  printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3001/auth/password/reset-request \
    -H 'Content-Type: application/json' -d '{"email":"member@postgear.local"}')"
done; echo
```

Verified `401 ×9 then 429 ×5`, and `200 200 200 429 429` — the reset endpoint is
throttled harder because every call sends an email, so an unthrottled one is a
free mail-bombing relay pointed at any address.

Recover the locked account either by waiting 15 minutes or by using the reset
link from the console:

```bash
curl -s -X POST localhost:3001/auth/password/reset -H 'Content-Type: application/json' \
  -d '{"token":"<TOKEN>","password":"brand-new-9-passphrase"}'
```

A reset clears `failedLoginAttempts` and `lockedUntil` — the documented escape
hatch for someone who cannot wait.

```bash
cd apps/api && npx jest lockout
```

Expect **8 passed**, including that the delay stays finite for an absurd
attempt count (`2 ** 1024` overflows to `Infinity`; the cap pins it).

### 8.3 — argon2id password storage

| # | Item | Status |
|---|---|---|
| 8.3.1 | argon2id at OWASP minimums (m=19456, t=2, p=1) | ✅ [New] |
| 8.3.2 | Hashed on signup **and** re-hashed on change | ✅ [New] |
| 8.3.3 | Constant-time comparison everywhere; no `===` on a credential | ✅ [New] |
| 8.3.4 | Legacy plaintext/md5/sha1 detected and rehashed on next login | ✅ [New] |
| 8.3.5 | `npm run audit:passwords` reports the stored-format distribution | ✅ [New] |
| 8.3.6 | No password is logged anywhere; redaction enforced by the logger | ✅ [New] |
| 8.3.7 | Dummy hash on the unknown-email branch, closing the timing oracle | ✅ [New] |
| 8.3.8 | 22 unit tests | ✅ [New] |

argon2id rather than the sprint doc's bcrypt: it is memory-hard, so a cracking
rig's cost scales with RAM instead of with cheap parallel cores.

**The migration is lazy, and that is the correct design.** Rehashing needs the
plaintext, which exists only for the instant a user submits it at login — so
`verify()` returns `needsRehash` alongside the result and the login path
upgrades the stored hash inside that same successful request. No forced reset,
no batch job holding secrets it should not have. `argon2.needsRehash()` covers
the same path when the cost parameters are raised later.

There is **no legacy corpus in this database** — `User.password` was unset on
both seeded users before this sprint — so 8.3.4 is forward-looking, for an
import or an inherited table. Saying otherwise would imply a migration that had
nothing to migrate.

**How to test:**

```bash
cd apps/api && npx jest password.service
```

Expect **22 passed**, covering md5 / sha1 / plaintext detect-and-rehash, the
refusal to rehash on a *failed* verification (which would overwrite a good hash
with one derived from the attacker's guess), a corrupted hash reading as "wrong
password" rather than throwing, and the dummy-hash timing check.

```bash
npm run audit:passwords
```

Verified output:

```
Users: 3  (0 with no password — OAuth-only)

Format distribution
      3  argon2id (m=19456,t=2,p=1)

Nothing needs attention: every stored password is argon2id at current cost.
```

To see a legacy row handled for real, plant one and log in with it:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'UPDATE "User" SET password = md5('"'"'legacy-password-1'"'"')
   WHERE email = '"'"'member@postgear.local'"'"';'
npm run audit:passwords          # reports 1 md5 row needing attention
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"legacy-password-1"}'
npm run audit:passwords          # back to all-argon2id; console logs password.rehashed
npm run db:seed                  # restore the seed password
```

**The no-logging scan:**

```bash
grep -rniE "console\.(log|info|warn|error|debug).*(password|passwd|pwd)" \
  apps packages scripts e2e --include=*.ts --include=*.tsx
```

Four hits, all false positives: three in `scripts/audit-password-hashes.ts` that
print *counts and format names*, and one in `scripts/generate-keys.ts` printing a
header. No password value is logged anywhere. The structural guarantee is
`securityLogger.redact()`, which filters a key denylist (`password`, `token`,
`secret`, `authorization`, `cookie`, …) out of every logged object, so the rule
is enforced by the logger rather than left to each call site.

### 8.4 — Non-leaking error messages

| # | Item | Status |
|---|---|---|
| 8.4.1 | One catalogue, `auth.messages.ts`, is the only place these strings exist | ✅ [New] |
| 8.4.2 | Login failure is one message for all five causes | ✅ [New] |
| 8.4.3 | Lockout has no message of its own | ✅ [New] |
| 8.4.4 | Reset says `If that email is registered, …` regardless | ✅ [New] |
| 8.4.5 | Registration never confirms an address exists | ✅ [New] |
| 8.4.6 | Unit test fails if any message gains a banned phrase | ✅ [New] |
| 8.4.7 | Repo-wide grep for leaky strings | ✅ [New] |

**The complete message list, and where each is used:**

| Constant | Message | Used for |
|---|---|---|
| `INVALID_CREDENTIALS` | `Incorrect email or password` | wrong email · wrong password · unknown account · **locked account** · unactivated account |
| `INVALID_INPUT` | `Invalid input` | every validation/sanitization failure, naming no field |
| `PASSWORD_RESET_SENT` | `If that email is registered, you'll receive a reset link` | reset request, always |
| `REGISTRATION_ACCEPTED` | `Check your email to confirm your account` | registration, whether or not the email exists |
| `RESET_LINK_INVALID` | `That reset link is no longer valid` | expired · used · unknown token |
| `ACTIVATION_LINK_INVALID` | `That confirmation link is no longer valid` | expired · used · unknown token |
| `SESSION_EXPIRED` | `Your session has expired. Please sign in again.` | 401 on a protected route |
| `FORBIDDEN` | `You do not have permission to do that` | wrong role · foreign org · disabled membership |
| `NO_ACTIVE_ORG` | `Select a workspace first` | role-guarded route with no workspace selected |
| `TOO_MANY_REQUESTS` | `Too many requests. Please try again shortly.` | IP throttle |
| `UNEXPECTED` | `Something went wrong. Please try again.` | any unhandled error |
| `OAUTH_FAILED` | `We could not complete that sign-in` | any OAuth failure |

**File locations of every changed message.** This is where the deliverable has
to be honest: **there were no pre-existing auth error strings to fix**, because
before this sprint there was no auth code — `apps/api/src/main.ts` was a
`console.log('TODO')`. Every message above was *established*, not corrected. The
audit that matters is therefore the proof that no leaky string exists anywhere
else:

```bash
grep -rniE "not found|doesn't exist|does not exist|wrong password|incorrect password|invalid email|already registered|already exists|no such user" \
  apps/api/src apps/web/src --include=*.ts --include=*.tsx
```

Every hit is a comment, a test name, or the `BANNED_MESSAGE_PHRASES` list
itself — except three real strings, all in `apps/api/src/modules/org/org.service.ts`,
kept deliberately:

| String | Location | Why it stays |
|---|---|---|
| `Workspace not found` | `org.service.ts:100` | Attached to a **404 that is itself the anti-enumeration measure** — "you are not a member" and "it does not exist" return the same thing. Genericising it further would gain nothing and lose a usable message. |
| `Member not found` | `org.service.ts:188`, `:213` | On an `ADMIN`-only route, acting inside the caller's own workspace, about a member they can already list. It crosses no trust boundary. |

Three consequences of this design, accepted deliberately:

- **Registration with an existing address returns the same 201 as a new one**,
  and sends the address owner a "someone tried to sign up" email instead of a
  second activation link. Otherwise registration is an enumeration oracle.
- **A locked account is indistinguishable from a wrong password.** The lockout
  email is therefore not a nicety — it is the *only* channel telling the real
  owner what happened. If mail delivery breaks, users are locked out with no
  explanation.
- **Validation errors name no field.** A real UX cost on a signup form, imposed
  by the brief. Mitigated by keeping field-level hints on the client so the
  common case still guides the user, while the server refuses to confirm them.

**How to test:**

```bash
cd apps/api && npx jest auth.messages
```

Expect **17 passed**, including a check that no message anywhere contains
`lock`, and one asserting the exact required wording of the two mandated strings.

```bash
# unknown email vs. wrong password vs. unactivated — all identical
curl -s -X POST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com","password":"whatever-9-here"}'; echo
curl -s -X POST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"whatever-9-here"}'; echo

# registering an existing address is indistinguishable from a new one
curl -s -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"member@postgear.local","password":"correct-horse-9-battery","name":"Imposter"}'; echo
```

Verified: the first two are byte-identical, and the third returns
`{"message":"Check your email to confirm your account"}` with **201** — plus a
"someone tried to sign up with your email" notice in the API console.

---

## 9. Tests

| # | Item | Status |
|---|---|---|
| 9.1 | 101 API unit tests across 6 suites | ✅ [New] |
| 9.2 | 26 `packages/db` crypto tests still green | ✅ [Pre-existing — Sprint 1] |
| 9.3 | `e2e/auth.spec.ts` updated for route gate 1, plus 2 new cases | ✅ [New] |
| 9.4 | `e2e/onboarding.spec.ts` — 11 journey tests | ✅ [New] |
| 9.5 | E2E suite in CI | ⏸️ Deferred — see [Known gaps](#known-gaps) |

### 9.3 — one existing test had to invert

`e2e/auth.spec.ts` asserted that `/acme/calendar` **renders the app shell for an
anonymous visitor**. That was correct while the shell was a Sprint 0
design-system smoke test with nothing behind it. With gate 1 in place, reaching a
workspace without a session is the bug, so the test now asserts the redirect.

### 9.4 — running the E2E suite

The Playwright `webServer` starts only the Next app. The API and a seeded
database are prerequisites it does not manage:

```bash
docker compose up -d
npm run db:seed
npm run dev:api:e2e      # in its own terminal — note :e2e
npm run test:e2e
```

Expect **28 passed**.

> **`dev:api:e2e`, not `dev:api`.** The suite signs in roughly a dozen times a
> minute from one address, which is over the production throttle of 10/IP/min —
> with normal limits the last few tests get a 429 and fail for a reason
> unrelated to what they assert. The e2e script raises
> `LOGIN_RATE_LIMIT_PER_MIN` and `LOCKOUT_THRESHOLD`, which is exactly what
> those env vars are for. The throttle and lockout themselves are verified
> directly against the API in section 8.2.

Two other things worth knowing if a run looks strange:

- **Workers are capped at 4** (`playwright.config.ts`). Playwright's default is
  one per core; at that width the specs saturate a single `ts-node-dev` API and
  `getSession()` starts treating timed-out `/auth/me` calls as "not signed in",
  producing redirects to `/login` that look like assertion failures about
  something else entirely.
- **Only one API process may be running.** Two instances racing for :3001 —
  easy to end up with after a restart — means requests land on whichever one
  won the port, with whichever limits it was started with. That produced a
  genuinely confusing intermittent failure during this sprint.

---

## 10. One-command verification

```bash
npm run validate
```

Expect `Tasks: 28 successful, 28 total`. That is lint + typecheck + test across
every workspace, and now includes **127 real unit tests** (101 API + 26 crypto),
up from 26.

---

## Known gaps

**1. OAuth is not tested against live Google/GitHub apps.**
Both providers are fully implemented and the handshake is verifiable up to the
provider redirect (see section 2), but `.env` holds placeholder client ids, so
no real consent screen has been completed. What is *not* covered by placeholders:
the token exchange, the profile shape, and the verified-email flag. Close it by
registering two OAuth apps with callback
`http://localhost:3001/auth/oauth/{google,github}/callback`, putting real
credentials in `.env`, and signing in — first as a brand-new address, then as
`demo@postgear.local` to confirm the by-email linking in 2.5 attaches rather
than duplicating.

**2. Invitation acceptance for an unregistered address is a stub.**
`POST /orgs/:id/invites` creates the membership immediately when the invitee
already has an account. When they do not, it sends mail and returns the same
response — but nothing yet turns that into a membership when they register.
`User.inviteId` exists in the schema for this. It was left out because doing it
properly needs an invitation record with an expiry and a token, which is a
schema change with no consumer until the team-settings UI exists (Sprint 8's
territory). The API deliberately returns an identical response either way, so
closing this gap needs no client change.

**3. The E2E suite is not in CI.**
`ci.yml` runs `npm run validate` only. Adding Playwright needs a Postgres and
Redis service container, a built web app, and the API started as a background
step — worth doing, but it is CI plumbing rather than sprint work, and it would
have been the slowest part of this pass to get right. The suite is stable
locally (run twice, 28/28 both times).

**4. Repo-wide formatting is still not enforced in CI** — unchanged from
Sprint 1, and unchanged in size by this pass. Every file Sprint 2 created or
modified **is** formatted and passes `biome format`; the remaining backlog is
Sprint 0 UI files. Verify with:

```bash
npx biome format apps/api/src e2e scripts/audit-password-hashes.ts \
  apps/web/src/lib apps/web/src/types apps/web/src/components/onboarding \
  packages/db/prisma/seeds
```

Expect `No fixes applied.`

**5. Email address changes are not supported.**
`PATCH /users/me` deliberately excludes `email`: changing it has to re-verify
the new address, or it becomes an account-takeover path. That belongs with the
activation flow, not a profile PATCH.

---

## A note on one lint rule

`apps/api/biome.json` turns **`style/useImportType`** off for this app alone,
and enables `unsafeParameterDecoratorsEnabled` so Biome can parse Nest
controllers at all. The rule would rewrite
`import { ConfigService } from '@nestjs/config'` into `import type { … }`,
which erases the runtime class reference that `emitDecoratorMetadata` needs —
Nest then fails at boot with "can't resolve dependencies". Full reasoning in
[apps/api/BIOME_NOTES.md](../../apps/api/BIOME_NOTES.md). The rule stays on
everywhere else.

---

## Files changed in this pass

**Added — API (NestJS, from nothing)**
- `apps/api/src/app.module.ts` — global guards, filter, config
- `apps/api/src/config/env.ts` — Zod-validated environment, fails fast at boot
- `apps/api/src/common/sanitize.ts` + `.spec.ts` — input sanitization, 23 tests
- `apps/api/src/common/logging/security-logger.ts` — redacting structured logger
- `apps/api/src/common/pipes/zod-validation.pipe.ts` — `ZodBody` / `ZodQuery`
- `apps/api/src/common/filters/http-exception.filter.ts` — one error shape
- `apps/api/src/common/guards/{jwt-auth,roles,login-throttle}.guard.ts` (+ `roles.guard.spec.ts`)
- `apps/api/src/common/decorators/{public,roles,current-user,current-org}.decorator.ts`
- `apps/api/src/modules/auth/*` — controller, service, module, `auth.messages.ts`, `password.service.ts`, `token.service.ts`, `lockout.service.ts`, `dto/`, `providers/` (+ 4 spec files)
- `apps/api/src/modules/{org,users,onboarding,mail,redis}/*`
- `apps/api/biome.json`, `apps/api/BIOME_NOTES.md`

**Added — web**
- `apps/web/src/lib/{api,session,onboarding-questions}.ts`
- `apps/web/src/types/workspace.ts`
- `apps/web/src/components/auth/{login,register,reset-password,new-password}-form.tsx`, `oauth-buttons.tsx`
- `apps/web/src/components/onboarding/{onboarding-wizard,choice-group}.tsx`
- `apps/web/src/components/navigation/{workspace-provider,account-menu}.tsx`
- `apps/web/src/app/(dashboard)/onboarding/page.tsx`
- `apps/web/src/app/(auth)/verify/page.tsx`, `(auth)/reset-password/[token]/page.tsx`

**Added — data, tests, docs**
- `packages/db/prisma/migrations/20260905160000_sprint2_auth_onboarding/`
- `scripts/audit-password-hashes.ts`
- `e2e/onboarding.spec.ts`, `e2e/helpers/users.ts`
- `docs/sprint-completion-checklists/sprint-02-completion-checklist.md` — this file

**Modified**
- `packages/db/prisma/schema.prisma` — 10 `User` columns, `OnboardingResponse`, 5 enums
- `packages/db/prisma/SCHEMA_NOTES.md` — onboarding decision recorded; new model and columns documented
- `packages/db/prisma/seeds/index.ts` — real passwords, a `USER` member, a second org
- `packages/db/src/types.ts`, `packages/db/package.json` — new enum exports; argon2
- `apps/api/{package.json,tsconfig.json,src/main.ts}` — Nest deps, decorator/CommonJS overrides, real bootstrap
- `apps/web/src/app/(dashboard)/layout.tsx` — route gate 1
- `apps/web/src/app/(dashboard)/[orgId]/layout.tsx` — route gate 2 + workspace context
- `apps/web/src/app/page.tsx` — session-aware routing
- `apps/web/src/app/(auth)/{layout,login/page,register/page,reset-password/page}.tsx` — wired up
- `apps/web/src/components/navigation/{app-shell,dashboard-shell,topbar,org-switcher}.tsx` — top-bar slots, real switcher, working sign-out
- `apps/web/src/app/dev/components/components-showcase.tsx` — demo slots for the playground
- `e2e/auth.spec.ts` — gate-1 assertion inverted, 2 message tests added
- `playwright.config.ts` — worker cap, prerequisites documented
- `package.json` — `dev:api`, `dev:api:e2e`, `audit:passwords`; e2e scripts load `.env`
- `.env.example` / `.env` — API port, cookie names, throttle/lockout, SMTP
- `docs/sprint-documents/sprint-02-auth-and-organizations.md` — DoD, deviations table

**Deleted**
- 11 `.gitkeep` placeholders from directories that now hold real files
