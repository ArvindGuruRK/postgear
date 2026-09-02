import { defineConfig, devices } from '@playwright/test';

// Next refuses to boot a second dev server, so this targets the standard dev
// port and reuses whatever is already running there.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Visual/interaction checks for the design system playground.
 *
 * `webServer` starts its own dev server on a dedicated port so a run never
 * collides with (or silently tests) whatever is already on :3000.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
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
    // `/` is a 404 in this app, which Playwright reads as "nothing running"
    // and then tries to start a duplicate server — probe a real route.
    url: `${BASE_URL}/dev/components`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
