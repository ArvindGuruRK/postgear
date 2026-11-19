import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  API_URL,
  createClipApi,
  createFreeWorkspace,
  deleteWorkspace,
  entitlements,
  type MeterView,
  prisma,
  signInAs,
  stamp,
  waitForVideoReady,
} from './helpers/clips';
import { createUnonboardedUser, deleteUser, type FixtureUser } from './helpers/users';

/**
 * Clips limits under load and across a plan change (Sprint 12, Module 20).
 *
 * A throwaway Free workspace and its admin are made in Postgres (one sign-in,
 * nothing seeded is touched), with an override that leaves room for exactly
 * three ten minute imports (30 import minutes).
 *
 * - **Load**: twenty imports fired at once. Exactly three are charged; every
 *   other one is refused, and the meter never reads below zero or above its
 *   limit, during the burst or after it.
 * - **Plan change**: a BILLING_SIMULATION upgrade to Pro moves
 *   `GET /entitlements/me` and the editor's export quality tiles within
 *   seconds.
 *
 * `afterAll` deletes the videos through the API (their files go too), then
 * the workspace (its subscription, billing rows, ledger and override with it)
 * and the user, and proves none of it is left.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const VIEWPORT = { width: 1440, height: 900 };
const RUN = stamp();
const IMPORT_METER = 'clips.import_minutes_per_month';
const ROOM_MINUTES = 30;
const PLAN_SENTENCE_START = `You have used all ${ROOM_MINUTES} import minutes for this month.`;
const THROTTLE_SENTENCE = 'You are checking links very quickly. Wait a minute, then try again.';

/** Twenty different finished ten minute streams (simulation: channel items and samples). */
const TEN_MINUTE_LINKS = [
  'https://www.twitch.tv/videos/900000001',
  'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001',
  ...[103, 105, 107, 109, 111, 113, 115, 117, 118].flatMap((n) => [
    `https://www.twitch.tv/videos/900000${n}`,
    `https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000${n}`,
  ]),
];

let user: FixtureUser;
let orgId = '';
let context: BrowserContext;
let page: Page;
const charged: string[] = [];
const clips: string[] = [];

test.beforeAll(async ({ browser }) => {
  user = await createUnonboardedUser('clips-limits');
  await prisma.user.update({
    where: { id: user.id },
    data: { onboardingStep: 5, onboardingCompletedAt: new Date() },
  });
  orgId = await createFreeWorkspace(user.id, `E2E Clips Limits ${RUN}`);
  await prisma.orgEntitlementOverride.create({
    data: {
      organizationId: orgId,
      key: IMPORT_METER,
      value: ROOM_MINUTES,
      reason: `End to end run ${RUN}: room for exactly three ten minute imports`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: user.email,
    },
  });

  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  await signInAs(page, user.email, orgId, user.password);
});

test.afterAll(async () => {
  const problems: string[] = [];
  for (const id of clips) {
    const status = (await context.request.delete(`${API_URL}/clips/${id}`)).status();
    if (status >= 400 && status !== 404) problems.push(`DELETE /clips/${id}: ${status}`);
  }
  for (const id of charged) {
    const status = (await context.request.delete(`${API_URL}/clips/videos/${id}`)).status();
    if (status >= 400 && status !== 404) problems.push(`DELETE /clips/videos/${id}: ${status}`);
  }
  await context.close();
  if (orgId) await deleteWorkspace(orgId);
  if (user) await deleteUser(user.id);

  const left = {
    workspace: await prisma.organization.count({ where: { id: orgId } }),
    user: await prisma.user.count({ where: { id: user.id } }),
    override: await prisma.orgEntitlementOverride.count({ where: { organizationId: orgId } }),
    ledger: await prisma.usageEntry.count({ where: { organizationId: orgId } }),
    videos: await prisma.clipVideo.count({ where: { organizationId: orgId } }),
    subscription: await prisma.subscription.count({ where: { organizationId: orgId } }),
  };
  console.log(`[clips-limits cleanup] ${JSON.stringify(left)} ${problems.join('; ')}`);
  expect(problems).toEqual([]);
  expect(
    Object.values(left).every((n) => n === 0),
    JSON.stringify(left),
  ).toBe(true);
});

test('Twenty imports at once against room for three: three are charged, the rest refused', async () => {
  const before = (await entitlements(page.request)).meters[IMPORT_METER];
  expect(before).toMatchObject({ used: 0, limit: ROOM_MINUTES });

  // Read the meter all through the burst.
  const samples: MeterView[] = [];
  let reading = true;
  const reader = (async () => {
    while (reading) {
      const meter = (await entitlements(page.request)).meters[IMPORT_METER];
      if (meter) samples.push(meter);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();

  const answers = await Promise.all(
    TEN_MINUTE_LINKS.map(async (url) => {
      const response = await page.request.post(`${API_URL}/clips/videos`, {
        data: { url, rightsConfirmed: true },
      });
      const body = (await response.json()) as {
        video?: { id: string };
        code?: string;
        /** The API's sentence (the global filter names it `error`). */
        error?: string;
      };
      return { url, status: response.status(), body };
    }),
  );
  reading = false;
  await reader;

  const tally = answers.map((one) => `${one.status} ${one.body.code ?? ''}`.trim());
  console.log(`[load] answers: ${JSON.stringify(tally)}`);

  const imported = answers.filter((one) => one.status === 201);
  for (const one of imported) if (one.body.video) charged.push(one.body.video.id);
  expect(imported, 'exactly three imports are charged').toHaveLength(3);

  // Every other one is refused: the plan's sentence, or the probe throttle that
  // stands in front of it (ten probes a minute per workspace; see the report).
  const refused = answers.filter((one) => one.status !== 201);
  for (const one of refused) {
    if (one.status === 402) {
      expect(one.body.code).toBe('clips_minutes_used');
      expect(one.body.error).toContain(PLAN_SENTENCE_START);
      expect(one.body.error).toContain('or you can upgrade the plan.');
    } else {
      expect(one.status, `${one.url}: ${JSON.stringify(one.body)}`).toBe(429);
      expect(one.body.error).toBe(THROTTLE_SENTENCE);
    }
  }
  expect(refused.filter((one) => one.status === 402).length).toBeGreaterThanOrEqual(1);

  // The meter never went below zero or past its limit.
  expect(samples.length).toBeGreaterThan(0);
  for (const meter of samples) {
    expect(meter.used).toBeGreaterThanOrEqual(0);
    expect(meter.used).toBeLessThanOrEqual(ROOM_MINUTES);
    expect(meter.remaining ?? 0).toBeGreaterThanOrEqual(0);
  }
  const after = (await entitlements(page.request)).meters[IMPORT_METER];
  expect(after).toMatchObject({ used: ROOM_MINUTES, remaining: 0 });

  // The ledger agrees: three charges of ten minutes, in thousandths.
  const ledger = await prisma.usageEntry.aggregate({
    where: { organizationId: orgId, meter: IMPORT_METER },
    _sum: { units: true },
  });
  expect(ledger._sum.units).toBe(ROOM_MINUTES * 1000);

  for (const id of charged) await waitForVideoReady(page.request, id, 120_000);
});

test('A simulated upgrade moves /entitlements/me within seconds', async () => {
  const videoId = charged[0];
  if (!videoId) throw new Error('No imported video to clip');
  const { clipId } = await createClipApi(page.request, videoId, 2_000, 7_000);
  clips.push(clipId);

  await page.goto(`/${orgId}/clips/edit/${clipId}`);
  const shape = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'What Do You Want To Make?' }) });
  await expect(shape).toBeVisible({ timeout: 60_000 });
  await shape.getByTestId('clip-shape-continue').click();
  await page.getByTestId('clip-tab-export').click();
  const panel = page.getByTestId('clip-export-panel');
  await expect(
    panel.getByRole('button', { name: '1080p 60 fps, locked', exact: true }),
  ).toBeVisible();

  const free = await entitlements(page.request);
  expect(free.tier).toBe('FREE');
  expect(free.values['clips.export_max_quality']).toBe('720p');

  const checkout = await page.request.post(`${API_URL}/billing/checkout`, {
    data: { tier: 'PRO', period: 'MONTHLY' },
  });
  expect(checkout.ok(), await checkout.text()).toBe(true);
  const upgradedAt = Date.now();

  await expect
    .poll(async () => (await entitlements(page.request)).tier, {
      timeout: 30_000,
      intervals: [500],
    })
    .toBe('PRO');
  const pro = await entitlements(page.request);
  expect(pro.values['clips.export_max_quality']).toBe('1080p60');
  console.log(`[plan change] /entitlements/me read PRO after ${Date.now() - upgradedAt} ms`);
});

test('The open editor follows the upgrade: its 1080p 60 fps tile unlocks within seconds', async () => {
  // Fixed in Module 20: an open screen checks the plan answer's age every five
  // seconds (apps/web/src/lib/entitlements.ts) and asks again past 15 seconds.
  const panel = page.getByTestId('clip-export-panel');
  await expect(async () => {
    await page.getByTestId('clip-tab-layouts').click();
    await page.getByTestId('clip-tab-export').click();
    await expect(panel.getByRole('button', { name: /^1080p 60 fps/ })).not.toHaveAccessibleName(
      /locked/,
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
});
