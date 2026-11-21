import { type BrowserContext, expect, type Page, type Response, test } from '@playwright/test';
import {
  API_URL,
  DEMO_EMAIL,
  DEMO_ORG,
  entitlements,
  getJson,
  MEMBER_EMAIL,
  prisma,
  SECOND_ORG,
  signInAs,
  stamp,
  switchOrg,
} from './helpers/clips';
import { pickDate } from './helpers/date-picker';

/**
 * The operator screen (Sprint 12, Module 19; Module 20 section 3): a plan
 * value edited with a reason reaches a Free workspace's Clips page and the
 * Change Log; an override changes one workspace's AI minutes and goes away again;
 * a member who is not an operator gets the 404 page.
 *
 * The demo user is the operator (`isSuperAdmin`). One sign-in for it and one
 * for the member. Saves print the owner mail to the API console outside
 * production; nothing is sent.
 *
 * `afterAll` puts every plan value back and removes any override left on the
 * Free workspace, then proves both in Postgres. The Change Log keeps its rows:
 * it is the audit history of what the run did.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const VIEWPORT = { width: 1440, height: 900 };
const RUN = stamp();
const STORAGE_KEY = 'clips.storage_gb';
const AI_KEY = 'clips.ai_minutes_per_month';

let context: BrowserContext;
let page: Page;
let free: BrowserContext;
let freePage: Page;
/** FREE `clips.storage_gb` as the run found it. */
let originalStorage: unknown = null;

interface PlanCell {
  tier: string;
  key: string;
  value: unknown;
  updatedAt: string | null;
}

interface OverrideRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

async function freeStorageCell(): Promise<PlanCell> {
  const plans = await getJson<{ cells: PlanCell[] }>(
    context.request,
    '/operator/entitlements/plans',
  );
  const cell = plans.cells.find((one) => one.tier === 'FREE' && one.key === STORAGE_KEY);
  if (!cell) throw new Error('No FREE clips.storage_gb cell');
  return cell;
}

async function secondOrgOverrides(): Promise<OverrideRow[]> {
  const view = await getJson<{ overrides: OverrideRow[] }>(
    context.request,
    `/operator/workspaces/${SECOND_ORG}/entitlements`,
  );
  return view.overrides;
}

function answer(target: Page, method: string, path: string | RegExp): Promise<Response> {
  return target.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().startsWith(API_URL) &&
      (typeof path === 'string'
        ? new URL(response.url()).pathname === path
        : path.test(new URL(response.url()).pathname)),
  );
}

/** Opens the operator screen on one of its tabs. */
async function openOperatorTab(name: string): Promise<void> {
  if (!page.url().includes('/operator')) await page.goto('/operator');
  const tabs = page.getByRole('tablist', { name: 'Operator tabs' });
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  await tabs.getByRole('tab', { name, exact: true }).click();
}

/** Reloads the Free workspace's Clips page until `check` passes (plan values settle in seconds). */
async function onFreeClipsPage(check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await freePage.goto(`/${SECOND_ORG}/clips`);
    await check();
  }).toPass({ timeout: 45_000, intervals: [2_000, 4_000] });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  await signInAs(page, DEMO_EMAIL, DEMO_ORG);
  originalStorage = (await freeStorageCell()).value;

  free = await browser.newContext({
    viewport: VIEWPORT,
    storageState: await context.storageState(),
  });
  freePage = await free.newPage();
  await switchOrg(free.request, SECOND_ORG);
});

test.afterAll(async () => {
  const restored: string[] = [];
  const cell = await freeStorageCell();
  if (JSON.stringify(cell.value) !== JSON.stringify(originalStorage)) {
    const put = await context.request.put(`${API_URL}/operator/entitlements/plans`, {
      data: {
        cells: [
          { tier: 'FREE', key: STORAGE_KEY, value: originalStorage, updatedAt: cell.updatedAt },
        ],
        reason: `End to end run ${RUN}: put the Free storage value back`,
      },
    });
    restored.push(`FREE ${STORAGE_KEY} back: HTTP ${put.status()}`);
  }
  for (const row of await secondOrgOverrides()) {
    if (row.key !== AI_KEY) continue;
    const removed = await context.request.delete(
      `${API_URL}/operator/workspaces/${SECOND_ORG}/overrides/${row.key}`,
      {
        data: {
          reason: `End to end run ${RUN}: remove the test override`,
          updatedAt: row.updatedAt,
        },
      },
    );
    restored.push(`override ${row.key} removed: HTTP ${removed.status()}`);
  }
  if (restored.length > 0) console.log(`[operator cleanup] ${restored.join('; ')}`);

  const stored = await prisma.planEntitlement.findFirst({
    where: { tier: 'FREE', key: STORAGE_KEY },
    select: { value: true },
  });
  const overrides = await prisma.orgEntitlementOverride.count({
    where: { organizationId: SECOND_ORG, key: AI_KEY },
  });
  console.log(
    `[operator cleanup] FREE ${STORAGE_KEY} = ${JSON.stringify(stored?.value)}, overrides left = ${overrides}`,
  );

  await free.close();
  await context.close();

  expect(stored?.value).toEqual(originalStorage);
  expect(overrides).toBe(0);
});

test('1. A Free plan value edited with a reason reaches the Free workspace and the Change Log', async () => {
  expect(originalStorage).toBe(3);
  const reason = `End to end run ${RUN}: Free storage from 3 to 4 GB`;

  // Before: the Free workspace's Clips page reads 3 GB.
  await onFreeClipsPage(async () => {
    await expect(freePage.getByTestId('clips-storage-meter')).toContainText('of 3 GB', {
      timeout: 5_000,
    });
  });

  await openOperatorTab('Plans');
  const table = page.getByTestId('plans-table');
  await table.getByRole('button', { name: 'Edit Clips Storage, Free', exact: true }).click();
  const field = table.getByRole('textbox', { name: /^Clips Storage/ });
  await field.fill('4');
  await field.press('Enter');

  await page.getByRole('button', { name: 'Review Changes', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Changes' });
  await expect(review.getByTestId('review-lines')).toContainText('Clips Storage, Free');
  await expect(review.getByTestId('review-lines')).toContainText('4');
  await review.getByLabel('Reason for this change').fill(reason);
  const saved = answer(page, 'PUT', '/operator/entitlements/plans');
  await review.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(review).toBeHidden();
  expect((await freeStorageCell()).value).toBe(4);

  // After: the Free workspace's limit reads 4 GB within seconds.
  await onFreeClipsPage(async () => {
    await expect(freePage.getByTestId('clips-storage-meter')).toContainText('of 4 GB', {
      timeout: 5_000,
    });
  });

  await openOperatorTab('Change Log');
  const log = page.getByTestId('change-log');
  const row = log.getByRole('row').filter({ hasText: reason });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Clips Storage');
  await expect(row).toContainText('Free');
});

test('2. An override changes the workspace AI minutes; removed, the plan value returns', async () => {
  // The Clips home no longer carries the AI minutes chip (2026-11-20), so the
  // Free workspace's limit is read from its plan snapshot, the chip's source.
  const freeAiLimit = async () =>
    (await entitlements(free.request)).meters[AI_KEY]?.limit ?? Number.NaN;
  const planLimit = await freeAiLimit();
  expect(planLimit).toBeGreaterThan(0);
  const overrideLimit = planLimit + 15;

  await openOperatorTab('Workspace Overrides');
  await page
    .getByRole('searchbox', { name: 'Search workspaces' })
    .or(page.getByLabel('Search workspaces'))
    .first()
    .fill('PostGear Second Org');
  await page
    .getByRole('list', { name: 'Workspaces' })
    .getByRole('button', { name: /PostGear Second Org/ })
    .click();
  await expect(page.getByTestId('operator-workspace')).toContainText('PostGear Second Org');

  const applies = page.getByRole('region', { name: 'What applies now' });
  const aiRow = applies.getByRole('row').filter({ hasText: 'AI Minutes' });
  await expect(aiRow).toContainText('Plan', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Add Override', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Override' });
  await dialog.getByLabel('Setting').click();
  await page.getByRole('option', { name: 'AI Minutes', exact: true }).click();
  const value = dialog.getByRole('textbox', { name: /^AI Minutes/ });
  await value.fill(String(overrideLimit));
  const ends = new Date();
  ends.setDate(ends.getDate() + 7);
  await pickDate(page, dialog.getByLabel('Ends on'), ends);
  await dialog
    .getByLabel('Reason for this change')
    .fill(`End to end run ${RUN}: a short AI minutes test`);
  const put = answer(page, 'PUT', `/operator/workspaces/${SECOND_ORG}/overrides/${AI_KEY}`);
  await dialog.getByRole('button', { name: 'Add Override', exact: true }).click();
  expect((await put).status()).toBe(200);
  await expect(page.getByText('The override is live for this workspace.')).toBeVisible();
  await expect(aiRow).toContainText('Override');

  await expect.poll(freeAiLimit, { timeout: 45_000 }).toBe(overrideLimit);

  const overrideRow = page
    .getByRole('region', { name: 'Overrides' })
    .getByRole('row')
    .filter({ hasText: 'AI Minutes' });
  await overrideRow.getByRole('button', { name: 'Remove Override' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Override' });
  await remove.getByLabel('Reason for this change').fill(`End to end run ${RUN}: the test is over`);
  const removed = answer(page, 'DELETE', `/operator/workspaces/${SECOND_ORG}/overrides/${AI_KEY}`);
  await remove.getByRole('button', { name: 'Remove Override', exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(
    page.getByText('The override was removed. The plan value applies now.'),
  ).toBeVisible();
  await expect(aiRow).toContainText('Plan');

  await expect.poll(freeAiLimit, { timeout: 45_000 }).toBe(planLimit);
});

test('3. A member who is not an operator gets the 404 page at /operator', async ({ browser }) => {
  const member = await browser.newContext({ viewport: VIEWPORT });
  const memberPage = await member.newPage();
  try {
    await signInAs(memberPage, MEMBER_EMAIL, null);
    await memberPage.goto('/operator');
    await expect(memberPage.getByText('Nothing scheduled here')).toBeVisible({ timeout: 30_000 });
    await expect(memberPage.getByRole('tablist', { name: 'Operator tabs' })).toHaveCount(0);

    const api = await member.request.get(`${API_URL}/operator/entitlements/plans`);
    expect([403, 404]).toContain(api.status());
  } finally {
    await member.close();
  }
});
