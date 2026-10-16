import { expect, type Page, test } from '@playwright/test';

/**
 * The billing page in simulation mode (`BILLING_SIMULATION=true`): no card,
 * no Stripe, but every change goes through the real webhook handler a second
 * or two later — which is exactly what the "Activating…" state waits for.
 *
 * ## Why this does not subscribe
 *
 * The seed gives `seed-demo-org` a live Standard plan, so the page opens in
 * its manage state and checkout is not on offer. What *is* exercised is the
 * rest of the contract's §6: the current plan with its two meters, an
 * upgrade with a proration preview that lands after Activating…, a
 * cancellation with a reason that shows the end date and a resume that
 * clears it, and a downgrade that is scheduled rather than applied.
 *
 * ## Order matters, and so does the seed
 *
 * The steps leave the workspace on Pro with a Standard downgrade scheduled.
 * Re-run `npm run db:seed` before the suite: the seed's subscription upsert
 * must reset the row (tier, status, identifier, schedule) for the first
 * assertion to hold. The first test checks the precondition and fails with
 * a readable message rather than part-way through a flow.
 *
 * Every assertion reads `data-testid` / `data-*` or a role, never a colour.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` (with `BILLING_SIMULATION=true`
 * in `.env`) in its own terminal.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
/** The simulation applies its events after 1–2 s; the page polls every 2 s for a minute. */
const WEBHOOK_TIMEOUT = 70_000;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

async function openBilling(page: Page) {
  await page.goto(`/${DEMO_ORG}/settings/billing`);
  // Scoped to main: the app shell's header repeats the page title in its own h1.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByTestId('billing-simulated')).toBeVisible();
}

const status = (page: Page) => page.getByTestId('billing-status');
const planCard = (page: Page, tier: string) => page.getByTestId(`billing-plan-${tier}`);

test.describe.configure({ mode: 'serial' });

test.describe('billing (simulation)', () => {
  test('shows the seeded Standard plan with both usage meters', async ({ page }) => {
    await signIn(page);
    await openBilling(page);

    await expect(status(page), 'Re-seed the database: the demo org must start on an active Standard plan').toHaveAttribute(
      'data-status',
      'active',
    );
    await expect(planCard(page, 'STANDARD')).toHaveAttribute('data-current', 'true');
    await expect(planCard(page, 'STANDARD').getByRole('button', { name: 'Current plan' })).toBeDisabled();
    await expect(page.getByTestId('billing-scheduled')).toHaveCount(0);

    const channels = page.getByTestId('billing-usage-channels');
    await expect(channels).toHaveAttribute('data-max', '5');
    await expect(channels).toHaveAttribute('data-used', /^\d+$/);

    const credits = page.getByTestId('billing-usage-credits');
    await expect(credits).toHaveAttribute('data-max', '100');
    await expect(credits).toHaveAttribute('data-used', /^\d+$/);

    // The period toggle re-prices the grid without changing the current plan.
    await page.getByRole('tab', { name: 'Yearly' }).click();
    await expect(planCard(page, 'PRO').getByText('$490')).toBeVisible();
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(planCard(page, 'PRO').getByText('$49')).toBeVisible();
  });

  test('upgrades to Pro after a proration preview and Activating…', async ({ page }) => {
    await signIn(page);
    await openBilling(page);

    await planCard(page, 'PRO').getByRole('button', { name: 'Upgrade' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Upgrade to Pro' })).toBeVisible();
    const preview = dialog.getByTestId('billing-preview');
    await expect(preview).toHaveAttribute('data-effective', 'now', { timeout: 20_000 });
    await expect(preview).toHaveAttribute('data-amount', /^\d+$/);

    await dialog.getByRole('button', { name: 'Confirm upgrade' }).click();

    // The pending state shows before the webhook lands, and the tier only
    // changes once it has.
    await expect(page.getByTestId('billing-activating')).toBeVisible();
    await expect(planCard(page, 'PRO')).toHaveAttribute('data-current', 'true', {
      timeout: WEBHOOK_TIMEOUT,
    });
    await expect(page.getByTestId('billing-activating')).toHaveCount(0, { timeout: 20_000 });
    await expect(status(page)).toHaveAttribute('data-status', 'active');
    await expect(page.getByTestId('billing-usage-channels')).toHaveAttribute('data-max', '15');
    await expect(page.getByTestId('billing-usage-credits')).toHaveAttribute('data-max', '500');
  });

  test('cancels with a reason, shows the end date, and resumes', async ({ page }) => {
    await signIn(page);
    await openBilling(page);

    await page.getByRole('button', { name: 'Cancel plan' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Cancel the .* plan\?/ })).toBeVisible();

    // The confirm button waits for a reason.
    await expect(dialog.getByRole('button', { name: 'Cancel plan' })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Reason' }).click();
    await page.getByRole('option', { name: 'Too expensive' }).click();
    await dialog.getByLabel('Anything else? (optional)').fill('E2E cancellation feedback.');
    await dialog.getByRole('button', { name: 'Cancel plan' }).click();

    await expect(status(page)).toHaveAttribute('data-status', 'canceling', { timeout: WEBHOOK_TIMEOUT });
    const cancelAt = page.getByTestId('billing-cancel-at');
    await expect(cancelAt).toContainText(/ends on/);
    await expect(cancelAt).toHaveAttribute('data-date', /^\d{4}-\d{2}-\d{2}T/);

    await page.getByRole('button', { name: 'Resume plan' }).click();
    await expect(status(page)).toHaveAttribute('data-status', 'active', { timeout: WEBHOOK_TIMEOUT });
    await expect(page.getByTestId('billing-cancel-at')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel plan' })).toBeVisible();
  });

  test('schedules a downgrade back to Standard for the period end', async ({ page }) => {
    await signIn(page);
    await openBilling(page);

    await planCard(page, 'STANDARD').getByRole('button', { name: 'Downgrade' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Switch to Standard' })).toBeVisible();
    await expect(dialog.getByTestId('billing-preview')).toHaveAttribute('data-effective', 'period_end', {
      timeout: 20_000,
    });
    await expect(dialog.getByTestId('billing-preview')).toHaveAttribute('data-amount', '2900');

    await dialog.getByRole('button', { name: 'Schedule change' }).click();

    // Nothing is applied now: still Pro, with the change recorded for later.
    const scheduled = page.getByTestId('billing-scheduled');
    await expect(scheduled).toBeVisible({ timeout: 20_000 });
    await expect(scheduled).toHaveAttribute('data-tier', 'STANDARD');
    await expect(planCard(page, 'PRO')).toHaveAttribute('data-current', 'true');
    await expect(planCard(page, 'STANDARD')).toHaveAttribute('data-action', 'scheduled');
    await expect(status(page)).toHaveAttribute('data-status', 'active');
  });

  test('a member who is not an admin sees the plan but cannot change it', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('member@postgear.local');
    await page.locator('#password').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
    await openBilling(page);

    await expect(status(page)).toHaveAttribute('data-status', /active|canceling/);
    await expect(page.getByRole('button', { name: 'Cancel plan' })).toHaveCount(0);
    await expect(planCard(page, 'TEAM').getByRole('button', { name: 'Upgrade' })).toBeDisabled();
    await expect(page.getByText('Only workspace admins can subscribe, change or cancel the plan.')).toBeVisible();
  });
});
