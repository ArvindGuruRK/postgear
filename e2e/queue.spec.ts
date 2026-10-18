import { expect, type Page, test } from '@playwright/test';
import { cleanUp } from './helpers/media';

/**
 * The queue: every post in publish order, with how each one went.
 *
 * Uses the seeded demo posts for the read-only checks and creates its own for
 * the ones that change state. "Post now" is asserted up to what the API
 * records (the post moves to the current minute and stays queued for the
 * worker), because whether a worker is running is the deployment's business,
 * not this suite's (the completion checklist covers the publish itself).
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

async function createQueued(page: Page, text: string, publishAt: Date): Promise<string> {
  const response = await page.request.post(`${API_URL}/posts`, {
    data: {
      state: 'QUEUE',
      publishDate: publishAt.toISOString(),
      shared: [
        {
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
          media: [],
        },
      ],
      channels: [{ channelId: 'seed-channel-linkedin', customized: false }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const { post } = (await response.json()) as { post: { group: string } };
  return post.group;
}

const created = { groups: [] as string[], mediaNames: [] as string[] };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await cleanUp(page.request, created);
  await page.close();
});

test.describe('queue', () => {
  test('lists the seeded posts in order and filters by state', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/queue`);

    // The page is named only by the top bar's h1 (no in-page title).
    await expect(page.getByRole('heading', { level: 1, name: 'Queue' })).toBeVisible();
    const rows = page.getByTestId('queue-row');
    await expect(rows.first()).toBeVisible();

    // Soonest first: the failed post from two days ago leads, the draft next week closes.
    await expect(rows.first()).toHaveAttribute('data-tone', 'failed');
    await expect(rows.first()).toContainText('Channel needs reconnecting');

    await page.getByRole('tab', { name: 'Failed' }).click();
    await expect(page).toHaveURL(/state=ERROR/);
    // Only failed posts, the seeded one among them. Not an exact count: the
    // "Post now" test runs alongside this one, and a worker may fail its post
    // while this tab is open.
    const failed = page.getByTestId('queue-row');
    await expect(failed.filter({ hasText: 'Channel needs reconnecting' })).toHaveCount(1);
    for (const row of await failed.all()) {
      await expect(row).toHaveAttribute('data-tone', 'failed');
    }

    await page.getByRole('tab', { name: 'Published' }).click();
    await expect(page.getByTestId('queue-row').first()).toHaveAttribute('data-tone', 'published');
    await expect(
      page.getByRole('link', { name: 'View the published post' }).first(),
    ).toHaveAttribute('href', /linkedin\.com/);

    await page.getByRole('tab', { name: 'Drafts' }).click();
    await expect(page.getByTestId('queue-row').first()).toHaveAttribute('data-tone', 'draft');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/state=/);
  });

  test('"Post now" moves a queued post to the current minute, still queued for the worker', async ({
    page,
  }) => {
    await signIn(page);
    const later = new Date();
    later.setDate(later.getDate() + 10);
    later.setHours(9, 0, 0, 0);
    const group = await createQueued(page, `E2E post now ${Date.now()}`, later);
    created.groups.push(group);

    await page.goto(`/${DEMO_ORG}/queue?state=QUEUE`);

    const row = page.locator(`[data-testid="queue-row"][data-group="${group}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Post now' }).click();

    // `.first()`: the toast briefly repeats its text in a hidden live region for
    // screen readers, so the title can match twice for a moment.
    await expect(page.getByText('Publishing now', { exact: true }).first()).toBeVisible();

    const response = await page.request.get(`${API_URL}/posts/${group}`);
    const { post } = (await response.json()) as { post: { publishDate: string; state: string } };
    expect(['QUEUE', 'PUBLISHED', 'ERROR']).toContain(post.state);
    expect(Math.abs(new Date(post.publishDate).getTime() - Date.now())).toBeLessThan(60_000);
  });

  test('deleting from the queue removes the post for every channel', async ({ page }) => {
    await signIn(page);
    const later = new Date();
    later.setDate(later.getDate() + 11);
    later.setHours(9, 0, 0, 0);
    const group = await createQueued(page, `E2E delete me ${Date.now()}`, later);

    await page.goto(`/${DEMO_ORG}/queue?state=QUEUE`);

    const row = page.locator(`[data-testid="queue-row"][data-group="${group}"]`);
    await row.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText('Post deleted').first()).toBeVisible();
    await expect(row).toHaveCount(0);
    expect((await page.request.get(`${API_URL}/posts/${group}`)).status()).toBe(404);
  });
});
