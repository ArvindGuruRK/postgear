import { defineConfig, devices } from '@playwright/test';

// Next refuses to boot a second dev server, so this targets the standard dev
// port and reuses whatever is already running there.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Visual/interaction checks for the design system playground, plus Sprint 2's
 * authentication and onboarding journeys.
 *
 * `webServer` starts its own dev server on a dedicated port so a run never
 * collides with (or silently tests) whatever is already on :3000.
 *
 * It starts **only the Next app**. The API on :3001 and a seeded database are
 * prerequisites the runner does not manage:
 *
 *     docker compose up -d
 *     npm run db:seed
 *     npm run dev:api:e2e      # in its own terminal
 *     npm run test:e2e
 *
 * Note `dev:api:e2e` rather than `dev:api`. The suite signs in roughly a dozen
 * times a minute from a single address, which is over the production login
 * throttle of 10/IP/minute — so with the normal limits the last few tests get
 * a 429 and fail for a reason that has nothing to do with what they assert.
 * The e2e script raises `LOGIN_RATE_LIMIT_PER_MIN` and `LOCKOUT_THRESHOLD`,
 * which is what those env vars exist for. The throttle and lockout themselves
 * are verified directly against the API — see the Sprint 2 completion
 * checklist, section 8.
 *
 * Left unmanaged on purpose — Playwright's `webServer` would kill the API
 * between runs, and the API holds a Postgres pool and a Redis connection that
 * are slow to cycle. A missing API shows up as an unexpected redirect to
 * /login rather than a crash, since `getSession()` treats an unreachable API
 * as "not signed in".
 *
 * The suite is run through `dotenv -e .env` (see the root `test:e2e` script)
 * because `e2e/helpers/users.ts` talks to Postgres directly and needs
 * DATABASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  // Capped deliberately. Playwright defaults to one worker per core (11 here),
  // and the Sprint 2 specs each drive a real sign-in against a single
  // ts-node-dev API process and one Postgres connection pool. At full width
  // that is synthetic load rather than signal: `getSession()` treats a
  // timed-out /auth/me as "not signed in" and redirects to /login, so
  // contention surfaces as a flaky assertion about the wrong thing entirely.
  // Four workers keeps the suite fast and the failures meaningful.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run dev --workspace=@postgear/web -- --port ${PORT}`,
    // Probe a terminal route rather than `/`: `/` is a redirect to /login
    // (see apps/web/src/app/page.tsx), and a readiness probe that has to
    // follow a redirect is a slower, flakier signal than one that doesn't.
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
