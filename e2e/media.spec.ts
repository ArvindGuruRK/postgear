import { expect, type Page, test } from '@playwright/test';
import { cleanUp, noisyPhoto, uniqueName } from './helpers/media';

/**
 * The media library, Sprint 4's last Definition of Done item: an uploaded
 * image is compressed automatically, appears in the library, and can be reused
 * across posts.
 *
 * "Compressed" is asserted from what the page reports about the stored file
 * (its size against the original's, and its dimensions), which the API reads
 * from the file it actually wrote. Nothing here trusts the upload's own claims.
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

const created = { groups: [] as string[], mediaNames: [] as string[] };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await cleanUp(page.request, created);
  await page.close();
});

test.describe('media library', () => {
  test('compresses an upload, lists it, and reuses it across two posts', async ({ page }) => {
    const fileName = uniqueName('library-photo');
    created.mediaNames.push(fileName);

    await signIn(page);
    await page.goto(`/${DEMO_ORG}/media`);
    // The page is named only by the top bar's h1 (no in-page title).
    await expect(page.getByRole('heading', { level: 1, name: 'Media', exact: true })).toBeVisible();

    const original = await noisyPhoto(4000, 3000);
    // The drop box's file input (a drop anywhere on the page works too).
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: fileName, mimeType: 'image/jpeg', buffer: original });

    // Compressed, and smaller than it arrived.
    const report = page.getByText(/Compressed .* → /);
    await expect(report).toBeVisible({ timeout: 30_000 });

    // Listed, searchable, and stored at the capped size (the viewer's details).
    await page.getByRole('searchbox', { name: 'Search media' }).fill(fileName);
    const tile = page.getByTestId('media-tile').filter({ hasText: fileName });
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText('JPEG');
    await tile.getByRole('button', { name: `Open ${fileName}` }).click();
    const viewer = page.getByRole('dialog', { name: fileName });
    await expect(viewer).toContainText('2048 × 1536');
    await expect(viewer).toContainText('Not used in any draft or queued post');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // Filtering to video hides it.
    await page.getByRole('button', { name: 'Videos' }).click();
    await expect(page.getByTestId('media-tile').filter({ hasText: fileName })).toHaveCount(0);
    await page.getByRole('button', { name: 'All media' }).click();
    await expect(tile).toHaveCount(1);

    // Reuse 1: one click from the library into a new post.
    await tile.hover();
    await tile.getByRole('link', { name: 'Use In A Post' }).click();
    await expect(page).toHaveURL(/\/composer\?media=/);
    await expect(page.getByRole('img', { name: fileName }).first()).toBeVisible();

    await page
      .getByRole('group', { name: 'Channels' })
      .getByRole('button', { name: /Acme Marketing/ })
      .click();
    await page.getByRole('textbox', { name: 'Part 1 of the shared post' }).click();
    await page.keyboard.type('First post using the image');
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page).toHaveURL(/\?group=/);
    created.groups.push(new URL(page.url()).searchParams.get('group') ?? '');

    // Reuse 2: a second post attaches the same file from the library picker.
    await page.goto(`/${DEMO_ORG}/composer`);
    await page
      .getByRole('group', { name: 'Channels' })
      .getByRole('button', { name: /Acme Marketing/ })
      .click();
    await page.getByRole('textbox', { name: 'Part 1 of the shared post' }).click();
    await page.keyboard.type('Second post, same image');
    await page.getByRole('button', { name: 'Add media to Part 1' }).click();

    const dialog = page.getByRole('dialog', { name: 'Media Library' });
    await dialog.getByRole('searchbox', { name: 'Search media' }).fill(fileName);
    await dialog.getByRole('button', { name: `Select ${fileName}` }).click();
    await dialog.getByRole('button', { name: 'Add selected media' }).click();
    await expect(
      page.getByTestId('preview-linkedin').getByRole('img', { name: fileName }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page).toHaveURL(/\?group=/);
    created.groups.push(new URL(page.url()).searchParams.get('group') ?? '');

    // Deleting says how many posts it affects before anything is removed.
    await page.goto(`/${DEMO_ORG}/media`);
    await page.getByRole('searchbox', { name: 'Search media' }).fill(fileName);
    await page.getByTestId('media-tile').filter({ hasText: fileName }).hover();
    await page.getByRole('button', { name: `Delete ${fileName}` }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(
      confirm.getByText('2 unpublished posts use this file and will lose the attachment.'),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('media-tile').filter({ hasText: fileName })).toHaveCount(0);
  });

  test('refuses a file that is not really an image, whatever it is called', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/media`);

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'totally-a-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
      });

    await expect(page.getByText(/That file type is not supported/)).toBeVisible();
    await expect(
      page.getByTestId('media-tile').filter({ hasText: 'totally-a-photo.jpg' }),
    ).toHaveCount(0);
  });
});
