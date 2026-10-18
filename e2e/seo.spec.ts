import { expect, type Page, test } from '@playwright/test';

/**
 * The SEO analyzer: one test per Sprint 7 Part B Definition of Done item
 * the web owns: a private or internal address is refused on the field before
 * any stage starts (SSRF fails closed, both the `localhost` and the cloud
 * metadata flavours), a real public URL runs every stage to a score with a
 * grade, four categories and prioritised fixes, a second run of the same URL
 * shows the comparison and a trend, and the seeded history renders on first
 * load.
 *
 * Runs against the API with `AI_SIMULATION=true`: the crawl of
 * `https://example.com/` is real and free, the advice model is the
 * deterministic stand-in, credits and the stream are real. The crawl needs
 * the network; set `SEO_E2E_OFFLINE=true` to skip the one test that does.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed` (which seeds three `example.com` audits, graded F, C and B, and
 * one failed `nonexistent.invalid` audit for the demo workspace), and
 * `npm run dev:api:e2e` in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
/** A real crawl plus simulated advice takes a few seconds; a slow network, more. */
const ANALYSIS_TIMEOUT = 90_000;
const OFFLINE = process.env.SEO_E2E_OFFLINE === 'true';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

async function openAnalyzer(page: Page, query = '') {
  await page.goto(`/${DEMO_ORG}/seo-analyzer${query}`);
  // The page is named only by the top bar's h1 (no in-page title).
  await expect(page.getByRole('heading', { level: 1, name: 'SEO Analyzer' })).toBeVisible();
}

const stage = (page: Page, id: string) =>
  page.locator(`[data-testid="ai-stage"][data-stage="${id}"]`);

/** Submits a URL and asserts it was refused on the field with no stage started. */
async function expectRefusedOnField(page: Page, url: string) {
  await page.getByTestId('seo-url').fill(url);
  await page.getByTestId('seo-analyze').click();

  const error = page.getByTestId('seo-form-error');
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(error).toContainText(/private|internal/i);

  // Refused before the stream: no tracker, so no stage ever became active.
  await expect(page.locator('[data-testid="ai-stage"][data-status="active"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ai-stage"][data-status="done"]')).toHaveCount(0);
  await expect(page.getByTestId('seo-url')).toHaveAttribute('aria-invalid', 'true');
}

test.describe('seo analyzer', () => {
  test('refuses a localhost address on the field before any stage starts', async ({ page }) => {
    await signIn(page);
    await openAnalyzer(page);
    await expectRefusedOnField(page, 'http://localhost:3000');
  });

  test('refuses the cloud metadata address the same way', async ({ page }) => {
    await signIn(page);
    await openAnalyzer(page);
    await expectRefusedOnField(page, 'http://169.254.169.254/latest/meta-data');
  });

  test('analyzes a public URL to a graded score, then shows the trend on a second run', async ({
    page,
  }) => {
    test.skip(OFFLINE, 'SEO_E2E_OFFLINE=true: the crawl of example.com needs the network');
    test.setTimeout(ANALYSIS_TIMEOUT * 2 + 60_000);

    await signIn(page);
    await openAnalyzer(page);

    await page.getByTestId('seo-url').fill('https://example.com/');
    await page.getByTestId('seo-analyze').click();

    // The tracker follows the stream: every stage reaches done (or, for
    // advice, skipped when AI is off), then the run is done.
    for (const id of ['validate', 'crawl', 'score']) {
      await expect(stage(page, id)).toHaveAttribute('data-status', 'done', {
        timeout: ANALYSIS_TIMEOUT,
      });
    }
    await expect(stage(page, 'advise')).toHaveAttribute('data-status', /^(done|skipped)$/, {
      timeout: ANALYSIS_TIMEOUT,
    });
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({
      timeout: ANALYSIS_TIMEOUT,
    });

    // A score 0–100 with a grade, and the four categories each scored.
    const gauge = page.getByTestId('seo-score');
    await expect(gauge).toHaveAttribute('data-score', /^\d{1,3}$/);
    const score = Number(await gauge.getAttribute('data-score'));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    await expect(gauge).toHaveAttribute('data-grade', /^[ABCDF]$/);

    const categories = page.getByTestId('seo-category');
    await expect(categories).toHaveCount(4);
    for (const id of ['onPage', 'technical', 'content', 'backlink']) {
      await expect(
        page.locator(`[data-testid="seo-category"][data-category="${id}"]`),
      ).toHaveAttribute('data-score', /^\d{1,3}$/);
    }

    // Prioritised fixes: at least one recommendation with a severity.
    const recommendations = page.getByTestId('seo-recommendation');
    await expect(recommendations.first()).toBeVisible();
    await expect(recommendations.first()).toHaveAttribute(
      'data-severity',
      /^(critical|warning|info)$/,
    );

    // The history gained (or kept) a row for the site, selected and graded.
    const row = page.locator('[data-testid="seo-history-row"][data-url*="example.com"]');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-grade', /^[ABCDF]$/);
    await expect(page).toHaveURL(/audit=/);

    // A second run of the same URL compares with the last and draws a trend.
    await page.getByRole('button', { name: 'Analyze again' }).click();
    await expect(page.getByRole('heading', { name: 'Analyzing…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({
      timeout: ANALYSIS_TIMEOUT,
    });

    const delta = page.getByTestId('seo-delta');
    await expect(delta).toBeVisible();
    await expect(delta).toContainText('vs last run');
    await expect(delta).toHaveAttribute('data-direction', /^(up|down|same)$/);

    const trend = page.getByTestId('seo-trend');
    await expect(trend).toBeVisible();
    const points = Number(await trend.getAttribute('data-points'));
    expect(points).toBeGreaterThanOrEqual(2);
    await expect(
      trend.getByRole('img', { name: /Score over time for example\.com/ }),
    ).toBeVisible();
  });

  test('renders the seeded history with its trend on first load', async ({ page }) => {
    await signIn(page);
    await openAnalyzer(page);

    // example.com: three seeded runs, F → C → B, as one row with the latest
    // grade. The live-crawl test above may have added runs in parallel, so
    // the assertions are "at least the seed", not "exactly the seed".
    const row = page.locator('[data-testid="seo-history-row"][data-url*="example.com"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-grade', /^[ABCDF]$/);
    await expect(row).toContainText(/\d+ runs/);

    // The failed audit shows its reason under a danger badge.
    const failed = page.locator('[data-testid="seo-history-row"][data-url*="nonexistent.invalid"]');
    await expect(failed).toBeVisible();
    await expect(failed).toHaveAttribute('data-status', 'failed');
    await expect(failed.getByText('Failed', { exact: true })).toBeVisible();

    // The latest site's trend is drawn before anything is selected: the three
    // seeded scores at least.
    const trend = page.getByTestId('seo-trend');
    await expect(trend).toBeVisible();
    expect(Number(await trend.getAttribute('data-points'))).toBeGreaterThanOrEqual(3);

    // Clicking the row loads its latest audit into the result area and the
    // URL, with the comparison against the run before it.
    await row.getByRole('button', { name: /Open the latest audit/ }).click();
    await expect(page.getByTestId('seo-score')).toHaveAttribute('data-grade', /^[ABCDF]$/, {
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/audit=/);
    await expect(page.getByTestId('seo-delta')).toContainText('vs last run');

    // The page fits a phone: nothing scrolls sideways. The app shell scrolls
    // its `main`, not the document, so that is the element to measure.
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.getByRole('main').evaluate((main) => ({
      scrollWidth: main.scrollWidth,
      clientWidth: main.clientWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });
});
