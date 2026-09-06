import { expect, test } from '@playwright/test';
import { createUnonboardedUser, deleteUser, disconnect, type FixtureUser } from './helpers/users';

/**
 * Sprint 2's end-to-end journeys: the two route gates, the five-step
 * onboarding wizard, resuming an abandoned flow, and signing out.
 *
 * ## What these need
 *
 * - The API running: `npm run dev --workspace=@postgear/api`
 * - A seeded database: `npm run db:seed`
 * - `DATABASE_URL` in the environment, which is why the root script runs
 *   Playwright through `dotenv -e .env`
 *
 * The Playwright `webServer` starts only the Next app. A missing API surfaces
 * as an unexpected redirect to /login, because `getSession()` deliberately
 * treats an unreachable API as "not signed in" — a recoverable login screen
 * beats an error page.
 *
 * ## Why fixtures create their own users
 *
 * The seeded accounts are shared, and these tests mutate onboarding state.
 * Walking the wizard as `onboarding@postgear.local` would leave it onboarded
 * and silently break the next run, so each wizard test gets a throwaway user
 * and deletes it afterwards. See `helpers/users.ts` for why they are written
 * directly rather than registered through the API.
 */

const SEED_PASSWORD = 'DemoPassword123!';

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.afterAll(async () => {
  await disconnect();
});

test.describe('route gates', () => {
  test('an anonymous visitor is sent to sign in from a workspace', async ({ page }) => {
    await page.goto('/seed-demo-org/calendar');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an anonymous visitor is sent to sign in from onboarding', async ({ page }) => {
    // /onboarding sits inside the (dashboard) group, so it inherits gate 1
    // even though it deliberately escapes gate 2.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an onboarded user signing in lands in their workspace', async ({ page }) => {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/seed-demo-org\/calendar$/, { timeout: 20_000 });
  });

  test('a signed-in user is bounced off the login page', async ({ page }) => {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/calendar$/, { timeout: 20_000 });

    await page.goto('/login');
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('an un-onboarded user is sent to onboarding, not to a workspace', async ({ page }) => {
    // Gate 2. `onboarding@postgear.local` is seeded with zero UserOrganization
    // rows and a null onboardingCompletedAt precisely so this is reproducible
    // from a plain `npm run db:seed`.
    await signIn(page, 'onboarding@postgear.local', SEED_PASSWORD);

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
  });

  test('a workspace the user does not belong to renders the 404', async ({ page }) => {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/calendar$/, { timeout: 20_000 });

    // member@ is only in seed-demo-org. Tenant isolation, from the outside.
    await page.goto('/seed-second-org/calendar');
    await expect(page.getByRole('heading', { name: 'Nothing scheduled here' })).toBeVisible();
  });
});

test.describe('the onboarding wizard', () => {
  let user: FixtureUser;

  test.beforeEach(async () => {
    user = await createUnonboardedUser('wizard');
  });

  test.afterEach(async () => {
    await deleteUser(user.id);
  });

  test('walks all five steps, skips the channel step, and lands in the dashboard', async ({
    page,
  }) => {
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

    // Step 1 — workspace
    await page.getByLabel('Workspace name').fill('E2E Workspace');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    // Step 2 — Q1 role, Q2 team size
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
    await page.getByText('Solo creator', { exact: true }).click();
    await page.getByText('Just me', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3 — Q3 goal, Q4 frequency
    await expect(page.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
    await page.getByText('Save time scheduling', { exact: true }).click();
    await page.getByText('Every day', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 4 — channels. Selecting nothing turns Continue into "Skip for now".
    // The sprint requires that a user who cannot finish an OAuth handshake
    // still reaches the dashboard, so the connect button is disabled until
    // Sprint 3 while the skip stays live.
    await expect(page.getByRole('heading', { name: 'Where do you post?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect a channel/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // Step 5 — Q5 referral
    await expect(page.getByRole('heading', { name: 'One last thing' })).toBeVisible();
    await page.getByText('Search engine', { exact: true }).click();
    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page).toHaveURL(/\/[^/]+\/calendar$/, { timeout: 20_000 });
    // The app shell — which gate 2 was keeping this user out of a moment ago.
    await expect(page.locator('aside').first()).toBeVisible();
  });

  test('records the channels a user does select', async ({ page }) => {
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

    await page.getByLabel('Workspace name').fill('Channel Picker');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await page.getByText('Agency', { exact: true }).click();
    await page.getByText('2–10 people', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByText('Grow my audience', { exact: true }).click();
    await page.getByText('A few times a week', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByText('LinkedIn', { exact: true }).click();
    await page.getByText('Instagram', { exact: true }).click();
    // With a selection made, the button stops offering to skip.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'One last thing' })).toBeVisible();
  });

  test('resumes where it was abandoned instead of erroring', async ({ page }) => {
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

    await page.getByLabel('Workspace name').fill('Abandoned Workspace');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();

    // Abandon: a full reload, discarding every scrap of client state.
    await page.goto('/onboarding');

    // Back on step 2 — not step 1, not an error page, and specifically not
    // dropped into a dashboard with a half-finished profile. This is the
    // behaviour a derived "has >= 1 organization" completion check could not
    // provide: creating the workspace would have ended onboarding outright.
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toHaveCount(0);
  });

  test('a signed-out, half-onboarded user can sign back in without an error page', async ({
    page,
    context,
  }) => {
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

    await page.getByLabel('Workspace name').fill('Half Done');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();

    // Drop the session the way closing the browser would.
    await context.clearCookies();

    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  });
});

test('signing out returns the user to the login screen and revokes the session', async ({
  page,
}) => {
  await signIn(page, 'member@postgear.local', SEED_PASSWORD);
  await expect(page).toHaveURL(/\/calendar$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  // The cookie is httpOnly, so the only honest check is to ask for a protected
  // page again and see where we end up.
  await page.goto('/seed-demo-org/calendar');
  await expect(page).toHaveURL(/\/login$/);
});
