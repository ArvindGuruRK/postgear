# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How to talk to me

- Use emojis in explanations, summaries and replies 🎯
- Keep explanations simple and easy to understand: plain words, short sentences, no jargon unless it's needed (and explain it when it is) 🙂
- Do not use em-dashes in any response. Prefer commas, hyphens, parentheses, or periods instead.

## What this is

PostGear: a social media management + SEO SaaS. npm workspaces + Turborepo monorepo, Node >= 20.9. Product spec in `prd.md`, per-sprint specs in `docs/sprint-documents/`, the full local run/test walkthrough in `docs/local-testing-guide.md`. Note `complete_codebase_and_architecture_analysis.md` describes **Postiz** (the reference product), not this codebase.

## Commands

```bash
npm run dev            # docker compose up -d, then API (:3001) + worker + web (:3000) via turbo
npm run dev:api        # API alone (ts-node-dev, reads root .env)
npm run dev:worker     # Temporal worker alone
npm run dev --workspace=@postgear/web

npm run validate       # lint + typecheck + test across all workspaces (this is what CI runs); needs uv, since the Python service's lint, typecheck and test fail without it on purpose
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

# Clips (Sprint 12): tools check, sample videos, the open library, rights removals
npm run clips:doctor   # FFmpeg (libass, harfbuzz, x264), ffprobe, yt-dlp, Deno
npm run clips:samples  # the local sample videos simulation serves
npm run clips:library:seed   # draws the small sticker and sound fixtures and ingests them
npm run clips:remove -- --url <video link> --reason "<10+ chars>" --by <operator email>
npm run operator:grant -- --email <address>   # also operator:revoke; the only way to set isSuperAdmin
docker compose --profile worker-image up -d --build worker   # the real worker image; stop the host worker first; forces every simulation flag on
npm run clips:regression     # the saved Sprint 12 clips exported again and compared (real FFmpeg)

# Clips AI (Sprint 13): the Python media service, managed with uv (https://docs.astral.sh/uv/)
npm run dev:media      # FastAPI on :8100 plus its Temporal worker; `npm run dev` starts it too (skips with one line if uv is missing)
cd apps/media && uv sync               # enough for simulation, lint, types, tests; `uv sync --group ml` adds the real model libraries
npm run contract:export && npm run contract:python   # after editing a shape in packages/media-contract/src/shapes: the JSON, then the Python models
docker compose --profile media-image up -d media   # the media image instead (stop dev:media first: both use :8100)

# E2E (Playwright, e2e/*.spec.ts). Needs docker services, a seeded DB, and the API started with
# dev:api:e2e (raised login throttle) in its own terminal; Playwright only starts the web app.
npm run dev:api:e2e
npm run test:e2e -- e2e/composer.spec.ts
```

Local services from `docker-compose.yml`: Postgres 15, Redis, MinIO, Temporal (:7233) and Temporal UI (:8233).

In development, Claude runs migrations and `db:generate` itself rather than asking the user; the `.claude/hooks/prisma-schema-reminder.js` hook lists the steps after any `schema.prisma` edit.

MCP servers (`.mcp.json`): the Postgres MCP was removed because every session left an orphan `crystaldba/postgres-mcp` container running; query the database with `docker exec postgear_postgres psql -U postgres -d postgear_db` instead. The `claude_readonly` role (`npm run db:readonly-role`, `infra/postgres/readonly-role.sql`) is kept so the MCP can be added back. `playwright` (headless, isolated) drives the local app; use it for bigger UI or flow changes only, since the user checks small tweaks by hand.

## Architecture

**apps/api**: NestJS 11 on Express. One module per domain under `src/modules/*` (controller / service / repository / `*.messages.ts` for user-facing strings). Key cross-cutting rules, in `src/app.module.ts` and `src/common/`:
- `JwtAuthGuard` then `RolesGuard` are global `APP_GUARD`s, in that order on purpose. Every route is authenticated by default; opt out with `@Public()`. Active workspace comes from the org cookie, read via `@CurrentOrg()`.
- Roles: `ADMIN`, `USER` and, since Sprint 13, `EDITOR` (makes clips, designs and post drafts; never schedules, publishes, connects channels, bills or invites; seats counted by `members.editors_max`). `common/guards/editor-access.json` says how every route treats an Editor and its spec fails on a route without an entry, so add one with every new route. Draft-only writers call `assertEditorMayWrite`; `capabilities.ts` is shared with the web app.
- No class-validator / global ValidationPipe. Bodies are validated with the Zod pipe in `common/pipes/zod-validation.pipe.ts`, schemas are `.strict()`.
- Env is Zod-validated at boot in `src/config/env.ts`; the API is always started through `dotenv -e ../../.env` (no per-app .env).
- Streaming endpoints (AI, SEO) use SSE (`common/sse.ts`); the web side consumes them with `apps/web/src/lib/sse.ts`.
- `tsc` output lands in `dist/apps/api/src/` because workspace packages are compiled in as source.

**apps/worker**: a Temporal worker. Workflows in `src/workflows` (post publish, token refresh, analytics sync, webhook delivery, maintenance, Clips jobs), activities in `src/activities` and `src/clips`. The API never publishes: it writes rows and starts/signals/cancels workflows; the worker does the platform calls and writes status back. `WORKER_ROLES` (default `publishing,media,render`) picks the queues one process polls: `postgear-publishing`, `postgear-media` (imports, downloads, Media posters), `postgear-media-quick` (probes, channel lists) and `postgear-render` (exports), so a render never delays a scheduled post. The worker never reads plan values or the ledger: it calls the API's `/internal/clips/...` routes (internal token) to charge, reverse, finish and sweep. `infra/docker/Dockerfile.worker` is the real image (GPL FFmpeg as a separate program: keep it in a private registry). Every Clips job is started by the API's `ClipSchedulerService` (Sprint 13): slots per class (`CLIPS_RENDER_SLOTS`, `CLIPS_MEDIA_SLOTS`, `CLIPS_MEDIA_PY_SLOTS`), priority from the plan, aged so nobody waits forever; the worker's `WORKER_MEDIA_CONCURRENCY` must be at least the media and Python slots added together, because waiting runs hold activity slots.

**apps/media** (Sprint 13): the Python half of Clips AI. FastAPI on :8100 (`/health` open; every other route needs `MEDIA_INTERNAL_TOKEN`) and a Temporal worker that serves activities only on `postgear-media-py` (speech to text, faces, motion, stills, the voice). The Node worker owns the workflows, order, retries and charges; Python never reads a plan or the ledger and never logs a payload. `TRANSCRIBER=auto` sends speech longer than `TRANSCRIBE_HOSTED_ABOVE_MINUTES` to Groq when `GROQ_API_KEY` is set, falling back to our own machine. `infra/docker/Dockerfile.media` has `slim` and `full` targets and holds no model (the operator fills the `media_models` volume). `packages/media-contract` holds the shapes that cross between Node and Python, written once in Zod (`src/shapes`); `npm run contract:export` writes `schema/contract.json` from them (a drift test fails when it is stale), the Python models are generated from that file (`npm run contract:python`), and both sides refuse unknown fields.

**packages/scheduling**: the API/worker contract (workflow + signal names, workflow id derived from row id, retry policy, publish status shape stored in `Post.error`). Must stay pure (no Temporal, Prisma or Node built-ins) because workflow code imports it inside Temporal's sandbox.

**apps/web**: Next.js 16 App Router (read `apps/web/AGENTS.md`: this Next version differs from training data, consult `node_modules/next/dist/docs/`). Routes under `src/app/(auth)` and `src/app/(dashboard)/[orgId]/...`; `/dev/components` is the design-system playground. All API calls go through `src/lib/api.ts` (`serverApi()` forwards cookies in server components). Auth gating is done in layouts via `src/lib/session.ts`, deliberately no `proxy.ts`/middleware. The httpOnly session cookie set by :3001 works on :3000 because cookies are scoped by host, not port.

**Shared packages** (all consumed as TS source; `main` points at `src/index.ts`, resolved via tsconfig `paths`):
- `db`: Prisma client, token encryption (`crypto.ts`), webhook signing. `prisma/SCHEMA_NOTES.md` explains schema decisions.
- `social-core`: provider implementations (X, LinkedIn, Facebook, Instagram, Threads, YouTube, TikTok, Pinterest) on `abstract/social.abstract.ts`. Instagram has two providers: `instagram-standalone` (the "Instagram" tile, Instagram Login, no Page) and `instagram` ("Instagram Via Facebook Page", which Discover's competitor tracking needs). Instagram on its own and Threads share `providers/meta/meta.login.ts`; they take only https callbacks, so locally `CHANNELS_PUBLIC_URL` (an https tunnel) carries channel callbacks and media URLs while login stays on `API_URL`. The web app may import only `@postgear/social-core/composer` (browser-safe); the root pulls in `node:crypto`.
- `ai-engine`: LangGraph agents, prompts, tools, model wiring (OpenAI + Tavily).
- `seo-engine`: Playwright crawler (falls back to plain fetch) + scoring.
- `discover-engine`: Discover's sources (Google Trends, Google News), places and languages. Never imports another workspace and never reaches the network on its own: its fetch is injected (the API binds `fetchUrlSafely`, simulation binds recorded files).
- `email`: every email as typed props in, `{ subject, preview, html, text }` out (table layout, Outlook button, dark mode). Pure: React and `react-dom/server` only, so `/dev/emails` renders it in the browser. Logos are PNGs in `apps/web/public/email` (`node apps/web/scripts/generate-email-brand.mjs`).
- Clips (Sprint 12): `video-engine` (pure: the clip document, time map, render plan and FFmpeg compiler, error sentences; imports nothing), `video-preview` (web only: the editor's fast preview from the same `frameState`), `storage` (public media and the private clips space with signed addresses; production needs S3), `media-tools` (Node only: FFmpeg, ffprobe, yt-dlp runners; the ONLY package that may import `child_process`, `guard.test.ts` enforces it), `entitlements` (pure: the key registry, plan values, refusal sentences).
- Plan limits and allowances: every Clips limit is read through `EntitlementResolver` and every charge goes through `UsageService` (idempotency key plus a reversal); values live in `PlanEntitlement` rows and per-workspace overrides, edited on the operator screen at `/operator` (superadmin only; in production also `OPERATOR_EMAILS`). Never hard-code a Clips number or read it from `plans.ts`.
- `ui`: design-system components; `config`: shared Jest preset, Tailwind config, tsconfig base; `sdk`: public API client.

**Simulation modes** (how everything is tested locally without paid keys; each is refused when `NODE_ENV=production`): `PUBLISH_SIMULATION` (worker publishes to a stand-in; `[simulate:429]` etc. in post text forces failures), `ANALYTICS_SIMULATION` (defaults to following PUBLISH_SIMULATION), `AI_SIMULATION`, `BILLING_SIMULATION` (synthesises Stripe events through the real webhook handler), `DISCOVER_SIMULATION` (Discover reads the feeds recorded in `packages/discover-engine/fixtures` and finds places with a stand-in that knows Chennai, San Francisco and Paris; its one competitor is the hand-written sample at `acme.example`, and Read answers a hand-written sample article for any address, so no stranger's site is ever fetched), `WEBHOOK_ALLOW_PRIVATE_URLS`, `CLIPS_SIMULATION` (links and channels answer from `packages/media-tools/fixtures/simulation`, imports and downloads copy the local samples, Find Clips measures those samples and reads Twitch chat from a recorded file; forcing links and `[simulate:...]` names are listed in the local testing guide; never fetches a real YouTube, Twitch or Kick video), `MEDIA_SIMULATION` (Sprint 13: the Python service answers speech to text, faces, motion and stills from recorded files for the sample videos, so no model is downloaded; unset, it follows `CLIPS_SIMULATION`). Without `RESEND_API_KEY` or `SMTP_HOST`, mail (activation/reset links) is printed to the API console (refused in production); `/dev/emails` previews every email. `.env.example` documents every variable.

## UI conventions

- Rules for consuming design tokens live in `docs/design-patterns/design-system-rules.md`. Motion and interaction follow `docs/design-patterns/motion-and-interaction-principles.md` app-wide (pulse on success, grow don't swap, blur icon crossfades, rubber band edges, mask wipes, one focus with the rest dimmed, less motion for frequent actions, Fitts/Hick, respond in under 400 ms); run its checklist on every UI change. One font (Sora) via role utilities (`type-heading`, `type-ui`, `type-label`) defined in `apps/web/src/app/globals.css`; never hand-write weight/tracking to fake a role.
- Names are Title Case, every word ("Create Post", "Connect A Channel", "From The Blog"): headings, card/dialog titles, buttons, tabs, menu items, table headers, badges. Sentences stay sentence case (descriptions, explaining tooltips, banners, errors, toasts, empty-state messages, form labels). No all-caps text: `type-label` and `Badge` no longer uppercase. Write the real text (never CSS `capitalize`); `apps/web/src/lib/title-case.test.ts` enforces it.
- The product name in a heading, button or brand line is `<BrandName />` (`components/brand/brand-mark.tsx`): the wordmark's own lettering, sized from the surrounding text. Never type "PostGear" in a font to fake it. Sentences (descriptions, errors, toasts) and plain strings (tab titles, metadata) keep the typed word.
- No in-page titles, taglines or decorative dividers: the top bar names the page. Pages open with a `PageActions` row, then content.
- Clickable icons use animated icons (`@animateicons/react` via `MotionIcon`); purely decorative/state icons stay lucide. One exception: a navigation menu's values show a plain lucide icon beside the name.
- Input placeholders read "Enter your ...", never sample values.
- Never write the em dash (U+2014) or the middle dot (U+00B7) anywhere in the project (copy, comments, docs, commit messages, PRs). Use a comma, colon, parentheses or a full stop. `.claude/hooks/block-ai-punctuation.js` refuses any write that contains either; where code genuinely needs the character (e.g. an HTML entity table), write it as a `\u` escape.
- **Workflows, Design Studio and Clips are desktop only** (2026-10-31; Clips 2026-11-18). Nobody edits a canvas, a slide or a clip on a phone, so these three modules get no mobile layout, no tab-bar fallback and no small-screen checks: design and test them at 1366 px and up. Every other page keeps its responsive layout as it is. Creating or opening a workflow or a design, or editing a clip (`clips/edit/{clipId}`), takes the whole window (no rail, no top bar; `immersion()` in `components/navigation/immersion.ts`), with a back button of its own.
- One search: the top bar's global search. A page does not carry a second search box of its own.
- Buttons all stand on the same small shadow (`shadow-brutalSm`, the calendar's Add Channel and Create Post tiles). An icon-only control that sits on a surface with its own border and shadow (toolbar, panel header, step card) is `Button variant="ghost"`: no border, no shadow, no press.
- Dropdowns (the button and the open list) and toggle-style controls (tab lists, view switchers, segmented controls, choice tiles) have no shadow, anywhere in the app. Status marks on a workflow step card are bare icons with no background, in its bottom right corner. A step card keeps its black border and wears a ring touching it: grey on hover, its icon's colour when selected. The ring follows only the outer edge of the card and its label together (no line under the label), and stays thin zoomed out.
- There is one toggle bar, the calendar's Day, Week, Month: `Tabs` and `Segmented` from the design system, never hand-made. A choice that is the point of a form is `ChoiceTiles`, not a toggle bar.
- A focused field is a plain 2 px blue line: no glow, and no hard shadow under it while focused.
- Anything read-only inside a card, panel, dialog or sheet (nested cards, previews, code, list rows, table headers) is `bg-inset`, the third dark shade, not `bg-secondary` or `bg-chrome`. Pressable and typeable things (buttons, tiles, fields) keep their own layers.
- Layout and flows follow Postiz/Buffer (screenshots in `docs/screenshots`), with PostGear's own neobrutalist styling. Postiz is AGPL: never copy its code.
