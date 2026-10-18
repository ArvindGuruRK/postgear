import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { verifyWebhookSignature } from '@postgear/db';

/**
 * Outbound webhooks (Sprint 8): the Definition of Done item "receive a
 * webhook when it publishes", proven with a real receiver: this test hosts
 * one, registers it through the settings page, sends a test delivery, and
 * checks the request the worker made (headers, a verifiable signature, the
 * documented payload) and the delivery history the page then shows.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, `npm run dev:api:e2e` and `npm run dev:worker` in their
 * own terminals, with `WEBHOOK_ALLOW_PRIVATE_URLS="true"` in `.env` (the
 * receiver is on this machine, which the SSRF guard otherwise refuses).
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
/** A delivery goes through Temporal; a cold worker can take a few seconds. */
const DELIVERY_TIMEOUT = 60_000;

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(calendar|channels)/, { timeout: 20_000 });
}

let server: Server;
let receiverUrl: string;
const received: Received[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/postgear`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe('webhooks', () => {
  test('registers a receiver, sends a signed test delivery to it, and shows the delivery as delivered', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/settings/webhooks`);
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'page');

    const name = `E2E receiver ${Date.now()}`;
    await page.getByTestId('webhook-add').click();
    await page.getByLabel(/^Name/).fill(name);
    await page.getByLabel(/^URL/).fill(receiverUrl);
    await page.getByTestId('webhook-save').click();

    // The secret is shown once, in the dialog, and carried on the panel for the test.
    const panel = page.getByTestId('webhook-secret');
    await expect(panel).toBeVisible();
    const secret = await panel.getAttribute('data-secret');
    expect(secret).toMatch(/^whsec_/);
    await page.getByTestId('webhook-secret-done').click();

    const row = page.locator('[data-testid="webhook-row"]', { hasText: name });
    await expect(row).toBeVisible();

    // Send a test through the kebab menu.
    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Send test' }).click();

    // The receiver gets exactly one signed request.
    await expect
      .poll(() => received.length, { timeout: DELIVERY_TIMEOUT, message: 'the worker delivered the test' })
      .toBeGreaterThan(0);
    const [request] = received;
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['x-postgear-event']).toBe('webhook.test');
    expect(request.headers['x-postgear-delivery']).toMatch(/[0-9a-f-]{36}/);
    expect(
      verifyWebhookSignature({
        secret: secret as string,
        body: request.body,
        signatureHeader: request.headers['x-postgear-signature'] as string,
        timestampHeader: request.headers['x-postgear-timestamp'] as string,
      }),
    ).toEqual({ ok: true });

    const payload = JSON.parse(request.body) as {
      id: string;
      event: string;
      workspaceId: string;
      data: { post: { id: string; channel: { provider: string } } };
    };
    expect(payload.event).toBe('webhook.test');
    expect(payload.workspaceId).toBe(DEMO_ORG);
    expect(payload.id).toBe(request.headers['x-postgear-delivery']);
    expect(payload.data.post.channel.provider).toBeTruthy();

    // The deliveries sheet opened by the test send shows it delivered.
    const delivery = page.locator('[data-testid="webhook-delivery"][data-event="webhook.test"]').first();
    await expect(delivery).toHaveAttribute('data-status', 'DELIVERED', { timeout: DELIVERY_TIMEOUT });
    await page.keyboard.press('Escape');

    // Clean up through the UI: delete the hook.
    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByTestId('webhook-delete-confirm').click();
    await expect(row).toHaveCount(0);
  });

  test('refuses a private address when the deployment does not allow them, or accepts it when it does', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/${DEMO_ORG}/settings/webhooks`);
    await page.getByTestId('webhook-add').click();
    await page.getByLabel(/^Name/).fill('Metadata probe');
    await page.getByLabel(/^URL/).fill('https://169.254.169.254/latest/meta-data');
    await page.getByTestId('webhook-save').click();

    // With private URLs allowed (the local setting) the API accepts it; without,
    // the SSRF guard's message appears under the form. Either way, nothing crashes.
    const secret = page.getByTestId('webhook-secret');
    const error = page.getByRole('alert').filter({ hasText: /private|internal|https/ });
    await expect(secret.or(error).first()).toBeVisible({ timeout: 15_000 });

    if (await secret.isVisible()) {
      await page.getByTestId('webhook-secret-done').click();
      const row = page.locator('[data-testid="webhook-row"]', { hasText: 'Metadata probe' });
      await row.getByRole('button', { name: 'Actions for Metadata probe' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByTestId('webhook-delete-confirm').click();
      await expect(row).toHaveCount(0);
    }
  });
});
