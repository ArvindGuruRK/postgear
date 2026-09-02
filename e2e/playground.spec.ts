import { expect, test } from '@playwright/test';

const PLAYGROUND = '/dev/components';

/**
 * These assert the things type-checking can't: that a class actually survives
 * `cn()`, that a control is reachable by a real click, and that nothing is
 * covered by an invisible overlay.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(PLAYGROUND);
});

test('progress fills keep their colour through cn()', async ({ page }) => {
  // The bug this exists for: tailwind-merge classified bg-stripes as a
  // background-COLOR and silently dropped the fill in front of it.
  const fill = page.locator('[data-state] > div.bg-stripes').first();
  await expect(fill).toHaveClass(/bg-action/);
  const bg = await fill.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('calendar arrows are clickable, not buried under the caption', async ({ page }) => {
  const calendar = page.locator('.rdp-root').first();
  const caption = calendar.locator('[role="status"]').first();
  const before = await caption.textContent();

  await calendar.getByRole('button', { name: /next/i }).first().click();

  await expect(caption).not.toHaveText(before ?? '');
});

test('sidebar expands from the rail and collapses back', async ({ page }) => {
  const sidebar = page.locator('aside').first();
  await expect(sidebar).toHaveClass(/w-20/);

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar).toHaveClass(/w-56/);
  await expect(sidebar.getByText('PostGear')).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toHaveClass(/w-20/);
});

test('theme toggle is not covered by anything and flips the body class', async ({ page }) => {
  const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ });
  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/light/);
});

test('accordion opens and reveals its panel', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /token expires/i }).first();
  await trigger.click();
  await expect(trigger).toHaveAttribute('data-state', 'open');
});

test('countdown ticks', async ({ page }) => {
  const seconds = page.locator('[role="timer"]').first().locator('div').last();
  const first = await seconds.textContent();
  await expect(seconds).not.toHaveText(first ?? '', { timeout: 5000 });
});

test('capture the playground in both themes', async ({ page }, testInfo) => {
  await page.locator('body.light, body.dark').first().waitFor();
  await page.screenshot({ path: testInfo.outputPath('playground-light.png'), fullPage: true });

  await page.getByRole('button', { name: /Switch to dark mode/ }).click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('playground-dark.png'), fullPage: true });
});
