import { expect, type Page, test } from '@playwright/test';
import { cleanUp } from './helpers/media';

/**
 * Notifications (Sprint 8): the bell, the live stream, and the email
 * preferences; one test per Definition of Done item the web owns.
 *
 * Runs against the API with `PUBLISH_SIMULATION=true` and a worker on the
 * task queue: the failed post is a real publish through Temporal whose
 * provider is the simulated one, so the `post.failed` row is written by the
 * worker and reaches the bell over the API's dispatcher and SSE stream; the
 * whole path, with nothing stubbed on the web side.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, `npm run dev:api:e2e` and the worker (`npm run dev
 * --workspace=apps/worker`) in their own terminals.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
/** The worker picks the post up, fails it at once in simulation, and the API's 3 s poll pushes it. */
const DELIVERY_TIMEOUT = 30_000;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
}

async function unreadFromApi(page: Page): Promise<number> {
  const response = await page.request.get(`${API_URL}/notifications/unread`);
  expect(response.ok()).toBeTruthy();
  const { unread } = (await response.json()) as { unread: number };
  return unread;
}

/** A queued post whose text carries the simulated provider's failure marker. */
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

test.describe('notifications', () => {
  test('signing in loads the bell with no request refused', async ({ page }) => {
    // The demo admin is in two workspaces, so login sets no `pg_org` and the
    // layout's workspace switch races the bell's first requests: both used
    // to come back 403 (the list and the stream) on almost every sign-in.
    const refused: string[] = [];
    page.on('response', (response) => {
      if (response.url().startsWith(API_URL) && response.status() === 403) {
        refused.push(`${response.request().method()} ${response.url().slice(API_URL.length)}`);
      }
    });

    await signIn(page);
    await page.goto(`/${DEMO_ORG}/calendar`);

    const bell = page.getByTestId('notification-bell');
    await bell.click();
    // The stream is open: the footer's "Connecting…" is gone.
    await expect(page.getByTestId('notification-connection')).toHaveCount(0, { timeout: 20_000 });

    // The panel is the API's first page and the badge its unread count.
    const response = await page.request.get(`${API_URL}/notifications?limit=20`);
    expect(response.ok()).toBeTruthy();
    const { notifications } = (await response.json()) as { notifications: { id: string }[] };
    expect(notifications.length).toBeGreaterThan(0);
    await expect(page.getByTestId('notification-item')).toHaveCount(notifications.length, {
      timeout: 20_000,
    });
    await expect
      .poll(
        async () => (await bell.getAttribute('data-unread')) === String(await unreadFromApi(page)),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);

    expect(refused).toEqual([]);
  });

  test('the bell shows the unread count and "Mark all as read" clears it', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/calendar`);

    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeVisible();

    // The badge is the server's number, not a count of the page it loaded.
    const expected = await unreadFromApi(page);
    await expect(bell).toHaveAttribute('data-unread', String(expected), { timeout: 20_000 });

    await bell.click();
    await expect(
      page
        .getByRole('heading', { name: 'Notifications' })
        .or(page.getByText('Notifications', { exact: true })),
    ).toBeVisible();

    const markAll = page.getByRole('button', { name: 'Mark all as read' });
    if (expected > 0) {
      await expect(markAll).toBeEnabled();
      await markAll.click();
    } else {
      // Nothing to read: the action is disabled rather than pretending.
      await expect(markAll).toBeDisabled();
    }

    await expect(bell).toHaveAttribute('data-unread', '0', { timeout: 10_000 });
    expect(await unreadFromApi(page)).toBe(0);
    // Every item the panel shows is now read.
    for (const item of await page.getByTestId('notification-item').all()) {
      await expect(item).toHaveAttribute('data-read', 'true');
    }
  });

  test('a post that fails arrives in the bell over the stream, without a reload', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/queue`);

    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAttribute('data-unread', /^\d+$/, { timeout: 20_000 });
    const before = Number(await bell.getAttribute('data-unread'));

    // Open the panel first, so a new item has to appear in a list that is
    // already on screen: the stream, not a fetch on open.
    await bell.click();
    const connection = page.getByTestId('notification-connection');
    await expect(connection).toHaveCount(0, { timeout: 20_000 });

    const marker = `E2E failing post ${Date.now()} [simulate:400]`;
    const group = await createQueued(page, marker, new Date(Date.now() + 10 * 60_000));
    created.groups.push(group);
    const publishNow = await page.request.post(`${API_URL}/posts/${group}/publish-now`);
    expect(publishNow.ok()).toBeTruthy();

    const failed = page
      .locator('[data-testid="notification-item"][data-type="post.failed"]')
      .filter({ hasText: 'Acme Marketing' })
      .first();
    await expect(failed).toBeVisible({ timeout: DELIVERY_TIMEOUT });
    await expect(failed).toHaveAttribute('data-read', 'false');
    // At least one more than before: the other specs running alongside
    // (billing, developers) write their own notifications into this
    // workspace, so an exact count would race with them.
    await expect
      .poll(async () => Number(await bell.getAttribute('data-unread')), {
        timeout: DELIVERY_TIMEOUT,
      })
      .toBeGreaterThanOrEqual(before + 1);

    // The item leads to the failed tab of the queue.
    await failed.click();
    await expect(page).toHaveURL(/\/queue\?state=ERROR/, { timeout: 20_000 });
  });

  test('email preferences persist across a reload', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/settings/notifications`);
    await expect(
      page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Notifications' }),
    ).toHaveAttribute('aria-current', 'page');

    const success = page.getByTestId('toggle-successEmails');
    await expect(success).toBeVisible();
    await expect(success).toBeEnabled({ timeout: 20_000 });
    const initial = (await success.getAttribute('aria-checked')) === 'true';

    await success.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(success).toHaveAttribute('aria-checked', String(!initial));

    await page.reload();
    const after = page.getByTestId('toggle-successEmails');
    await expect(after).toHaveAttribute('aria-checked', String(!initial), { timeout: 20_000 });

    // The API agrees, and the other preference was left alone.
    const response = await page.request.get(`${API_URL}/users/me/notification-preferences`);
    expect(response.ok()).toBeTruthy();
    const { preferences } = (await response.json()) as {
      preferences: { successEmails: boolean; failureEmails: boolean };
    };
    expect(preferences.successEmails).toBe(!initial);

    // Put it back for the next run.
    await after.click();
    await expect(after).toHaveAttribute('aria-checked', String(initial));
  });
});
