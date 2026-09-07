import { expect, test } from '@playwright/test';

/**
 * The Channels page.
 *
 * ## What these cover, and what they deliberately do not
 *
 * No real OAuth happens here. Completing a consent screen needs registered
 * developer apps, a real social account, and a third party's UI — none of which
 * belongs in an automated suite. What *is* testable without any of that is
 * everything on this side of the redirect: the channel list, both health
 * treatments, the provider picker's configured/unconfigured split, and the
 * disconnect confirmation.
 *
 * That is possible because the seed creates two channels on `seed-demo-org` —
 * one healthy, one flagged for reconnection — with genuinely encrypted tokens.
 * Without those fixtures this page could only ever render its empty state.
 *
 * Prerequisites, same as the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // By id, not getByLabel: the field's reveal toggle is labelled
  // "Show password", which the accessible-name lookup also matches.
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

test.describe('channels page', () => {
  test('lists the seeded channels with their handles', async ({ page }) => {
    await signIn(page, 'demo@postgear.local');
    await page.goto(`/${DEMO_ORG}/channels`);

    // Scoped to main: the top bar also titles the section "Channels".
    await expect(page.getByRole('main').getByRole('heading', { name: 'Channels' })).toBeVisible();

    await expect(page.getByText('Acme Marketing')).toBeVisible();
    await expect(page.getByText('Acme on X')).toBeVisible();

    // The handle is shown under the name, which is what makes two accounts on
    // the same platform tellable apart.
    await expect(page.getByText('@acme-marketing')).toBeVisible();
  });

  test('distinguishes a healthy channel from one needing reconnection', async ({ page }) => {
    await signIn(page, 'demo@postgear.local');
    await page.goto(`/${DEMO_ORG}/channels`);

    // The seeded X channel has refreshNeeded set, and must not look the same as
    // the healthy one — that conflation is the specific failure this asserts
    // against.
    await expect(page.getByText('Reconnect', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();

    // And the breakage is summarised at the page level, not left to a small
    // badge nobody scrolls to.
    await expect(page.getByText(/channel needs attention/i)).toBeVisible();
  });

  test('the connect dialog separates configured platforms from unconfigured ones', async ({
    page,
  }) => {
    await signIn(page, 'demo@postgear.local');
    await page.goto(`/${DEMO_ORG}/channels`);

    await page.getByRole('button', { name: 'Connect a channel' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();

    // With placeholder credentials in .env every provider is unconfigured, and
    // the point is that they are still *listed* — hiding them would read as
    // "PostGear does not support this platform" rather than "this deployment
    // has no key for it".
    await expect(page.getByText('Not set up on this instance')).toBeVisible();
    await expect(page.getByRole('button', { name: /LinkedIn/ }).first()).toBeVisible();
  });

  test('disconnecting asks for confirmation and says what it will affect', async ({ page }) => {
    await signIn(page, 'demo@postgear.local');
    await page.goto(`/${DEMO_ORG}/channels`);

    await page.getByRole('button', { name: 'Manage Acme Marketing' }).click();
    await page.getByRole('menuitem', { name: 'Disconnect' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Disconnect Acme Marketing\?/)).toBeVisible();
    // The consequence is stated rather than left implicit.
    await expect(dialog.getByText(/scheduled|Nothing is currently scheduled/)).toBeVisible();

    // Backing out must leave the channel alone.
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByText('Acme Marketing')).toBeVisible();
  });

  test('a non-admin member sees channels but cannot manage them', async ({ page }) => {
    await signIn(page, 'member@postgear.local');
    await page.goto(`/${DEMO_ORG}/channels`);

    await expect(page.getByText('Acme Marketing')).toBeVisible();
    // Connecting and disconnecting are ADMIN-only on the API; offering the
    // button would only produce a 403.
    await expect(page.getByRole('button', { name: 'Connect a channel' })).toHaveCount(0);
    await expect(
      page.getByText('Only workspace admins can connect or remove channels.'),
    ).toBeVisible();
  });

  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto(`/${DEMO_ORG}/channels`);
    await expect(page).toHaveURL(/\/login$/);
  });
});
