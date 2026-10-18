import { type APIResponse, expect, type Page, test } from '@playwright/test';

/**
 * The public API, end to end (Sprint 8 Definition of Done, developers):
 *
 * - the API-keys page creates a key and shows the secret exactly once;
 * - that secret creates a post through `/v1/posts` and reads it back;
 * - revoking the key on the page makes the same secret a 401;
 * - a burst against `/v1/me` with the seeded key is throttled with
 *   `Retry-After`.
 *
 * The first three share one key and run in order; the burst uses the seeded
 * key (`npm run db:seed` writes it) so it never depends on the UI.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, and `npm run dev:api:e2e` in its own terminal. The
 * burst assumes the default `API_RATE_LIMIT_PER_MIN=60`; a run that raised
 * it past 70 would see no 429 and fail here for that reason alone.
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** `packages/db/prisma/seeds/index.ts`: DEMO_API_KEY_SECRET. */
const SEED_API_KEY = `pg_seedDemoKey${'0'.repeat(29)}`;
const SEED_LINKEDIN_CHANNEL = 'seed-channel-linkedin';

const SECRET_PATTERN = /^pg_[A-Za-z0-9_-]{40}$/;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

async function openApiKeys(page: Page) {
  await page.goto(`/${DEMO_ORG}/settings/api-keys`);
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'API keys' })).toHaveAttribute('aria-current', 'page');
}

function bearer(secret: string) {
  return { Authorization: `Bearer ${secret}` };
}

/** Posts created through the API, deleted through it afterwards with the seeded key. */
const created: string[] = [];

test.afterAll(async ({ request }) => {
  for (const id of created) {
    await request.delete(`${API_URL}/v1/posts/${id}`, { headers: bearer(SEED_API_KEY) }).catch(() => undefined);
  }
});

test.describe.serial('api keys and the public api', () => {
  let secret = '';
  let prefix = '';
  let keyName = '';

  test('the page creates a key, shows the secret once, and lists the row', async ({ page }) => {
    await signIn(page);
    await openApiKeys(page);

    keyName = `E2E key ${Date.now()}`;
    await page.getByRole('button', { name: 'Create key' }).first().click();
    await page.getByLabel(/^Name/).fill(keyName);
    await page.getByRole('button', { name: 'Create key' }).last().click();

    const field = page.getByTestId('api-key-secret');
    await expect(field).toBeVisible({ timeout: 20_000 });
    secret = await field.inputValue();
    expect(secret).toMatch(SECRET_PATTERN);
    prefix = secret.slice(0, 11);

    // The warning that this is the only showing, and the first curl to paste.
    await expect(page.getByText(/will not be shown again/)).toBeVisible();
    await expect(page.getByText(`curl -H "Authorization: Bearer ${secret}" ${API_URL}/v1/me`)).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();

    const row = page.locator(`[data-testid="api-key-row"][data-prefix="${prefix}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toHaveAttribute('data-status', 'live');
    await expect(row).toContainText(keyName);
    await expect(row).toContainText(`${prefix}…`);

    // The secret is gone from the page: only the prefix remains.
    await expect(page.getByText(secret)).toHaveCount(0);
  });

  test('the secret creates a post through /v1/posts and reads it back', async ({ request }) => {
    expect(secret).toMatch(SECRET_PATTERN);

    const me = await request.get(`${API_URL}/v1/me`, { headers: bearer(secret) });
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({
      workspace: { id: DEMO_ORG },
      key: { name: keyName, prefix },
    });

    const createResponse = await request.post(`${API_URL}/v1/posts`, {
      headers: bearer(secret),
      data: { text: 'Hello from the API', channelIds: [SEED_LINKEDIN_CHANNEL], state: 'draft' },
    });
    expect(createResponse.status()).toBe(201);
    const { post } = (await createResponse.json()) as {
      post: { id: string; state: string; parts: { text: string }[] };
    };
    created.push(post.id);
    expect(post.state).toBe('DRAFT');
    expect(post.parts[0].text).toBe('Hello from the API');

    const readResponse = await request.get(`${API_URL}/v1/posts/${post.id}`, {
      headers: bearer(secret),
    });
    expect(readResponse.status()).toBe(200);
    const read = (await readResponse.json()) as {
      post: { id: string; parts: { text: string }[]; channels: { channelId: string }[] };
    };
    expect(read.post.id).toBe(post.id);
    expect(read.post.parts[0].text).toBe('Hello from the API');
    expect(read.post.channels.map((channel) => channel.channelId)).toEqual([SEED_LINKEDIN_CHANNEL]);

    // The list sees it too.
    const listResponse = await request.get(`${API_URL}/v1/posts?state=draft`, {
      headers: bearer(secret),
    });
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as { posts: { id: string }[] };
    expect(list.posts.map((entry) => entry.id)).toContain(post.id);
  });

  test('revoking the key on the page makes the same secret a 401', async ({ page }) => {
    expect(secret).toMatch(SECRET_PATTERN);

    await signIn(page);
    await openApiKeys(page);

    const row = page.locator(`[data-testid="api-key-row"][data-prefix="${prefix}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Revoke ${keyName}` }).click();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();

    await expect(row).toHaveAttribute('data-status', 'revoked', { timeout: 20_000 });
    await expect(row.getByRole('button')).toHaveCount(0);

    const refused = await page.request.get(`${API_URL}/v1/me`, { headers: bearer(secret) });
    expect(refused.status()).toBe(401);
    expect(await refused.json()).toEqual({ error: 'Invalid API key', statusCode: 401 });
  });
});

test.describe('the per-key ceiling', () => {
  test('a burst of 70 calls with the seeded key sees a 429 with Retry-After', async ({ request }) => {
    const responses: APIResponse[] = await Promise.all(
      Array.from({ length: 70 }, () =>
        request.get(`${API_URL}/v1/me`, { headers: bearer(SEED_API_KEY) }),
      ),
    );

    const statuses = responses.map((response) => response.status());
    expect(statuses).toContain(200);
    expect(statuses).toContain(429);

    const throttled = responses.find((response) => response.status() === 429);
    expect(throttled).toBeDefined();
    if (!throttled) {
      return;
    }

    expect(Number(throttled.headers()['retry-after'])).toBeGreaterThan(0);
    expect(await throttled.json()).toEqual({ error: 'Rate limit exceeded', statusCode: 429 });
  });

  test('a missing or malformed key is refused with one message', async ({ request }) => {
    const missing = await request.get(`${API_URL}/v1/me`);
    expect(missing.status()).toBe(401);
    expect(await missing.json()).toEqual({ error: 'Invalid API key', statusCode: 401 });

    const malformed = await request.get(`${API_URL}/v1/me`, { headers: bearer('not-a-key') });
    expect(malformed.status()).toBe(401);
    expect(await malformed.json()).toEqual({ error: 'Invalid API key', statusCode: 401 });
  });
});
