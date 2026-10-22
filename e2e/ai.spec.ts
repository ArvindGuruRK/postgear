import { expect, type Page, test } from '@playwright/test';
import { cleanUp } from './helpers/media';

/**
 * The AI studio: one test per Sprint 6 Definition of Done item the web owns:
 * a topic becomes a post through the staged pipeline and lands in the
 * composer as a draft, the copilot answers "what channels do I have" with its
 * list-channels tool, and every generation moves the credits meter.
 *
 * Runs against the API in simulation mode (`AI_SIMULATION=true`): the model,
 * research and image calls are deterministic stand-ins, while credits, the
 * stream and the tool calls are real. Generation streams over several
 * seconds, so the assertions that wait for it carry generous timeouts.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` (with `AI_SIMULATION=true` in
 * `.env`) in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
/** A generation in simulation mode takes a few seconds; a slow machine, more. */
const GENERATION_TIMEOUT = 90_000;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
}

async function openStudio(page: Page, query = '') {
  await page.goto(`/${DEMO_ORG}/ai-copilot${query}`);
  // The page is named only by the top bar's h1 (no in-page title).
  await expect(page.getByRole('heading', { level: 1, name: 'AI Copilot' })).toBeVisible();
}

/** The meter's `used` once the balance has loaded. */
async function creditsUsed(page: Page): Promise<number> {
  const meter = page.getByTestId('credits-meter');
  await expect(meter).toHaveAttribute('data-used', /^\d+$/, { timeout: 20_000 });
  return Number(await meter.getAttribute('data-used'));
}

const created = { groups: [] as string[], mediaNames: [] as string[] };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await cleanUp(page.request, created);
  await page.close();
});

test.describe('ai studio', () => {
  test('generates a short post for LinkedIn, charges credits, and opens it in the composer', async ({
    page,
  }) => {
    await signIn(page);
    await openStudio(page);
    const usedBefore = await creditsUsed(page);

    const topic = `E2E launch note ${Date.now()}`;
    await page.getByLabel(/^Topic/).fill(topic);

    // The picker is the composer's: a pressed button per channel.
    const linkedIn = page
      .getByRole('group', { name: 'Channels' })
      .getByRole('button', { name: /Acme Marketing/ });
    if ((await linkedIn.getAttribute('aria-pressed')) !== 'true') {
      await linkedIn.click();
    }
    await expect(page.getByText(/Fits LinkedIn's/)).toBeVisible();

    await page.getByRole('button', { name: /^Generate \(\d+ Credits\)$/ }).click();

    // The tracker follows the stream: writing finishes, then the run is done.
    const stage = (id: string) => page.locator(`[data-testid="ai-stage"][data-stage="${id}"]`);
    await expect(stage('hook')).toHaveAttribute('data-status', 'done', {
      timeout: GENERATION_TIMEOUT,
    });
    await expect(stage('content')).toHaveAttribute('data-status', 'done', {
      timeout: GENERATION_TIMEOUT,
    });
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({
      timeout: GENERATION_TIMEOUT,
    });

    const part = page.getByTestId('ai-result-part').first();
    await expect(part).toBeVisible();
    const text = (await part.locator('p').innerText()).trim();
    expect(text.length).toBeGreaterThan(0);

    // A short post was charged: the meter moved by the post price, no image.
    await expect
      .poll(() => creditsUsed(page), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(usedBefore + 5);

    await page.getByRole('button', { name: 'Open in composer' }).click();
    await expect(page).toHaveURL(/\/composer\?group=/, { timeout: 20_000 });
    const group = new URL(page.url()).searchParams.get('group') ?? '';
    expect(group).not.toBe('');
    created.groups.push(group);

    // The draft opens with the generated text as part 1, for the channel chosen.
    // Edit mode: only an existing post offers a fresh "New post" link.
    await expect(
      page.getByRole('dialog', { name: 'Edit Post' }).getByRole('link', { name: 'New post' }),
    ).toBeVisible();
    const firstLine = text.split('\n')[0].slice(0, 40);
    await expect(page.getByRole('textbox', { name: 'Part 1 of the shared post' })).toContainText(
      firstLine,
      { timeout: 20_000 },
    );
    await expect(
      page.getByRole('group', { name: 'Channels' }).getByRole('button', { name: /Acme Marketing/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the copilot answers "what channels do I have" through its list-channels tool', async ({
    page,
  }) => {
    await signIn(page);
    await openStudio(page);

    // The mode is a URL-synced tab.
    await page.getByRole('tab', { name: 'Copilot' }).click();
    await expect(page).toHaveURL(/mode=copilot/);

    // Enter sends; the suggestion chips are the same question.
    await page.getByLabel('Message').fill('What channels do I have connected?');
    await page.keyboard.press('Enter');

    const asked = page.locator('[data-testid="copilot-message"][data-role="user"]');
    await expect(asked).toHaveCount(1);
    await expect(asked).toContainText('What channels do I have connected?');

    const tool = page.locator('[data-testid="copilot-tool"][data-tool="list_channels"]');
    await expect(tool).toHaveAttribute('data-status', 'ok', { timeout: GENERATION_TIMEOUT });

    const reply = page.locator('[data-testid="copilot-message"][data-role="assistant"]').last();
    await expect(reply).toContainText('Acme Marketing', { timeout: GENERATION_TIMEOUT });

    // The conversation survives a reload within the tab, and Clear ends it.
    await page.reload();
    await expect(
      page.locator('[data-testid="copilot-message"][data-role="assistant"]').last(),
    ).toContainText('Acme Marketing', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Clear conversation' }).click();
    await expect(page.getByTestId('copilot-message')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'What channels do I have connected?' }),
    ).toBeVisible();
  });
});
