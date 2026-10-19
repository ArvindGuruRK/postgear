import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { prisma } from '@postgear/db';

/**
 * The calendar and channel features of the UI revamp's second round
 * (2026-10-19): reordering channels by dragging, the channel menu (create a
 * post, copy the id, preferences, disable and enable), the channel usage
 * footer, duplicating a post from its card, and tags and repeats on the
 * card with the toolbar's tag filter.
 *
 * Runs against the seeded demo workspace. Every change is put back: the
 * channel order is restored to the exact stored positions it had (read and
 * written straight in the database, so a channel the person connected
 * themselves keeps its exact value too), the renamed and disabled seed
 * channel gets its name, colour and state back, and every post and tag a
 * test made is deleted through the API.
 *
 * One sign-in per role for the whole file (the login throttle is shared), so
 * the admin tests run in order on one page.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
/** The seed's Instagram channel: healthy, and not a channel anyone posts to by hand. */
const STUDIO_ID = 'seed-channel-instagram';
const LINKEDIN_ID = 'seed-channel-linkedin';

test.describe.configure({ mode: 'serial' });

interface ApiChannel {
  id: string;
  name: string;
  color: number;
  disabled: boolean;
}

async function signIn(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
  return { context, page };
}

async function channels(page: Page): Promise<ApiChannel[]> {
  const response = await page.request.get(`${API_URL}/channels`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { channels: ApiChannel[] }).channels;
}

/** Noon, `days` days from now: never in the past. */
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

async function createPost(
  page: Page,
  text: string,
  publishAt: Date,
  extra: Record<string, unknown> = {},
): Promise<string> {
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
      channels: [{ channelId: LINKEDIN_ID, customized: false }],
      ...extra,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { post: { group: string } }).post.group;
}

async function rowIds(page: Page): Promise<string[]> {
  return page
    .getByRole('complementary', { name: 'Channels' })
    .getByTestId('channel-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-channel-id') ?? ''));
}

const created = { groups: [] as string[], tags: [] as string[] };
let originalPositions: { id: string; position: number | null }[] = [];
let original: ApiChannel | undefined;

test.describe('calendar and channels, as an admin', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await signIn(browser, 'demo@postgear.local'));
    originalPositions = await prisma.$queryRaw<{ id: string; position: number | null }[]>`
      SELECT "id", "position" FROM "Integration" WHERE "organizationId" = ${DEMO_ORG}`;
    original = (await channels(page)).find((channel) => channel.id === STUDIO_ID);
  });

  test.afterAll(async () => {
    for (const group of created.groups) {
      await page.request.delete(`${API_URL}/posts/${group}`).catch(() => undefined);
    }
    for (const tag of created.tags) {
      await page.request.delete(`${API_URL}/tags/${tag}`).catch(() => undefined);
    }
    // The exact stored order, every row (the person's own channels too).
    for (const row of originalPositions) {
      await prisma.$executeRaw`UPDATE "Integration" SET "position" = ${row.position} WHERE "id" = ${row.id}`;
    }
    if (original) {
      await page.request.patch(`${API_URL}/channels/${STUDIO_ID}`, {
        data: { name: original.name, color: original.color, disabled: original.disabled },
      });
    }
    await context.close();
    await prisma.$disconnect();
  });

  test('drags a channel to a new place, by keyboard and by pointer, and the order is saved', async () => {
    await page.goto(`/${DEMO_ORG}/calendar?view=week`);
    const card = page.getByRole('complementary', { name: 'Channels' });
    await expect(card.getByTestId('channel-row').first()).toBeVisible();

    const before = await rowIds(page);
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Keyboard: Space picks the first channel up, ArrowDown moves it one
    // place, Space drops it. A pause between keys, as a person leaves one:
    // dnd-kit starts listening for the moving keys a tick after the pick-up.
    const firstGrip = card.getByRole('button', { name: /^Reorder / }).first();
    await firstGrip.focus();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/order') && response.request().method() === 'PUT',
    );
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    expect((await saved).ok()).toBeTruthy();

    const swapped = [before[1], before[0], ...before.slice(2)];
    await expect.poll(() => rowIds(page)).toEqual(swapped);
    expect((await channels(page)).map((channel) => channel.id)).toEqual(swapped);

    // It is the workspace's order now: a reload shows it.
    await page.reload();
    await expect.poll(() => rowIds(page)).toEqual(swapped);

    // Pointer: drag the channel now second back above the first.
    const grips = card.getByRole('button', { name: /^Reorder / });
    const from = await grips.nth(1).boundingBox();
    const to = await grips.nth(0).boundingBox();
    if (!from || !to) throw new Error('Drag geometry not available');
    const savedAgain = page.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/order') && response.request().method() === 'PUT',
    );
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 8 });
    await page.mouse.up();
    expect((await savedAgain).ok()).toBeTruthy();
    await expect.poll(() => rowIds(page)).toEqual(before);
    expect((await channels(page)).map((channel) => channel.id)).toEqual(before);

    // Dragging is not a click: no channel filter was switched on.
    await expect(card.getByText(/^Showing \d+ of \d+$/)).toHaveCount(0);
  });

  test('the channel menu: create a post, copy the id, and no "Create a post" for a broken channel', async () => {
    await page.goto(`/${DEMO_ORG}/calendar?view=week`);
    const card = page.getByRole('complementary', { name: 'Channels' });

    await card.getByRole('button', { name: 'Manage Acme on X' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy channel ID' })).toBeVisible();
    // Needs a reconnect: nothing can be posted to it.
    await expect(page.getByRole('menuitem', { name: 'Create a post' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await card.getByRole('button', { name: 'Manage Acme Studio' }).click();
    await page.getByRole('menuitem', { name: 'Copy channel ID' }).click();
    await expect(page.getByText('Channel ID copied', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(STUDIO_ID);

    await card.getByRole('button', { name: 'Manage Acme Studio' }).click();
    await page.getByRole('menuitem', { name: 'Create a post' }).click();
    await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/composer\\?channel=${STUDIO_ID}$`));
  });

  test('preferences rename a channel and change its colour in one save', async () => {
    await page.goto(`/${DEMO_ORG}/channels`);
    await page.getByRole('button', { name: 'Manage Acme Studio' }).click();
    await page.getByRole('menuitem', { name: 'Preferences' }).click();

    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    await expect(dialog.getByLabel('Name')).toHaveValue('Acme Studio');
    await dialog.getByLabel('Name').fill('Acme Studio E2E');
    const nextColor = original?.color === 6 ? 'Violet' : 'Cyan';
    await dialog.locator(`label[title="${nextColor}"]`).click();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/channels/${STUDIO_ID}`) &&
        response.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    const body = (await saved).request().postDataJSON() as Record<string, unknown>;
    expect(body).toEqual({ name: 'Acme Studio E2E', color: nextColor === 'Cyan' ? 6 : 0 });
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Acme Studio E2E')).toBeVisible();

    const after = (await channels(page)).find((channel) => channel.id === STUDIO_ID);
    expect(after?.name).toBe('Acme Studio E2E');
    expect(after?.color).toBe(nextColor === 'Cyan' ? 6 : 0);

    // Put it back.
    await page.request.patch(`${API_URL}/channels/${STUDIO_ID}`, {
      data: { name: original?.name ?? 'Acme Studio', color: original?.color ?? 2 },
    });
    const restored = (await channels(page)).find((channel) => channel.id === STUDIO_ID);
    expect(restored?.name).toBe(original?.name);
    expect(restored?.color).toBe(original?.color);
  });

  test('disabling asks first, enabling does not, and both say so', async () => {
    await page.goto(`/${DEMO_ORG}/calendar?view=week`);
    const card = page.getByRole('complementary', { name: 'Channels' });
    const row = card.locator(`[data-testid="channel-row"][data-channel-id="${STUDIO_ID}"]`);

    await card.getByRole('button', { name: 'Manage Acme Studio' }).click();
    await page.getByRole('menuitem', { name: 'Disable channel' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Disable this channel?')).toBeVisible();
    await expect(confirm.getByText(/will not publish until it is enabled again/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Disable channel' }).click();
    await expect(page.getByText('Channel disabled', { exact: true })).toBeVisible();
    await expect(row).toHaveClass(/opacity-50/);
    expect((await channels(page)).find((channel) => channel.id === STUDIO_ID)?.disabled).toBe(true);

    await card.getByRole('button', { name: 'Manage Acme Studio' }).click();
    await expect(page.getByRole('menuitem', { name: 'Create a post' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Enable channel' }).click();
    await expect(page.getByText('Channel enabled', { exact: true })).toBeVisible();
    await expect(row).not.toHaveClass(/opacity-50/);
    expect((await channels(page)).find((channel) => channel.id === STUDIO_ID)?.disabled).toBe(
      false,
    );
  });

  test('the usage footer counts channels against the plan', async () => {
    await page.goto(`/${DEMO_ORG}/calendar?view=week`);
    const response = await page.request.get(`${API_URL}/channels`);
    const { limit } = (await response.json()) as { limit: { used: number; max: number } | null };
    test.skip(!limit || limit.max >= 1000, 'no meter without a binding limit');
    if (!limit) return;

    const line = page.getByTestId('channels-usage-line');
    await expect(line).toContainText(`${limit.used} of ${limit.max}`);
    await expect(line).toHaveAttribute('data-max', String(limit.max));
  });

  test('duplicating a post opens the composer on a copy', async () => {
    const day = atNoon(1);
    const group = await createPost(page, `E2E duplicate me ${Date.now()}`, day);
    created.groups.push(group);

    await page.goto(`/${DEMO_ORG}/calendar?view=day&date=${dayKey(day)}`);
    const postCard = page.locator(`[data-testid="post-card"][data-group="${group}"]`);
    await postCard.scrollIntoViewIfNeeded();
    await postCard.hover();
    await postCard.getByRole('button', { name: 'Duplicate post' }).click();
    await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/composer\\?duplicate=${group}$`));
  });

  test('a tagged, repeating post wears its tag on the strip, and the tag filter finds it', async () => {
    const tagResponse = await page.request.post(`${API_URL}/tags`, {
      data: { name: `E2E tag ${Date.now()}`, color: 'teal' },
    });
    test.skip(!tagResponse.ok(), `the tags API is not answering yet (${tagResponse.status()})`);
    const { tag } = (await tagResponse.json()) as { tag: { id: string; name: string } };
    created.tags.push(tag.id);

    const day = atNoon(2);
    const tagged = await createPost(page, `E2E tagged ${Date.now()}`, day, {
      tags: [tag.id],
      intervalInDays: 7,
    });
    const plain = await createPost(page, `E2E untagged ${Date.now()}`, day);
    created.groups.push(tagged, plain);

    await page.goto(`/${DEMO_ORG}/calendar?view=day&date=${dayKey(day)}`);
    const taggedCard = page.locator(`[data-testid="post-card"][data-group="${tagged}"]`);
    const plainCard = page.locator(`[data-testid="post-card"][data-group="${plain}"]`);
    await taggedCard.scrollIntoViewIfNeeded();

    // The strip takes the tag's colour (teal is the second avatar slot) and
    // names it; the repeat mark says how often.
    await expect(taggedCard.getByTestId('post-card-tags')).toHaveText(tag.name);
    await expect(taggedCard.getByTestId('post-card-strip')).toHaveClass(/bg-avatar2/);
    await expect(taggedCard.getByTestId('post-card-repeat')).toHaveAttribute(
      'aria-label',
      'Repeats every 7 days',
    );
    await expect(plainCard.getByTestId('post-card-tags')).toHaveCount(0);

    // The filter: only posts with the ticked tag, then every post again.
    await page.getByTestId('tag-filter').click();
    await page.getByRole('checkbox', { name: tag.name }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tag-filter')).toHaveText('Tags (1)');
    await expect(taggedCard).toBeVisible();
    await expect(plainCard).toHaveCount(0);

    await page.getByTestId('tag-filter').click();
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.keyboard.press('Escape');
    await expect(plainCard).toBeVisible();
    await expect(taggedCard).toBeVisible();
  });
});

test.describe('calendar and channels, as a member', () => {
  test('sees the channels without a grip or a menu', async ({ browser }) => {
    const { context, page } = await signIn(browser, 'member@postgear.local');
    await page.goto(`/${DEMO_ORG}/calendar?view=week`);
    const card = page.getByRole('complementary', { name: 'Channels' });
    await expect(card.getByTestId('channel-row').first()).toBeVisible();
    await expect(card.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Manage / })).toHaveCount(0);
    await context.close();
  });
});
