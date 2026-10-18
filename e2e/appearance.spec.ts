import { expect, type Page, test } from '@playwright/test';
import { prisma, Role } from '@postgear/db';
import { createUnonboardedUser, deleteUser, disconnect, type FixtureUser } from './helpers/users';

/**
 * Settings → Appearance: a fresh account is on Classic in both modes; a free
 * light or dark theme is saved to the account and survives a reload (a dark
 * one picked from a light page switching the mode to dark); and a premium
 * theme, light or dark, on a Free workspace previews, asks for an upgrade,
 * and is not saved.
 *
 * ## Why a fixture user, not the demo one
 *
 * The seeded demo workspace is on an active STANDARD plan, so the demo user
 * has the premium themes: the locked path cannot be exercised as them. And
 * the choice is per user: changing the demo user's mode or theme would
 * repaint every other spec running in parallel as that user. So this spec
 * writes its own onboarded user with one workspace that has no subscription
 * row (= the Free plan; a workspace created through the API would get a
 * trial), and deletes both afterwards.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, `npm run dev:api:e2e`.
 */

let user: FixtureUser;
let orgId: string;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgId}/`), { timeout: 20_000 });
}

async function openAppearance(page: Page) {
  await page.goto(`/${orgId}/settings/appearance`);
  // One grid at a time, for the scheme on screen.
  await expect(page.locator('[data-testid^="themes-"]')).toBeVisible();
}

function savedAppearance(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith('/users/me/appearance') && response.request().method() === 'PATCH',
  );
}

async function appearanceCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === 'pg_appearance')?.value;
}

function storedAppearance() {
  return prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { themeMode: true, lightTheme: true, darkTheme: true },
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  user = await createUnonboardedUser('appearance');
  const organization = await prisma.organization.create({
    data: { name: 'Appearance E2E' },
    select: { id: true },
  });
  orgId = organization.id;
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, role: Role.ADMIN },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { onboardingCompletedAt: new Date(), onboardingStep: 5 },
  });
});

test.afterAll(async () => {
  if (user) {
    await deleteUser(user.id);
  }
  await disconnect();
});

test.describe('appearance', () => {
  test('a fresh account is on Classic in both modes, with no theme attribute', async ({ page }) => {
    expect(await storedAppearance()).toEqual({
      themeMode: 'SYSTEM',
      lightTheme: 'classic',
      darkTheme: 'classic',
    });

    await signIn(page);
    await openAppearance(page);

    const body = page.locator('body');
    await expect(body).not.toHaveAttribute('data-light-theme');
    await expect(body).not.toHaveAttribute('data-dark-theme');
    await expect(page.getByTestId('mode-system')).toHaveAttribute('aria-pressed', 'true');
    // System on a light device (the runner's default): only the light grid shows.
    await expect(page.getByTestId('themes-light')).toBeVisible();
    await expect(page.getByTestId('themes-dark')).toHaveCount(0);
    await expect(page.getByTestId('theme-light-classic')).toHaveAttribute('aria-pressed', 'true');
    // The old "themes only apply in light mode" note is gone.
    await expect(page.getByTestId('appearance-dark-note')).toHaveCount(0);
  });

  test('a free light theme applies at once, is saved, and survives a reload', async ({ page }) => {
    await signIn(page);
    await openAppearance(page);

    // Light mode explicitly, so the theme is visible whatever the runner's
    // colour scheme is.
    const modeSaved = savedAppearance(page);
    await page.getByTestId('mode-light').click();
    expect((await modeSaved).ok()).toBeTruthy();
    await expect(page.locator('body')).toHaveClass(/\blight\b/);

    const themeSaved = savedAppearance(page);
    await page.getByTestId('theme-light-paper').click();
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'paper');
    expect((await themeSaved).ok()).toBeTruthy();
    await expect(page.getByTestId('theme-light-paper')).toHaveAttribute('aria-pressed', 'true');

    // The cookie is what the no-flash script paints from on the next load.
    expect(await appearanceCookie(page)).toBe('light.paper.classic');

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'paper');
    await expect(page.getByTestId('theme-light-paper')).toHaveAttribute('aria-pressed', 'true');

    // And it is the account's, not just this browser's.
    expect(await storedAppearance()).toEqual({
      themeMode: 'LIGHT',
      lightTheme: 'paper',
      darkTheme: 'classic',
    });
  });

  test('a premium light theme on a Free workspace previews, offers the upgrade, and is not saved', async ({
    page,
  }) => {
    await signIn(page);
    await openAppearance(page);
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'paper');

    const grape = page.getByTestId('theme-light-grape');
    await expect(grape).toContainText('Premium');
    await grape.click();

    const dialog = page.getByTestId('premium-theme-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Grape is a premium theme');
    await expect(dialog.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      `/${orgId}/settings/billing`,
    );
    // Previewing on the live page.
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'grape');

    await dialog.getByRole('button', { name: 'Keep current' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'paper');

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-light-theme', 'paper');

    // The server refuses it too, with the code the page branches on.
    const refused = await page.request.patch(`${API_URL}/users/me/appearance`, {
      data: { lightTheme: 'grape' },
    });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toMatchObject({ code: 'premium_theme_requires_plan' });

    expect((await storedAppearance()).lightTheme).toBe('paper');
  });

  test('switching to Dark swaps in the dark grid; a free dark theme is saved and survives a reload', async ({
    page,
  }) => {
    await signIn(page);
    await openAppearance(page);
    const body = page.locator('body');
    await expect(body).toHaveClass(/\blight\b/);
    await expect(page.getByTestId('themes-light')).toBeVisible();

    const modeSaved = savedAppearance(page);
    await page.getByTestId('mode-dark').click();
    expect((await modeSaved).ok()).toBeTruthy();
    await expect(body).toHaveClass(/\bdark\b/);
    await expect(page.getByTestId('themes-dark')).toBeVisible();
    await expect(page.getByTestId('themes-light')).toHaveCount(0);

    const saved = savedAppearance(page);
    await page.getByTestId('theme-dark-midnight').click();
    await expect(body).toHaveAttribute('data-dark-theme', 'midnight');
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    // The grid matches the mode on screen, so a pick never changes the mode.
    expect(response.request().postDataJSON()).toEqual({ darkTheme: 'midnight' });

    await expect(page.getByTestId('theme-dark-midnight')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mode-dark')).toHaveAttribute('aria-pressed', 'true');
    // The light choice is kept for the next switch back.
    await expect(body).toHaveAttribute('data-light-theme', 'paper');
    expect(await appearanceCookie(page)).toBe('dark.paper.midnight');

    await page.reload();
    await expect(body).toHaveClass(/\bdark\b/);
    await expect(body).toHaveAttribute('data-dark-theme', 'midnight');
    await expect(page.getByTestId('theme-dark-midnight')).toHaveAttribute('aria-pressed', 'true');
    // The theme's block wins over the base `.dark` one: Midnight's page, not #121212.
    await expect(body).toHaveCSS('background-color', 'rgb(11, 17, 32)');

    expect(await storedAppearance()).toEqual({
      themeMode: 'DARK',
      lightTheme: 'paper',
      darkTheme: 'midnight',
    });
  });

  test('a premium dark theme on a Free workspace previews, offers the upgrade, and is not saved', async ({
    page,
  }) => {
    await signIn(page);
    await openAppearance(page);
    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-dark-theme', 'midnight');

    const nebula = page.getByTestId('theme-dark-nebula');
    await expect(nebula).toContainText('Premium');
    await nebula.click();

    const dialog = page.getByTestId('premium-theme-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Nebula is a premium theme');
    await expect(body).toHaveAttribute('data-dark-theme', 'nebula');

    await dialog.getByRole('button', { name: 'Keep current' }).click();
    await expect(dialog).toBeHidden();
    await expect(body).toHaveAttribute('data-dark-theme', 'midnight');

    await page.reload();
    await expect(body).toHaveAttribute('data-dark-theme', 'midnight');

    const refused = await page.request.patch(`${API_URL}/users/me/appearance`, {
      data: { darkTheme: 'nebula' },
    });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toMatchObject({ code: 'premium_theme_requires_plan' });

    expect(await storedAppearance()).toEqual({
      themeMode: 'DARK',
      lightTheme: 'paper',
      darkTheme: 'midnight',
    });
  });
});
