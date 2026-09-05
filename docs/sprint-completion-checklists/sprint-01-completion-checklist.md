# Sprint 1 — Completion Checklist & Test Guide

Companion to [sprint-01-foundation-and-data-model.md](../sprint-documents/sprint-01-foundation-and-data-model.md).
Status as of **2026-09-05**.

Sprint 1 was roughly two-thirds finished before this pass — the environment,
install, migrations and seed were already working and verified. This document
marks those clearly as **[Pre-existing]** so you can skip re-testing them, and
**[New]** for what was built in this pass.

**Everything in Sprint 1 is now complete.** One item is deliberately deferred
with a reason recorded — see [Known gaps](#known-gaps).

---

## Prerequisites

Run once before any test below:

```bash
docker compose up -d      # Postgres, Redis, MinIO
npm install
npm run db:generate
```

---

## 1. Root tooling & local stack (Task 1)

| # | Item | Status |
|---|---|---|
| 1.1 | `docker compose up` brings up Postgres, Redis, MinIO with no manual steps beyond the `.env` copy | ✅ [Pre-existing] |
| 1.2 | `npm install` completes cleanly across all workspaces | ✅ [Pre-existing] |
| 1.3 | Every `turbo run <task>` executes across all 6 workspaces | ✅ [Pre-existing] |
| 1.4 | Tailwind v4 tokens render; app shell applies a `dark`/`light` class | ✅ [Pre-existing — Sprint 0] |
| 1.5 | `ts-node` added to root devDependencies (was only hoisted from `packages/db`, so root scripts worked by luck) | ✅ [New] |

**How to test**

```bash
docker compose ps          # expect 3 containers "Up"
npm run validate           # expect "28 successful, 28 total"
```

For 1.4, run `npm run dev` and open <http://localhost:3000>. The theme toggle in
the top bar should flip light/dark. The mechanism is a no-flash inline script in
[apps/web/src/app/layout.tsx](../../apps/web/src/app/layout.tsx) that puts the
class on `<body>` — not `<html>`, because the color variables in `colors.css` are
declared as *descendant* selectors of `:root` and won't resolve otherwise.

> Temporal is **not** in `docker-compose.yml`. That's intentional and matches the
> sprint doc — it gets added when Sprint 5 needs durable scheduling.

---

## 2. CI skeleton (Task 2)

| # | Item | Status |
|---|---|---|
| 2.1 | `.github/workflows/ci.yml` runs `npm run validate` on every PR | ✅ [New] |
| 2.2 | CI also runs `prisma validate` | ✅ [New] |
| 2.3 | Prisma client generated before typecheck (it must be — `packages/db` re-exports its types) | ✅ [New] |
| 2.4 | Concurrency group cancels superseded runs | ✅ [New] |
| 2.5 | Repo-wide `format:check` gate | ⏸️ Deferred — see [Known gaps](#known-gaps) |

The file was a stub whose only real step was `actions/checkout`.

**How to test** — run the CI steps locally in the same order:

```bash
npm ci
npm run db:generate
npx prisma validate --schema packages/db/prisma/schema.prisma
npm run validate
```

All four should exit 0. The last prints `28 successful, 28 total`.

To test it for real, push this branch and open a PR against `master` — note the
workflow triggers on `master`, `main` **and** `develop`, since this repo's default
branch is `master` but the stub only listed `main`/`develop`.

---

## 3. Prisma schema adoption (Task 3)

| # | Item | Status |
|---|---|---|
| 3.1 | Schema migrates clean against real Postgres | ✅ [Pre-existing] |
| 3.2 | Model list read end-to-end and classified | ✅ [New] |
| 3.3 | `packages/db/prisma/SCHEMA_NOTES.md` written | ✅ [New] |
| 3.4 | AES-256-GCM encryption helper exists | ✅ [New] |
| 3.5 | `packages/db/src/client.ts` — real Prisma singleton (was `export {}`) | ✅ [New] |
| 3.6 | `packages/db/src/types.ts` — typed re-exports (was `export {}`) | ✅ [New] |

### 3.3 — SCHEMA_NOTES.md

[packages/db/prisma/SCHEMA_NOTES.md](../../packages/db/prisma/SCHEMA_NOTES.md)
originally recorded all 48 inherited models split into **MVP-active** vs
**dormant-until-needed**. It has since been updated: **27 of those models were
pruned** in two follow-up migrations, leaving 21. The doc now carries a
[Deliberately removed](../../packages/db/prisma/SCHEMA_NOTES.md#deliberately-removed)
section instead of a long dormant list.

Three findings from the read-through that contradict assumptions in the sprint
doc, and are worth knowing before you write queries:

- **Primary keys are not "cuid" as the sprint doc states.** The majority use
  `@default(uuid())`; only `Subscription`, `Integration` and `Post` use `cuid()`.
  New models should use `uuid()`.
- **Tenant scoping is not uniformly `organizationId`.** 14 models use it, but
  `Tags` and `Customer` use `orgId` for the identical concept.
- **Soft delete is far wider than the doc's "Tags, Webhooks".** 11 of the 21
  models carry `deletedAt`. Every read of those must filter `deletedAt: null` —
  Prisma has no global filter here, so it's per-query. This is the likeliest
  data bug in the codebase.

> Counts here reflect the pruned schema. `SCHEMA_NOTES.md` is the source of
> truth if they ever drift again.

**How to test** — verify the counts yourself:

```bash
# Should print 21 (was 48 before pruning)
grep -c "^model " packages/db/prisma/schema.prisma

# 3 cuid models vs 16 uuid
awk '/^model /{m=$2} /@default\(cuid\(\)\)/{print m}' packages/db/prisma/schema.prisma
awk '/^model /{m=$2} /@default\(uuid\(\)\)/{print m}' packages/db/prisma/schema.prisma | wc -l

# The 2 orgId outliers: Tags, Customer
awk '/^model /{m=$2} /^  orgId /{print m}' packages/db/prisma/schema.prisma
```

Then read the doc and spot-check any two dormant models against `schema.prisma`.

### 3.4 — Encryption helper

[packages/db/src/crypto.ts](../../packages/db/src/crypto.ts). AES-256-GCM, keyed
from `ENCRYPTION_KEY_AES256`. Exports `encrypt` / `decrypt`, nullable variants
for `Integration.refreshToken`, `isEncrypted()` for backfill detection, and
`safeCompare()` for constant-time secret comparison.

GCM rather than CBC because it's authenticated: tampering fails loudly instead of
yielding attacker-influenced plaintext. Ciphertext is versioned
(`v1:<iv>:<tag>:<data>`) so a future algorithm change doesn't need a big-bang
migration.

**How to test:**

```bash
cd packages/db && npx jest
```

Expect **26 passed**. The suite covers round-trips (including unicode, empty
string, and a 2KB JSON blob), tamper detection on both the ciphertext body and
the auth tag, decryption under the wrong key, malformed payloads, and key
validation.

For a live check against your actual `.env` key:

```bash
cat > smoke-tmp.ts <<'EOF'
import { encrypt, decrypt, isEncrypted } from './packages/db/src/crypto';
const t = 'ya29.real-looking-oauth-token';
const c = encrypt(t);
console.log('cipher       :', c);
console.log('roundtrip ok :', decrypt(c) === t);
console.log('isEncrypted  :', isEncrypted(c), '/ plaintext:', isEncrypted(t));
EOF
npx dotenv -e .env -- npx ts-node --project scripts/tsconfig.json ./smoke-tmp.ts
rm smoke-tmp.ts
```

Expect `roundtrip ok : true` and `isEncrypted : true / plaintext: false`.
Run it twice — **the ciphertext must differ each time** (fresh IV per call).

> Two consequences this creates, both documented in SCHEMA_NOTES: encrypted
> columns can't be searched by equality (`where: { token: x }` never matches),
> and rotating the key permanently orphans stored tokens.

The helper is **not yet wired to `Integration`** — that's Sprint 3's job, exactly
as the sprint doc scopes it ("this sprint just needs the encryption helper to
exist").

---

## 4. Onboarding data-model consequence (Task 3a)

| # | Item | Status |
|---|---|---|
| 4.1 | Confirmed a `User` is valid with zero `UserOrganization` rows — no migration needed | ✅ [New] |
| 4.2 | Seed creates an un-onboarded user, so the state is testable | ✅ [New] |
| 4.3 | Two-gate route protection and the open "where does completion live" call documented | ✅ [New] |

The sprint doc warned this state would otherwise "ship untested". It's now
reproducible from a plain `npm run db:seed`.

**How to test:**

```bash
npm run db:seed
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  "SELECT u.email, count(uo.id) AS org_count
   FROM \"User\" u LEFT JOIN \"UserOrganization\" uo ON uo.\"userId\" = u.id
   GROUP BY u.email ORDER BY org_count;"
```

Expected:

```
           email           | org_count
---------------------------+-----------
 onboarding@postgear.local |         0
 demo@postgear.local       |         1
```

The `0` row is the point. Sprint 2 must not assume `user.organizations[0]` exists.

---

## 5. Seed & bootstrap scripts (Task 4)

| # | Item | Status |
|---|---|---|
| 5.1 | Seed creates demo org + user + membership + subscription, idempotently | ✅ [Pre-existing] |
| 5.2 | `User.timezone` convention resolved | ✅ [New] |
| 5.3 | `scripts/generate-keys.ts` implemented | ✅ [New] |
| 5.4 | Deprecated `scripts/db-seed.ts` deleted, stale doc reference fixed | ✅ [New] |
| 5.5 | Real secrets written into local `.env` | ✅ [New] |

### 5.2 — timezone

Resolved by reading Postiz's client: it sends `String(dayjs.tz().utcOffset())`,
and dayjs's `utcOffset()` returns **minutes**. So `User.timezone` is a **UTC
offset in minutes** — `0` = UTC, `-300` = US Eastern, `330` = IST. The seed's `0`
was correct.

Caveat now recorded in both the seed and SCHEMA_NOTES: an offset can't represent
DST, so a "9am local" schedule drifts an hour twice a year. If Sprint 5's
scheduler needs DST correctness, add a nullable `timezoneName` (IANA string)
*alongside* this field rather than reinterpreting it.

`User.password` remains deliberately unset — Sprint 2 sets it via bcrypt.

### 5.3 / 5.5 — key generation

**How to test:**

```bash
npm run generate:keys              # prints; does not touch .env
npm run generate:keys -- --write   # patches .env in place
grep -E "ENCRYPTION_KEY_AES256|JWT_SECRET|NEXTAUTH_SECRET" .env
```

`ENCRYPTION_KEY_AES256` must be exactly 64 hex characters. The `.env` placeholder
it replaced (`"32-byte-hex-string-for-encrypting-oauth-tokens-at-rest"`) was prose,
and `crypto.ts` rejects it outright rather than deriving a weak key from it — try
it if you want to see the error:

```bash
cd packages/db && ENCRYPTION_KEY_AES256="not-a-real-key" npx jest -t "placeholder"
```

`--write` is a line-targeted regex rewrite, so comments, ordering and unrelated
vars survive byte-for-byte. Your `.env` was patched during this work; it's
gitignored and only held non-functional placeholders beforehand. Nothing else in
the file changed (verified by diff).

### 5.1 — seed idempotency

```bash
npm run db:seed && npm run db:seed
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  "SELECT 'User' t, count(*) FROM \"User\"
   UNION ALL SELECT 'Organization', count(*) FROM \"Organization\"
   UNION ALL SELECT 'UserOrganization', count(*) FROM \"UserOrganization\"
   UNION ALL SELECT 'Subscription', count(*) FROM \"Subscription\";"
```

Expect `User 2`, `Organization 1`, `UserOrganization 1`, `Subscription 1` — stable
across runs.

---

## 6. One-command verification

```bash
npm run validate
```

Expect `Tasks: 28 successful, 28 total`. This is lint + typecheck + test across
every workspace, and it now includes 26 real unit tests rather than only stubs.

---

## Known gaps

**Repo-wide formatting is not enforced in CI, on purpose.**
`npm run format:check` currently reports **86 errors, all of them pre-existing** —
Sprint 0 UI files written before Biome's formatter was run over them. I verified
this by stashing every Sprint 1 change and re-running against a clean `HEAD`,
which reported **91**. This pass therefore reduced the backlog by 5 (the stub
files it rewrote) and added none.

Adding the gate now would fail every PR for reasons unrelated to its changes, so
the step sits commented out in `ci.yml` with this explanation. Files created in
this sprint *are* formatted and pass.

To close it: run `npm run format` in one dedicated commit, then uncomment the
step. I left that out of Sprint 1 because it would mean a large mechanical diff
across the UI work you just finished in Sprint 0 — that's your call to make, not
something to bundle silently into a foundation sprint.

---

## Files changed in this pass

**Added**
- `packages/db/src/crypto.ts` — AES-256-GCM helper
- `packages/db/src/crypto.test.ts` — 26 tests
- `packages/db/prisma/SCHEMA_NOTES.md` — model inventory & conventions
- `scripts/tsconfig.json` — CommonJS config for root TS scripts
- `docs/sprint-completion-checklists/sprint-01-completion-checklist.md` — this file

**Modified**
- `.github/workflows/ci.yml` — real pipeline, replacing the TODO stub
- `scripts/generate-keys.ts` — implemented, replacing a `console.log('TODO')`
- `packages/db/src/client.ts` — Prisma singleton, replacing `export {}`
- `packages/db/src/types.ts` — typed re-exports, replacing `export {}`
- `packages/db/src/index.ts` — exports the crypto module
- `packages/db/prisma/seeds/index.ts` — un-onboarded user; timezone convention documented
- `package.json` — `generate:keys` script; `ts-node` devDependency
- `project_structure.md` — stale `db-seed.ts` reference
- `docs/sprint-documents/sprint-01-foundation-and-data-model.md` — DoD updated
- `.env` — real generated secrets (gitignored)

**Deleted**
- `scripts/db-seed.ts` — disconnected duplicate of the real seed entrypoint
