import { expect, type Page, test } from '@playwright/test';
import { cleanUp, noisyPhoto, uniqueName } from './helpers/media';

/**
 * The post composer — one test per Sprint 4 Definition of Done item it owns,
 * plus the two rules that keep a draft safe: the queue refuses a post a
 * platform would reject, and a stale save never overwrites a newer one.
 *
 * Runs against the seeded demo workspace, whose three channels were chosen for
 * this: X (weighted length, native threads, needs reconnecting), LinkedIn
 * (later parts become comments) and Instagram (no post without an image).
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';

async function signIn(page: Page, email = 'demo@postgear.local') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

async function openComposer(page: Page, query = '') {
  await page.goto(`/${DEMO_ORG}/composer${query}`);
  await expect(page.getByRole('heading', { name: /New post|Edit post/ })).toBeVisible();
}

function channel(page: Page, name: RegExp) {
  return page.getByRole('group', { name: 'Channels' }).getByRole('button', { name });
}

function part(page: Page, index: number, scope = 'the shared post') {
  return page.getByRole('textbox', { name: `Part ${index} of ${scope}` });
}

/** Types into an editor. TipTap needs real key events, not `fill`. */
async function write(page: Page, index: number, text: string, scope?: string) {
  const editor = part(page, index, scope);
  await editor.click();
  await page.keyboard.type(text);
}

/** The group id from the URL after a first save. */
function groupFrom(page: Page): string {
  return new URL(page.url()).searchParams.get('group') ?? '';
}

const created = { groups: [] as string[], mediaNames: [] as string[] };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await cleanUp(page.request, created);
  await page.close();
});

test.describe('composer', () => {
  test('composes text and an image for three platforms, each with a live preview', async ({
    page,
  }) => {
    const fileName = uniqueName('composer-photo');
    created.mediaNames.push(fileName);

    await signIn(page);
    await openComposer(page);

    await channel(page, /Acme on X/).click();
    await channel(page, /Acme Marketing/).click();
    await channel(page, /Acme Studio/).click();

    await write(page, 1, 'Launch day for the composer.');

    // Attach through the picker, uploading a fresh image from inside it.
    await page.getByRole('button', { name: 'Add media to Part 1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add media' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'image/jpeg',
      buffer: await noisyPhoto(),
    });
    await expect(dialog.getByText(/Compressed .* → /)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: /^Attach 1/ }).click();
    await expect(page.getByRole('img', { name: fileName }).first()).toBeVisible();

    // Every counter measures the rendered text, per platform.
    await expect(page.getByTitle('Acme on X: 28 of 280 characters')).toBeVisible();

    // One preview per platform, each showing the same text and the image.
    const xPreview = page.getByTestId('preview-x');
    await expect(xPreview.getByText('Launch day for the composer.')).toBeVisible();
    await expect(xPreview.getByRole('img', { name: fileName })).toBeVisible();

    const previewChannels = page.getByRole('group', { name: 'Preview channel' });

    await previewChannels.getByRole('button', { name: /Acme Marketing/ }).click();
    const linkedIn = page.getByTestId('preview-linkedin');
    await expect(linkedIn.getByText('Launch day for the composer.')).toBeVisible();
    await expect(linkedIn.getByRole('img', { name: fileName })).toBeVisible();

    await previewChannels.getByRole('button', { name: /Acme Studio/ }).click();
    const instagram = page.getByTestId('preview-instagram');
    await expect(instagram.getByRole('img', { name: fileName })).toBeVisible();
    await expect(instagram.getByText('Launch day for the composer.')).toBeVisible();
    await expect(instagram.getByText('acme.studio', { exact: true }).last()).toBeVisible();

    // With the image attached, Instagram has nothing left to object to.
    await expect(page.getByText('Ready for Acme Studio.')).toBeVisible();
  });

  test('builds a three-part thread and reorders it, by button and by keyboard drag', async ({
    page,
  }) => {
    await signIn(page);
    await openComposer(page);
    await channel(page, /Acme on X/).click();

    await write(page, 1, 'First');
    await page.getByRole('button', { name: 'Add to thread' }).click();
    await write(page, 2, 'Second');
    await page.getByRole('button', { name: 'Add to thread' }).click();
    await write(page, 3, 'Third');

    const posts = page.getByTestId('preview-x').getByRole('article');
    await expect(posts).toHaveCount(3);
    await expect(posts).toHaveText([/First/, /Second/, /Third/]);

    // Buttons: Part 3 to the top.
    await page.getByRole('button', { name: 'Move Part 3 up' }).click();
    await page.getByRole('button', { name: 'Move Part 2 up' }).click();
    await expect(posts).toHaveText([/Third/, /First/, /Second/]);

    // Keyboard drag: pick up part 1 with Space, move it down one, drop it.
    // dnd-kit measures the list when a drag starts and animates each move, so
    // the keys are paced the way a person presses them rather than all in one
    // frame, where the move would land before the measurement.
    await page.getByRole('button', { name: 'Drag to reorder Part 1' }).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await expect(posts).toHaveText([/First/, /Third/, /Second/]);

    // The editors moved with their text, rather than keeping their position.
    await expect(part(page, 1)).toHaveText('First');
    await expect(part(page, 2)).toHaveText('Third');
  });

  test('saves a draft with a customized channel and reopens it for editing', async ({ page }) => {
    const marker = `Draft ${Date.now()}`;

    await signIn(page);
    await openComposer(page);
    await channel(page, /Acme on X/).click();
    await channel(page, /Acme Marketing/).click();

    await write(page, 1, `${marker} for everyone`);

    // Give LinkedIn its own wording.
    await page.getByRole('tab', { name: 'Acme Marketing' }).click();
    await page.getByRole('button', { name: 'Customize for Acme Marketing' }).click();
    const custom = part(page, 1, 'Acme Marketing');
    await custom.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' — longer, for LinkedIn');

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?group=/);

    const group = groupFrom(page);
    created.groups.push(group);

    // A reload reopens exactly what was saved.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Edit post' })).toBeVisible();
    await expect(part(page, 1)).toHaveText(`${marker} for everyone`);
    await page.getByRole('tab', { name: /Acme Marketing/ }).click();
    await expect(part(page, 1, 'Acme Marketing')).toHaveText(
      `${marker} for everyone — longer, for LinkedIn`,
    );

    // And it is listed among saved posts, from where it opens too.
    await openComposer(page);
    await page.getByRole('button', { name: 'Saved posts' }).click();
    await page.getByRole('link', { name: new RegExp(marker) }).click();
    await expect(page).toHaveURL(new RegExp(`group=${group}`));
    await expect(part(page, 1)).toHaveText(`${marker} for everyone`);

    // Edit and save again: the same post, updated in place.
    await write(page, 1, ' (edited)');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft · all changes saved')).toBeVisible();
    expect(groupFrom(page)).toBe(group);
  });

  test('refuses to queue a post a platform would reject, and says why', async ({ page }) => {
    await signIn(page);
    await openComposer(page);
    await channel(page, /Acme on X/).click();
    await channel(page, /Acme Studio/).click();

    await write(page, 1, 'x'.repeat(290));

    await page.getByRole('button', { name: 'Add to queue' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Not ready for the queue yet' });
    await expect(alert).toContainText('Acme on X: X allows 280 characters; this post has 290.');
    await expect(alert).toContainText(
      'Acme Studio: Instagram posts must include at least one image or video.',
    );

    // Nothing was saved.
    await expect(page).not.toHaveURL(/\?group=/);
  });

  test('refuses a save made from a stale copy instead of overwriting the newer one', async ({
    browser,
  }) => {
    const first = await browser.newPage();
    await signIn(first);
    await openComposer(first);
    await channel(first, /Acme Marketing/).click();
    await write(first, 1, `Conflict ${Date.now()}`);
    await first.getByRole('button', { name: 'Save draft' }).click();
    await expect(first).toHaveURL(/\?group=/);
    const group = groupFrom(first);
    created.groups.push(group);

    // A second tab opens the same draft.
    const second = await browser.newPage();
    await signIn(second);
    await openComposer(second, `?group=${group}`);

    // The first tab saves a change; the second tab's copy is now stale.
    await write(first, 1, ' — newer');
    await first.getByRole('button', { name: 'Save draft' }).click();
    await expect(first.getByText('Draft · all changes saved')).toBeVisible();

    await write(second, 1, ' — older');
    await second.getByRole('button', { name: 'Save draft' }).click();
    await expect(second.getByText(/Someone else changed this post/)).toBeVisible();
    await expect(second.getByRole('button', { name: 'Reload' })).toBeVisible();

    await first.close();
    await second.close();
  });

  test('a regular member can write and save posts', async ({ page }) => {
    await signIn(page, 'member@postgear.local');
    await openComposer(page);
    await channel(page, /Acme Marketing/).click();
    await write(page, 1, `Member draft ${Date.now()}`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
    created.groups.push(groupFrom(page));
  });
});
