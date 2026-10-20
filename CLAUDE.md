# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How to talk to me

- Use emojis in explanations, summaries and replies 🎯
- Keep explanations simple and easy to understand: plain words, short sentences, no jargon unless it's needed (and explain it when it is) 🙂

## What this is

PostGear: a social media management + SEO SaaS. npm workspaces + Turborepo monorepo, Node >= 20.9. Product spec in `prd.md`, per-sprint specs in `docs/sprint-documents/`, the full local run/test walkthrough in `docs/local-testing-guide.md`. Note `complete_codebase_and_architecture_analysis.md` describes **Postiz** (the reference product), not this codebase.

## Commands

```bash
npm run dev            # docker compose up -d, then API (:3001) + worker + web (:3000) via turbo
npm run dev:api        # API alone (ts-node-dev, reads root .env)
npm run dev:worker     # Temporal worker alone
npm run dev --workspace=@postgear/web

npm run validate       # lint + typecheck + test across all workspaces (this is what CI runs)
npm run lint | typecheck | test
npm run format         # biome format --write (format:check is NOT gated in CI yet)

# Single workspace / single test file (Jest + ts-jest, tests live in src/**/*.{test,spec}.ts[x])
npm test --workspace=@postgear/api -- posts.service
npx jest --config apps/api/jest.config.js apps/api/src/modules/posts/posts.service.spec.ts

# Database (Prisma, schema at packages/db/prisma/schema.prisma; all scripts load the root .env)
npm run db:generate    # required before typecheck: packages/db re-exports @prisma/client types
npm run db:migrate     # prisma migrate dev
npm run migrate:deploy --workspace=packages/db
npm run db:seed        # demo@postgear.local / DemoPassword123! (also member@, onboarding@), org seed-demo-org

# E2E (Playwright, e2e/*.spec.ts). Needs docker services, a seeded DB, and the API started with
# dev:api:e2e (raised login throttle) in its own terminal; Playwright only starts the web app.
npm run dev:api:e2e
npm run test:e2e -- e2e/composer.spec.ts
```

Local services from `docker-compose.yml`: Postgres 15, Redis, MinIO, Temporal (:7233) and Temporal UI (:8233).

In development, Claude runs migrations and `db:generate` itself rather than asking the user; the `.claude/hooks/prisma-schema-reminder.js` hook lists the steps after any `schema.prisma` edit.

## Architecture

**apps/api**: NestJS 11 on Express. One module per domain under `src/modules/*` (controller / service / repository / `*.messages.ts` for user-facing strings). Key cross-cutting rules, in `src/app.module.ts` and `src/common/`:
- `JwtAuthGuard` then `RolesGuard` are global `APP_GUARD`s, in that order on purpose. Every route is authenticated by default; opt out with `@Public()`. Active workspace comes from the org cookie, read via `@CurrentOrg()`.
- No class-validator / global ValidationPipe. Bodies are validated with the Zod pipe in `common/pipes/zod-validation.pipe.ts`, schemas are `.strict()`.
- Env is Zod-validated at boot in `src/config/env.ts`; the API is always started through `dotenv -e ../../.env` (no per-app .env).
- Streaming endpoints (AI, SEO) use SSE (`common/sse.ts`); the web side consumes them with `apps/web/src/lib/sse.ts`.
- `tsc` output lands in `dist/apps/api/src/` because workspace packages are compiled in as source.

**apps/worker**: a Temporal worker on one task queue. Workflows in `src/workflows` (post publish, token refresh, analytics sync, webhook delivery, maintenance), activities in `src/activities`. The API never publishes: it writes rows and starts/signals/cancels workflows; the worker does the platform calls and writes status back.

**packages/scheduling**: the API/worker contract (workflow + signal names, workflow id derived from row id, retry policy, publish status shape stored in `Post.error`). Must stay pure (no Temporal, Prisma or Node built-ins) because workflow code imports it inside Temporal's sandbox.

**apps/web**: Next.js 16 App Router (read `apps/web/AGENTS.md`: this Next version differs from training data, consult `node_modules/next/dist/docs/`). Routes under `src/app/(auth)` and `src/app/(dashboard)/[orgId]/...`; `/dev/components` is the design-system playground. All API calls go through `src/lib/api.ts` (`serverApi()` forwards cookies in server components). Auth gating is done in layouts via `src/lib/session.ts`, deliberately no `proxy.ts`/middleware. The httpOnly session cookie set by :3001 works on :3000 because cookies are scoped by host, not port.

**Shared packages** (all consumed as TS source; `main` points at `src/index.ts`, resolved via tsconfig `paths`):
- `db`: Prisma client, token encryption (`crypto.ts`), webhook signing. `prisma/SCHEMA_NOTES.md` explains schema decisions.
- `social-core`: provider implementations (X, LinkedIn, Facebook, Instagram, YouTube, TikTok, Pinterest) on `abstract/social.abstract.ts`. The web app may import only `@postgear/social-core/composer` (browser-safe); the root pulls in `node:crypto`.
- `ai-engine`: LangGraph agents, prompts, tools, model wiring (OpenAI + Tavily).
- `seo-engine`: Playwright crawler (falls back to plain fetch) + scoring.
- `ui`: design-system components; `config`: shared Jest preset, Tailwind config, tsconfig base; `sdk`: public API client.

**Simulation modes** (how everything is tested locally without paid keys; each is refused when `NODE_ENV=production`): `PUBLISH_SIMULATION` (worker publishes to a stand-in; `[simulate:429]` etc. in post text forces failures), `ANALYTICS_SIMULATION` (defaults to following PUBLISH_SIMULATION), `AI_SIMULATION`, `BILLING_SIMULATION` (synthesises Stripe events through the real webhook handler), `WEBHOOK_ALLOW_PRIVATE_URLS`. Without `SMTP_HOST`, mail (activation/reset links) is printed to the API console. `.env.example` documents every variable.

## UI conventions

- Rules for consuming design tokens live in `docs/design-patterns/design-system-rules.md`. One font (Sora) via role utilities (`type-heading`, `type-ui`, `type-label`) defined in `apps/web/src/app/globals.css`; never hand-write weight/tracking to fake a role.
- No in-page titles, taglines or decorative dividers: the top bar names the page. Pages open with a `PageActions` row, then content.
- Clickable icons use animated icons (`@animateicons/react` via `MotionIcon`); purely decorative/state icons stay lucide.
- Input placeholders read "Enter your ...", never sample values.
- Never write the em dash (U+2014) or the middle dot (U+00B7) anywhere in the project (copy, comments, docs, commit messages, PRs). Use a comma, colon, parentheses or a full stop. `.claude/hooks/block-ai-punctuation.js` refuses any write that contains either; where code genuinely needs the character (e.g. an HTML entity table), write it as a `\u` escape.
- Layout and flows follow Postiz/Buffer (screenshots in `docs/screenshots`), with PostGear's own neobrutalist styling. Postiz is AGPL: never copy its code.
