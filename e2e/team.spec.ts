import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { prisma } from '@postgear/db';
import { createUnonboardedUser, deleteUser, disconnect, type FixtureUser } from './helpers/users';

/**
 * Settings > Team, end to end (2026-10-19):
 *
 * - an admin sees the members, marked "(you)" on their own row, and can make
 *   a copy-only invitation link;
 * - an admin changes a member's role and back;
 * - the last admin is refused when trying to leave;
 * - a plain member sees the same list read-only;
 * - a brand-new account opens an invitation signed out, signs in through
 *   `?next=`, joins, finds the link used up, and leaves again.
 *
 * Each person signs in once, and the tests run in order on one shared page
 * per person: the API's sign-in throttle is per address and the suite is not
 * the only thing signing in. Nothing seeded is left changed: the member's
 * role is put back (through the API, and by the database in `afterAll` if a
 * test failed half way), and the throwaway account goes with its membership.
 *
 * Prerequisites as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and the API running.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const DEMO_ORG_NAME = 'PostGear Demo Org';
const MEMBER_USER_ID = 'seed-member-user';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const WEB_ORIGIN = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3000}`;

test.describe.configure({ mode: 'serial' });

let admin: { context: BrowserContext; page: Page };
let fixture: FixtureUser | null = null;
/** Created by the admin for the fixture account, bound to its address. */
let inviteUrl = '';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function openTeam(page: Page) {
  await page.goto(`/${DEMO_ORG}/settings/team`);
  await expect(
    page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Team' }),
  ).toHaveAttribute('aria-current', 'page');
}

function row(page: Page, email: string) {
  return page.locator(`[data-testid="team-member"][data-email="${email}"]`);
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_ORIGIN });
  const page = await context.newPage();
  await signIn(page, 'demo@postgear.local', SEED_PASSWORD);
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
  // The admin is in two workspaces, so sign-in picked no active one; the
  // admin routes act on that cookie. The request shares the page's cookies.
  expect((await page.request.post(`${API_URL}/orgs/${DEMO_ORG}/switch`)).status()).toBe(200);
  admin = { context, page };
});

test.afterAll(async () => {
  await prisma.userOrganization.updateMany({
    where: { userId: MEMBER_USER_ID, organizationId: DEMO_ORG },
    data: { role: 'USER' },
  });
  if (fixture) {
    await deleteUser(fixture.id);
  }
  await admin?.context.close();
  await disconnect();
});

test('an admin sees every member, their own row marked and without a remove', async () => {
  const { page } = admin;
  await openTeam(page);

  await expect(page.getByRole('button', { name: 'Invite member' })).toBeVisible();

  const me = row(page, 'demo@postgear.local');
  await expect(me).toContainText('Demo Admin (you)');
  await expect(me.getByRole('combobox', { name: 'Your role' })).toHaveText('Admin');
  await expect(me.getByRole('button', { name: 'Leave workspace' })).toBeVisible();
  await expect(me.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

  const member = row(page, 'member@postgear.local');
  await expect(member).toContainText('Regular Member');
  await expect(member).not.toContainText('(you)');
  await expect(member.getByRole('combobox', { name: 'Role of Regular Member' })).toHaveText(
    'Member',
  );
  await expect(member.getByRole('button', { name: 'Remove Regular Member' })).toBeVisible();
});

test('an admin copies an invitation link instead of emailing it', async () => {
  const { page } = admin;

  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeVisible();

  await dialog.getByLabel('Send invitation by email').click();
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/orgs/${DEMO_ORG}/invites` &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Copy link' }).click();

  const response = await created;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { url: string; expiresAt: string };
  expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
  expect(body.url).toMatch(/\/invite\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  await expect(page.getByText('Invite link copied', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body.url);

  // The link names the workspace to anyone holding it, signed in or not.
  const token = body.url.split('/invite/')[1];
  const preview = await page.request.get(`${API_URL}/orgs/invites/${token}`);
  expect(await preview.json()).toMatchObject({
    workspaceName: DEMO_ORG_NAME,
    role: 'USER',
    alreadyMember: true,
  });
});

test('an admin makes a member an admin and back', async () => {
  const { page } = admin;
  const member = row(page, 'member@postgear.local');
  const picker = member.getByRole('combobox', { name: 'Role of Regular Member' });

  for (const [label, role] of [
    ['Admin', 'ADMIN'],
    ['Member', 'USER'],
  ] as const) {
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/orgs/${DEMO_ORG}/members/${MEMBER_USER_ID}` &&
        response.request().method() === 'PATCH',
    );
    await picker.click();
    await page.getByRole('option', { name: label }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText('Role updated', { exact: true }).first()).toBeVisible();

    await openTeam(page);
    await expect(member).toHaveAttribute('data-role', role);
    await expect(picker).toHaveText(label);
  }
});

test('the last admin is told to promote someone before leaving', async () => {
  const { page } = admin;

  // Guard rail: this only clicks "Leave" while the API is certain to refuse.
  const admins = await prisma.userOrganization.count({
    where: { organizationId: DEMO_ORG, role: 'ADMIN', disabled: false },
  });
  expect(admins).toBe(1);

  await row(page, 'demo@postgear.local').getByRole('button', { name: 'Leave workspace' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: `Leave ${DEMO_ORG_NAME}?` })).toBeVisible();
  await confirm.getByRole('button', { name: 'Leave workspace' }).click();

  await expect(
    page.getByText('Promote someone else to admin before you leave.', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/settings/team$`));
  await expect(row(page, 'demo@postgear.local')).toBeVisible();
});

test('an admin creates an invitation bound to one address', async () => {
  fixture = await createUnonboardedUser('team-invite');

  const response = await admin.page.request.post(`${API_URL}/orgs/${DEMO_ORG}/invites`, {
    data: { role: 'USER', sendEmail: false, email: fixture.email },
  });
  expect(response.status()).toBe(201);
  inviteUrl = ((await response.json()) as { url: string }).url;
});

test('a member sees the team read-only', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signIn(page, 'member@postgear.local', SEED_PASSWORD);
    await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
    await openTeam(page);

    const list = page.getByRole('list', { name: `Members of ${DEMO_ORG_NAME}` });
    await expect(row(page, 'demo@postgear.local')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
    await expect(list.getByRole('combobox')).toHaveCount(0);
    await expect(list.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

    await expect(row(page, 'demo@postgear.local').getByTestId('team-member-role')).toHaveText(
      'Admin',
    );
    const me = row(page, 'member@postgear.local');
    await expect(me).toContainText('Regular Member (you)');
    await expect(me.getByTestId('team-member-role')).toHaveText('Member');
    await expect(me.getByRole('button', { name: 'Leave workspace' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a new account joins through the link, which then cannot be used again, and leaves', async ({
  browser,
  request,
}) => {
  expect(fixture).not.toBeNull();
  const invitee = fixture as FixtureUser;
  const path = new URL(inviteUrl).pathname;
  const token = path.split('/invite/')[1];

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Signed out: the workspace and the two ways in, both coming back here.
    await page.goto(path);
    await expect(page.getByRole('heading', { name: `Join ${DEMO_ORG_NAME}` })).toBeVisible();
    await expect(page.getByText(`It was sent to ${invitee.email}.`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/register?next=${encodeURIComponent(path)}`,
    );

    await page.getByRole('link', { name: 'Sign in to join' }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await page.getByLabel('Email').fill(invitee.email);
    await page.locator('#password').fill(invitee.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Back on the invitation, signed in.
    await expect(page).toHaveURL(path, { timeout: 20_000 });
    await expect(page.getByText(`Signed in as ${invitee.email}`)).toBeVisible();
    await page.getByTestId('invite-join').click();

    // Not onboarded yet, so the dashboard's gate takes over, past step 1.
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    const joined = await prisma.userOrganization.findFirst({
      where: { userId: invitee.id, organizationId: DEMO_ORG },
      select: { role: true },
    });
    expect(joined?.role).toBe('USER');
    const onboarding = await prisma.user.findUnique({
      where: { id: invitee.id },
      select: { onboardingStep: true },
    });
    expect(onboarding?.onboardingStep).toBe(2);

    // Single use: nobody else can open it now. The person who used it sees
    // that they are in already.
    const used = await request.get(`${API_URL}/orgs/invites/${token}`);
    expect(used.status()).toBe(410);
    expect(((await used.json()) as { error: string }).error).toMatch(/already been used/);
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: `You're already in ${DEMO_ORG_NAME}` }),
    ).toBeVisible();

    // Leaving: finish onboarding by hand so the dashboard opens, then leave.
    // That was their only workspace, so they land back in onboarding.
    await prisma.user.update({
      where: { id: invitee.id },
      data: { onboardingCompletedAt: new Date(), onboardingStep: 6 },
    });
    await openTeam(page);
    const me = row(page, invitee.email);
    await expect(me).toContainText('(you)');
    await me.getByRole('button', { name: 'Leave workspace' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Leave workspace' }).click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    expect(
      await prisma.userOrganization.count({
        where: { userId: invitee.id, organizationId: DEMO_ORG },
      }),
    ).toBe(0);
    const after = await prisma.user.findUnique({
      where: { id: invitee.id },
      select: { onboardingCompletedAt: true, onboardingStep: true },
    });
    expect(after).toEqual({ onboardingCompletedAt: null, onboardingStep: 1 });
  } finally {
    await context.close();
  }
});
