import { expect, test } from '@playwright/test';

/**
 * Covers the Sprint 0 app shell — the auth screens that serve as the design
 * system's end-to-end smoke test, the routes that used to 404, and the focus
 * ring's contrast fix — plus the Sprint 2 behaviour layered onto those same
 * screens: route gate 1, and the two places the UI must stay deliberately
 * uninformative about whether an account exists.
 *
 * These need the API running but no database fixtures. The seeded happy path
 * lives in onboarding.spec.ts.
 */

test('/ redirects to sign in instead of 404ing', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sign in renders its fields and routes on to the other auth screens', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel('Email')).toBeVisible();
  // By id, not getByLabel('Password'): the field's own reveal toggle is
  // labelled "Show password", which that accessible-name lookup also matches.
  await expect(page.locator('#password')).toBeVisible();

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

test('the password reveal toggle swaps the field type without losing the value', async ({
  page,
}) => {
  await page.goto('/login');

  const field = page.locator('#password');
  await field.fill('correct horse battery staple');
  await expect(field).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveValue('correct horse battery staple');

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveValue('correct horse battery staple');
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
    const style = await page.locator(`label[for="${field}"]`).evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, weight: s.fontWeight, transform: s.textTransform };
    });

    expect(style.family).toContain('Plus Jakarta Sans');
    expect(style.weight).toBe('700');
    expect(style.transform).toBe('none');
  }
});

test('the auth shell drops the illustration panel when there is no room for it', async ({
  page,
}) => {
  // The panel is decorative, so it is the half that goes on a narrow viewport
  // rather than squeezing the form beside it (design-system-rules.md 11).
  const panel = page.getByRole('complementary');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await expect(panel).toBeVisible();

  await page.setViewportSize({ width: 640, height: 900 });
  await expect(panel).toBeHidden();
  await expect(page.locator('#password')).toBeVisible();
});

test('an unknown route renders the styled 404, not a bare Next.js page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');

  await expect(page.getByRole('heading', { name: 'Nothing scheduled here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
});

test('an org route redirects an anonymous visitor to sign in', async ({ page }) => {
  // This test used to assert the opposite — that /acme/calendar rendered the
  // app shell for anyone. That was correct while the shell was a Sprint 0
  // design-system smoke test with no auth behind it. Sprint 2 added route
  // gate 1 in the (dashboard) group layout, so reaching a workspace without a
  // session is now the bug, and this is the regression guard for it.
  await page.goto('/acme/calendar');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the sign-in form reports a failure without saying which field was wrong', async ({
  page,
}) => {
  // The API returns one message for every cause — unknown email, wrong
  // password, unactivated, locked. If a future change starts distinguishing
  // them the API becomes an account-enumeration oracle, and this fails.
  await page.goto('/login');

  await page.getByLabel('Email').fill('definitely-not-a-user@example.com');
  await page.locator('#password').fill('whatever-9-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Scoped to the form: Next renders its own always-present route announcer
  // with role="alert", so an unscoped getByRole('alert') matches two elements.
  await expect(page.locator('form').getByRole('alert')).toHaveText('Incorrect email or password');
});

test('password reset never confirms whether an address is registered', async ({ page }) => {
  await page.goto('/reset-password');

  await page.getByLabel('Email').fill('definitely-not-a-user@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();

  await expect(
    page.getByText("If that email is registered, you'll receive a reset link"),
  ).toBeVisible();
});
