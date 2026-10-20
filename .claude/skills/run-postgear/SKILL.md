---
name: run-postgear
description: Start, run, launch, open or screenshot the PostGear app locally (Docker services, API, worker, web), sign in with the seeded accounts, use the simulation flags, and run the Playwright e2e suite or one spec. Use for "run the app", "start PostGear", "open the dashboard", "take a screenshot", "run e2e", "why won't it start".
---

# Run PostGear locally

Background: `CLAUDE.md` (architecture, commands) and `docs/local-testing-guide.md` (the full manual walk-through, section numbers below refer to it). The machine is Windows: prefer the PowerShell tool for `npm`/`docker`, and start every long-lived server with `run_in_background`, never in the foreground.

## 1. Check what is already running

Before starting anything, probe, because the user often has `npm run dev` open already:

```powershell
docker ps --format "{{.Names}}: {{.Status}}"
curl.exe -s http://localhost:3001/health      # API: {"status":"ok","checks":{"database":"ok"},...}
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/login   # web: 200
```

If the API answers, do not start a second one (Next and ts-node-dev both refuse a busy port). Reuse what is there.

## 2. Docker services

Docker Desktop must be open with the engine running (the cheat-sheet's first symptom is `docker compose up` failing because it is not). `npm run dev` runs `docker compose up -d` itself (the root `predev` script). Containers from `docker-compose.yml`:

| Container | Port(s) | What |
|---|---|---|
| `postgear_postgres` | 5432 | Postgres 15, database `postgear_db` (user/password `postgres`) |
| `postgear_redis` | 6379 | Redis 7 |
| `postgear_minio` | 9000, console 9001 | S3 store (only used when `STORAGE_PROVIDER="s3"`; default is `local`) |
| `postgear_temporal` | 7233 | Temporal server, waits for Postgres to be healthy |
| `postgear_temporal_ui` | 8233 | Temporal web UI: every scheduled post is a workflow there |

## 3. Start the app

**Everything at once** (what the user normally runs): `npm run dev`. Turbo starts the API (:3001), the worker and the web app (:3000) with prefixed logs.

**One process each** (to restart only one piece):

| Piece | Command | Ready when |
|---|---|---|
| API | `npm run dev:api` | logs `API listening on http://localhost:3001`; any bad `.env` variable is named here |
| Worker | `npm run dev:worker` | logs `[worker] polling "postgear-publishing" on localhost:7233 ...` and warns when simulation is on |
| Web | `npm run dev --workspace=@postgear/web` | `/login` answers 200 |

Without a worker nothing publishes, and the Calendar and Queue pages say "No worker running". The API and worker read `.env` only at start: after editing `.env`, restart them (the worker too for `WEBHOOK_ALLOW_PRIVATE_URLS`).

Useful URLs: web <http://localhost:3000>, API health <http://localhost:3001/health> (public), Swagger for `/v1` at <http://localhost:3001/api/docs>, Temporal UI <http://localhost:8233>, MinIO console <http://localhost:9001>.

## 4. Data and sign-in

- First run, or after `docker compose down -v`: `npm run db:migrate` then `npm run db:seed`. Re-seeding also resets the AI credit ledger and the demo plan.
- Seeded logins (password `DemoPassword123!` for all): `demo@postgear.local` (the main account), `member@postgear.local` (a member role), `onboarding@postgear.local` (not onboarded yet).
- The demo workspace id is `seed-demo-org`, so pages live at `http://localhost:3000/seed-demo-org/<page>`: `home`, `composer`, `calendar`, `queue`, `channels`, `media`, `analytics`, `seo-analyzer`, `ai-copilot`, `settings/...`.
- The three seeded channels (Acme Marketing, Acme on X, Acme Studio) hold fake tokens. Acme on X is seeded broken on purpose (it shows the reconnect state).
- The database may also hold a real LinkedIn channel the user connected. Never run `npm run db:reset` without asking.

## 5. Simulation flags (keep them on)

No paid API is ever called locally. The user's `.env` has these set to `"true"`; all of them are refused when `NODE_ENV=production`:

| Flag | Effect |
|---|---|
| `PUBLISH_SIMULATION` | Worker publishes to a stand-in. Put `[simulate:429]`, `[simulate:429x2]`, `[simulate:401]`, `[simulate:400]` or `[simulate:slow:5]` in post text to force failures |
| `ANALYTICS_SIMULATION` | Unset, so it follows `PUBLISH_SIMULATION`: metrics come from a stand-in |
| `AI_SIMULATION` | Deterministic model, research and images; credits, streaming and tools are real |
| `BILLING_SIMULATION` | Synthetic Stripe events through the real webhook handler |
| `WEBHOOK_ALLOW_PRIVATE_URLS` | Outbound webhooks may target localhost (e.g. `npx -y http-echo-server 4000`) |

With `SMTP_HOST` empty, every email (activation, password reset, invites, failed-post alerts) is printed to the API console instead of sent. Read the API log to get those links.

Only flip a flag to `"false"` when the user asks for a real run (for example a real LinkedIn post).

## 6. Screenshots and driving the browser

Only for bigger UI or flow changes: the user checks small UI tweaks by hand, so do not screenshot those unless asked. When needed, write a small Playwright script in the scratchpad that signs in the way the specs do (`e2e/ai.spec.ts` `signIn`): go to `/login`, fill the `Email` label and `#password`, click the `Sign in` button, wait for a URL ending in `/home`, `/calendar` or `/channels`, then `page.goto('/seed-demo-org/<page>')` and `page.screenshot(...)`. Read the image back to check it, and test phone width (390 px) as well when layout changed.

## 7. The e2e suite

The suite signs in about a dozen times a minute, over the normal login throttle (10 per minute per address), so the API must run in e2e mode:

1. Stop `npm run dev:api` (or `npm run dev`; then run the worker and web on their own).
2. `npm run dev:api:e2e` in the background (same API with `LOGIN_RATE_LIMIT_PER_MIN=500`, `LOCKOUT_THRESHOLD=50`, `RATE_LIMIT_PER_MIN=3000`).
3. The database must be seeded. Then `npm run test:e2e`, or one spec: `npm run test:e2e -- e2e/composer.spec.ts`. `npm run test:e2e:ui` opens the Playwright UI.
4. Afterwards, switch back to `npm run dev:api` so manual testing has the real limits.

Playwright starts only the web app (port 3000, or `PLAYWRIGHT_PORT`) and reuses one already running. `e2e/global-setup.ts` reads `X-RateLimit-Limit` from `/health` and prints a warning box when the API is not in e2e mode. A signed-in test landing on `/login` means the API is not reachable. Known flake: `queue > lists the seeded posts in order` fails once earlier runs have published posts; a reseed fixes it.

## 8. When it will not start

| Symptom | Fix |
|---|---|
| `docker compose up` errors about the engine | Docker Desktop is not running yet |
| Port 5432, 6379 or 9000 in use | Another Postgres, Redis or MinIO is running |
| API exits at boot | Read the first error, it names the `.env` variable. Bad `JWT_SECRET` / `ENCRYPTION_KEY_AES256` (must be 64 hex chars): `npm run generate:keys -- --write` (invalidates stored channel tokens, so ask first) |
| Website loads but sign-in fails | API not running on 3001 |
| Sign-ins fail with 429 in e2e | API started with `dev:api`; use `dev:api:e2e` |
| AI or Billing page says "not configured" | The simulation flag is off and no real key is set; restart the API after editing `.env` |
| Webhook deliveries stay Pending | Worker not running |
| `prisma generate` fails with EPERM on `query_engine-windows.dll.node` | The running dev servers hold the engine open. The JS client is still written: check the new names in `node_modules/.prisma/client/index.js`, delete the leftover `.tmp*` file, touch an API file so ts-node-dev respawns |

## 9. Stopping

Stop servers you started (TaskStop on the background task). `docker compose stop` keeps data; `docker compose down -v` deletes all local data (never without asking).
