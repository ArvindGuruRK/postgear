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

test('rail shows every section with its label and marks the current one', async ({ page }) => {
  const rail = page.getByRole('complementary', { name: 'Main' });
  await expect(rail.getByRole('img', { name: 'PostGear' })).toBeVisible();

  const sections = rail.getByRole('navigation', { name: 'Sections' });
  await expect(sections.getByRole('link', { name: 'Calendar' })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Design System' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sections.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute(
    'aria-current',
  );

  await expect(
    rail.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Settings' }),
  ).toBeVisible();
});

test('tooltips open on hover and focus, on the side asked for, even on a disabled button', async ({
  page,
}) => {
  // Radix renders the label twice: the visible content (data-side) and a
  // visually hidden role="tooltip" copy for screen readers.
  const visible = page.locator('[data-slot="tooltip-content"]');

  // Radix opens on pointermove inside the trigger. `locator.hover()` jumps
  // the pointer there in a single move, which a real mouse never does, so
  // glide in over a few steps instead, from above, where the row's label
  // sits: from the side would cross the neighbouring button first. Retried,
  // because on this long page a glide made before hydration finishes lands
  // on a button with no handlers yet.
  async function glideOnto(name: string, disabled?: boolean) {
    const target = page.getByRole('button', { name, exact: true, disabled });
    await target.scrollIntoViewIfNeeded();
    await expect(async () => {
      const box = await target.boundingBox();
      if (!box) throw new Error(`${name} has no box`);
      await page.mouse.move(box.x + box.width / 2, box.y - 24);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      await expect(visible).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  }

  await glideOnto('right');
  await expect(visible).toHaveAttribute('data-side', 'right');
  await expect(page.getByRole('tooltip')).toHaveText('Opens right');

  // A disabled button gets no pointer events; the wrapper hovers for it. The
  // buttons section has an enabled "Add Channel" too, hence `disabled`.
  await glideOnto('Add Channel', true);
  await expect(page.getByRole('tooltip')).toHaveText('This plan’s channel limit is reached');

  // Keyboard focus opens it too: the icon-only AI button names itself.
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Generate with AI' }).focus();
  await expect(page.getByRole('tooltip')).toHaveText('Generate with AI');
});

test('theme toggle is not covered by anything and flips the body class', async ({ page }) => {
  const toggle = page.getByRole('button', { name: /Switch To (Dark|Light) Mode/ });
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

  await page.getByRole('button', { name: /Switch To Dark Mode/i }).click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('playground-dark.png'), fullPage: true });
});
