# Sprint 1 — Foundation, Environment & Data Model

> **PRD Coverage**: Section 5.12 (Platform & Infrastructure) — foundational slice only; the rest of 5.12 (rate limiting, Sentry, health checks) lands in [Sprint 8](sprint-08-billing-notifications-api-launch.md).
> **Depends on**: nothing — this is the starting point.
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only — see [README](README.md) for the ground rule on not copying files/folders).

## Sprint Goal

Get the monorepo tooling and local dev stack running, and get the team (you + Claude Code) fully oriented in the inherited Prisma schema, so every later sprint has a stable foundation to build on.

## Current State (already scaffolded)

Verified in the repo as of this writing:
- `apps/web`, `apps/api`, `apps/worker` exist with stub files (`main.ts` is a `console.log('TODO...')`, module folders under `apps/api/src/modules/*` contain only `.gitkeep`).
- `packages/{db,social-core,seo-engine,ai-engine,ui,config}` exist with stub `index.ts`/provider files.
- `docker-compose.yml`, `turbo.json`, `.env.example`, `infra/docker/Dockerfile.{web,api,worker}` exist at root.
- **Decision (locked in)**: `packages/db/prisma/schema.prisma` is Postiz's actual 48-model schema (confirmed: exact model list match — `Organization`, `Tags`, `TagsPosts`, `User`, `UsedCodes`, `UserOrganization`, `GitHub`, `Trending`, `Media`, `SocialMediaAgency`, `Credits`, `Subscription`, `Integration`, `Post`, `mastra_*` tables, `OAuthApp`, etc. — 970 lines), kept intentionally rather than redesigned from scratch. This is a deliberate, one-time exception to the "reference, don't copy" rule for this sprint document set: a battle-tested multi-tenant schema is exactly the kind of foundational, hard-to-get-right asset worth inheriting wholesale rather than re-deriving under time pressure. The rule for every *other* module (controllers, workflows, UI, providers) is unchanged — those get built fresh, referencing Postiz's logic only.
- **Going forward**: this schema is not frozen. As each later sprint needs a capability Postiz's schema doesn't cover — SEO auditing ([Sprint 7](sprint-07-analytics-and-seo-engine.md)), AI copilot specifics ([Sprint 6](sprint-06-ai-content-engine.md)), any PostGear-only analytics — that sprint **adds new models onto this same file**, following its existing conventions (cuid `id`, `organizationId` scoping, `createdAt`/`updatedAt`, soft-delete via `deletedAt` where relevant). Models already present but not yet used by an MVP sprint (`SocialMediaAgency`, `Orders`, `Plugs`, `ThirdParty`, `mastra_*`, etc.) are left in place dormant — don't delete them preemptively, and don't feel obligated to build features to justify them either.
- **Decision (locked in, 2026-08-29)**: linting is **Biome** (not ESLint/Prettier — the empty stub configs those had in every package were removed), unit testing is **Jest** (not Vitest). Both are wired end-to-end already: root `biome.json`, per-package `jest.config.js` files spreading a shared `packages/config/jest.preset.js`, and `lint`/`lint:fix`/`typecheck`/`test`/`test:watch`/`test:coverage` scripts in every package plus a root `validate` script (`turbo run lint typecheck test`) for a single CI/pre-push gate. What's *not* done yet: `npm install` hasn't actually been run, so none of `@biomejs/biome`, `jest`, `ts-jest`, `tailwind-scrollbar`, `tailwindcss-rtl`, `@tailwindcss/postcss`, or the Testing-Library packages are in `node_modules` yet — that's this sprint's job, not a prior one.

## Reference Study Guide

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Monorepo layout & workspace config | `postiz-app-main/pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json` | **Note**: Postiz uses pnpm workspaces; PostGear uses npm workspaces (root `package.json`'s `workspaces` field) with Turborepo on top for task orchestration — same either way. Study only the `apps/` vs `libraries/` split and shared-tsconfig pattern here, not the package-manager choice itself. |
| Local dev stack | `postiz-app-main/docker-compose.dev.yaml`, `docker-compose.yaml` | Which services they run locally (Postgres, Redis, Temporal + its Postgres + Elasticsearch, Temporal UI) vs. production-only pieces — decide what PostGear actually needs day one (likely: Postgres, Redis, Temporal; defer Elasticsearch/Sentry Spotlight). |
| Prisma schema shape | `postiz-app-main/libraries/nestjs-libraries/src/database/prisma/schema.prisma` (48 models) | This is the **same file** already sitting in `packages/db/prisma/schema.prisma` (see Decision above) — the Postiz path is listed here only so you can diff against upstream if Postiz ships schema changes later. Note the conventions worth continuing when *adding* new models: `organizationId` on every tenant-scoped table, soft-delete via `deletedAt` (`Tags`, `Webhooks`), cuid primary keys. |
| Env var inventory | `postiz-app-main/.env.example` | Cross-check against PostGear's own `.env.example` for anything missing (e.g. `JWT_SECRET` equivalents, encryption key for tokens at rest). |

## PostGear Implementation Plan

### Task 1 — Confirm & fix root tooling
- `turbo.json`'s pipeline already covers `build`, `lint`, `lint:fix`, `typecheck`, `test`, `test:watch`, `test:coverage`, `dev`, `clean` — this task is mostly about *running* `npm install` and confirming each `turbo run <task>` actually executes across every workspace, not adding more pipeline entries.
- Confirm `docker-compose.yml` (root) covers: Postgres 16+, Redis 7, and — since [Sprint 5](sprint-05-scheduling-and-publishing.md) needs durable scheduling — a local Temporal dev server (`temporalio/auto-setup`) + its Postgres. Add a `minio` (or skip and use local disk for now — see [Sprint 4](sprint-04-post-composer-and-media.md)).
- The design tokens imported from Postiz (see [`../design-patterns/`](../design-patterns/README.md)) are already written in native Tailwind v4 syntax (`packages/config/tailwind.css`, wired into `apps/web/src/app/globals.css`). What's still outstanding: run `npm install` so the newly-added devDependencies (`@tailwindcss/postcss`, `tailwind-scrollbar`, `tailwindcss-rtl`) are actually present, then confirm `npm run dev` renders the imported colors — and make sure the app shell applies a `dark`/`light` class to a root element (nothing does yet), since the color variables don't resolve without one.

### Task 2 — CI skeleton
- `.github/workflows/ci.yml`: run `npm run validate` (already wired as `turbo run lint typecheck test`) plus `prisma validate` on PR. Keep it minimal; don't try to replicate Postiz's full CI (Sonar, i18n lock checks, etc.) — those aren't relevant to a pre-launch solo project.

### Task 3 — Adopt & scope the inherited Prisma schema
No redesign needed — the schema already in `packages/db/prisma/schema.prisma` is the working data model. This sprint's job is to get familiar with it and confirm it's ready to build on:
- Read through the real model list end-to-end once: `Organization`, `User`, `UserOrganization` (the org-membership join table — this is the name every later sprint should use, not an invented `Member`), `Integration` (this is what a "connected social channel" is called in this schema — used as-is in [Sprint 3](sprint-03-social-integrations.md)), `Post` (one row per platform target; a cross-posted batch is tied together via its `group` field, and thread/reply chains via `parentPostId` — there is no separate `PostItem` table), `Media`, `Subscription`, `Credits`, `Webhooks`, `Notifications`, plus the currently-dormant ones (`SocialMediaAgency`, `Orders`, `Plugs`, `mastra_*`, `OAuthApp`, etc.) that later sprints may or may not activate.
- Confirm the encryption boundary for `Integration.token`/`Integration.refreshToken`: encrypt/decrypt at the repository layer (AES-256-GCM), matching the intent already in the env blueprint — this sprint just needs the encryption helper to exist; [Sprint 3](sprint-03-social-integrations.md) is where it gets used.
- Write a short `packages/db/prisma/SCHEMA_NOTES.md` (or a comment block at the top of `schema.prisma`) recording which models are MVP-active vs. dormant-until-needed, so nobody wonders later whether e.g. `Plugs` is safe to ignore.

### Task 4 — Seed & bootstrap scripts
- Done: `packages/db/prisma/seeds/index.ts` seeds a demo `Organization` + `User` + `UserOrganization` (role `ADMIN`) + a `STANDARD`-tier `Subscription`, idempotently (fixed ids + upsert). `npm run db:seed` (root) and `npm run db:reset` (root — runs `prisma migrate reset`, which auto-invokes the seed via the `"prisma": {"seed": ...}` field in `packages/db/package.json`) both work once `npm install` has run. The old disconnected `scripts/db-seed.ts` stub is now a deprecation note pointing here — delete it once you've confirmed nothing else references that path.
- Two things the seed script left as placeholders, worth resolving early: `User.timezone` was set to `0` without confirming what convention this schema actually expects for that field (offset minutes vs. something else) — check before Sprint 2's profile UI reads/writes it; and `User.password` was left unset since there's no working login flow yet — set it via bcrypt once Sprint 2 lands.
- Flesh out `scripts/generate-keys.ts` to emit the AES key + JWT secret for local `.env`.

## Definition of Done
- [ ] `docker compose up` brings up Postgres, Redis, and a local Temporal dev server with no manual steps beyond `.env` copy.
- [ ] `npm install` at root completes cleanly (installs Biome, Jest, the Tailwind v4 plugin packages, Testing Library, etc. across all workspaces).
- [ ] `npm run db:generate` + `npm run db:migrate` (root package.json scripts, delegating to `packages/db` via `--workspace`) run clean against the inherited schema, and `SCHEMA_NOTES.md` clearly lists MVP-active vs. dormant models.
- [ ] `npm run db:seed` populates the demo org/user/subscription without error, and re-running it doesn't create duplicates.
- [ ] `npm run validate` (lint + typecheck + test across every workspace via Turborepo) passes clean on an empty/stub codebase — confirms the tooling itself works before any real feature code is written.
- [ ] CI runs `npm run validate` + `prisma validate` on every PR.

## Risks
- Because the schema is inherited rather than purpose-built, a few field names will feel like they carry Postiz's history (e.g. `Integration` for "channel", `token`/`refreshToken` instead of more explicit names) — resist the urge to rename them defensively; renaming a live schema's fields is real migration churn for cosmetic gain. Add clarifying comments in the schema file instead where a name might confuse a future reader.
