import { expect, test } from '@playwright/test';

/**
 * Covers the Sprint 0 app shell: the auth screens that serve as the design
 * system's end-to-end smoke test, the routes that used to 404, and the focus
 * ring's contrast fix.
 */

test('/ redirects to sign in instead of 404ing', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sign in renders its fields and routes on to the other auth screens', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel('Full name')).toBeVisible();
  // No workspace/organization field here on purpose — that moved into the
  // post-signup onboarding flow (sprint-02, Task 6).
  await expect(page.getByLabel('Organization')).toHaveCount(0);

  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test('the focus ring uses the darkened light-mode colour', async ({ page }) => {
  // Regression guard for the WCAG fix: the ring used to reuse actionAccent
  // (#ff6b35), which only reached 2.68:1 against the light page background.
  // #d6440f clears 3:1 on the page, on white cards, and against the ink
  // border. If someone re-points the ring at actionAccent, this fails.
  await page.goto('/login');
  await page.getByLabel('Email').focus();

  const outline = await page
    .getByLabel('Email')
    .evaluate((el) => getComputedStyle(el).outlineColor);

  expect(outline).toBe('rgb(214, 68, 15)');
});

test('form labels use the body face, not the display face', async ({ page }) => {
  // Regression guard for a mistake made twice: form-control labels rendered in
  // Bangers (font-display), then in Plus Jakarta but uppercase with wide
  // tracking — neither matching the specimen the playground has always shown.
  // design-system-rules.md §1 is the rule; this is the enforcement.
  await page.goto('/register');

  for (const field of ['name', 'email', 'password']) {
    const style = await page
      .locator(`label[for="${field}"]`)
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, weight: s.fontWeight, transform: s.textTransform };
      });

    expect(style.family).toContain('Plus Jakarta Sans');
    expect(style.weight).toBe('700');
    expect(style.transform).toBe('none');
  }
});

test('an unknown route renders the styled 404, not a bare Next.js page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');

  await expect(page.getByRole('heading', { name: 'Nothing scheduled here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
});

test('an org route renders the app shell around the page', async ({ page }) => {
  await page.goto('/acme/calendar');

  const sidebar = page.locator('aside').first();
  await expect(sidebar).toBeVisible();

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar.getByRole('link', { name: 'Analytics' })).toHaveAttribute(
    'href',
    '/acme/analytics',
  );
});
