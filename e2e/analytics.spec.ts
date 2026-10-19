import { expect, type Page, test } from '@playwright/test';

/**
 * The analytics dashboard: what the seed makes checkable without a platform:
 * the totals render as numbers, the range lives in the URL, every channel is
 * compared with its standing (LinkedIn synced, X needing a reconnect), the
 * top post opens its own numbers against the channel's average, and "Sync
 * now" reports what it did.
 *
 * Runs against the API in simulation mode (`ANALYTICS_SIMULATION=true`),
 * with `npm run db:seed` having given the LinkedIn and Instagram channels
 * ninety days of metrics. Whether a worker is running is the deployment's
 * business: the sync test accepts either outcome the API can report, since
 * both are a toast and both are correct.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
}

async function openAnalytics(page: Page, query = '') {
  await page.goto(`/${DEMO_ORG}/analytics${query}`);
  // The page is named only by the top bar's h1 (no in-page title).
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
}

const STATS = ['followers', 'impressions', 'engagements', 'engagementRate'] as const;

test.describe('analytics', () => {
  test('shows the totals, keeps the range in the URL, and compares every channel', async ({
    page,
  }) => {
    await signIn(page);
    await openAnalytics(page);

    // Four stat cards, each with a number (the numbers are formatted after
    // hydration, hence the wait on the first one).
    for (const metric of STATS) {
      const stat = page.locator(`[data-testid="analytics-stat"][data-metric="${metric}"]`);
      await expect(stat).toBeVisible({ timeout: 20_000 });
      await expect(stat).toContainText(/\d/);
    }

    await page.getByRole('tab', { name: '7 days' }).click();
    await expect(page).toHaveURL(/range=7/);
    await expect(page.getByRole('tab', { name: '7 days' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The comparison table: LinkedIn has synced; X cannot until it is reconnected.
    const linkedIn = page.locator(
      '[data-testid="analytics-channel-row"][data-channel="seed-channel-linkedin"]',
    );
    await expect(linkedIn).toBeVisible();
    await expect(linkedIn).toContainText('Acme Marketing');
    await expect(linkedIn).toContainText(/Synced/);

    const x = page.locator('[data-testid="analytics-channel-row"][data-channel="seed-channel-x"]');
    await expect(x).toContainText('Acme on X');
    await expect(x).toContainText('Needs reconnect');

    // Metrics are the simulated stand-in locally, and the page says so.
    await expect(page.getByTestId('analytics-simulated')).toContainText('ANALYTICS_SIMULATION');
  });

  test('opens the top post with its numbers against the channel average', async ({ page }) => {
    await signIn(page);
    await openAnalytics(page, '?range=90');

    const top = page.locator('[data-testid="analytics-top-post"][data-rank="1"]');
    await expect(top).toBeVisible({ timeout: 20_000 });
    await expect(top).toContainText('Acme Marketing');
    await top.getByRole('button', { name: /Open metrics for post 1/ }).click();

    const dialog = page.getByTestId('post-analytics');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-state-kind', 'ready', { timeout: 20_000 });
    await expect(dialog).toContainText('Impressions');
    await expect(dialog).toContainText('vs avg');
    await expect(dialog).toContainText(/Last updated/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('"Sync now" reports whether a sync was queued', async ({ page }) => {
    await signIn(page);
    await openAnalytics(page);

    await expect(page.getByTestId('analytics-sync-status')).toHaveAttribute(
      'data-status',
      /online|away|busy/,
      { timeout: 20_000 },
    );

    // `exact`: the status pill's own label mentions "Sync now" when nothing has synced yet.
    const sync = page.getByRole('button', { name: 'Sync now', exact: true });
    await expect(sync).toBeEnabled();
    await sync.click();

    // Either the scheduler took it or it is unreachable; both are a toast.
    // `.first()`: the toast repeats its text in a hidden live region for
    // screen readers, so the title can match twice for a moment.
    await expect(page.getByText(/^Sync (requested for|not requested)/).first()).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the page never scrolls sideways; only the table does', async ({ page }) => {
      await signIn(page);
      await openAnalytics(page);
      await expect(
        page.locator('[data-testid="analytics-stat"][data-metric="followers"]'),
      ).toContainText(/\d/, { timeout: 20_000 });

      // The shell scrolls inside `main`, so a sideways overflow would show
      // there rather than on the document; check both.
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
          main: main ? [main.scrollWidth, main.clientWidth] : [0, 0],
        };
      });
      expect(overflow.page[0]).toBe(overflow.page[1]);
      expect(overflow.main[0]).toBe(overflow.main[1]);
    });
  });
});
