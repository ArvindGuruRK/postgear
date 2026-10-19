import { expect, type Page, test } from '@playwright/test';
import { createUnonboardedUser, deleteUser, disconnect, type FixtureUser } from './helpers/users';

/**
 * Sprint 2's end-to-end journeys: the two route gates, the onboarding wizard
 * (a welcome, then one question per screen with its own Skip, ending on the
 * profile / avatar step, after Buffer's since 2026-10-19), resuming an
 * abandoned flow, and signing out.
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
 * treats an unreachable API as "not signed in": a recoverable login screen
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

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Each question screen's heading, in order. */
const HEADINGS = {
  role: 'How would you describe yourself?',
  teamSize: 'How big is your team?',
  goal: 'What do you most want from PostGear?',
  frequency: 'How often do you post on social media?',
  channels: 'Where do you plan to post?',
  referral: 'How did you hear about PostGear?',
  profile: 'What should we call you?',
};

const heading = (page: Page, name: string) => page.getByRole('heading', { name });

/** Signs in a fresh user, passes the welcome and names their workspace. */
async function startWizard(page: Page, user: FixtureUser, workspace: string) {
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

  await expect(page.getByRole('heading', { name: /Welcome to PostGear/ })).toBeVisible();
  await page.getByRole('button', { name: "Let's start" }).click();

  await expect(heading(page, 'Name your workspace')).toBeVisible();
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(heading(page, HEADINGS.role)).toBeVisible();
}

/** Skips every question from the first one, landing on the profile step. */
async function skipToProfile(page: Page) {
  for (const next of [
    HEADINGS.teamSize,
    HEADINGS.goal,
    HEADINGS.frequency,
    HEADINGS.channels,
    HEADINGS.referral,
    HEADINGS.profile,
  ]) {
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(heading(page, next)).toBeVisible();
  }
}

/** Picks an answer card and continues to the next screen's heading. */
async function answer(page: Page, label: string, next: string) {
  await page.getByText(label, { exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(heading(page, next)).toBeVisible();
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
    // Home is the landing page since 2026-10-19.
    await expect(page).toHaveURL(/\/seed-demo-org\/home(\?|$)/, { timeout: 20_000 });
  });

  test('a signed-in user is bounced off the login page', async ({ page }) => {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 20_000 });

    await page.goto('/login');
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('an un-onboarded user is sent to onboarding, not to a workspace', async ({ page }) => {
    // Gate 2. `onboarding@postgear.local` is seeded with zero UserOrganization
    // rows and a null onboardingCompletedAt precisely so this is reproducible
    // from a plain `npm run db:seed`.
    await signIn(page, 'onboarding@postgear.local', SEED_PASSWORD);

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Welcome to PostGear/ })).toBeVisible();
  });

  test('a workspace the user does not belong to renders the 404', async ({ page }) => {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 20_000 });

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

  test('walks every screen, skips the channels, and lands in the dashboard', async ({ page }) => {
    await startWizard(page, user, 'E2E Workspace');

    // Continue stays off until an answer is picked.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await answer(page, 'Solo creator', HEADINGS.teamSize);
    await answer(page, 'Just me', HEADINGS.goal);
    await answer(page, 'Save time scheduling', HEADINGS.frequency);
    await answer(page, 'Every day', HEADINGS.channels);

    // Channels: Continue needs a platform; skipping must never need an OAuth
    // handshake, since a user who cannot complete one still has to reach the
    // dashboard.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(heading(page, HEADINGS.referral)).toBeVisible();

    // Q5 no longer ends onboarding: it leads to the profile step.
    await answer(page, 'Search engine', HEADINGS.profile);

    // The name is pre-filled from the account.
    await expect(page.getByLabel('Your name')).toHaveValue('E2E Tester');
    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page).toHaveURL(/\/[^/]+\/home(\?|$)/, { timeout: 20_000 });
    // The app shell, which gate 2 was keeping this user out of a moment ago.
    await expect(page.locator('aside').first()).toBeVisible();
  });

  test('Skip moves on one question at a time, and the profile step still has to be finished', async ({
    page,
  }) => {
    await startWizard(page, user, 'Skipper');
    await skipToProfile(page);

    // Skipping does not finish onboarding: a reload resumes on the profile
    // step instead of opening the dashboard.
    await page.goto('/onboarding');
    await expect(heading(page, HEADINGS.profile)).toBeVisible();
  });

  test('the back arrow returns to the previous question with its answer kept', async ({ page }) => {
    await startWizard(page, user, 'Back And Forth');
    await answer(page, 'Marketing agency', HEADINGS.teamSize);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(heading(page, HEADINGS.role)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Marketing agency' })).toBeChecked();

    // The workspace is named once: back from the first question is the welcome.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: /Welcome to PostGear/ })).toBeVisible();
    await page.getByRole('button', { name: "Let's start" }).click();
    await expect(heading(page, HEADINGS.role)).toBeVisible();
  });

  test('a chosen preset avatar replaces the initials in the account menu', async ({ page }) => {
    await startWizard(page, user, 'Avatar Picker');
    await skipToProfile(page);

    await page.getByLabel('Your name').fill('Avery');

    // The tile is the radio's label; the input itself is visually hidden.
    const radio = page.getByRole('radio', { name: 'Person with two hair buns, waving, on violet' });
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/users/me/avatar/preset') && response.ok(),
    );
    await page.locator('label', { has: radio }).click();
    await expect(radio).toBeChecked();
    await saved;

    // "Finish setup" waits for the avatar save to land before enabling.
    const finish = page.getByRole('button', { name: 'Finish setup' });
    await expect(finish).toBeEnabled();
    await finish.click();

    await expect(page).toHaveURL(/\/[^/]+\/home(\?|$)/, { timeout: 20_000 });

    const menu = page.getByRole('button', { name: 'Open user menu' });
    await expect(menu.locator('img')).toHaveAttribute('src', /\/avatars\/notionists-05\.svg$/);
    await expect(menu).not.toContainText('AV');
  });

  test('an uploaded photo becomes the avatar', async ({ page }) => {
    await startWizard(page, user, 'Avatar Upload');
    await skipToProfile(page);

    // A real 1×1 PNG; the API crops and re-encodes it to a 256 px WebP.
    await page.getByTestId('avatar-upload-input').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    await expect(page.getByRole('radio', { name: 'Your photo' })).toBeChecked({ timeout: 15_000 });

    // Client-side checks fire before any upload.
    await page.getByTestId('avatar-upload-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.getByText('Upload a JPEG, PNG or WebP image.')).toBeVisible();
  });

  test('records the channels a user does select', async ({ page }) => {
    await startWizard(page, user, 'Channel Picker');

    await answer(page, 'Marketing agency', HEADINGS.teamSize);
    await answer(page, '2–10 people', HEADINGS.goal);
    await answer(page, 'Grow my audience', HEADINGS.frequency);
    await answer(page, 'A few times a week', HEADINGS.channels);

    await page.getByText('LinkedIn', { exact: true }).click();
    await page.getByText('Instagram', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'LinkedIn' })).toBeChecked();

    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/onboarding/channels') && response.ok(),
    );
    await page.getByRole('button', { name: 'Continue' }).click();
    const body = (await (await saved).json()) as { answers: { interestedChannels: string[] } };
    expect(body.answers.interestedChannels).toEqual(['linkedin', 'instagram']);

    await expect(heading(page, HEADINGS.referral)).toBeVisible();
  });

  test('resumes where it was abandoned instead of erroring', async ({ page }) => {
    await startWizard(page, user, 'Abandoned Workspace');

    // Abandon: a full reload, discarding every scrap of client state.
    await page.goto('/onboarding');

    // Back on the first question, not the welcome, not the workspace form,
    // not an error page, and specifically not dropped into a dashboard with a
    // half-finished profile. A derived "has >= 1 organization" completion
    // check could not provide this: creating the workspace would have ended
    // onboarding outright.
    await expect(heading(page, HEADINGS.role)).toBeVisible();
    await expect(heading(page, 'Name your workspace')).toHaveCount(0);

    // Each answer is saved as it is given, so the second question of a pair
    // is where a reload after the first one picks up.
    await answer(page, 'Solo creator', HEADINGS.teamSize);
    await page.goto('/onboarding');
    await expect(heading(page, HEADINGS.teamSize)).toBeVisible();
  });

  test('a signed-out, half-onboarded user can sign back in without an error page', async ({
    page,
    context,
  }) => {
    await startWizard(page, user, 'Half Done');

    // Drop the session the way closing the browser would.
    await context.clearCookies();

    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    await expect(heading(page, HEADINGS.role)).toBeVisible();
  });
});

test('signing out returns the user to the login screen and revokes the session', async ({
  page,
}) => {
  await signIn(page, 'member@postgear.local', SEED_PASSWORD);
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  // The cookie is httpOnly, so the only honest check is to ask for a protected
  // page again and see where we end up.
  await page.goto('/seed-demo-org/calendar');
  await expect(page).toHaveURL(/\/login$/);
});
