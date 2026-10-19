import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';

/**
 * Settings > Signatures (2026-10-19): adding, editing and deleting a
 * signature, the one "Default" (added to new posts automatically), and the
 * list a member sees, read-only.
 *
 * Every signature a test adds is deleted again, and if the workspace had a
 * default of its own before the run, it is made the default again: marking
 * a new one as default takes the mark off the old one.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe.configure({ mode: 'serial' });

interface ApiSignature {
  id: string;
  content: string;
  autoAdd: boolean;
}

async function signIn(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
  return { context, page };
}

async function list(page: Page): Promise<ApiSignature[]> {
  const response = await page.request.get(`${API_URL}/signatures`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { signatures: ApiSignature[] }).signatures;
}

let admin: { context: BrowserContext; page: Page };
let previousDefault: string | null = null;
const created: string[] = [];

test.beforeAll(async ({ browser }) => {
  admin = await signIn(browser, 'demo@postgear.local');
  previousDefault = (await list(admin.page)).find((signature) => signature.autoAdd)?.id ?? null;
});

test.afterAll(async () => {
  const { page } = admin;
  const left = await list(page);
  for (const signature of left.filter(
    (entry) => created.includes(entry.id) || entry.content.startsWith('E2E signature'),
  )) {
    await page.request.delete(`${API_URL}/signatures/${signature.id}`);
  }
  if (previousDefault) {
    await page.request.patch(`${API_URL}/signatures/${previousDefault}`, {
      data: { autoAdd: true },
    });
  }
  await admin.context.close();
});

test('an admin adds, edits, re-defaults and deletes signatures', async () => {
  const { page } = admin;
  await page.goto(`/${DEMO_ORG}/settings/signatures`);
  // Named by the top bar and the settings nav only.
  await expect(page.getByRole('link', { name: 'Signatures' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const stamp = Date.now();
  const first = `E2E signature one ${stamp}\nSecond line`;
  const second = `E2E signature two ${stamp}`;

  // Add the first, as the default.
  await page.getByTestId('signature-add').click();
  let dialog = page.getByRole('dialog', { name: 'Add signature' });
  await dialog.getByLabel('Signature').fill(first);
  await dialog.getByRole('switch', { name: 'Add to new posts automatically' }).click();
  await dialog.getByTestId('signature-save').click();
  await expect(page.getByText('Signature added', { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  const firstRow = page
    .getByTestId('signature-row')
    .filter({ hasText: `E2E signature one ${stamp}` });
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toHaveAttribute('data-default', 'true');
  await expect(firstRow.getByText('Default', { exact: true })).toBeVisible();
  created.push((await firstRow.getAttribute('data-signature-id')) ?? '');

  // Add the second, not the default.
  await page.getByTestId('signature-add').click();
  dialog = page.getByRole('dialog', { name: 'Add signature' });
  await dialog.getByLabel('Signature').fill(second);
  await dialog.getByTestId('signature-save').click();
  const secondRow = page.getByTestId('signature-row').filter({ hasText: second });
  await expect(secondRow).toBeVisible();
  await expect(secondRow).toHaveAttribute('data-default', 'false');
  created.push((await secondRow.getAttribute('data-signature-id')) ?? '');

  // Edit the second: new text, and make it the default. The first loses it.
  await secondRow.getByRole('button', { name: 'Edit signature' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit signature' });
  await expect(dialog.getByLabel('Signature')).toHaveValue(second);
  await dialog.getByLabel('Signature').fill(`${second} edited`);
  await dialog.getByRole('switch', { name: 'Add to new posts automatically' }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Signature saved', { exact: true })).toBeVisible();
  await expect(secondRow).toContainText(`${second} edited`);
  await expect(secondRow).toHaveAttribute('data-default', 'true');
  await expect(firstRow).toHaveAttribute('data-default', 'false');

  const defaults = (await list(page)).filter((signature) => signature.autoAdd);
  expect(defaults.map((signature) => signature.content)).toEqual([`${second} edited`]);

  // Delete both, each after a confirmation; backing out of one first.
  await firstRow.getByRole('button', { name: 'Delete signature' }).click();
  let confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('Delete this signature?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(firstRow).toBeVisible();

  for (const row of [firstRow, secondRow]) {
    await row.getByRole('button', { name: 'Delete signature' }).click();
    confirm = page.getByRole('alertdialog');
    await confirm.getByTestId('signature-delete-confirm').click();
    await expect(row).toHaveCount(0);
  }
  await expect(page.getByText('Signature deleted', { exact: true }).first()).toBeVisible();
});

test('a member sees the signatures but cannot change them', async ({ browser }) => {
  // A signature for the member to see, made and removed by the admin.
  const response = await admin.page.request.post(`${API_URL}/signatures`, {
    data: { content: `E2E signature for members ${Date.now()}`, autoAdd: false },
  });
  expect(response.ok()).toBeTruthy();
  const { signature } = (await response.json()) as { signature: ApiSignature };
  created.push(signature.id);

  const member = await signIn(browser, 'member@postgear.local');
  await member.page.goto(`/${DEMO_ORG}/settings/signatures`);
  const row = member.page.getByTestId('signature-row').filter({ hasText: signature.content });
  await expect(row).toBeVisible();
  await expect(member.page.getByTestId('signature-add')).toHaveCount(0);
  await expect(row.getByRole('button')).toHaveCount(0);
  await expect(
    member.page.getByText('Only workspace admins can add or change signatures.'),
  ).toBeVisible();

  // The API agrees: a member's write is refused.
  const refused = await member.page.request.delete(`${API_URL}/signatures/${signature.id}`);
  expect(refused.status()).toBe(403);
  await member.context.close();
});
