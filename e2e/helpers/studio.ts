import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';

/**
 * What `e2e/studio.spec.ts` needs around the Design Studio: one sign-in, the
 * editor's save indicator, the design and its exported slides as the API
 * reports them, and the cleanup of everything a run made.
 *
 * Everything here talks to the API with the signed-in page's own cookies
 * (`page.request`), like the rest of the suite: through the API rather than
 * the database, so a deleted media item's files leave storage too.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const DEMO_ORG = 'seed-demo-org';

const DEMO_EMAIL = 'demo@postgear.local';
const DEMO_PASSWORD = 'DemoPassword123!';

/** The login throttle counts sign-ins per address per minute. */
const THROTTLE_WINDOW_MS = 61_000;

/**
 * Signs the page in as the seeded demo user and makes the demo workspace the
 * active one, which every API call is scoped by.
 *
 * The API on :3001 may run with the normal login throttle (10 a minute per
 * address), and other runs on this machine sign in too. A sign-in refused
 * with a 429 is tried once more after the throttle's minute, so the file
 * never signs in more than twice.
 */
export async function signIn(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);

    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/auth/login',
    );
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const response = await answered;

    if (response.status() === 429 && attempt === 1) {
      await page.waitForTimeout(THROTTLE_WINDOW_MS);
      continue;
    }

    expect(response.ok(), `sign-in answered HTTP ${response.status()}`).toBe(true);
    break;
  }

  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 30_000 });
  const switched = await page.request.post(`${API_URL}/orgs/${DEMO_ORG}/switch`);
  expect(switched.ok(), `workspace switch answered HTTP ${switched.status()}`).toBe(true);
}

/** The editor's save indicator: Saved, Saving, Offline, "Could not save. Retrying." or Not saved. */
export function saveStatus(page: Page): Locator {
  return page
    .getByTestId('studio-editor')
    .getByRole('status')
    .filter({ hasText: /Saved|Saving|Offline|Retrying|Not saved/ })
    .first();
}

/**
 * Waits for the indicator to read Saved and nothing else. It holds the word
 * twice (one copy for wide screens, one for screen readers on narrow ones),
 * so the match allows repeats; "Not saved" never matches.
 */
export async function expectSaved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toHaveText(/^(?:Saved)+$/, { timeout: 30_000 });
}

/**
 * Makes a change in the editor and waits until the server has it: the
 * autosave's PATCH answered, then the indicator back on Saved, which the
 * editor shows only once the API has confirmed everything on screen.
 *
 * Waiting on the request as well as the words matters: the indicator reads
 * Saved before the change too, so the words alone could pass too early.
 */
export async function savedAfter(
  page: Page,
  designId: string,
  change: () => Promise<void>,
): Promise<void> {
  const patched = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === `/studio/designs/${designId}`,
    { timeout: 30_000 },
  );

  await change();

  const response = await patched;
  expect(response.ok(), `autosave answered HTTP ${response.status()}`).toBe(true);
  await expectSaved(page);
}

export interface StudioSlide {
  layoutId: string;
  elements: Record<string, { text?: string; hidden?: boolean } | undefined>;
}

export interface StudioDesign {
  id: string;
  title: string;
  status: string;
  revision: number;
  exportStale: boolean;
  exportedMediaIds: string[];
  document: { caption: string; slides: StudioSlide[] };
}

export async function getDesign(request: APIRequestContext, id: string): Promise<StudioDesign> {
  const response = await request.get(`${API_URL}/studio/designs/${encodeURIComponent(id)}`);
  expect(response.ok(), `GET design answered HTTP ${response.status()}`).toBe(true);
  return ((await response.json()) as { design: StudioDesign }).design;
}

export interface LibraryItem {
  id: string;
  name: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

/** "{title} 01.jpg", "{title} 02.jpg"...: what Export names each slide. */
export function slideFileNames(title: string, count: number, extension = 'jpg'): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${title} ${String(index + 1).padStart(2, '0')}.${extension}`,
  );
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The library's exported slides of the design with this title, in slide
 * order. Only names of exactly that shape count, so a title that happens to
 * be part of another item's name never picks that item up.
 */
export async function exportedSlides(
  request: APIRequestContext,
  title: string,
): Promise<LibraryItem[]> {
  const response = await request.get(`${API_URL}/media?search=${encodeURIComponent(title)}`);
  expect(response.ok(), `GET media answered HTTP ${response.status()}`).toBe(true);

  const { media } = (await response.json()) as { media: LibraryItem[] };
  const slide = new RegExp(`^${escapeRegExp(title)} \\d{2}\\.(jpg|png)$`);

  return media.filter((item) => slide.test(item.name)).sort((a, b) => a.name.localeCompare(b.name));
}

export interface PostPart {
  content: unknown;
  media: { id: string; name: string }[];
}

export interface PostDetail {
  group: string;
  state: string;
  shared: PostPart[];
  channels: { channelId: string; name: string }[];
}

export async function getPost(request: APIRequestContext, group: string): Promise<PostDetail> {
  const response = await request.get(`${API_URL}/posts/${encodeURIComponent(group)}`);
  expect(response.ok(), `GET post answered HTTP ${response.status()}`).toBe(true);
  return ((await response.json()) as { post: PostDetail }).post;
}

/**
 * The drafts whose words contain `marker`, newest first. A safety net for
 * the cleanup: Send makes its draft on the server, so a run that stopped
 * before the composer opened still finds it here by its caption.
 */
export async function draftGroupsWith(
  request: APIRequestContext,
  marker: string,
): Promise<string[]> {
  const response = await request.get(`${API_URL}/posts?state=DRAFT`);
  expect(response.ok(), `GET posts answered HTTP ${response.status()}`).toBe(true);

  const { posts } = (await response.json()) as { posts: { group: string; preview: string }[] };
  return posts.filter((post) => post.preview.includes(marker)).map((post) => post.group);
}

/** What a run made, filled in as it goes, so a failure part-way still cleans up. */
export interface StudioRunState {
  designId: string | null;
  /** The run's unique design title, once it is set: exported slides are named after it. */
  title: string | null;
  /** Words only this run's caption holds, to find its draft by. */
  marker: string | null;
  groups: Set<string>;
  mediaIds: Set<string>;
  shareTokens: Set<string>;
}

export function newRunState(): StudioRunState {
  return {
    designId: null,
    title: null,
    marker: null,
    groups: new Set(),
    mediaIds: new Set(),
    shareTokens: new Set(),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

/**
 * Removes everything a run made, through the API, and says what it did.
 * Every step is tried even when an earlier one failed; a failure is written
 * into the log, and `expectNothingLeft` then says what is still there.
 *
 * Order matters for the share links. Deleting a design is a soft delete that
 * leaves its share rows untouched: they stop resolving (the public route
 * refuses a deleted design), but they are never revoked, and once the design
 * is gone the API can neither list nor revoke them. So any link still active
 * is revoked first, then the draft post, then the exported images (the post
 * first, so no draft is left pointing at them), and the design last.
 */
export async function cleanUpStudio(
  request: APIRequestContext,
  run: StudioRunState,
): Promise<string[]> {
  const log: string[] = [];

  async function step(what: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.push(`${what} failed: ${messageOf(error)}`);
    }
  }

  const designPath = run.designId
    ? `${API_URL}/studio/designs/${encodeURIComponent(run.designId)}`
    : null;

  if (designPath) {
    await step('revoking share links', async () => {
      const response = await request.get(`${designPath}/shares`);
      if (!response.ok()) {
        log.push(`share list answered HTTP ${response.status()}`);
        return;
      }

      const { shares } = (await response.json()) as { shares: { id: string }[] };
      if (shares.length === 0) log.push('no active share link left to revoke');

      for (const share of shares) {
        const revoked = await request.delete(
          `${designPath}/shares/${encodeURIComponent(share.id)}`,
        );
        log.push(`revoked share ${share.id}: HTTP ${revoked.status()}`);
      }
    });

    await step("reading the design's exported images", async () => {
      const response = await request.get(designPath);
      if (!response.ok()) return;

      const { design } = (await response.json()) as { design: StudioDesign };
      log.push(`the design lists ${design.exportedMediaIds.length} exported images`);
      for (const id of design.exportedMediaIds) run.mediaIds.add(id);
    });
  }

  if (run.marker) {
    const marker = run.marker;
    await step('finding the draft by its caption', async () => {
      const groups = await draftGroupsWith(request, marker);
      log.push(`${groups.length} draft(s) hold the run's caption`);
      for (const group of groups) run.groups.add(group);
    });
  }

  for (const group of run.groups) {
    await step(`deleting draft post ${group}`, async () => {
      const removed = await request.delete(`${API_URL}/posts/${encodeURIComponent(group)}`);
      log.push(`deleted draft post ${group}: HTTP ${removed.status()}`);
    });
  }

  if (run.title) {
    const title = run.title;
    await step('finding the exported images by name', async () => {
      const items = await exportedSlides(request, title);
      log.push(`${items.length} image(s) in the library carry the run's name`);
      for (const item of items) run.mediaIds.add(item.id);
    });
  }

  for (const id of run.mediaIds) {
    await step(`deleting media ${id}`, async () => {
      const removed = await request.delete(`${API_URL}/media/${encodeURIComponent(id)}`);
      log.push(`deleted media ${id}: HTTP ${removed.status()}`);
    });
  }

  if (designPath) {
    await step('deleting the design', async () => {
      const removed = await request.delete(designPath);
      log.push(`deleted design ${run.designId}: HTTP ${removed.status()}`);
    });
  }

  return log;
}

/** Asks the API again for everything the run made: none of it may still be there. */
export async function expectNothingLeft(
  request: APIRequestContext,
  run: StudioRunState,
): Promise<string[]> {
  const proof: string[] = [];

  if (run.designId) {
    const id = encodeURIComponent(run.designId);
    const design = await request.get(`${API_URL}/studio/designs/${id}`);
    expect(design.status(), 'the deleted design').toBe(404);
    const shares = await request.get(`${API_URL}/studio/designs/${id}/shares`);
    expect(shares.status(), "the deleted design's share list").toBe(404);
    proof.push(
      `design ${run.designId}: HTTP ${design.status()}, its shares: HTTP ${shares.status()}`,
    );
  }

  for (const group of run.groups) {
    const post = await request.get(`${API_URL}/posts/${encodeURIComponent(group)}`);
    expect(post.status(), `the deleted draft ${group}`).toBe(404);
    proof.push(`draft post ${group}: HTTP ${post.status()}`);
  }

  if (run.marker) {
    const left = await draftGroupsWith(request, run.marker);
    expect(left, 'drafts holding the run caption').toEqual([]);
    proof.push(`drafts holding "${run.marker}": ${left.length} left`);
  }

  for (const id of run.mediaIds) {
    const item = await request.get(`${API_URL}/media/${encodeURIComponent(id)}`);
    expect(item.status(), `the deleted media ${id}`).toBe(404);
    proof.push(`media ${id}: HTTP ${item.status()}`);
  }

  if (run.title) {
    const left = await exportedSlides(request, run.title);
    expect(left, 'exported slides still in the library').toEqual([]);
    proof.push(`media named "${run.title} NN": ${left.length} left`);
  }

  for (const token of run.shareTokens) {
    const shared = await request.get(
      `${API_URL}/public/design-shares/${encodeURIComponent(token)}`,
    );
    expect(shared.status(), 'the share link').toBe(404);
    proof.push(`share link ${token.slice(0, 6)}...: HTTP ${shared.status()}`);
  }

  return proof;
}
