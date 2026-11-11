import { expect, type Page, type Request } from '@playwright/test';

/**
 * What the Discover spec shares: signing in as a seeded account, opening the
 * page, and a browser-side stand-in for `POST /ai/generate`.
 *
 * ## Why the generation is answered in the browser
 *
 * `AI_SIMULATION=true` makes the model free, but a generation still charges
 * the workspace's credits, and the seeded allowance is small and shared with
 * every other spec and every hand check. Create Post's own contract is what
 * this spec owns (what the sheet sends, and what it does with the answer), so
 * the stream is fulfilled here with the same events the API sends and nothing
 * is charged. The pipeline behind that endpoint has its own spec
 * (`ai.spec.ts`).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const DEMO_ORG = 'seed-demo-org';
/** The seeded workspace nobody saved a Discover place for: it starts on the guess. */
export const SECOND_ORG = 'seed-second-org';

const SEED_PASSWORD = 'DemoPassword123!';

/** The first load compiles the route in dev; a cold machine needs most of this. */
export const PAGE_TIMEOUT = 120_000;
/** A feed, a place or a read answering from the recorded files. */
export const ANSWER_TIMEOUT = 30_000;

export async function signIn(page: Page, email = 'demo@postgear.local'): Promise<void> {
  // Tried again when the form was pressed before the page had hydrated: in
  // dev, with several workers compiling the same routes, the button can be on
  // screen a moment before React owns it, and the press then does nothing
  // useful. A second attempt is a second sign-in, which `dev:api:e2e` allows.
  await expect(async () => {
    await page.goto('/login', { timeout: PAGE_TIMEOUT });
    await page.getByLabel('Email').fill(email);
    await page.locator('#password').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 30_000 });
  }).toPass({ timeout: PAGE_TIMEOUT });
}

/** Opens Discover and waits for the first group of the tab it lands on. */
export async function openDiscover(page: Page, orgId = DEMO_ORG, query = ''): Promise<void> {
  await page.goto(`/${orgId}/discover${query}`, {
    waitUntil: 'domcontentloaded',
    timeout: PAGE_TIMEOUT,
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible({
    timeout: PAGE_TIMEOUT,
  });
}

export function placeChip(page: Page) {
  return page.getByTestId('discover-place-chip');
}

export function languageChip(page: Page) {
  return page.getByTestId('discover-language-chip');
}

export function group(page: Page, id: string) {
  return page.locator(`[data-testid="discover-group"][data-group="${id}"]`);
}

/** Every request the page made to one Discover route, for asserting what was (not) sent. */
export function recordRequests(page: Page, path: string): URL[] {
  const seen: URL[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (request.url().startsWith(API_URL) && url.pathname === path) {
      seen.push(url);
    }
  });
  return seen;
}

/** The demo workspace's balance, read from the API with the page's session. */
export async function creditsUsed(page: Page): Promise<number> {
  const response = await page.request.get(`${API_URL}/ai/credits`);
  expect(response.ok()).toBe(true);
  const { credits } = (await response.json()) as { credits: { used: number } };
  return credits.used;
}

export interface GenerateCall {
  topic: string;
  tone: string;
  format: string;
  withImage: boolean;
  channelIds: string[];
  language?: string;
  sources?: { title: string; url: string; snippet: string }[];
  publishAt?: string;
}

export const STUB_POST_TEXT = 'E2E stand-in draft: what this means for our audience this week.';

/**
 * Answers `POST /ai/generate` in the browser with a finished run and returns
 * the bodies the sheet sent. The balance echoed on `done` is the real one, so
 * the sheet's meter does not move.
 */
export async function stubGenerate(page: Page): Promise<GenerateCall[]> {
  const calls: GenerateCall[] = [];
  const creditsResponse = await page.request.get(`${API_URL}/ai/credits`);
  const { credits } = (await creditsResponse.json()) as { credits: unknown };

  await page.route(`${API_URL}/ai/generate`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as GenerateCall;
    calls.push(body);

    const parts = [{ text: STUB_POST_TEXT, imagePrompt: null, image: null }];
    const sources = body.sources ?? [];
    const events = [
      { type: 'stage', stage: 'research', status: 'skipped', detail: 'Using the sources given' },
      { type: 'stage', stage: 'classify', status: 'done' },
      { type: 'category', category: 'news' },
      { type: 'stage', stage: 'hook', status: 'done' },
      { type: 'hook', hook: 'E2E stand-in hook' },
      { type: 'stage', stage: 'content', status: 'done' },
      { type: 'content', parts },
      {
        type: 'done',
        result: {
          tone: body.tone,
          format: body.format,
          category: 'news',
          hook: 'E2E stand-in hook',
          parts,
          sources,
          researched: false,
        },
        credits,
        ...(body.publishAt ? { publishAt: body.publishAt } : {}),
      },
    ];

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      body: events
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join(''),
    });
  });

  return calls;
}

/** Removes a draft the spec opened in the composer. */
export async function deleteDraft(page: Page, groupId: string): Promise<void> {
  await page.request.delete(`${API_URL}/posts/${groupId}`).catch(() => undefined);
}

/** Removes every competitor with this exact name from the active workspace. */
export async function removeCompetitorsNamed(page: Page, name: string): Promise<void> {
  const response = await page.request.get(`${API_URL}/discover/competitors`);
  if (!response.ok()) {
    return;
  }

  const { competitors } = (await response.json()) as {
    competitors: { id: string; name: string }[];
  };
  for (const competitor of competitors.filter((entry) => entry.name === name)) {
    await page.request
      .delete(`${API_URL}/discover/competitors/${competitor.id}`)
      .catch(() => undefined);
  }
}
