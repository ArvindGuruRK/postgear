import { expect, type Page, test } from '@playwright/test';
import { cleanUp } from './helpers/media';

/**
 * The calendar — Sprint 5's visual scheduler.
 *
 * Runs against the seeded demo workspace, whose posts were chosen to show every
 * state at once: a thread queued for tomorrow, one published yesterday, one
 * failed, one draft. Each test creates its own post through the API so a
 * reschedule never moves a seeded fixture another test relies on.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` in its own terminal. The worker
 * is not needed for these: they assert what the API records and the page
 * shows, not that a platform received anything.
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

/** A queued LinkedIn post at the given local time, created through the API. */
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

/** Noon, `days` days from now — well inside a week view and never in the past. */
function atNoon(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const created = { groups: [] as string[], mediaNames: [] as string[] };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await cleanUp(page.request, created);
  await page.close();
});

test.describe('calendar', () => {
  test('shows the seeded posts in month, week and day views with the scheduler status', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/calendar?view=week&date=${dayKey(new Date())}`);

    // Scoped to main: the app shell's header repeats the page title in its own h1.
    await expect(page.getByRole('main').getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByTestId('week-view')).toBeVisible();
    await expect(page.getByTestId('scheduler-status')).toBeVisible();

    // The seeded thread for tomorrow is on this week's grid (or next week's,
    // on a Sunday), published yesterday is behind us: both reachable by
    // stepping, so step until the queued one is in view.
    const tomorrow = page.getByTestId('post-card').filter({ hasText: /open the doors/ });
    if (!(await tomorrow.first().isVisible())) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }
    await expect(tomorrow.first()).toBeVisible();

    await page.getByRole('button', { name: 'Month view' }).click();
    await expect(page.getByTestId('month-view')).toBeVisible();

    await page.getByRole('button', { name: 'Day view' }).click();
    await expect(page.getByTestId('day-view')).toBeVisible();
    await expect(page.getByTestId('calendar-range')).toContainText(/\d{4}/);
  });

  test('drag-and-drop moves a post to another day and the API records the new time', async ({
    page,
  }) => {
    await signIn(page);
    const from = atNoon(2);
    // The week starts on Monday (`startOfWeek`), so when `from` lands on a
    // Sunday the next day is in another week and off the anchored grid; move
    // the post back a day instead. Either way it is "another day".
    const to = from.getDay() === 0 ? atNoon(1) : atNoon(3);
    const group = await createQueued(page, `E2E drag me ${Date.now()}`, from);
    created.groups.push(group);

    // Anchor the week on the post's own day so both source and target are visible.
    await page.goto(`/${DEMO_ORG}/calendar?view=week&date=${dayKey(from)}`);

    const card = page.locator(`[data-testid="post-card"][data-group="${group}"]`);
    await expect(card).toBeVisible();

    const grip = card.getByTestId('post-card-grip');
    const target = page.locator(`[data-slot="slot:${to.getTime() - 12 * 60 * 60 * 1000}:12"]`);
    await expect(target).toBeVisible();

    // The grid scrolls inside its own frame and opens on the morning, so noon
    // can sit at its clipped bottom edge: bring the row into view before taking
    // any geometry, or the pointer lands on the frame rather than the grip.
    await card.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    // A pointer drag with intermediate moves, so dnd-kit's distance activation
    // fires and its collision detection sees the pointer over the target.
    const gripBox = await grip.boundingBox();
    const targetBox = await target.boundingBox();
    if (!gripBox || !targetBox) throw new Error('Drag geometry not available');

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + 20, gripBox.y + 10, { steps: 5 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 20, { steps: 15 });
    await page.mouse.up();

    // `.first()`: the toast briefly repeats its text in a hidden live region for
    // screen readers, so the title can match twice for a moment.
    await expect(page.getByText('Rescheduled', { exact: true }).first()).toBeVisible();

    // The page and the API agree on the new time: same clock time, next day.
    await expect(target.locator(`[data-group="${group}"]`)).toBeVisible();
    const response = await page.request.get(`${API_URL}/posts/${group}`);
    const { post } = (await response.json()) as { post: { publishDate: string; state: string } };
    expect(new Date(post.publishDate).getTime()).toBe(to.getTime());
    expect(post.state).toBe('QUEUE');
  });

  test('a card opens its details, and Reschedule moves it to a typed time', async ({ page }) => {
    await signIn(page);
    const from = atNoon(4);
    const group = await createQueued(page, `E2E reschedule me ${Date.now()}`, from);
    created.groups.push(group);

    await page.goto(`/${DEMO_ORG}/calendar?view=day&date=${dayKey(from)}`);

    await page
      .locator(`[data-testid="post-card"][data-group="${group}"]`)
      .getByRole('button', { name: /Scheduled:/ })
      .click();

    const dialog = page.getByTestId('post-detail');
    await expect(dialog).toBeVisible();
    // The state badge, and the LinkedIn channel's own standing, both read "Scheduled".
    await expect(dialog.getByText('Scheduled', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Acme Marketing')).toBeVisible();

    await dialog.getByRole('button', { name: 'Reschedule' }).click();
    const to = new Date(from);
    to.setHours(15, 30, 0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    await page
      .getByLabel('Publish at')
      .fill(
        `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}T${pad(to.getHours())}:${pad(to.getMinutes())}`,
      );
    await page.getByRole('button', { name: 'Move post' }).click();

    await expect(page.getByText('Rescheduled', { exact: true }).first()).toBeVisible();
    const response = await page.request.get(`${API_URL}/posts/${group}`);
    const { post } = (await response.json()) as { post: { publishDate: string } };
    expect(new Date(post.publishDate).getTime()).toBe(to.getTime());
  });

  test('clicking a future slot opens the composer at that time', async ({ page }) => {
    await signIn(page);
    const day = atNoon(5);
    await page.goto(`/${DEMO_ORG}/calendar?view=day&date=${dayKey(day)}`);

    const slot = page.locator(`[data-slot="slot:${day.getTime() - 12 * 60 * 60 * 1000}:14"]`);
    await slot.hover();
    await slot.getByRole('button', { name: /^New post/ }).click();

    // Generous: the first visit compiles the composer route under `next dev`.
    await expect(page).toHaveURL(/\/composer\?at=/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'New post' })).toBeVisible();
    const expected = new Date(day);
    expected.setHours(14, 0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    await expect(page.getByLabel('Publish at')).toHaveValue(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T14:00`,
    );
  });
});
