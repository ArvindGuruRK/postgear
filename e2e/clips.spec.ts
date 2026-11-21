import { copyFileSync } from 'node:fs';
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  type Response,
  test,
} from '@playwright/test';
import {
  API_URL,
  type ClipsRun,
  cleanUpClipsRun,
  createClipApi,
  DEMO_EMAIL,
  DEMO_ORG,
  deleteWorkspace,
  frameDifference,
  getJson,
  getVideo,
  greyFrame,
  LINKS,
  newClipsRun,
  parseAiChip,
  parseUsedBytes,
  prisma,
  runLeftovers,
  SAMPLE_TALK,
  SECOND_ORG,
  SENTENCES,
  signInAs,
  stamp,
  switchOrg,
  toneWav,
  waitForJob,
  waitForVideoReady,
} from './helpers/clips';

/**
 * Sprint 12 Clips, end to end (Module 20 section 3): the journeys,
 * numbered as the module document lists them, on the simulation only (the
 * guide's section 5p links, the local sample files, the recorded fixtures).
 * Nothing is published or scheduled: test 11 opens the composer on the
 * clip's draft and leaves.
 *
 * One sign-in for the whole file (the API runs with the normal login
 * throttle): the demo user's session is copied into a second context that
 * works in the Free workspace (`seed-second-org`).
 *
 * Serial on purpose: the tests share one upload, one clip and its single
 * 720p export (the only full render the file makes, plus one Preview Export).
 * `afterAll` deletes every video, clip, download, channel, favourite, sound,
 * draft and Media file the run made, removes the ledger rows it charged, and
 * proves in Postgres that nothing is left.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const VIEWPORT = { width: 1440, height: 900 };
const RUN = stamp();
const UPLOAD_NAME = `e2e-clips-${RUN}`;

let context: BrowserContext;
let page: Page;
let second: BrowserContext;
let pageB: Page;
const run: ClipsRun = newClipsRun();

/** What the tests hand to each other. */
const shared = {
  kickLink: '',
  kickVideoId: '',
  kickTitle: '',
  uploadVideoId: '',
  clipId: '',
  exportJobId: '',
  exportMediaId: '',
  exportName: '',
  exportUrl: '',
};

/** Ten minute simulation streams, the guide's Twitch sample first. */
const STREAM_LINKS = [
  'https://www.twitch.tv/videos/900000001',
  LINKS.kickSample,
  ...[103, 105, 107, 109, 111, 113, 115, 117, 118].map(
    (n) => `https://www.twitch.tv/videos/900000${n}`,
  ),
];

/** The first of those streams the workspace does not have (read in Postgres: no probe spent). */
async function linkNotInWorkspace(org: string): Promise<string> {
  const have = await prisma.clipVideo.findMany({
    where: { organizationId: org, deletedAt: null, externalId: { not: null } },
    select: { externalId: true },
  });
  const ids = new Set(have.map((one) => one.externalId));
  const free = STREAM_LINKS.find((link) => !ids.has(link.split('/').pop() ?? ''));
  if (!free) throw new Error(`${org} already has every simulation stream`);
  return free;
}

function apiPath(response: Response): string {
  return new URL(response.url()).pathname;
}

/** The next answer to `method` on an API path matching `path`. */
function answer(target: Page, method: string, path: string | RegExp, timeout = 60_000) {
  return target.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().startsWith(API_URL) &&
      (typeof path === 'string' ? apiPath(response) === path : path.test(apiPath(response))),
    { timeout },
  );
}

function clipsHome(org = DEMO_ORG, tab?: string): string {
  return `/${org}/clips${tab ? `?tab=${tab}` : ''}`;
}

function editorHref(org: string, clipId: string): string {
  return `/${org}/clips/edit/${clipId}`;
}

/** A video's card on the Videos tab, by its id (its Open link only shows once it is READY). */
function readyCard(target: Page, videoId: string): Locator {
  return target
    .getByTestId('clips-video-card')
    .filter({ has: target.locator(`a[href$="/clips/video/${videoId}"]`) });
}

async function linkBox(target: Page): Promise<Locator> {
  const box = target.getByRole('region', { name: 'Bring In A Video' });
  await expect(box).toBeVisible({ timeout: 30_000 });
  return box;
}

async function probeLink(target: Page, url: string): Promise<Response> {
  const box = await linkBox(target);
  await box.getByLabel('Video link').fill(url);
  const probed = answer(target, 'POST', '/clips/links/probe');
  await box.getByRole('button', { name: 'Find Clips', exact: true }).click();
  return probed;
}

/** Picks Kick in Add A Channel, when the dialog asks which platform at all. */
async function pickKick(dialog: Locator): Promise<void> {
  const group = dialog.getByRole('group', { name: 'Platform' });
  if ((await group.count()) === 0) return;
  await group.getByRole('button', { name: /^Kick/ }).click();
}

async function openEditorTab(target: Page, tab: string): Promise<void> {
  const button = target.getByTestId(`clip-tab-${tab}`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Waits for the editor's autosave to land (it saves about 1.5 s after the last change). */
async function expectEditorSaved(target: Page): Promise<void> {
  const status = target.getByTestId('clip-save-status');
  // A change marks it pending at once; give the render a moment, then wait for the save.
  await target.waitForTimeout(300);
  await expect(status).toHaveAttribute('data-status', 'saved', { timeout: 20_000 });
}

interface ClipDoc {
  canvas: { ratio: string };
  layout: { kind: string; areas: Array<{ crop: Array<{ rect: Record<string, number> }> }> };
  segments: Array<{ id: string; speed: number; sourceIn: number; sourceOut: number }>;
  zooms: unknown[];
  tracks: Array<{ kind: string; items: Array<{ type?: string }> }>;
}

async function clipDoc(request: APIRequestContext, clipId: string): Promise<ClipDoc> {
  const body = await getJson<{ clip: { document: ClipDoc } }>(request, `/clips/${clipId}`);
  return body.clip.document;
}

/**
 * The first-open shape question. Found by its heading: the dialog itself has
 * no accessible name (its title's id is replaced, so `aria-labelledby` points
 * at nothing; reported).
 */
function shapeDialog(target: Page): Locator {
  return target
    .getByRole('dialog')
    .filter({ has: target.getByRole('heading', { name: 'What Do You Want To Make?' }) });
}

/** Blurs whatever has focus, so the editor's own keys (playhead, split) reach the page. */
async function blurFocus(target: Page): Promise<void> {
  await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  await signInAs(page, DEMO_EMAIL, DEMO_ORG);

  // The same session in the Free workspace: no second sign-in.
  second = await browser.newContext({
    viewport: VIEWPORT,
    storageState: await context.storageState(),
  });
  pageB = await second.newPage();
  pageB.on('dialog', (dialog) => void dialog.accept());
  await switchOrg(second.request, SECOND_ORG);
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  const requests: Record<string, APIRequestContext> = {
    [DEMO_ORG]: context.request,
    [SECOND_ORG]: second.request,
  };

  // Anything the run uploaded under its own name, even when a test stopped early.
  const strays = await prisma.clipVideo.findMany({
    where: { title: { startsWith: UPLOAD_NAME }, deletedAt: null },
    select: { id: true, organizationId: true },
  });
  for (const one of strays) {
    if (!run.videos.some((v) => v.id === one.id))
      run.videos.push({ id: one.id, org: one.organizationId });
  }

  const problems = await cleanUpClipsRun(requests, run);
  for (const org of run.workspaces) await deleteWorkspace(org);
  // A job of a deleted clip or video is cancelled a moment later, not at once.
  await expect.poll(async () => (await runLeftovers(run)).openJobs, { timeout: 30_000 }).toBe(0);
  const left = await runLeftovers(run);
  console.log(`[clips cleanup] ${JSON.stringify(left)}`);
  if (problems.length > 0) console.log(`[clips cleanup] problems: ${problems.join('; ')}`);

  await second.close();
  await context.close();

  expect(problems, 'every cleanup call answered').toEqual([]);
  expect(
    Object.values(left).every((n) => n === 0),
    JSON.stringify(left),
  ).toBe(true);
});

test('1. The rail opens Clips on its entry card; at 1280 px it asks for a bigger screen', async () => {
  await page.goto(`/${DEMO_ORG}/home`);
  await page.locator(`a[href="/${DEMO_ORG}/clips"]`).filter({ visible: true }).first().click();
  // The dev server may first compile the Clips route (seconds after an app edit).
  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/clips(\\?|$)`), { timeout: 60_000 });

  // One card holds every way in (2026-11-19 redo): no tab bar.
  const box = await linkBox(page);
  await expect(page.getByRole('tablist', { name: 'Clips tabs' })).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'Find Clips', exact: true })).toBeVisible();
  await expect(box.getByTestId('clips-upload-area')).toContainText('Upload Your Own Video');
  for (const name of ['Browse Twitch', 'Browse Kick']) {
    await expect(box.getByRole('button', { name, exact: true })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText(SENTENCES.biggerScreen)).toBeVisible();
  await expect(box).toBeHidden();
  await page.setViewportSize(VIEWPORT);
  await expect(box).toBeVisible();
});

test('2. A pasted link shows its card; Import needs the tick; the import becomes ready', async () => {
  // The guide's Twitch sample first; the demo workspace is shared, so when it is
  // already there the next simulation stream it does not have yet stands in.
  shared.kickLink = await linkNotInWorkspace(DEMO_ORG);
  await page.goto(clipsHome());
  const probed = await probeLink(page, shared.kickLink);
  expect(probed.status()).toBe(200);

  const card = page.getByTestId('clips-link-card');
  await expect(card).toBeVisible();
  const importButton = card.getByRole('button', { name: 'Import Video', exact: true });
  await expect(importButton).toBeDisabled();
  await card.getByRole('checkbox', { name: SENTENCES.rights }).click();
  await expect(importButton).toBeEnabled();

  const imported = answer(page, 'POST', '/clips/videos');
  await importButton.click();
  const response = await imported;
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { video: { id: string; title: string } };
  shared.kickVideoId = body.video.id;
  shared.kickTitle = body.video.title;
  run.videos.push({ org: DEMO_ORG, id: body.video.id });

  // The home stays, says it is getting the stream ready, then opens its video
  // page on its own (a stream is longer than one clip).
  await expect(page.getByTestId('clips-opening-row')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/clips/video/${shared.kickVideoId}$`), {
    timeout: 90_000,
  });
  await page.goto(clipsHome(DEMO_ORG, 'videos'));
  const ready = readyCard(page, shared.kickVideoId);
  await expect(ready).toBeVisible({ timeout: 90_000 });
  await expect(ready).toHaveAttribute('data-status', 'READY');
});

test('3. Private, live and unsupported links show their sentences', async () => {
  await page.goto(clipsHome());
  const box = await linkBox(page);

  const privateProbe = await probeLink(page, LINKS.twitchPrivate);
  expect(privateProbe.status()).toBe(422);
  await expect(box.getByText(SENTENCES.private)).toBeVisible();

  const liveProbe = await probeLink(page, LINKS.twitchLive);
  expect(liveProbe.status()).toBe(422);
  await expect(box.getByText(SENTENCES.live)).toBeVisible();

  // An unsupported link is refused on sight; the probe may not even be asked.
  await box.getByLabel('Video link').fill(LINKS.unsupported);
  await box.getByRole('button', { name: 'Find Clips', exact: true }).click();
  await expect(box.getByText(SENTENCES.unsupported)).toBeVisible();
  await expect(page.getByTestId('clips-link-card')).toHaveCount(0);
});

test('4. Uploading the three minute sample brings it in and opens the editor', async () => {
  const testInfo = test.info();
  const file = testInfo.outputPath(`${UPLOAD_NAME}.mp4`);
  copyFileSync(SAMPLE_TALK, file);

  await page.goto(clipsHome());
  const box = await linkBox(page);
  const chooser = page.waitForEvent('filechooser');
  await box.getByTestId('clips-upload-area').click();
  const completed = answer(page, 'POST', /^\/clips\/videos\/uploads\/[^/]+\/complete$/, 150_000);
  await (await chooser).setFiles(file);

  await expect(page.getByTestId('clips-upload-row').first()).toBeVisible();
  const response = await completed;
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { video: { id: string } };
  shared.uploadVideoId = body.video.id;
  run.videos.push({ org: DEMO_ORG, id: body.video.id });

  await waitForVideoReady(page.request, shared.uploadVideoId);
  const video = await getVideo(page.request, shared.uploadVideoId);
  expect(video.title).toContain(UPLOAD_NAME);
  expect(video.durationMs ?? 0).toBeGreaterThan(170_000);

  // A short upload goes straight into the editor as one whole clip.
  await expect(page).toHaveURL(/\/clips\/edit\/[^/?]+/, { timeout: 60_000 });
  const clipId = new URL(page.url()).pathname.split('/').pop() ?? '';
  run.clips.push({ org: DEMO_ORG, id: clipId });
  await expect(shapeDialog(page)).toBeVisible({ timeout: 30_000 });

  await page.goto(clipsHome(DEMO_ORG, 'videos'));
  await expect(readyCard(page, shared.uploadVideoId)).toHaveAttribute('data-status', 'READY', {
    timeout: 30_000,
  });
});

test('5. The video page plays, marks with I and O, and creates a clip', async () => {
  await page.goto(`/${DEMO_ORG}/clips/video/${shared.uploadVideoId}`);
  const player = page.getByTestId('source-player');
  await expect(player).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0.3);
  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await page.keyboard.press('i');
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  await page.keyboard.press('o');
  await expect(page.getByLabel(/^Marked range/)).toBeVisible();

  const created = answer(page, 'POST', '/clips');
  await page.getByRole('button', { name: 'Create Clip', exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { clip: { id: string; durationMs: number } };
  shared.clipId = body.clip.id;
  run.clips.push({ org: DEMO_ORG, id: body.clip.id });
  // I at the playhead, two L presses (5 s each), O: a ten second clip.
  expect(body.clip.durationMs).toBeGreaterThanOrEqual(9_000);
  expect(body.clip.durationMs).toBeLessThanOrEqual(11_000);

  // Two: the whole clip test 4's upload opened in the editor, and this one.
  const mine = page.getByRole('list', { name: 'Clips from this video' });
  await expect(mine.getByTestId('video-clip-row')).toHaveCount(2);
});

test('6. Find Clips shows its price, its steps, scored clips and a flag; the AI chip drops by it', async () => {
  // The AI minutes chip sits under Find Clips on the video page (it left the Clips home 2026-11-20).
  const videoPage = `/${DEMO_ORG}/clips/video/${shared.uploadVideoId}`;
  await page.goto(videoPage);
  const find = page.getByTestId('find-clips');
  const chip = find.getByTestId('clips-ai-minutes');
  await expect(chip).toContainText('AI minutes left', { timeout: 30_000 });
  const before = parseAiChip(await chip.innerText());
  const button = find.getByRole('button', { name: /^Find Clips \(\d+ AI Minutes?\)$/ });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const price = Number(/\((\d+) AI/.exec(await button.innerText())?.[1]);
  expect(price).toBeGreaterThan(0);

  const sawSteps = find
    .getByTestId('find-clips-progress')
    .waitFor({ state: 'attached', timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  const started = answer(page, 'POST', `/clips/videos/${shared.uploadVideoId}/highlights`);
  await button.click();
  const response = await started;
  expect(response.ok(), await response.text()).toBe(true);
  expect(await sawSteps).toBe(true);

  const found = page.getByRole('list', { name: 'Clips found by AI' });
  await expect(found.getByTestId('video-clip-row').first()).toBeVisible({ timeout: 90_000 });
  await expect(found.getByTestId('video-clip-score').first()).toHaveText(/\d/);
  await expect(page.getByTestId('timeline-ai-flag').first()).toBeVisible();

  await page.goto(videoPage);
  await expect
    .poll(async () => parseAiChip(await chip.innerText()).left, {
      timeout: 30_000,
    })
    .toBe(before.left - price);
});

test('7. The editor: Vertical, Split layout, a crop moved, a trim, a split and Undo', async () => {
  await page.goto(editorHref(DEMO_ORG, shared.clipId));
  await expect(page.getByTestId('clip-editor')).toBeVisible({ timeout: 60_000 });

  const shape = shapeDialog(page);
  await expect(shape).toBeVisible();
  await shape.getByRole('button', { name: /^Vertical/ }).click();
  await shape.getByTestId('clip-shape-continue').click();
  await expect(shape).toBeHidden();

  await openEditorTab(page, 'layouts');
  const layouts = page.getByTestId('clip-layouts-panel');
  await expect(
    layouts.getByRole('group', { name: 'Shape' }).getByRole('button', { name: /Vertical/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const split = layouts.getByRole('group', { name: 'Layouts' }).getByRole('button', {
    name: /^Split/,
  });
  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');

  // Move the first crop box with its keys (Shift moves further).
  const boxes = page.getByTestId('clip-crop-box');
  await expect(boxes).toHaveCount(2);
  const cropBox = boxes.first();
  const startBox = await cropBox.boundingBox();
  await cropBox.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowRight');
  let moved = await cropBox.boundingBox();
  if (moved && startBox && Math.abs(moved.x - startBox.x) < 1) {
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    moved = await cropBox.boundingBox();
  }
  expect(Math.abs((moved?.x ?? 0) - (startBox?.x ?? 0))).toBeGreaterThan(1);
  await expectEditorSaved(page);

  // Trim: drag the part's end grip left by about a sixth of its length.
  const part = page.getByTestId('clip-part').first();
  const partBox = await part.boundingBox();
  if (!partBox) throw new Error('No part on the timeline');
  const grip = part.locator('[data-grip="end"]');
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error('No end grip on the part');
  const fromX = gripBox.x + gripBox.width / 2;
  const y = gripBox.y + gripBox.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(fromX - partBox.width / 12, y, { steps: 4 });
  await page.mouse.move(fromX - partBox.width / 6, y, { steps: 4 });
  await page.mouse.up();
  // The timeline zooms to fit the clip again, so the saved part is what shows the trim.
  await expect
    .poll(
      async () => {
        const doc = await clipDoc(page.request, shared.clipId);
        return (doc.segments[0]?.sourceOut ?? 0) - (doc.segments[0]?.sourceIn ?? 0);
      },
      { timeout: 20_000 },
    )
    .toBeLessThan(9_800);

  // Split at the playhead three seconds in, then take it back.
  await blurFocus(page);
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await page.getByTestId('clip-timeline-split').click();
  await expect(page.getByTestId('clip-part')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('clip-part')).toHaveCount(1);
  await expectEditorSaved(page);

  const doc = await clipDoc(page.request, shared.clipId);
  expect(doc.canvas.ratio).toBe('9:16');
  expect(doc.layout.kind).toBe('split');
  expect(doc.segments).toHaveLength(1);
});

test('8. A text, a sticker, a zoom and a sound; one part at 2x', async () => {
  await expect(page.getByTestId('clip-editor')).toBeVisible();

  await openEditorTab(page, 'text');
  await page.getByTestId('clip-text-panel').getByRole('button', { name: 'Add Text' }).click();
  const words = page.getByRole('textbox', { name: 'Words' });
  await expect(words).toBeVisible();
  await words.fill('Clips End To End');

  await openEditorTab(page, 'elements');
  const elements = page.getByTestId('clip-elements-panel');
  await elements.getByLabel('Search Stickers').fill('wow');
  await elements.getByRole('button', { name: 'Add Wow', exact: true }).first().click();
  await expect(page.getByTestId('clip-selected-sticker')).toBeVisible();

  await openEditorTab(page, 'effects');
  const effects = page.getByTestId('clip-effects-panel');
  const zoomCard = effects.getByTestId('clip-effect-zoom');
  if (!(await zoomCard.getByRole('button', { name: 'Add Zoom' }).isVisible())) {
    await zoomCard.getByRole('button').first().click();
  }
  await zoomCard.getByRole('button', { name: 'Add Zoom' }).click();
  await expect(page.getByTestId('clip-selected-zoom')).toBeVisible();

  await openEditorTab(page, 'audio');
  const audio = page.getByTestId('clip-audio-panel');
  await audio.getByLabel('Search Sound Effects').fill('ding');
  await audio.getByRole('button', { name: 'Add Ding', exact: true }).first().click();
  await expect(page.getByTestId('clip-selected-sound')).toBeVisible();

  // Select the part: its speed card opens; 2x halves its length.
  await page.getByTestId('clip-part').first().click();
  const speed = page.getByTestId('clip-speed');
  if (!(await speed.isVisible())) {
    await openEditorTab(page, 'effects');
    const card = page.getByTestId('clip-effect-speed');
    if (!(await speed.isVisible())) await card.getByRole('button').first().click();
  }
  await expect(speed).toBeVisible();
  await speed.getByRole('button', { name: '2x', exact: true }).click();
  await expect(page.getByTestId('clip-part').first()).toContainText('2x');
  await expectEditorSaved(page);

  const doc = await clipDoc(page.request, shared.clipId);
  const overlay = doc.tracks.filter((t) => t.kind === 'overlay').flatMap((t) => t.items);
  expect(overlay.some((item) => item.type === 'text')).toBe(true);
  expect(overlay.some((item) => item.type === 'sticker')).toBe(true);
  expect(doc.zooms).toHaveLength(1);
  expect(doc.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.items).length).toBe(1);
  expect(doc.segments[0]?.speed).toBe(2);
});

test('9. Export at 720p; the clip is in Media with a poster and a length', async () => {
  await openEditorTab(page, 'export');
  const panel = page.getByTestId('clip-export-panel');
  const tile = panel.getByRole('button', { name: /^720p(?! 60)/ });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');

  const started = answer(page, 'POST', `/clips/${shared.clipId}/exports`);
  await page.getByTestId('clip-panel-export').click();
  const response = await started;
  expect(response.status(), await response.text()).toBe(202);
  const { job } = (await response.json()) as { job: { id: string } };
  shared.exportJobId = job.id;

  const result = panel.getByTestId('clip-export-result');
  await expect(result).toBeVisible({ timeout: 150_000 });
  await expect(result.locator('img')).toBeVisible();

  const { exports } = await getJson<{
    exports: Array<{
      quality: string;
      media: {
        id: string;
        name: string;
        url: string;
        posterUrl: string | null;
        durationMs: number | null;
        height: number | null;
      } | null;
    }>;
  }>(page.request, `/clips/${shared.clipId}/exports`);
  const latest = exports[0];
  expect(latest?.quality).toBe('720p');
  const media = latest?.media;
  if (!media) throw new Error('The export has no Media file');
  shared.exportMediaId = media.id;
  shared.exportName = media.name;
  shared.exportUrl = media.url;
  run.media.push({ org: DEMO_ORG, id: media.id });
  expect(media.posterUrl).toBeTruthy();
  expect(media.durationMs ?? 0).toBeGreaterThan(3_000);
  expect(media.height).toBe(1280);

  // The Media library has it, with its poster and length.
  const library = await getJson<{
    media: Array<{ id: string; thumbnailUrl: string | null; durationMs?: number | null }>;
  }>(page.request, `/media?search=${encodeURIComponent(media.name)}`);
  const row = library.media.find((one) => one.id === media.id);
  expect(row, 'the export is listed in Media').toBeTruthy();
  expect(row?.thumbnailUrl).toBeTruthy();
  expect(row?.durationMs ?? 0).toBeGreaterThan(3_000);
});

test('10. (part 1) A change makes the export out of date; Undo makes it current again', async () => {
  // Fixed in Module 20: the saved clip can come back one bit off what the editor
  // holds (a split layout's crop), so fingerprints count numbers to 12 digits.
  await openEditorTab(page, 'export');
  const stale = page.getByTestId('clip-export-stale');
  await expect(page.getByTestId('clip-export-result')).toBeVisible();
  await expect(stale).toBeHidden();

  await openEditorTab(page, 'layouts');
  const layouts = page.getByTestId('clip-layouts-panel').getByRole('group', { name: 'Layouts' });
  await layouts.getByRole('button', { name: /^Fullscreen/ }).click();
  await expectEditorSaved(page);
  await openEditorTab(page, 'export');
  await expect(stale).toContainText(SENTENCES.outOfDate);

  // Undo puts the exported document back: the alert goes.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectEditorSaved(page);
  await expect(stale).toBeHidden();
});

test('10. (part 2) The Free workspace has the 1080p plan lock', async () => {
  // The document must be the exported one again for the tests after this one.
  const doc = await clipDoc(page.request, shared.clipId);
  expect(doc.layout.kind).toBe('split');

  // 1080p is locked, in the panel and at the API.
  const freeVideo = await prisma.clipVideo.findFirst({
    where: { organizationId: SECOND_ORG, status: 'READY', deletedAt: null },
    select: { id: true },
  });
  if (!freeVideo) throw new Error('The Free workspace has no ready video to clip');
  const { clipId } = await createClipApi(second.request, freeVideo.id, 1_000, 6_000);
  run.clips.push({ org: SECOND_ORG, id: clipId });

  await pageB.goto(editorHref(SECOND_ORG, clipId));
  const shape = shapeDialog(pageB);
  await expect(shape).toBeVisible({ timeout: 60_000 });
  await shape.getByTestId('clip-shape-continue').click();
  await openEditorTab(pageB, 'export');
  const locked = pageB
    .getByTestId('clip-export-panel')
    .getByRole('button', { name: '1080p, locked', exact: true });
  await expect(locked).toBeVisible();
  await locked.click();
  await expect(pageB.getByRole('dialog', { name: /1080p Export/ })).toBeVisible();
  await pageB.keyboard.press('Escape');

  const refused = await second.request.post(`${API_URL}/clips/${clipId}/exports`, {
    data: { quality: '1080p' },
  });
  expect(refused.status()).toBe(402);
  expect(((await refused.json()) as { error: string }).error).toBe(SENTENCES.qualityLocked);
});

test('11. Send To Composer: an unfit channel is greyed; the composer opens with the clip', async () => {
  await openEditorTab(page, 'export');
  await page.getByTestId('clip-export-send').click();
  const dialog = page.getByTestId('clip-send-dialog');
  await expect(dialog).toBeVisible();
  // The out-of-date bug of test 10 also reaches this dialog: it asks first. The
  // export is the clip as it is, so the old version is the right one to send.
  const outdated = dialog.getByTestId('clip-send-outdated');
  const channelsShown = dialog.getByTestId('clip-send-channel').first();
  await expect(outdated.or(channelsShown)).toBeVisible({ timeout: 30_000 });
  if (await outdated.isVisible()) await dialog.getByTestId('clip-send-old').click();

  // LinkedIn takes no video from here: greyed, with its reason.
  const greyed = dialog.locator('[data-testid="clip-send-channel"][data-disabled="true"]');
  await expect(greyed.first()).toBeVisible({ timeout: 30_000 });
  await expect(greyed.first().getByTestId('clip-send-reason')).not.toBeEmpty();
  await expect(greyed.first().getByRole('checkbox')).toBeDisabled();

  const fit = dialog.locator('[data-testid="clip-send-channel"]:not([data-disabled="true"])');
  await fit.first().getByRole('checkbox').click();
  await dialog.getByTestId('clip-send-caption').fill(`Clips end to end ${RUN}`);

  const sent = answer(page, 'POST', `/clips/${shared.clipId}/send`);
  await dialog.getByTestId('clip-send-open').click();
  const response = await sent;
  expect(response.ok(), await response.text()).toBe(true);
  const { group } = (await response.json()) as { group: string };
  run.groups.push({ org: DEMO_ORG, group });

  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/composer\\?group=${group}`), {
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole('button', { name: new RegExp(`^Remove ${escapeRegExp(shared.exportName)} from`) })
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  // Leave without saving or posting; the draft goes in cleanup.
  await page.goto(clipsHome());
});

test('12. Download 720p from a link; Save File answers', async () => {
  const probed = await probeLink(page, shared.kickLink);
  expect(probed.status()).toBe(200);
  const card = page.getByTestId('clips-link-card');
  await expect(card.getByText(SENTENCES.alreadyHere)).toBeVisible();
  await card.getByRole('checkbox', { name: SENTENCES.rights }).click();
  await card.getByRole('button', { name: 'Download', exact: true }).click();

  const menu = page.getByTestId('clips-download-menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  const hd = items.filter({ hasText: /^720p/ });
  const pick = (await hd.count()) > 0 ? hd.first() : items.first();
  const started = answer(page, 'POST', '/clips/downloads');
  await pick.click();
  const response = await started;
  const body = (await response.json()) as { job: { id: string }; existing: boolean };
  // 202 for a new file; 200 when this very file is already kept (someone made it
  // within the last 24 hours in this shared workspace): then it is not the run's.
  expect([202, 200], await response.text()).toContain(response.status());
  expect(body.existing).toBe(response.status() === 200);
  if (!body.existing) run.downloads.push({ org: DEMO_ORG, jobId: body.job.id });

  // A download moves the page to the Downloads list.
  await expect(page.getByTestId('clips-view-name')).toHaveText('Downloads');
  const row = page
    .getByTestId('clips-download-row')
    .filter({ has: page.getByTestId('clips-download-save-file') })
    .first();
  await expect(page.getByTestId('clips-download-row').first()).toBeVisible();
  const job = await waitForJob(page.request, body.job.id, 90_000);
  expect(job.status).toBe('DONE');
  await expect(row).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

  const fileAnswer = answer(page, 'GET', `/clips/downloads/${body.job.id}/file`);
  const saving = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
  await row.getByTestId('clips-download-save-file').click();
  const file = await fileAnswer;
  expect(file.status()).toBe(200);
  const { url } = (await file.json()) as { url: string };
  const fetched = await page.request.get(url);
  expect(fetched.status()).toBe(200);
  expect(
    Number(fetched.headers()['content-length'] ?? (await fetched.body()).length),
  ).toBeGreaterThan(100_000);
  await (await saving)?.cancel();
});

test('13. Deleting a video says what goes, and the storage meter drops', async () => {
  await page.goto(clipsHome(DEMO_ORG, 'videos'));
  const meter = page.getByTestId('clips-storage-meter');
  await expect(meter).toContainText(' of ', { timeout: 30_000 });
  const before = parseUsedBytes(await meter.innerText());

  const card = readyCard(page, shared.kickVideoId);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `More for ${shared.kickTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Delete Video' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete Video' });
  await expect(confirm.getByTestId('delete-video-sentence')).toHaveText(
    'Delete this video? Exported clips stay in Media.',
  );
  const deleted = answer(page, 'DELETE', `/clips/videos/${shared.kickVideoId}`);
  await confirm.getByRole('button', { name: 'Delete Video' }).click();
  expect((await deleted).ok()).toBe(true);

  await expect(card).toHaveCount(0);
  await expect
    .poll(async () => parseUsedBytes(await meter.innerText()), { timeout: 30_000 })
    .toBeLessThan(before);
});

test("14. The second workspace cannot open the first one's video, clip or job", async () => {
  for (const route of [
    `/clips/videos/${shared.uploadVideoId}`,
    `/clips/${shared.clipId}`,
    `/clips/jobs/${shared.exportJobId}`,
  ]) {
    const response = await second.request.get(`${API_URL}${route}`);
    expect(response.status(), route).toBe(404);
  }

  await pageB.goto(`/${SECOND_ORG}/clips/video/${shared.uploadVideoId}`);
  await expect(pageB.getByText('Nothing scheduled here')).toBeVisible({ timeout: 30_000 });
  await pageB.goto(editorHref(SECOND_ORG, shared.clipId));
  await expect(pageB.getByText('Nothing scheduled here')).toBeVisible({ timeout: 30_000 });
});

test('15. Channels: add one, its list, hide and show again, import from it; the Free limit', async () => {
  // Browse Kick on the entry card opens Kick's saved channels in a dialog.
  await page.goto(clipsHome());
  await (await linkBox(page)).getByRole('button', { name: 'Browse Kick', exact: true }).click();
  const section = page.getByRole('dialog', { name: 'Browse Kick' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await section.getByRole('button', { name: 'Add A Channel' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Add A Channel' });
  await pickKick(dialog);
  await dialog.getByLabel('Channel name').fill('simstreamer');
  await dialog.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(dialog.getByText('Acme', { exact: true })).toBeVisible({ timeout: 30_000 });
  const added = answer(page, 'POST', '/clips/channels');
  await dialog.getByRole('button', { name: 'Add Channel', exact: true }).click();
  const response = await added;
  expect(response.status(), await response.text()).toBe(201);
  const { channel } = (await response.json()) as { channel: { id: string } };
  run.channels.push({ org: DEMO_ORG, id: channel.id });
  await expect(page.getByText('Acme is in your channels.', { exact: true })).toBeVisible();

  // Browse Kick shows Kick alone: no platform tabs to pick from.
  await expect(section.getByRole('tablist', { name: 'Platform' })).toHaveCount(0);
  const hideButtons = section.getByRole('button', { name: /^Hide .+ from the list$/ });
  await expect(hideButtons.nth(3)).toBeVisible({ timeout: 30_000 });
  const hideLabel = (await hideButtons.nth(3).getAttribute('aria-label')) ?? '';
  const hideButton = section.getByRole('button', { name: hideLabel, exact: true });

  const hidden = answer(page, 'PUT', /^\/clips\/channels\/[^/]+\/hidden\/[^/]+$/);
  await hideButton.click();
  expect((await hidden).ok()).toBe(true);
  await expect(hideButton).toBeHidden();
  const shown = answer(page, 'DELETE', /^\/clips\/channels\/[^/]+\/hidden\/[^/]+$/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await shown).ok()).toBe(true);
  await expect(hideButton).toBeVisible();

  // Import another through the link card: the first stream the workspace does not have.
  await section
    .getByRole('button', { name: /^Import / })
    .first()
    .click();
  const importDialog = page.getByRole('dialog', { name: 'Import Video' });
  const card = importDialog.getByTestId('clips-link-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('checkbox', { name: SENTENCES.rights }).click();
  const imported = answer(page, 'POST', '/clips/videos');
  await card.getByRole('button', { name: 'Import Video', exact: true }).click();
  const importResponse = await imported;
  expect(importResponse.status(), await importResponse.text()).toBe(201);
  const { video } = (await importResponse.json()) as { video: { id: string } };
  run.videos.push({ org: DEMO_ORG, id: video.id });
  await expect(importDialog).toBeHidden();
  await waitForVideoReady(page.request, video.id);

  // The Free workspace allows one channel: with one added, the second is refused.
  const first = await second.request.post(`${API_URL}/clips/channels`, {
    data: { platform: 'twitch', handle: 'simstreamer' },
  });
  expect(first.status(), await first.text()).toBe(201);
  run.channels.push({
    org: SECOND_ORG,
    id: ((await first.json()) as { channel: { id: string } }).channel.id,
  });

  // An old `?tab=streams` link still lands on every platform's channels.
  await pageB.goto(clipsHome(SECOND_ORG, 'streams'));
  const sectionB = pageB.getByRole('dialog', { name: 'Browse Channels' });
  await expect(sectionB).toBeVisible({ timeout: 30_000 });
  await sectionB.getByRole('button', { name: 'Add A Channel' }).first().click();
  const dialogB = pageB.getByRole('dialog', { name: 'Add A Channel' });
  await pickKick(dialogB);
  await dialogB.getByLabel('Channel name').fill('simstreamer');
  await dialogB.getByRole('button', { name: 'Check', exact: true }).click();
  const limit = dialogB.getByText(SENTENCES.oneChannel);
  const addB = dialogB.getByRole('button', { name: 'Add Channel', exact: true });
  // The plan sentence comes at Check, or at Add Channel at the latest.
  await expect
    .poll(async () => (await limit.isVisible()) || (await addB.isEnabled()), { timeout: 30_000 })
    .toBe(true);
  if (!(await limit.isVisible())) await addB.click();
  await expect(limit).toBeVisible();
});

test('16. The library: search, a favourite under Favourites, and an uploaded sound', async () => {
  await page.goto(editorHref(DEMO_ORG, shared.clipId));
  await expect(page.getByTestId('clip-editor')).toBeVisible({ timeout: 60_000 });

  // Stickers.
  await openEditorTab(page, 'elements');
  const elements = page.getByTestId('clip-elements-panel');
  await elements.getByLabel('Search Stickers').fill('o');
  const tiles = elements.getByTestId('clip-sticker-tile');
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  const notYet = tiles
    .filter({ has: page.getByRole('button', { name: 'Add To Favourites' }) })
    .first();
  const stickerName =
    (
      await notYet
        .getByRole('button', { name: /^Add (?!To Favourites)/ })
        .getAttribute('aria-label')
    )?.replace(/^Add /, '') ?? '';
  const favSticker = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().endsWith('/clips/library/favourites'),
  );
  await notYet.getByRole('button', { name: 'Add To Favourites' }).click();
  const stickerItem = (await favSticker).postDataJSON() as { type: 'sticker'; itemId: string };
  run.favourites.push({ org: DEMO_ORG, type: 'sticker', id: stickerItem.itemId });
  await elements
    .getByRole('group', { name: 'Elements' })
    .getByRole('button', { name: 'Favourites' })
    .click();
  await expect(
    elements.getByRole('button', { name: `Add ${stickerName}`, exact: true }),
  ).toBeVisible();

  // Sounds.
  await openEditorTab(page, 'audio');
  const audio = page.getByTestId('clip-audio-panel');
  await audio
    .getByRole('group', { name: 'Sounds' })
    .getByRole('button', { name: 'Sound Effects' })
    .click();
  await audio.getByLabel('Search Sound Effects').fill('o');
  const rows = audio.getByTestId('clip-sound-row');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const row = rows.filter({ has: page.getByRole('button', { name: 'Add To Favourites' }) }).first();
  const soundName =
    (
      await row.getByRole('button', { name: /^Add (?!To Favourites)/ }).getAttribute('aria-label')
    )?.replace(/^Add /, '') ?? '';
  const favSound = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().endsWith('/clips/library/favourites'),
  );
  await row.getByRole('button', { name: 'Add To Favourites' }).click();
  const soundItem = (await favSound).postDataJSON() as { type: 'sound'; itemId: string };
  run.favourites.push({ org: DEMO_ORG, type: 'sound', id: soundItem.itemId });
  await audio
    .getByRole('group', { name: 'Sounds' })
    .getByRole('button', { name: 'Favourites' })
    .click();
  await expect(audio.getByRole('button', { name: `Add ${soundName}`, exact: true })).toBeVisible();

  // Upload a sound.
  await audio
    .getByRole('group', { name: 'Sounds' })
    .getByRole('button', { name: 'Uploaded' })
    .click();
  const uploaded = answer(page, 'POST', '/clips/sounds/uploads');
  await audio.getByTestId('clip-sound-file').setInputFiles({
    name: `${UPLOAD_NAME}-tone.wav`,
    mimeType: 'audio/wav',
    buffer: toneWav(),
  });
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(201);
  const { sound } = (await response.json()) as { sound: { id: string; name: string } };
  run.soundUploads.push({ org: DEMO_ORG, id: sound.id });
  // The stored name is tidied from the file name ("e2e-clips-x-tone.wav" reads "e2e clips x tone").
  expect(sound.name).toBe(`${UPLOAD_NAME}-tone`.replace(/-/g, ' '));
  await expect(
    audio.getByTestId('clip-uploaded-sound').filter({ hasText: sound.name }),
  ).toBeVisible({ timeout: 30_000 });
});

test('17. Preview Export renders low resolution and plays; it agrees with the 720p export', async () => {
  await openEditorTab(page, 'export');
  const started = answer(page, 'POST', `/clips/${shared.clipId}/previews`);
  await page.getByTestId('clip-preview-export').click();
  expect((await started).ok()).toBe(true);

  const dialog = page.getByTestId('clip-preview-dialog');
  await expect(dialog).toBeVisible();
  const video = dialog.getByTestId('clip-preview-video');
  await expect(video).toBeVisible({ timeout: 150_000 });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const size = await video.evaluate((v: HTMLVideoElement) => ({
    w: v.videoWidth,
    h: v.videoHeight,
  }));
  expect(size.h).toBeLessThan(1280);
  expect(size.w / size.h).toBeCloseTo(9 / 16, 1);

  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThan(0.3);

  // Export Clip is offered from the preview at the chosen 720p. It is not pressed:
  // test 9 already exported this very document (same fingerprint), and the file
  // keeps to one full render.
  await expect(dialog.getByRole('button', { name: 'Export Clip', exact: true })).toBeEnabled();
  const { preview } = await getJson<{ preview: { fingerprint: string; url: string } }>(
    page.request,
    `/clips/${shared.clipId}/previews/latest`,
  );
  const { exports } = await getJson<{ exports: Array<{ fingerprint: string; quality: string }> }>(
    page.request,
    `/clips/${shared.clipId}/exports`,
  );
  expect(exports[0]?.quality).toBe('720p');
  expect(preview.fingerprint).toBe(exports[0]?.fingerprint);

  // Frame by frame, the text, the crop and the sticker sit in the same places.
  for (const at of [0.5, 1.5, 2.5]) {
    const low = greyFrame(preview.url, at);
    const full = greyFrame(shared.exportUrl, at);
    const { mean, worstBlock } = frameDifference(low, full);
    expect(mean, `mean difference at ${at}s`).toBeLessThan(12);
    expect(worstBlock, `worst block at ${at}s`).toBeLessThan(60);
  }
  // The footer's Close (the corner X is named Close too).
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toBeHidden();
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
