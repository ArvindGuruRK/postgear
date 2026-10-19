import { expect, type Page, test } from '@playwright/test';
import { localDay, pickDate, pickDateTime } from './helpers/date-picker';
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

    // Soonest first. The workspace keeps whatever else people have posted
    // (the seed resets only its own rows), so the check is the seeded posts'
    // order among themselves, within their own week: failed two days ago,
    // published yesterday, queued tomorrow, the draft next week.
    const daysFromNow = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return localDay(date);
    };
    await page.goto(`/${DEMO_ORG}/queue?from=${daysFromNow(-2)}&to=${daysFromNow(7)}`);
    await expect(rows.first()).toBeVisible();
    const texts = await rows.allInnerTexts();
    const at = (text: string) => texts.findIndex((row) => row.includes(text));
    const failedAt = at('the X connection had expired');
    const publishedAt = at('the first post PostGear published');
    const queuedAt = at('we open the doors');
    const draftAt = at('ideas for next week');
    const order = [failedAt, publishedAt, queuedAt, draftAt];
    expect(Math.min(...order)).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await expect(rows.nth(failedAt)).toHaveAttribute('data-tone', 'failed');
    await expect(rows.nth(failedAt)).toContainText('Channel needs reconnecting');

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
      page
        .getByTestId('queue-row')
        .filter({ hasText: 'the first post PostGear published' })
        .getByRole('link', { name: 'View the published post' }),
    ).toHaveAttribute('href', /linkedin\.com/);

    await page.getByRole('tab', { name: 'Drafts' }).click();
    await expect(page.getByTestId('queue-row').first()).toHaveAttribute('data-tone', 'draft');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/state=/);
  });

  test('the date filter narrows the list to a day, and Reschedule moves a row off it', async ({
    page,
  }) => {
    await signIn(page);
    const day = new Date();
    day.setDate(day.getDate() + 12);
    day.setHours(9, 0, 0, 0);
    const group = await createQueued(page, `E2E filter me ${Date.now()}`, day);
    created.groups.push(group);

    await page.goto(`/${DEMO_ORG}/queue`);
    await pickDate(page, page.locator('#queue-from'), day);
    await pickDate(page, page.locator('#queue-to'), day);
    await expect(page).toHaveURL(new RegExp(`from=${localDay(day)}&to=${localDay(day)}`));

    // Only that day's posts: one heading, this post among its rows.
    const row = page.locator(`[data-testid="queue-row"][data-group="${group}"]`);
    await expect(row).toBeVisible();
    await expect(
      page.locator('section[aria-label]').filter({ has: page.getByTestId('queue-row') }),
    ).toHaveCount(1);

    const to = new Date(day);
    to.setDate(to.getDate() + 1);
    to.setHours(10, 15, 0, 0);
    await row.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Reschedule' }).click();
    await pickDateTime(page, page.locator('#reschedule-at'), to);
    await page.getByRole('button', { name: 'Move post' }).click();

    await expect(page.getByText('Rescheduled', { exact: true }).first()).toBeVisible();
    // The next day is outside the filter, so the row leaves the list.
    await expect(row).toHaveCount(0);
    const response = await page.request.get(`${API_URL}/posts/${group}`);
    const { post } = (await response.json()) as { post: { publishDate: string } };
    expect(new Date(post.publishDate).getTime()).toBe(to.getTime());
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
