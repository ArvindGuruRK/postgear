# PostGear: Honest Status, Problems And Solutions 🎯

Written on 2026-11-12, on branch `sprint-11-discover` (HEAD `c498c4b` plus 88 uncommitted entries).
Written for: Arvind (the only reader). Plain words, no sales talk.

---

## 0. How To Read This Document 🙂

**How I got these facts.** I split the repo into five areas and had each one audited by reading the code, the sprint documents and the completion checklists. I treated every document as a claim and checked it against code. I also read the local `.env` (key shapes only, never the secret values) and counted rows in the Docker database.

**What I did NOT do.** I did not run the full test suites, I did not start the app, and I did not call any outside service. So "works" in this document means: the code is real and has tests or live evidence in a checklist. It does not mean I re-proved it today. Where I am unsure, I say "unverified".

**Labels used in every table:**

| Label | Meaning |
|---|---|
| ✅ Real | Built, tested, and runs without any fake stand-in |
| 🧪 Simulated | Built and tested, but has only ever run against our own stand-in, never the real outside service |
| 🟡 Partial | Some parts built, some missing |
| ❌ Missing | Not built |

---

## 1. The Short Honest Verdict 🧭

**PostGear is a big, carefully built product. It is not yet a deployed product.**

- The code is real. I found almost no TODOs or fake code inside the app itself. Auth, the composer, scheduling on Temporal, billing logic, the AI credit ledger, the SEO crawler, Studio, Workflows and Discover are all genuine code with a lot of tests.
- But **almost nothing has ever touched a real outside service.** Every external call (social platforms, OpenAI, Stripe, email, Slack, Google, Nominatim, YouTube) has only run against our own stand-ins. Your `.env` confirms it: all five simulation flags are `true`, and the API keys are placeholders. The one likely-real credential is the LinkedIn app.
- **The app cannot be deployed today.** The three Dockerfiles are empty stubs, the deploy pipeline is an empty stub, and there is a probable blocker in how the API and worker load the shared packages in production (section 5, P0-1).
- **There is no public face.** No landing page, no pricing page, no terms, no privacy policy. The sign-up form has a "I agree to the terms" box that links to nothing.

**What this means for the investor goal:** it is achievable in 3 to 4 days, but only if we are strict about scope. The cut line is in section 10.

---

## 2. What We Have Built 🏗️

### 2.1 Platform Pieces

| Piece | What it is | Status |
|---|---|---|
| `apps/api` | NestJS 11 API, 24 modules, Zod validation, global auth guards | ✅ Real |
| `apps/worker` | Temporal worker: publish, token refresh, analytics sync, webhook delivery, workflow runs, maintenance | ✅ Real (publish is 🧪 at the last HTTP call) |
| `apps/web` | Next.js 16 app, about 423 TSX files, 104 Jest test files, 24 Playwright specs | ✅ Real |
| `packages/social-core` | 7 providers: X, LinkedIn (profile and Page), Facebook, Instagram, YouTube, TikTok, Pinterest | 🧪 Simulated (mock-tested only) |
| `packages/ai-engine` | LangGraph agents, prompts, OpenAI and Tavily wiring | 🧪 Simulated |
| `packages/seo-engine` | Playwright crawler plus scoring | ✅ Real (runs on real Chromium) |
| `packages/design-engine` | Studio document model, 167 templates, 52 fonts, export | ✅ Real |
| `packages/automation` | Workflow engine and step catalog | 🧪 Simulated outside calls |
| `packages/discover-engine` | Trends, news, places, competitors, reader | 🧪 Simulated (recorded feeds) |
| `packages/sdk` | Public API client | 🟡 Built, private, not published |
| `packages/ui` | Design system | ✅ Real |

### 2.2 Feature By Feature

| Feature | Status | Honest note |
|---|---|---|
| Sign up, activate, login, logout, reset password, lockout | ✅ Real | Mail only prints to the console (no SMTP) |
| Google and Facebook social login | 🧪 | Never completed against live apps. The Sprint 2 docs wrongly say GitHub |
| Workspaces, roles, signed invites | ✅ Real | Invite emails are never really sent |
| Onboarding (9 screens, skippable) | ✅ Real | Modelled on Buffer |
| Connect channels (OAuth, PKCE, entity picker, reconnect guard, token encryption) | 🧪 | Only LinkedIn has any sign of a live connection |
| Composer (per-channel text, threads, previews, validation) | ✅ Real | Missing: mention autocomplete, auto thread split, YouTube title and privacy fields |
| Media library (upload, sniffing, resize, local or S3) | ✅ Real | No video transcoding, no HEIC or WebM |
| Calendar, Queue, drag to reschedule, Post Now, Retry | ✅ Real | |
| Scheduling on Temporal (kill and restart tested, exactly once) | ✅ Real | Last HTTP call is simulated. This is the strongest part of the system |
| Repeat posts | ✅ Real | Built after the checklist was written, so docs say "not built" |
| Tags, signatures | ✅ Real | |
| AI Copilot, generate post, images, credits ledger | 🧪 | OpenAI never called. Ledger logic is solid |
| SEO analyzer (crawl, score, advice, SSRF-safe) | ✅ Real | Authority score is a guess without an Open PageRank key |
| Analytics (sync, charts, CSV, PDF report) | 🧪 | All 7 providers have real fetch code, none ever ran live. TikTok and Pinterest are thin |
| Billing (plans, trial, checkout, webhooks, idempotency) | 🧪 | Stripe never called. Prices are placeholders. Member limits not enforced |
| Notifications (bell, live stream, email prefs) | ✅ Real | Email part needs SMTP |
| Public API `/v1`, API keys, Swagger docs | ✅ Real | SDK not published |
| Outbound webhooks (signed, retried, SSRF-safe) | ✅ Real | |
| Global search, Home, day streak | ✅ Real | |
| Design Studio (brand kits, editor, export, share links, Send To Composer) | ✅ Real | Rights to the template art rest on your word (section 8) |
| Studio premium pack (167 templates, plan locks) | ✅ Real | 9 of 10 done criteria. Brand lock is not enforced in the API |
| Workflow builder (triggers, logic, AI, notify, data steps, canvas, runs) | 🧪 | No real Slack, Teams, Discord, Sheets, email or HTTP call has ever left it |
| Discover (trends, news, holidays, videos, competitors, Read, Create Post) | 🧪 | Real Google feeds recorded once. Read breaks in a production build |
| Admin module | ❌ Missing | Folder holds only `.gitkeep` |
| Landing, pricing, terms, privacy, help | ❌ Missing | |

### 2.3 Numbers From The Local Database

5 users, 11 workspaces, 4 channels, 456 posts, 186 media rows, 25 migrations. It is demo and test data, not real usage.

---

## 3. What Is Already Set Up ✔️

- Local stack in Docker: Postgres 15, Redis 7, MinIO, Temporal 1.28 plus its UI. Currently running.
- Env validation at boot (`apps/api/src/config/env.ts`): refuses to start without `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY_AES256`. In production it refuses every simulation flag, and requires `AUTOMATION_INTERNAL_TOKEN`.
- Security basics: Helmet, single-origin CORS, 1 MB JSON limit, Zod `.strict()` bodies, login throttle and account lockout, per-IP and per-API-key rate limits, SSRF guards (SEO, webhooks, Discover), upload type sniffing, token encryption at rest (AES-256-GCM), Stripe raw-body signature check plus idempotency table.
- `GET /health` (checks the database) usable as a platform health check.
- CI: lint, typecheck, test on every push (`.github/workflows/ci.yml`).
- A LinkedIn developer app (client id looks real; the Sprint 8 checklist says a real LinkedIn channel exists in the dev database). No real publish is recorded.
- Domains: `rkay.in` is yours. Plan is `postgear.rkay.in` (prod) and `postgear-staging.rkay.in` (staging).

---

## 4. What Is NOT Set Up (Keys, Accounts, Approvals) 🔑

This is the full list. "Lead time" is my honest estimate, and platforms change rules often, so confirm in each portal.

### 4.1 Needed For Any Real Demo

| What | Env variables | Current state | Lead time | Cost |
|---|---|---|---|---|
| OpenAI key | `OPENAI_API_KEY` | Placeholder (22 chars) | 10 minutes | Pay as you go, a few dollars is plenty |
| Tavily key (optional) | `TAVILY_API_KEY` | Placeholder | 10 minutes | Free tier |
| Stripe test-mode keys and webhook | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Placeholders | 1 hour (needs a registered webhook URL on the deployed API) | Free in test mode |
| SMTP provider | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Empty | 1 hour plus DNS records on `rkay.in` (SPF, DKIM) | Resend or Brevo free tier |
| S3 or R2 bucket with public URL | `STORAGE_PROVIDER=s3`, `S3_*` | Points at local MinIO | 1 hour | Cloudflare R2 has a free tier |
| Fresh production secrets | `JWT_SECRET`, `ENCRYPTION_KEY_AES256`, `AUTOMATION_INTERNAL_TOKEN` | Dev values | 5 minutes (`npm run generate:keys`) | Free |
| Sentry (recommended) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Empty | 15 minutes | Free tier |

### 4.2 Social Platforms

| Platform | Env variables | Current state | What blocks it | Lead time |
|---|---|---|---|---|
| LinkedIn profile | `LINKEDIN_CLIENT_ID/SECRET` | Probably real | Nothing, but no real publish ever recorded | Hours |
| LinkedIn Page | same app | Not approved | Community Management API application | Days to weeks |
| X | `X_TWITTER_CLIENT_ID/SECRET` | Placeholder | Dev app (set "Read and write", confidential client). Free tier caps posts; metrics likely need a paid tier | 1 hour for posting |
| Facebook and Instagram | `FACEBOOK_APP_ID/SECRET` (publishing app) | Placeholder | Meta app review plus Business Verification for public use. In development mode you can use your own Pages | Review: weeks. Dev mode: 2 hours |
| YouTube | `YOUTUBE_CLIENT_ID/SECRET` | Placeholder | Testing mode allows 100 named users. Public needs Google verification and maybe a security assessment | Testing: 1 hour. Verified: weeks |
| TikTok | `TIKTOK_CLIENT_KEY/SECRET` | **No variables in `.env` at all** | Content posting audit (until then all posts are private). Needs a verified media domain | Weeks |
| Pinterest | `PINTEREST_APP_ID/SECRET` | **No variables in `.env` at all** | Trial access only until standard access is granted | Days to weeks |
| Google login | `GOOGLE_CLIENT_ID/SECRET` | Placeholder | Consent screen only (basic scopes) | 1 hour |
| Facebook login | `FACEBOOK_CLIENT_ID/SECRET` | Placeholder | Basic app | 1 hour |

Rules that bite: Meta, TikTok and Pinterest usually reject `http://localhost` redirects. Instagram, Facebook, Pinterest and TikTok fetch media from a public URL, so local file storage can never publish media to them. A real hostname solves both.

### 4.3 Optional, Feature Specific

| Feature | Variables | Note |
|---|---|---|
| Discover Videos tab | `YOUTUBE_API_KEY` | Free key on your Google Cloud project |
| Discover news upgrade | `SERPAPI_API_KEY` (paid after 250/month), `NEWSDATA_API_KEY` | Only if you leave the free Google feeds |
| Discover places at scale | `DISCOVER_GEOCODER_URL` (self-hosted Nominatim) | The Docker profile the docs mention does not exist |
| Discover IP guess | `DISCOVER_IP_COUNTRY_FILE` | Needs a monthly download and credit line |
| Workflows: Google Sheets | `GOOGLE_AUTOMATION_CLIENT_ID/SECRET`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_APP_ID` | Test users only until Google verifies |
| Workflows: Slack, Teams, Discord | Per-user webhook links | Nothing for us to set |
| SEO authority score | `OPEN_PAGERANK_API_KEY` | Free key, otherwise it is an estimate |

---

## 5. Problems And Solutions 🛠️

Priority: **P0** = nothing works in production without it. **P1** = embarrassing or risky in front of investors. **P2** = real but can wait.
Effort is my honest estimate for one focused developer.

### P0: Blockers

#### P0-1. The API and worker probably cannot start in production 🚨
- **Problem.** All shared packages (`@postgear/db`, `social-core` and the rest) point `main` at `src/index.ts`, meaning raw TypeScript. Locally, `ts-node-dev` handles it. The production start command is `node dist/apps/api/src/main.js`, and the compiled code does `require("@postgear/db")`, which resolves to a `.ts` file that plain Node cannot load. The Discover audit found a matching symptom: the Read feature loads `linkedom` from a place that will not exist in a compiled build.
- **Evidence.** Package `main` fields; `apps/api/dist/.../health.controller.js`; Sprint 11 checklist known gap 1. **Confirmed on 2026-11-12:** running `require('@postgear/db')` with plain Node 24 from `apps/api` fails with `ERR_MODULE_NOT_FOUND` (it cannot resolve `packages/db/src/client`).
- **Solution.** Bundle the API and the worker with `tsup` or `esbuild` (workspace packages inlined, native modules like `argon2`, `sharp` and `playwright` kept external). This is the least risky path. The alternative, giving every package a compiled `dist` entry, touches more files.
- **Effort.** 0.5 to 1 day including the Discover reader worker file.

#### P0-2. No Dockerfiles, no deploy pipeline
- **Problem.** `infra/docker/Dockerfile.{api,web,worker}` are 6-line stubs. `deploy-staging.yml` is a TODO. `infra/k8s` is empty.
- **Solution.** Write three Dockerfiles (or Railway Nixpacks config):
  - API: Node 22 on Debian slim (not Alpine, because of `argon2`, `sharp` and Chromium), `npm ci`, `prisma generate`, bundle, `npx playwright install --with-deps chromium`. Add `SEO_BROWSER=off` as a fallback to save memory.
  - Worker: same bundle, no Chromium unless the worker needs it.
  - Web: `next build` with `NEXT_PUBLIC_*` passed as build args, `output: 'standalone'`.
  - Pre-deploy command on the API: `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
- **Effort.** 1 day (the first build always has surprises).

#### P0-3. Login will not work across two hostnames
- **Problem.** The session cookie is host-only (no `domain` anywhere in `auth.controller.ts`). The code was designed for `localhost:3000` and `localhost:3001`. In production the web app and API sit on different hosts, so the web server never sees the cookie, and the server-side page gates (in the layouts) bounce everyone to login. The org cookie has the same issue.
- **Solution.** Put both on sibling subdomains of one domain, for example `postgear.rkay.in` (web) and `api.postgear.rkay.in` (API), then add an optional `COOKIE_DOMAIN=.postgear.rkay.in` env variable applied to the session cookie, the 3 org-cookie sites and the logout/clear calls (these must use the same domain or logout silently fails). Keep `sameSite=lax`.
- **Effort.** 0.5 day, plus a test.

#### P0-4. Simulation flags are refused in production, so the demo needs real keys
- **Problem.** By design the API and worker refuse to boot with any `*_SIMULATION=true` when `NODE_ENV=production`. So a production-mode demo cannot use fakes.
- **Solution (decision for you).** Recommended: run the demo with `NODE_ENV=production` and real keys: OpenAI (real), Stripe test mode (real, free), LinkedIn and X (real), SMTP (real). Leave Discover simulation off (real free Google feeds). Do not weaken the guard.
- **Effort.** Mostly account setup, about 0.5 day.

#### P0-5. No terms, privacy policy or public page
- **Problem.** An investor lands on a login screen. The sign-up checkbox promises terms that do not exist. A real user, a Meta reviewer and a Google reviewer all require a privacy policy URL.
- **Solution.** One static marketing site inside the Next app (public route group): Landing, Pricing (reads the real plan table), Terms, Privacy, Contact. Add metadata (title, Open Graph, `metadataBase`), `robots.txt`, `sitemap.ts`, and `noindex` on the dashboard routes. Link the terms checkbox.
- **Effort.** 1 to 1.5 days for a decent landing page. Terms and privacy should be reviewed by a lawyer later; use a reputable template now and say so internally.

### P1: Important

#### P1-1. Zero real end-to-end platform runs
- **Problem.** Every provider is tested only against mocked responses. The first real run will almost certainly expose response-shape bugs. Carousels, video, thread comments, Instagram container polling, YouTube resumable upload and TikTok status polling have never touched a real platform.
- **Solution.** After deploy, publish one real text post and one image post per reachable platform: LinkedIn, X, Facebook Page and Instagram (dev mode, your own accounts), YouTube (testing mode). Fix what breaks. Record real responses as test fixtures.
- **Effort.** 1 to 1.5 days for the set. Skip TikTok and Pinterest for the POC.

#### P1-2. Temporal in production
- **Problem.** Temporal needs its own server. The code only supports a plain address (no TLS, no API key), so Temporal Cloud will not connect without code changes. Self-hosting on Railway works over the private network.
- **Solution.** For speed, self-host `temporalio/auto-setup` as a Railway service with its own database on the same Postgres. Keep it on the private network and do not expose its UI publicly. Temporal Cloud support (TLS plus API key in both `apps/worker/src/lib/temporal.ts` and `scheduling.service.ts`) is a later task.
- **Effort.** 0.5 day.

#### P1-3. Silent dev fallbacks that hide a bad deployment
- **Problem.** In production these do not fail the boot: missing `REDIS_URL` (rate limits and lockout become per process), missing SMTP (mail printed to logs), `STORAGE_PROVIDER=local` (files on a disk that vanishes), `WEB_URL` and `API_URL` defaulting to localhost, and `NEXT_PUBLIC_API_URL` falling back to localhost in the web build.
- **Solution.** In production mode, make `env.ts` require: Redis, S3 storage, https `WEB_URL` and `API_URL`, a `JWT_SECRET` that is not the example value, and SMTP (or an explicit `MAIL_DISABLED=true`). Make the web build fail if `NEXT_PUBLIC_API_URL` is unset.
- **Effort.** 0.5 day.

#### P1-4. Free trial farming
- **Problem.** Every new workspace gets a 14-day Pro trial (500 AI credits, 15 channels), and a user can create unlimited workspaces. That is unlimited free AI spend (images are the costly part) and free Chromium crawling.
- **Solution.** Limit workspaces per user (for example 3), trial once per user (mark it on the user, not the workspace), add a throttle to workspace creation, and consider a hard daily AI spend cap you can set in an env variable.
- **Effort.** 0.5 day.

#### P1-5. Demo environments show internal wording
- **Problem.** The UI shows banners such as "Simulated metrics (ANALYTICS_SIMULATION)" and cards that name env variables. With real keys these disappear, but billing "unconfigured" and AI "unavailable" cards still name env vars if a key is missing.
- **Solution.** Rewrite those cards in plain customer language and hide the env names outside development.
- **Effort.** 2 hours.

#### P1-6. Seeds and test endpoints are live in production
- **Problem.** Seeds have no `NODE_ENV` guard and install demo accounts plus a known API key. `POST /channels/:id/test-post` is a live publishing endpoint that is not environment-gated.
- **Solution.** Guard seeds against production (require an explicit flag). Remove or gate the test-post endpoint. For the investor demo, create a separate, clean demo workspace with believable content instead of running the dev seed.
- **Effort.** 2 hours, plus 0.5 day to build a good demo workspace.

#### P1-7. Discover is half-finished and uncommitted
- **Problem.** 88 uncommitted entries ("Module 10", the P2 backlog) hold the backend for Saved Ideas, per-user place, competitor research, weekly digest, new news providers and IP guessing. **None of it has a web screen, and none of the new API or worker services has tests.** One engine test fails (`simulation.test.ts:323`, a Pongal holiday expectation, possibly date-related). The docs say the Nominatim Docker profile exists, but it does not. The doc for this module still says "parked, nothing starts without Arvind's word".
- **Solution.** Decide: for the POC, **commit it on a separate branch and do not ship it.** Hide it from the app (no UI uses it anyway). Fix the one failing test. Remove the Nominatim claim from `.env.example`.
- **Effort.** 1 hour to branch and park. Finishing it properly is 3+ days and not POC work.

#### P1-8. CI is green only on paper
- **Problem.** `validate` was red on 4 image tests on 2026-11-11 (5 second timeouts in `media/image-processor.spec` and `media.service.spec`). CI runs no build, no Playwright, no security scan. Branch `sprint-11-discover` is 90 commits ahead of `master` with nothing merged.
- **Solution.** Fix or stabilise the 4 image tests. Add `next build` and a secret scan to CI. Merge sprints 9, 10 and 11 to `master` in order after fixes, so Railway deploys from one clean branch.
- **Effort.** 0.5 day.

#### P1-9. Auth has weak unit test cover
- **Problem.** `auth.service.ts` (488 lines) has no unit test file. Cover comes only from Playwright, which CI does not run.
- **Solution.** Run the Playwright auth spec before each deploy; add unit tests for register, login, activation, reset and OAuth linking after the POC.
- **Effort.** 1 day (post-POC).

### P2: Real, But Later

| # | Problem | Solution | Effort |
|---|---|---|---|
| P2-1 | Stripe prices are placeholders (29, 49, 99, 199 a month) | You decide real prices; update `plans.ts`; create real Stripe products only when going live | 1 hour |
| P2-2 | "Team members" limit advertised on plans but not enforced | Enforce in invite and accept flows | 0.5 day |
| P2-3 | No admin module (suspend a workspace, see users, subscriptions) | Minimal read-only admin page for super admins | 2 days |
| P2-4 | Lock Brand Look is enforced only in the Studio editor, not the API | Add the check to the studio update endpoint | 0.5 day |
| P2-5 | SEO gate, Studio export busy guards are per process (two API instances allow two) | Move to Redis locks | 0.5 day |
| P2-6 | No route-level `loading.tsx` or `error.tsx`; a page crash drops the whole shell. The 404 page links only to Login | Add segment boundaries and a smart 404 | 0.5 day |
| P2-7 | Heavy libraries (tiptap, react-pdf, xyflow, emoji picker) are not lazy loaded; three icon libraries; raw `<img>` tags | Dynamic imports; measure with `next build` | 1 day |
| P2-8 | Sentry never received a real event | Add the DSN and trigger the test route once | 15 minutes |
| P2-9 | Logging is plain text with no request ids | Structured logging (pino) | 0.5 day |
| P2-10 | No backups, no restore test, encryption key has no rotation (losing it bricks every channel) | Railway Postgres backups; store `ENCRYPTION_KEY_AES256` in a password manager and a second safe place | 2 hours |
| P2-11 | Sprint 10b (workflow UI revamp) is partly done. No 50-step test page, no motion spec | Not needed for POC | later |
| P2-12 | Workflows steps marked Coming Soon: Generate Video, Render Design, Excel, WhatsApp | Leave, but hide from the demo | none |
| P2-13 | Dead env variables (`NEXTAUTH_*`, `GITHUB_CLIENT_*`) and stale docs (see section 9) | Clean up | 1 hour |
| P2-14 | Prisma 5 is two majors behind; Node 20 is past end of life | Upgrade after launch; use Node 22 in Docker | later |
| P2-15 | No LICENSE file; docs mention AGPL (Postiz is AGPL, we must never copy its code) | Add a proprietary LICENSE; run a dependency licence scan | 2 hours |
| P2-16 | Secrets history never scanned | Run gitleaks once on the full git history | 30 minutes |

---

## 6. Per-Platform Reality Check 🌐

| Platform | Publish code | Analytics code | Live proof | What it takes to try it |
|---|---|---|---|---|
| LinkedIn profile | Text, up to 20 images, no video | None (LinkedIn has no member stats) | Connected once, no recorded publish | Nothing, try today |
| LinkedIn Page | Same plus org pick | Followers and share stats | None | Community Management API approval |
| X | Text, 4 images or 1 video, threads | Followers plus timeline metrics | None | Dev app, Read and write. Free tier limits posts and probably metrics |
| Facebook Page | Text, 10 photos, 1 video | Page insights | None | Dev mode with your own Page works; public needs review |
| Instagram | Single, carousel, video | Followers, reach, interactions | None | Business or Creator account linked to a Page, public media URL |
| YouTube | Video only, resumable | Channel and video | None | Testing mode; no title or privacy fields in the composer |
| TikTok | Video only, forced private until audited | Followers only | None | Skip for POC |
| Pinterest | One image per Pin | Followers plus daily | None | Skip for POC |

---

## 7. Honest Critique: Best, Worst, And What To Improve 🔍

### 7.1 The Really Good Parts 👍

1. **The scheduling backbone.** Temporal workflows with deterministic ids, signals, kill-and-restart tested, exactly-once publishing, reconcile every 15 minutes. This is how real schedulers should be built, and many competitors get it wrong.
2. **Security thinking.** SSRF guards in four places (including DNS-pinned sends and no redirects for webhooks), encrypted tokens, hashed API keys, idempotent Stripe handling, strict input schemas. Better than most early-stage SaaS.
3. **Simulation design.** The ability to run the whole product with no paid keys is clever, safely guarded in production, and a real engineering asset.
4. **Design Studio.** 167 templates, 52 fonts, checked for contrast and overflow in real Chromium, exports to zip and PDF, Send To Composer. This is a differentiator that Buffer and Postiz do not have.
5. **Workflow builder.** Idempotent steps with an effect ledger, review steps, auto-pause after failures. Ambitious and well structured.
6. **Test discipline.** Thousands of tests, a security route sweep for Discover, honest checklists that list their own gaps.
7. **Consistent look.** One design system, flat neobrutalist style, 24 themes.

### 7.2 The Weak Parts 👎

1. **Nothing is proven against the real world.** This is the biggest risk by far. A product that has never published a real post is a prototype, however polished.
2. **No front door.** No landing, pricing, legal pages. Investors judge in 30 seconds.
3. **Scope sprawl.** Social tool, AI copilot, SEO analyzer, design studio, workflow builder and a trends engine. Each is a product on its own. For investors the story is clear only if one is the hero.
4. **Documentation drift.** Checklists say GitHub login (code has Facebook), recurring posts "not built" (they are), invites "stub" (they are real). The docs are no longer a safe source of truth.
5. **Everything depends on platform approvals you do not control.** Meta, TikTok, LinkedIn Pages and Google can each take weeks and can reject.
6. **Discover relies on unofficial Google feeds** that say "personal, non-commercial use" in the feed itself. See section 8.
7. **Complexity cost.** Seven background services to run (web, API, worker, Postgres, Redis, Temporal, storage). Fine for a funded team; heavy for one person.
8. **Packaging was left for last.** Dockerfiles and deploy were never built, which is why section 5 has so many P0 items.

### 7.3 Suggestions

- **Pick one hero for the pitch:** "Plan, create and publish from one calendar, with AI and a built-in design studio." Present Workflows, SEO and Discover as "also included", not as the main story.
- **Demo only what is real.** An investor who spots a "Simulated" banner will doubt everything else. Better to show five features that truly work than ten that mostly do.
- **Have a screen-recorded backup** of a real publish to LinkedIn and X in case a platform is down during a call.
- **Get one real pilot user** (even a friend) publishing for a week before investor calls. Real usage data beats any slide.
- **Merge and stop adding features** until launch. Every new module widens the untested surface.

---

## 8. Legal And Terms Risks ⚖️

| Risk | Detail | Severity | What to do |
|---|---|---|---|
| Google Trends and News feeds | Unofficial feeds; the feeds themselves carry a "personal, non-commercial use" line; no commercial licence exists. Likely outcome is blocking or format change, not a lawsuit | Medium | Keep attribution and outbound links, keep the adapter seam. Apply for the Google Trends API alpha now (free). Have a fallback ready (GDELT, SerpApi) |
| Google News link decoder | Uses an unofficial endpoint, will probably break | Low to medium | Treat Read as best effort |
| Article reader | Fetches third-party pages on request and shows full text; no robots.txt check found | Medium | Show a short excerpt plus link, or check robots.txt |
| Template and art rights | The 10 art patterns are byte-for-byte copies from the CarouselClick app. Rights rest on your confirmation dated 2026-10-28, written in a doc, with no contract | Medium to high | Get a short written confirmation from the owner of CarouselClick (Sanjay) |
| Fonts | 52 OFL and Apache fonts; licence texts must travel with redistributed files. The personal-use "Logo Lab" fonts are correctly NOT shipped | Low | Confirm the font licence file is served or bundled with exports |
| Nominatim | Public instance allows 1 request a second, needs identifying user agent and OSM credit | Low | Add real contact to `DISCOVER_GEOCODER_USER_AGENT` |
| Attributions | Wikipedia and `date-holidays` (CC BY-SA), DB-IP (CC BY 4.0), YouTube branding rules | Low | Check the credits are visible in the app |
| Privacy law | Collecting emails and storing channel tokens means GDPR/DPDP-style duties: privacy policy, delete-account, data export | Medium | Privacy page now; delete-my-data flow later |
| Platform terms | Each platform bans some automation patterns (X automation rules, Meta data use) | Medium | Read each platform's developer policy before app review |
| React Flow credit | The workflow canvas shows the library's credit | Low | Fine for the free version; do not hide it |
| Postiz | Reference only; it is AGPL. Never copy its code | Keep | Already your rule |

---

## 9. Documents That Lie (Fix Or Ignore) 📚

| Document | What it says | What the code does |
|---|---|---|
| Sprint 2 checklist | Social login is Google and GitHub | Google and Facebook (GitHub env values are dead) |
| Sprint 2 known gap 2 | Invite for unregistered email is a stub | Signed single-use invites are built |
| Sprint 5 known gap 3 | Recurring posts not built | Built (2026-10-19) |
| Sprint 4 known gap 7 | Tags and signatures not built | Built |
| Sprint 7 known gap 6 | No PDF export | Client-side PDF exists |
| Sprint 10 checklist | Modules 10 to 14 uncommitted | Committed |
| Sprint 11 checklist | Silent about the 88 uncommitted Module 10 entries | Backend built, no UI, no tests |
| `.env.example` | Docker `geocoder` profile for Nominatim | Does not exist |
| `.env.example` | `NEXTAUTH_*` variables | Nothing reads them |

---

## 10. Hosting On Railway (Or Something Cheaper) ☁️

### 10.1 Services You Need

| Service | Notes |
|---|---|
| web (Next.js) | `next start`, build args for `NEXT_PUBLIC_*` |
| api (NestJS) | Needs 1 GB or more of memory if Chromium is on. Health check path `/health` |
| worker | No port. Single replica for now |
| Postgres | Railway plugin. Temporal needs two extra databases in it |
| Redis | Railway plugin |
| Temporal | Self-hosted container, private network only |
| Object storage | Cloudflare R2 (free tier, no egress fees), public bucket or custom domain |

### 10.2 Rough Monthly Cost (verify current Railway pricing before committing)

Railway bills by usage. Six small always-on services usually land somewhere around **20 to 50 USD a month** for a light demo, plus nearly free R2 and free tiers for Sentry and email. If cost matters more than convenience, the same stack runs on one 8 GB VPS (Hetzner or similar, about 10 to 15 USD) with Docker Compose, at the price of managing it yourself. For a 3 to 4 day POC, **Railway is the right choice** because it saves ops time.

### 10.3 Railway Gotchas For This Codebase

1. Fix P0-1 (bundling) first, or no service will start.
2. `NEXT_PUBLIC_API_URL` is baked at build time. Changing it needs a rebuild.
3. `trust proxy` is set to 1, which matches Railway's single proxy hop. Check it after deploy: if login throttle sees one IP for everyone, the hop count is wrong.
4. CORS accepts exactly one origin (`WEB_URL`), so preview URLs will fail.
5. Never run `db:seed` on production; build a clean demo workspace.
6. Register production OAuth redirect URIs on each platform: `<API_URL>/channels/connect/<provider>/callback`.
7. Stripe webhook endpoint: `<API_URL>/billing/webhook`.
8. The `dotenv -e ../../.env` wrapper in `packages/db` scripts breaks when no `.env` file exists. Call Prisma directly in the pre-deploy command.
9. Keep `ENCRYPTION_KEY_AES256` safe forever. Lose it and every connected channel is dead.

---

## 11. Suggested Cut Line For The 3 To 4 Day Proof Of Concept ✂️

This is a preview only. The proper plan is the next document we write together.

**Must do (the demo cannot happen without these):**
1. P0-1 bundling fix, P0-2 Dockerfiles and deploy, P0-3 cookie domain
2. Real keys: OpenAI, Stripe test mode, SMTP, R2, fresh secrets
3. Landing, Pricing, Terms, Privacy (P0-5)
4. Real publish to LinkedIn and X, and ideally Facebook and Instagram in dev mode
5. P1-3 production env checks, P1-6 clean demo workspace
6. Merge branches to `master`, fix the 4 failing image tests

**Should do if time allows:** P1-4 trial limits, P1-5 wording fixes, Sentry, backups, route error boundaries.

**Do not touch before the demo:** Module 10 Discover work (park it), TikTok, Pinterest, Temporal Cloud, admin module, Sprint 10b polish, performance work.

**Honest risk:** the biggest schedule risk is P0-1 plus Dockerfiles. If the bundling takes longer than a day, everything slides. Do that first, and do the 10 minute check (does `node dist/...` actually fail?) before anything else.

---

## 11b. Update After Your Answers (2026-11-12) 🔄

- Sanjay's rights confirmation closes the template-rights risk in section 8 (keep his message somewhere safe).
- Staging is the investor demo and production stays untouched. The full plan is in [02 Plan](02-four-day-staging-plan.md), env setup in [03](03-env-setup-guide.md), security in [04](04-security-review.md), hosting in [05](05-hosting-and-costs.md).
- Correction: Railway Pro is $20 per month, Hobby is $5. See doc 05.
- The security review found 3 High and 7 Medium issues that were not in this document. They are in doc 04.
- The questions below were answered; they stay for the record.

---

## 12. Questions I Needed You To Answer (Now Answered) ❓

1. **Which social platforms must be live in the demo?** My suggestion: LinkedIn, X, Facebook, Instagram.
2. **Is it OK to use Stripe test mode for the investor demo** (real checkout flow, fake card, no money)? My suggestion: yes.
3. **Can you get written confirmation from Sanjay** about the CarouselClick art?
4. **Real plan prices:** keep the placeholders (29, 49, 99, 199) for the pitch, or change them?
5. **Which domain layout:** web on `postgear.rkay.in`, API on `api.postgear.rkay.in`? (Needed for the cookie fix.)
6. **Do you have accounts ready** for Railway, Cloudflare (R2), an email provider (Resend or Brevo) and OpenAI billing?
7. **Park the uncommitted Discover Module 10 work** on its own branch? My suggestion: yes.
8. **Should Discover go into the demo at all,** given the Google feed risk and the Read feature issue? My suggestion: show the Trends and News tabs only, and hide Read.

---

## 13. Things I Could Not Verify 🔎

- Whether `node dist/apps/api/src/main.js` really fails (strong suspicion, not run)
- That any listed test passes today (only the Discover engine tests were run: 178 of 179 pass)
- Whether the LinkedIn credentials are valid
- Worker-side production refusal of `WEBHOOK_ALLOW_PRIVATE_URLS`
- Skip conditions on some e2e and browser tests
- Git history for leaked secrets (`.env` itself is ignored and not tracked)
- The actual bundle sizes (nobody ran `next build` in this audit)

---

*End of document. Next step: when you are happy with this, we write the 3 to 4 day plan.* 🚀
