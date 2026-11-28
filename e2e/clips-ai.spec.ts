import { writeFileSync } from 'node:fs';
import { CLIP_AIR_MS, transcriptRows } from '@postgear/video-engine';
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from '@playwright/test';
import {
  API_URL,
  type ClipsRun,
  cleanUpClipsRun,
  createClipApi,
  DEMO_EMAIL,
  DEMO_ORG,
  getJson,
  newClipsRun,
  prisma,
  runLeftovers,
  SENTENCES,
  signInAs,
  stamp,
  switchOrg,
  waitForJob,
  waitForVideoReady,
} from './helpers/clips';
import {
  type AiRun,
  aiMinutesUsed,
  answer,
  captionsOf,
  cleanUpAiRun,
  clipsOfVideo,
  expectEditorSaved,
  getClip,
  importLink,
  newAiRun,
  openClipEditor,
  openEditorTab,
  openEffect,
  outputMs,
  pngSize,
  probeGif,
  putOverride,
  readTranscript,
  removeOverride,
  renameClip,
  sentence,
  shapeDialog,
  speechAndFaceFiles,
} from './helpers/clips-ai';
import { createUnonboardedUser, deleteUser, type FixtureUser } from './helpers/users';

/**
 * Sprint 13 Clips AI, end to end (Module 16 section 3): the 19 journeys in
 * the module document's eight groups, on the simulation only
 * (`CLIPS_SIMULATION`, `MEDIA_SIMULATION`, `AI_SIMULATION`,
 * `PUBLISH_SIMULATION`): the local sample videos, the recorded transcripts
 * and faces, the stand-in model and the stand-in publisher. Nothing real is
 * fetched, listened to, posted or emailed.
 *
 * Serial on purpose: one signed-in admin context for the whole file, and the
 * expensive work done once (the three sample imports in the first
 * `beforeAll`, the listened stretch reused by later groups). The only video
 * renders are the small batch (test 12) and the montage (test 13), plus the
 * emote and the two schedule pictures.
 *
 * `afterAll` takes back everything the run made (videos, clips, exports,
 * recipes, designs, posts, the batch notice, the Editor account, the seat
 * override and the channel's posting times) and proves in Postgres that the
 * clips part of it is gone. Seeded rows are never deleted.
 */

test.describe.configure({
  mode: 'serial',
  timeout: 240_000,
});

const VIEWPORT = { width: 1440, height: 900 };
const RUN = stamp();
const SUITE_START = new Date();
const REASON = `Clips AI end to end run ${RUN}`;

let context: BrowserContext;
let page: Page;
const run: ClipsRun = newClipsRun();
const ai: AiRun = newAiRun();
let editorUser: FixtureUser | null = null;
const timings: Record<string, number> = {};

/** A link and the id the workspace stores for it, so "already here" is read in Postgres. */
interface SampleLink {
  url: string;
  externalId: string;
}

/** Ten minute streams, the newest channel items first (the Sprint 12 suite starts at the other end). */
const STREAM_LINKS: SampleLink[] = [118, 117, 115, 113, 111, 109, 107, 105, 103].map((n) => ({
  url: `https://www.twitch.tv/videos/900000${n}`,
  externalId: `900000${n}`,
}));
const TWO_SPEAKER_LINKS: SampleLink[] = [
  {
    url: 'https://www.loom.com/share/5151515151515151515151515151515a',
    externalId: '5151515151515151515151515151515a',
  },
];
const TALK_LINKS: SampleLink[] = [
  {
    url: 'https://rumble.com/v5sim01-postgear-sample-talk.html',
    externalId: 'v5sim01-postgear-sample-talk',
  },
  { url: 'https://www.reddit.com/comments/1simvd2/', externalId: '1simvd2' },
  { url: 'https://www.reddit.com/comments/1simvd3/', externalId: '1simvd3' },
];
/** Module 12's new sites: Dailymotion first. */
const NEW_SITE_LINKS: SampleLink[] = [
  { url: 'https://www.dailymotion.com/video/x9sim01', externalId: 'x9sim01' },
  { url: 'https://x.com/i/status/1900000000000000002', externalId: '1900000000000000002' },
  { url: 'https://www.pinterest.com/pin/900000000000000001/', externalId: '900000000000000001' },
];
/** TikTok is not in `CLIPS_PLATFORMS`: its links are paused. */
const OFF_SITE_LINK = 'https://www.tiktok.com/@postgearsamples/video/7300000000000000001';

const LINKEDIN = 'seed-channel-linkedin';
const SEAT_KEY = 'members.editors_max';

/** What the tests hand to each other. */
const s = {
  stream: '',
  two: '',
  talk: '',
  /** 40 to 70 s of the stream: captioned in test 2, cut and cleaned in test 4, saved as a recipe in 9. */
  c1: '',
  /** 45 to 65 s: the second clip of the same stretch (free captions), the recipe's target in 9. */
  c2: '',
  /** 300 to 306 s: Detect Camera (7), the batch (12), the montage (13), the emote (16). */
  c3: '',
  /** 85 to 91 s: Captions Only (10), the batch (12). */
  c6: '',
  /** 150 to 160 s: the uploaded captions file (5). */
  c7: '',
  /** Two speakers, 15 to 27 s: Follow The Speaker (7), the batch (12), the montage (13). */
  d1: '',
  /** The talk, 5 to 40 s: Bleep, Hook Title, Hook Clip (8). */
  t1: '',
  recipeId: '',
  recipeName: `E2E Recipe ${RUN}`,
  montageId: '',
  montageMediaName: '',
  aiMinutesAtStart: 0,
};

const titleOf = (name: string) => `E2E AI ${name} ${RUN}`;

async function firstFree(org: string, links: SampleLink[]): Promise<SampleLink> {
  const have = await prisma.clipVideo.findMany({
    where: { organizationId: org, deletedAt: null, externalId: { not: null } },
    select: { externalId: true },
  });
  const ids = new Set(have.map((one) => one.externalId));
  const free = links.find((link) => !ids.has(link.externalId));
  if (!free) throw new Error(`${org} already has every link of ${links[0]?.url}`);
  return free;
}

async function newClip(
  videoId: string,
  fromMs: number,
  toMs: number,
  name: string,
): Promise<string> {
  const { clipId } = await createClipApi(page.request, videoId, fromMs, toMs);
  run.clips.push({ org: DEMO_ORG, id: clipId });
  await renameClip(page.request, clipId, titleOf(name));
  return clipId;
}

/** Settles once the video is READY (polled in Postgres, outside any test's own expectations). */
async function readyLater(id: string, timeoutMs = 240_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.clipVideo.findUnique({ where: { id }, select: { status: true } });
    if (row?.status === 'READY') return;
    if (row?.status === 'FAILED' || Date.now() > until) {
      throw new Error(`Video ${id} did not import (${row?.status ?? 'gone'})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** Settles once the clip's sharp range (its SEGMENT job) is no longer being fetched. */
async function sharpSettled(clipId: string, timeoutMs = 240_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const open = await prisma.clipJob.count({
      where: { clipId, kind: 'SEGMENT', status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (open === 0) return;
    if (Date.now() > until) throw new Error(`The sharp range of clip ${clipId} is still fetching`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** What the first group does not need at once, ready by the time a test asks. */
const ready: { two: Promise<void>; talk: Promise<void>; c2: Promise<void> } = {
  two: Promise.resolve(),
  talk: Promise.resolve(),
  c2: Promise.resolve(),
};

function started(group: string): void {
  timings[group] = Date.now();
}

function finished(group: string): void {
  const at = timings[group];
  if (at) console.log(`[clips-ai timing] ${group}: ${((Date.now() - at) / 1000).toFixed(1)} s`);
}

/** Moves Clip Setup's End thumb down (PageDown is ten seconds) until it is at or under `ms`. */
async function setRangeEnd(target: Page, ms: number): Promise<void> {
  const end = target.getByTestId('clip-setup-range').getByRole('slider', { name: 'End' });
  await end.focus();
  for (let i = 0; i < 120; i += 1) {
    const now = Number(await end.getAttribute('aria-valuenow'));
    if (now <= ms) break;
    await target.keyboard.press(now - ms >= 10_000 ? 'PageDown' : 'ArrowLeft');
  }
  expect(Number(await end.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(ms);
}

async function setupTotal(target: Page): Promise<number> {
  const total = target.getByTestId('clip-setup-total');
  await expect(total).toHaveText(/^\d+$/, { timeout: 30_000 });
  return Number(await total.innerText());
}

/** Waits for the price to settle after a change (it is asked again after a short pause). */
async function settledTotal(target: Page, before: number | null): Promise<number> {
  const find = target.getByTestId('clip-setup-find');
  await expect(find).toBeEnabled({ timeout: 30_000 });
  if (before !== null) {
    await expect.poll(() => setupTotal(target), { timeout: 15_000 }).not.toBe(before);
  }
  await target.waitForTimeout(800);
  await expect(find).toBeEnabled({ timeout: 30_000 });
  return setupTotal(target);
}

async function runHighlights(
  target: Page,
  videoId: string,
): Promise<{ id: string; jobId: string }> {
  const startedRun = answer(target, 'POST', `/clips/videos/${videoId}/highlights`);
  await target.getByTestId('clip-setup-find').click();
  const response = await startedRun;
  expect(response.status(), await response.text()).toBe(202);
  const body = (await response.json()) as { run: { id: string }; job: { id: string } };
  await expect(target).toHaveURL(new RegExp(`/clips/video/${videoId}$`), { timeout: 30_000 });
  const job = await waitForJob(target.request, body.job.id, 180_000);
  expect(job.status).toBe('DONE');
  return { id: body.run.id, jobId: body.job.id };
}

interface RunView {
  status: string;
  found: number;
  ai?: { read: boolean; watched?: boolean; actions?: number; asked: boolean } | null;
}

async function latestRun(request: APIRequestContext, videoId: string): Promise<RunView> {
  const body = await getJson<{ run: RunView | null }>(
    request,
    `/clips/videos/${videoId}/highlights`,
  );
  if (!body.run) throw new Error('No highlights run');
  return body.run;
}

/** The time a composer's Publish At holds, as `YYYY-MM-DDTHH:mm` in local time. */
async function publishAt(target: Page): Promise<string> {
  const field = target.locator('#composer-publish-at');
  await expect(field).toHaveAttribute('data-value', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  return (await field.getAttribute('data-value')) ?? '';
}

function minuteOfDay(local: string): number {
  const [hours, minutes] = (local.split('T')[1] ?? '00:00').split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function localValue(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function composer(target: Page) {
  return target.getByRole('dialog', { name: /^(Create|Edit) Post$/ });
}

async function openComposer(target: Page): Promise<void> {
  await target.goto(`/${DEMO_ORG}/composer`);
  await expect(composer(target)).toBeVisible({ timeout: 30_000 });
  await expect(target.getByRole('textbox', { name: 'Part 1 of the shared post' })).toBeVisible();
}

async function writePost(target: Page, text: string): Promise<void> {
  await target.getByRole('textbox', { name: 'Part 1 of the shared post' }).click();
  await target.keyboard.type(text);
}

function channelButton(target: Page, name: RegExp) {
  return target.getByRole('group', { name: 'Channels' }).getByRole('button', { name });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  started('setup');
  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  await signInAs(page, DEMO_EMAIL, DEMO_ORG);
  s.aiMinutesAtStart = await aiMinutesUsed(page.request);

  // The three samples, imported at once: a stream (faces, action), two
  // speakers (Follow) and a talk (bad words, no face).
  const [stream, two, talk] = await Promise.all([
    firstFree(DEMO_ORG, STREAM_LINKS),
    firstFree(DEMO_ORG, TWO_SPEAKER_LINKS),
    firstFree(DEMO_ORG, TALK_LINKS),
  ]);
  // The stream first: the first group needs only it. The other two finish
  // importing while that group runs (a workspace imports two at a time).
  s.stream = await importLink(page.request, stream.url);
  run.videos.push({ org: DEMO_ORG, id: s.stream });
  [s.two, s.talk] = await Promise.all(
    [two, talk].map((link) => importLink(page.request, link.url)),
  );
  run.videos.push({ org: DEMO_ORG, id: s.two }, { org: DEMO_ORG, id: s.talk });
  ready.two = readyLater(s.two);
  ready.talk = readyLater(s.talk);
  await waitForVideoReady(page.request, s.stream, 150_000);

  // The first group's clip. The others are made where they are first needed:
  // each new clip fetches its sharp range (an encode of the clip and its
  // handles), and those share the machine and the queue with Find Clips,
  // Auto-Edit and the exports. The second clip on the same stretch is made
  // once the first one's sharp range (10 s to 100 s) is stored, so it needs
  // no fetch of its own (nor does Captions Only, at 85 s, later).
  s.c1 = await newClip(s.stream, 40_000, 70_000, 'Captioned');
  ready.c2 = (async () => {
    await sharpSettled(s.c1);
    s.c2 = await newClip(s.stream, 45_000, 65_000, 'Same Stretch');
  })();
  // Read (and so reported) by the tests that need them; never left unhandled.
  for (const later of [ready.two, ready.talk, ready.c2]) later.catch(() => undefined);
  finished('setup');
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  const request = context.request;
  const problems: string[] = [];

  // The Editor account and its membership, then the seat override.
  if (editorUser) {
    await prisma.notificationCursor
      .deleteMany({ where: { userId: editorUser.id } })
      .catch(() => undefined);
    await deleteUser(editorUser.id).catch((error: unknown) =>
      problems.push(`deleteUser: ${String(error)}`),
    );
    run.users.push(editorUser.id);
  }
  const seat = await removeOverride(request, DEMO_ORG, SEAT_KEY, REASON);
  if (seat >= 400) problems.push(`removing the seat override answered HTTP ${seat}`);

  // A post this run published (test 15's Post Now through the stand-in) is
  // locked against the API's delete on purpose (409), so it is marked deleted
  // here exactly as that delete would, and left out of the API cleanup (its
  // clip links go with the clip).
  const published = await prisma.post.findMany({
    where: {
      organizationId: DEMO_ORG,
      group: { in: run.groups.map((one) => one.group) },
      deletedAt: null,
      state: 'PUBLISHED',
    },
    select: { group: true },
  });
  const locked = new Set(published.map((one) => one.group).filter((g): g is string => !!g));
  if (locked.size > 0) {
    await prisma.post.updateMany({
      where: { organizationId: DEMO_ORG, group: { in: [...locked] }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    run.groups = run.groups.filter((one) => !locked.has(one.group));
  }

  // Anything imported under this run's links even when a test stopped early.
  const strays = await prisma.clipVideo.findMany({
    where: {
      organizationId: DEMO_ORG,
      deletedAt: null,
      createdAt: { gte: SUITE_START },
      externalId: {
        in: [...STREAM_LINKS, ...TWO_SPEAKER_LINKS, ...TALK_LINKS, ...NEW_SITE_LINKS].map(
          (link) => link.externalId,
        ),
      },
    },
    select: { id: true },
  });
  for (const one of strays) {
    if (!run.videos.some((v) => v.id === one.id)) run.videos.push({ org: DEMO_ORG, id: one.id });
  }

  problems.push(...(await cleanUpAiRun(request, ai)));
  problems.push(...(await cleanUpClipsRun({ [DEMO_ORG]: request }, run)));
  await expect.poll(async () => (await runLeftovers(run)).openJobs, { timeout: 30_000 }).toBe(0);
  const left = await runLeftovers(run);
  const minutes = await aiMinutesUsed(request);
  console.log(
    `[clips-ai cleanup] ${JSON.stringify(left)}; AI minutes used ${s.aiMinutesAtStart} -> ${minutes}`,
  );
  if (problems.length > 0) console.log(`[clips-ai cleanup] problems: ${problems.join('; ')}`);
  await context.close();

  expect(problems, 'every cleanup call answered').toEqual([]);
  expect(
    Object.values(left).every((n) => n === 0),
    JSON.stringify(left),
  ).toBe(true);
});

/* ========================================================================== */
/* Captions and transcript (1 to 4)                                           */
/* ========================================================================== */

test.describe('Captions and transcript', () => {
  test.beforeAll(() => started('captions'));
  test.afterAll(() => finished('captions'));

  test('1. The status shows the AI service; with it off, AI buttons are off and Sprint 12 tools work', async () => {
    const { status } = await getJson<{
      status: { ai?: { service: string; captions?: boolean; faces?: boolean } };
    }>(page.request, '/clips/status');
    expect(status.ai?.service).toBe('ok');
    expect(status.ai?.captions).toBe(true);
    expect(status.ai?.faces).toBe(true);

    // The AI service is not stopped for real (it serves other sessions): the
    // browser's own `GET /clips/status` is answered as if it were off.
    const statusUrl = `${API_URL}/clips/status`;
    await page.route(statusUrl, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { status: { ai?: Record<string, unknown> } };
      if (body.status.ai) {
        body.status.ai = {
          ...body.status.ai,
          service: 'off',
          captions: false,
          action: false,
          actionVision: false,
          faces: false,
          voice: false,
        };
      }
      await route.fulfill({ response, json: body });
    });

    try {
      await openClipEditor(page, DEMO_ORG, s.c1);
      await openEditorTab(page, 'captions');
      await expect(page.getByTestId('clip-captions-off')).toHaveText(
        'Captions from speech are not available right now. You can still upload a captions file.',
      );
      await expect(page.getByTestId('clip-captions-add')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Upload A Captions File' })).toBeEnabled();

      await page.getByTestId('clip-transcript-toggle').click();
      const pane = page.getByTestId('clip-transcript-pane');
      await expect(pane).toBeVisible();
      await expect(
        pane.getByText('Captions are not available right now. Everything else still works.'),
      ).toBeVisible();
      await expect(pane.getByTestId('clip-transcript-listen-button')).toBeDisabled();
      await pane.getByRole('button', { name: 'Close Transcript' }).click();
      await expect(pane).toBeHidden();

      // A Sprint 12 tool still works: a text goes on, saves, and comes off again.
      await openEditorTab(page, 'text');
      await page.getByTestId('clip-text-panel').getByRole('button', { name: 'Add Text' }).click();
      const words = page.getByRole('textbox', { name: 'Words' });
      await expect(words).toBeVisible();
      await words.fill('AI Is Off');
      await expectEditorSaved(page);
      const withText = await getClip(page.request, s.c1);
      expect(
        withText.document.tracks
          .flatMap((track) => track.items ?? [])
          .some((item) => item.type === 'text'),
      ).toBe(true);
      await page
        .getByTestId('clip-text-panel')
        .getByRole('button', { name: 'Remove Text' })
        .click();
      await expectEditorSaved(page);
      const without = await getClip(page.request, s.c1);
      expect(
        without.document.tracks
          .flatMap((track) => track.items ?? [])
          .some((item) => item.type === 'text'),
      ).toBe(false);
    } finally {
      await page.unroute(statusUrl);
    }
  });

  test('2. Add Captions: its steps, captions on the clip, the price charged once; the same stretch is then free', async () => {
    await openClipEditor(page, DEMO_ORG, s.c1);
    await openEditorTab(page, 'captions');
    const add = page.getByTestId('clip-captions-add');
    await expect(add).toHaveText(/^Add Captions \(\d+ AI Minutes?\)$/, { timeout: 30_000 });
    const price = Number(/\((\d+) AI/.exec(await add.innerText())?.[1]);
    expect(price).toBeGreaterThanOrEqual(2);
    const before = await aiMinutesUsed(page.request);

    // Simulated listening ends in under a second. The local testing guide's
    // forcing switch in the video's title (`[simulate:listen-slow]`) holds it
    // for about ten seconds, so its steps can be seen; the title (which also
    // names the sample) is put back as soon as they are.
    const { title } = await prisma.clipVideo.findUniqueOrThrow({
      where: { id: s.stream },
      select: { title: true },
    });
    await prisma.clipVideo.update({
      where: { id: s.stream },
      data: { title: `${title} [simulate:listen-slow]` },
    });
    try {
      const asked = answer(page, 'POST', `/clips/${s.c1}/captions`);
      await add.click();
      expect((await asked).status()).toBe(202);
      const listening = page.getByTestId('clip-captions-listening');
      await expect(
        listening.getByRole('progressbar', { name: 'Listening to this clip' }),
      ).toBeVisible();
      await expect(listening).toContainText('Listening to this clip. You can keep editing.', {
        timeout: 20_000,
      });
      await expect(listening.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    } finally {
      await prisma.clipVideo.update({ where: { id: s.stream }, data: { title } });
    }
    // Listened: the track is on the clip and its words are listed.
    await expect(page.getByTestId('clip-caption-words')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('clip-caption-word').first()).toBeVisible();
    await expectEditorSaved(page);
    const doc = (await getClip(page.request, s.c1)).document;
    expect(captionsOf(doc)?.transcriptAssetId).toBeTruthy();
    await expect.poll(() => aiMinutesUsed(page.request), { timeout: 15_000 }).toBe(before + price);

    // A second clip inside the listened stretch: no price, no listening, no charge.
    await ready.c2;
    await openClipEditor(page, DEMO_ORG, s.c2);
    await openEditorTab(page, 'captions');
    const free = page.getByTestId('clip-captions-add');
    await expect(free).toHaveText('Add Captions', { timeout: 30_000 });
    const second = answer(page, 'POST', `/clips/${s.c2}/captions`);
    await free.click();
    expect((await second).status()).toBe(200);
    await expect(page.getByTestId('clip-caption-words')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('clip-captions-listening')).toHaveCount(0);
    await expectEditorSaved(page);
    expect(captionsOf((await getClip(page.request, s.c2)).document)).not.toBeNull();
    expect(await aiMinutesUsed(page.request)).toBe(before + price);
  });

  test('3. Switch the style, fix a word, trim: the captions stay in step', async () => {
    // c2 is open on its Captions tab from test 2.
    await expect(page.getByTestId('clip-caption-words')).toBeVisible();
    const startStyle = captionsOf((await getClip(page.request, s.c2)).document)?.styleId;
    const karaoke = page.getByRole('button', { name: /^Karaoke/ }).first();
    await karaoke.click();
    await expect(karaoke).toHaveAttribute('aria-pressed', 'true');
    await expectEditorSaved(page);
    const styled = captionsOf((await getClip(page.request, s.c2)).document);
    expect(styled?.styleId).not.toBe(startStyle);
    expect(styled?.styleId).toMatch(/karaoke/);

    // Fix the second word the clip shows.
    const chips = page.getByTestId('clip-caption-word');
    const countBefore = await chips.count();
    const target = chips.nth(1);
    const heard = (await target.innerText()).trim();
    await target.click();
    const form = page.getByTestId('clip-caption-word-open');
    await expect(form).toBeVisible();
    await form.getByLabel('The word shown').fill('Edited');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    const fixed = page.getByRole('button', { name: /^Edited(, not sure)?$/ });
    await expect(fixed).toBeVisible();
    await expectEditorSaved(page);
    expect(
      Object.values(captionsOf((await getClip(page.request, s.c2)).document)?.edits ?? {}).map(
        (edit) => edit.text,
      ),
    ).toContain('Edited');
    await fixed.click();
    await expect(form.getByText(`Heard as "${heard}".`)).toBeVisible();
    await form.getByRole('button', { name: 'Close', exact: true }).click();

    // Trim the end by about a third: fewer words, the fix kept, nothing past the end.
    const part = page.getByTestId('clip-part').first();
    const partBox = await part.boundingBox();
    const gripBox = await part.locator('[data-grip="end"]').boundingBox();
    if (!partBox || !gripBox) throw new Error('No part or end grip on the timeline');
    const fromX = gripBox.x + gripBox.width / 2;
    const y = gripBox.y + gripBox.height / 2;
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    await page.mouse.move(fromX - partBox.width / 6, y, { steps: 4 });
    await page.mouse.move(fromX - partBox.width / 3, y, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => outputMs((await getClip(page.request, s.c2)).document), { timeout: 20_000 })
      .toBeLessThan(17_000);
    await expectEditorSaved(page);
    const lengthMs = outputMs((await getClip(page.request, s.c2)).document);

    await expect.poll(() => chips.count(), { timeout: 15_000 }).toBeLessThan(countBefore);
    await expect(page.getByRole('button', { name: /^Edited(, not sure)?$/ })).toBeVisible();
    const marks = page.getByTestId('clip-caption-words').getByRole('button', { name: /^Go to / });
    const last = (await marks.last().getAttribute('aria-label')) ?? '';
    const [, min, sec] = /^Go to (\d+):(\d+(?:\.\d)?)$/.exec(last) ?? [];
    expect(Number(min) * 60 + Number(sec)).toBeLessThanOrEqual(lengthMs / 1000);
  });

  test('4. The transcript: delete a sentence and Undo it; Remove Silences with its count', async () => {
    await openClipEditor(page, DEMO_ORG, s.c1);
    await page.getByTestId('clip-transcript-toggle').click();
    const pane = page.getByTestId('clip-transcript-pane');
    const words = pane.getByTestId('transcript-text');
    await expect(words).toBeVisible({ timeout: 30_000 });
    const before = (await getClip(page.request, s.c1)).document;

    // "Here comes the tunnel jump." (56.8 s of the stream): its five words.
    const options = words.getByRole('option');
    const texts = await options.allInnerTexts();
    const at = texts.findIndex(
      (text, i) => text.trim() === 'Here' && texts[i + 4]?.trim().startsWith('jump'),
    );
    expect(at, `the sentence in ${texts.join(' ')}`).toBeGreaterThanOrEqual(0);
    await options.nth(at).click();
    await options.nth(at + 4).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await expect(
      page.getByText(/^Cut 5 words\. The clip is [\d.]+ seconds? shorter\.$/).first(),
    ).toBeVisible();
    await expectEditorSaved(page);
    const cut = (await getClip(page.request, s.c1)).document;
    expect(cut.segments.length).toBe(before.segments.length + 1);
    expect(outputMs(cut)).toBeLessThan(outputMs(before) - 1_000);

    await page
      .getByTestId('clip-editor-top-bar')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expectEditorSaved(page);
    const undone = (await getClip(page.request, s.c1)).document;
    expect(undone.segments).toHaveLength(before.segments.length);
    expect(Math.round(outputMs(undone))).toBe(Math.round(outputMs(before)));

    // Remove Silences: the popover counts the pauses before anything is cut.
    await pane.getByTestId('clip-remove-silences').click();
    const popover = page.getByTestId('clip-silences-popover');
    const found = popover.getByTestId('clip-silences-found');
    await expect(found).toHaveText(
      /^(\d+ pauses?, [\d.]+ seconds?|No pauses longer than [\d.]+ seconds?\.)$/,
    );
    const line = await found.innerText();
    const count = Number(/^(\d+) pause/.exec(line)?.[1] ?? 0);
    const loud = popover.getByTestId('clip-silences-loud');
    if ((await loud.count()) > 0) {
      await expect(loud).toHaveText(
        /^(One pause has sound under it \(music or a game\), so it stays\.|\d+ pauses have sound under them \(music or a game\), so they stay\.)$/,
      );
    }
    console.log(`[clips-ai] Remove Silences on the stream clip: "${line}"`);
    expect(count, 'the stream clip has pauses between its sentences').toBeGreaterThan(0);
    await popover.getByTestId('clip-silences-remove').click();
    await expect(
      page
        .getByText(
          new RegExp(`^Removed ${count} pauses?\\. The clip is [\\d.]+ seconds? shorter\\.$`),
        )
        .first(),
    ).toBeVisible();
    await expectEditorSaved(page);
    const cleaned = (await getClip(page.request, s.c1)).document;
    expect(cleaned.segments.length).toBeGreaterThan(before.segments.length);
    expect((cleaned.meta?.cleanup as { silencesMinMs?: number } | undefined)?.silencesMinMs).toBe(
      800,
    );
  });
});

/* ========================================================================== */
/* Setup and AI (5 to 7)                                                      */
/* ========================================================================== */

test.describe('Setup and AI', () => {
  test.beforeAll(() => started('setup-and-ai'));
  test.afterAll(() => finished('setup-and-ai'));

  test('5. Clip Setup: price by range, a request, a Genre; an uploaded captions file is free; titled clips on sentences', async () => {
    // Clip Setup has no file field of its own (the code wins over the document):
    // a captions file goes on a clip, on its Captions tab. It is never listened
    // to and never charged. On a talk clip nothing else listens to meanwhile.
    await ready.talk;
    s.c7 = await newClip(s.talk, 150_000, 160_000, 'Own Captions');
    const minutesBefore = await aiMinutesUsed(page.request);
    const listensBefore = await prisma.clipJob.count({
      where: { videoId: s.talk, kind: 'TRANSCRIBE' },
    });
    await openClipEditor(page, DEMO_ORG, s.c7);
    await openEditorTab(page, 'captions');
    const fileName = `e2e-captions-${RUN}.srt`;
    const srt = [
      '1',
      '00:00:00,500 --> 00:00:03,000',
      'Our own words from a file.',
      '',
      '2',
      '00:00:03,500 --> 00:00:07,000',
      'Nothing here was listened to.',
      '',
    ].join('\n');
    const uploaded = answer(page, 'POST', `/clips/${s.c7}/captions/from-file`);
    await page.getByTestId('clip-captions-file').setInputFiles({
      name: fileName,
      mimeType: 'application/x-subrip',
      buffer: Buffer.from(srt, 'utf8'),
    });
    expect((await uploaded).ok()).toBe(true);
    await expect(page.getByText(`From your file: ${fileName}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('clip-caption-word').first()).toBeVisible();
    await expectEditorSaved(page);
    expect(captionsOf((await getClip(page.request, s.c7)).document)).not.toBeNull();
    expect(await aiMinutesUsed(page.request)).toBe(minutesBefore);
    expect(await prisma.clipJob.count({ where: { videoId: s.talk, kind: 'TRANSCRIBE' } })).toBe(
      listensBefore,
    );

    // Clip Setup on the stream.
    await page.goto(`/${DEMO_ORG}/clips/video/${s.stream}/setup`);
    await expect(page.getByTestId('clip-setup')).toBeVisible({ timeout: 60_000 });
    const whole = await settledTotal(page, null);
    await setRangeEnd(page, 120_000);
    const shorter = await settledTotal(page, whole);
    expect(shorter).toBeLessThan(whole);
    await expect(page.getByTestId('clip-setup-find')).toHaveText(
      `Find Clips (${shorter} AI ${shorter === 1 ? 'Minute' : 'Minutes'})`,
    );

    await page.getByTestId('clip-setup-genre').click();
    await page.getByRole('option', { name: 'Gaming', exact: true }).click();
    await expect(page.getByTestId('clip-setup-genre')).toHaveText(/Gaming/);
    await page.getByTestId('clip-setup-request').fill('the tunnel jump and the clean start');
    await page.waitForTimeout(800);
    await expect(page.getByTestId('clip-setup-find')).toBeEnabled({ timeout: 30_000 });

    await runHighlights(page, s.stream);
    const runView = await latestRun(page.request, s.stream);
    expect(runView.status).toBe('DONE');
    expect(runView.ai?.read).toBe(true);
    expect(runView.ai?.asked).toBe(true);
    const found = page.getByRole('list', { name: 'Clips found by AI' });
    await expect(found.getByTestId('video-clip-row').first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText('AI listened to what was said and looked at sound and picture.'),
    ).toBeVisible();

    // Titled clips that start on a sentence (a row of the transcript, less the air before it).
    const { transcript } = await readTranscript(page.request, s.stream);
    if (!transcript) throw new Error('The stream has no transcript');
    const rows = transcriptRows(
      { words: transcript.words, covered: transcript.covered },
      { fromMs: 0, toMs: 120_000 },
    );
    const starts = rows.map((row) => Math.max(0, row.from - CLIP_AIR_MS));
    const picked = (await clipsOfVideo(page.request, s.stream)).filter(
      (clip) => clip.origin === 'AI_TRANSCRIPT',
    );
    expect(picked.length).toBeGreaterThan(0);
    for (const clip of picked) {
      expect(clip.title.trim().length, 'an AI clip has a title').toBeGreaterThan(3);
      const from = clip.range?.fromMs ?? -1;
      expect(
        starts.some((start) => Math.abs(start - from) <= 1),
        `${clip.title} starts at ${from}, not on a sentence (${starts.slice(0, 12).join(', ')}...)`,
      ).toBe(true);
    }
  });

  test('6. Look For Action adds its clips and its line', async () => {
    await page.goto(`/${DEMO_ORG}/clips/video/${s.stream}/setup`);
    await expect(page.getByTestId('clip-setup')).toBeVisible({ timeout: 60_000 });
    const whole = await settledTotal(page, null);
    await setRangeEnd(page, 120_000);
    const without = await settledTotal(page, whole);
    const action = page.getByTestId('clip-setup-action');
    await expect(page.getByText(/^\+\d+ AI Minutes?$/).first()).toBeVisible();
    await action.click();
    await expect(action).toHaveAttribute('aria-checked', 'true');
    const withAction = await settledTotal(page, without);
    expect(withAction).toBeGreaterThan(without);

    await runHighlights(page, s.stream);
    const runView = await latestRun(page.request, s.stream);
    expect(runView.ai?.watched).toBe(true);
    await expect(
      page.getByText('AI listened to what was said and watched for action.'),
    ).toBeVisible({
      timeout: 30_000,
    });
    const clips = await clipsOfVideo(page.request, s.stream);
    const seen = clips.filter((clip) =>
      clip.reasons.some(
        (reason) => reason === 'sudden_movement' || reason === 'something_unexpected',
      ),
    );
    expect(seen.length, 'clips found or helped by action').toBeGreaterThan(0);
  });

  test('7. Detect Camera on the stream; Follow The Speaker on two speakers, and off again', async () => {
    await ready.two;
    [s.c3, s.d1] = await Promise.all([
      newClip(s.stream, 300_000, 306_000, 'Face Camera'),
      newClip(s.two, 15_000, 27_000, 'Two Speakers'),
    ]);
    await openClipEditor(page, DEMO_ORG, s.c3);
    await openEditorTab(page, 'layouts');
    const layouts = page.getByTestId('clip-layouts-panel');
    const split = layouts
      .getByRole('group', { name: 'Layouts' })
      .getByRole('button', { name: /^Split/ });
    await split.click();
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    await expectEditorSaved(page);
    const before = (await getClip(page.request, s.c3)).document.layout;
    await page.getByTestId('clip-detect-camera-button').click();
    await expect(sentence(page, 'Camera box moved onto the face camera.')).toBeVisible({
      timeout: 60_000,
    });
    await expectEditorSaved(page);
    const after = (await getClip(page.request, s.c3)).document.layout;
    expect(JSON.stringify(after.areas)).not.toBe(JSON.stringify(before.areas));

    await openClipEditor(page, DEMO_ORG, s.d1);
    await openEditorTab(page, 'layouts');
    const own = (await getClip(page.request, s.d1)).document.layout;
    const follow = page.getByTestId('clip-follow-switch');
    await expect(follow).toBeEnabled({ timeout: 30_000 });
    await follow.click();
    const picker = page.getByTestId('clip-follow-picker');
    const on = sentence(page, 'Following the speaker.');
    await expect(on.or(picker)).toBeVisible({ timeout: 60_000 });
    if (await picker.isVisible()) {
      await picker.getByRole('button').first().click();
      await expect(on).toBeVisible({ timeout: 30_000 });
    }
    await expectEditorSaved(page);
    expect((await getClip(page.request, s.d1)).document.layout.follow).toBeTruthy();

    await follow.click();
    await expect(sentence(page, 'Your own layout is back.')).toBeVisible();
    await expectEditorSaved(page);
    const back = (await getClip(page.request, s.d1)).document.layout;
    expect(back.follow).toBeUndefined();
    expect(back.kind).toBe(own.kind);
  });
});

/* ========================================================================== */
/* Recipes (8 to 11)                                                          */
/* ========================================================================== */

test.describe('Recipes', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    started('recipes');
    // The talk's first 75 seconds listened once, for its bad words and hook: the
    // clip (5 to 40 s) and the 30 second handles the editor can reach either side.
    const listened = await page.request.post(`${API_URL}/clips/videos/${s.talk}/transcript`, {
      data: { fromMs: 0, toMs: 75_000 },
    });
    expect([200, 202], await listened.text()).toContain(listened.status());
    const body = (await listened.json()) as { job?: { id: string } };
    if (body.job) expect((await waitForJob(page.request, body.job.id, 90_000)).status).toBe('DONE');
    s.t1 = await newClip(s.talk, 5_000, 40_000, 'Bad Words');
  });
  test.afterAll(() => finished('recipes'));

  test('8. Bleep Bad Words; Add Hook Title; Add Hook Clip', async () => {
    await openClipEditor(page, DEMO_ORG, s.t1);
    const bleep = await openEffect(page, 'bleep', /^Bleep Bad Words/);
    const toggle = bleep.getByTestId('clip-bleep-toggle');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(bleep.getByTestId('clip-bleep-partly')).toHaveCount(0);
    await toggle.click();
    await expect(sentence(page, 'Bad words bleeped.')).toBeVisible();
    // "bullshit" at 15.5 s of the talk is among the words found (the workspace's
    // own list may add more), and every word found is bleeped.
    const words = bleep.getByTestId('clip-bleep-words').getByRole('checkbox');
    await expect(
      bleep.getByRole('checkbox', { name: 'Bleep bullshit', exact: true }),
    ).toBeChecked();
    const count = await words.count();
    for (let i = 0; i < count; i += 1) await expect(words.nth(i)).toBeChecked();
    await expectEditorSaved(page);
    expect((await getClip(page.request, s.t1)).document.bleeps).toHaveLength(count);

    const title = await openEffect(page, 'hook-title', /^Add Hook Title/);
    const tiles = title.getByTestId('clip-hook-title-tile');
    await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
    await tiles.first().click();
    await expect(title.getByTestId('clip-hook-title-input')).not.toHaveValue('');
    await title.getByTestId('clip-hook-title-add').click();
    await expect(sentence(page, 'Hook title added.')).toBeVisible();
    await expectEditorSaved(page);
    const titled = (await getClip(page.request, s.t1)).document;
    expect(
      titled.tracks.flatMap((track) => track.items ?? []).some((item) => item.hookTitle === true),
    ).toBe(true);

    const hook = await openEffect(page, 'hook-clip', /^Add Hook Clip/);
    await expect(hook.getByTestId('clip-hook-add')).toBeVisible({ timeout: 30_000 });
    await hook.getByTestId('clip-hook-add').click();
    await expect(sentence(page, 'Hook added. The clip now opens with it.')).toBeVisible();
    await expectEditorSaved(page);
    expect((await getClip(page.request, s.t1)).document.segments[0]?.role).toBe('hook');
  });

  test('9. Save As Recipe; apply it to another clip; the recipe on Clip Setup', async () => {
    await openClipEditor(page, DEMO_ORG, s.c1);
    await page.getByTestId('clip-editor-more').click();
    await page.getByTestId('clip-menu-save-recipe').click();
    const save = page.getByTestId('clip-save-recipe');
    await expect(save).toBeVisible();
    await save.getByTestId('clip-save-recipe-name').fill(s.recipeName);
    await expect(save.getByTestId('clip-save-recipe-readback')).toContainText(/Captions/);
    const created = answer(page, 'POST', '/clips/recipes');
    await save.getByTestId('clip-save-recipe-submit').click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    s.recipeId = ((await response.json()) as { recipe: { id: string } }).recipe.id;
    ai.recipes.push(s.recipeId);
    await expect(sentence(page, `${s.recipeName} saved as a recipe.`)).toBeVisible();

    await openClipEditor(page, DEMO_ORG, s.c2);
    await page.getByTestId('clip-editor-more').click();
    await page.getByTestId('clip-menu-apply-recipe').click();
    const apply = page.getByTestId('clip-apply-recipe');
    await apply.getByRole('button', { name: `Apply ${s.recipeName}`, exact: true }).click();
    await expect(sentence(page, `${s.recipeName} applied.`)).toBeVisible({ timeout: 60_000 });
    await expectEditorSaved(page);
    const doc = (await getClip(page.request, s.c2)).document;
    expect(doc.recipeId).toBe(s.recipeId);
    expect(captionsOf(doc)).not.toBeNull();

    // On Clip Setup, the recipe sets the choices it holds (captions on).
    await page.goto(`/${DEMO_ORG}/clips/video/${s.stream}/setup`);
    await expect(page.getByTestId('clip-setup')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('clip-setup-recipe').click();
    await page.getByRole('option', { name: s.recipeName, exact: true }).click();
    await expect(page.getByTestId('clip-setup-recipe')).toHaveText(new RegExp(s.recipeName));
    await expect(page.getByTestId('clip-setup-captions')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('clip-setup-silences')).toHaveAttribute('aria-checked', 'true');
  });

  test('10. Captions Only: captions on and nothing else changed; a starter is copied and the copy renamed', async () => {
    s.c6 = await newClip(s.stream, 85_000, 91_000, 'Captions Only');
    await openClipEditor(page, DEMO_ORG, s.c6);
    const before = (await getClip(page.request, s.c6)).document;
    expect(captionsOf(before)).toBeNull();
    await page.getByTestId('clip-editor-more').click();
    await page.getByTestId('clip-menu-apply-recipe').click();
    await page
      .getByTestId('clip-apply-recipe')
      .getByRole('button', { name: 'Apply Captions Only', exact: true })
      .click();
    await expect(sentence(page, 'Captions Only applied.')).toBeVisible({ timeout: 60_000 });
    await expectEditorSaved(page);
    const after = (await getClip(page.request, s.c6)).document;
    expect(captionsOf(after)?.styleId).toBe('bold-pop');
    expect(after.segments).toEqual(before.segments);
    expect(after.layout).toEqual(before.layout);
    expect(after.canvas).toEqual(before.canvas);
    expect(after.tracks.filter((track) => track.kind !== 'captions')).toEqual(
      before.tracks.filter((track) => track.kind !== 'captions'),
    );

    // The starter copied in the kit, and the copy renamed (built-in starters cannot be changed).
    await page.goto(`/${DEMO_ORG}/clips/kit`);
    const starter = page.getByTestId('clip-kit-starter').filter({ hasText: 'Captions Only' });
    await expect(starter).toBeVisible({ timeout: 30_000 });
    const duplicated = answer(page, 'POST', /^\/clips\/recipes\/[^/]+\/duplicate$/);
    await starter.getByRole('button', { name: 'Duplicate Captions Only', exact: true }).click();
    const response = await duplicated;
    expect(response.status(), await response.text()).toBe(201);
    const copy = ((await response.json()) as { recipe: { id: string; name: string } }).recipe;
    ai.recipes.push(copy.id);
    expect(copy.name).toMatch(/^Captions Only Copy/);

    const renamed = `E2E Captions ${RUN}`;
    const own = page.getByTestId('clip-kit-own-recipes');
    await own.getByRole('button', { name: `Rename ${copy.name}`, exact: true }).click();
    const dialog = page.getByTestId('clip-kit-rename-dialog');
    await dialog.getByLabel('Recipe name').fill(renamed);
    const patched = answer(page, 'PATCH', `/clips/recipes/${copy.id}`);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await patched).ok()).toBe(true);
    await expect(own.getByText(renamed, { exact: true })).toBeVisible();
    const list = await getJson<{ recipes: Array<{ id: string; name: string }> }>(
      page.request,
      '/clips/recipes',
    );
    expect(list.recipes.find((recipe) => recipe.id === copy.id)?.name).toBe(renamed);
  });

  test('11. Auto-Edit Video: one press makes one edited clip and says what it skipped', async () => {
    const autoBefore = (await clipsOfVideo(page.request, s.talk)).filter(
      (c) => c.origin === 'AUTO_EDIT',
    );
    await page.goto(`/${DEMO_ORG}/clips/video/${s.talk}`);
    await page.getByTestId('clip-video-auto-edit').click();
    const dialog = page.getByTestId('clip-auto-edit');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('clip-auto-edit-recipe').click();
    await page.getByRole('option', { name: 'Reframe', exact: true }).click();
    const startButton = dialog.getByTestId('clip-auto-edit-start');
    await expect(startButton).toBeEnabled({ timeout: 30_000 });
    // The skipped part is said in a toast: by the dialog when the job did the
    // following, or by the editor when the clip follows on its first open
    // (after the shape question). Watched from the press on, since a toast
    // lasts a few seconds.
    const skipped = sentence(
      page,
      'Follow The Speaker was skipped: we could not find anyone to follow.',
    ).waitFor({ timeout: 150_000 });
    skipped.catch(() => undefined);
    const asked = answer(page, 'POST', `/clips/videos/${s.talk}/auto-edit`);
    await startButton.click();
    const started = await asked;
    expect(started.ok(), await started.text()).toBe(true);
    const { clipId } = (await started.json()) as { clipId: string };
    run.clips.push({ org: DEMO_ORG, id: clipId });

    await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/clips/edit/${clipId}$`), {
      timeout: 120_000,
    });
    await expect(page.getByTestId('clip-editor')).toBeVisible({ timeout: 60_000 });
    const shape = shapeDialog(page);
    if ((await getClip(page.request, clipId)).document.meta?.shapeChosen !== true) {
      await expect(shape).toBeVisible({ timeout: 30_000 });
      await shape.getByRole('button', { name: /^Vertical/ }).click();
      await shape.getByTestId('clip-shape-continue').click();
      await expect(shape).toBeHidden();
    }
    await skipped;
    const autoAfter = (await clipsOfVideo(page.request, s.talk)).filter(
      (c) => c.origin === 'AUTO_EDIT',
    );
    expect(autoAfter).toHaveLength(autoBefore.length + 1);
    const doc = (await getClip(page.request, clipId)).document;
    expect(doc.canvas.ratio).toBe('9:16');
    expect(doc.layout.follow).toBeUndefined();

    // Nothing later uses this clip: deleting it now stops the sharp range its
    // first open started, which would otherwise share the machine with the
    // batch export next.
    const removed = await page.request.delete(`${API_URL}/clips/${clipId}`);
    expect(removed.ok(), await removed.text()).toBe(true);
  });
});

/* ========================================================================== */
/* Batch and montage (12, 13): the only video exports                         */
/* ========================================================================== */

test.describe('Batch and montage', () => {
  test.beforeAll(() => started('batch-and-montage'));
  test.afterAll(() => finished('batch-and-montage'));

  async function tick(titles: string[]): Promise<void> {
    await page.goto(`/${DEMO_ORG}/clips?tab=clips`);
    for (const title of titles) {
      const box = page.getByRole('checkbox', { name: `Select ${title}`, exact: true });
      await expect(box).toBeAttached({ timeout: 30_000 });
      await box.check({ force: true });
      await expect(box).toBeChecked();
    }
    await expect(page.getByTestId('clips-bulk-bar')).toBeVisible();
  }

  test('12. Tick three clips, Export All: one notice', async () => {
    // Three short clips made earlier, their sharp ranges fetched long ago.
    await tick(['Face Camera', 'Captions Only', 'Two Speakers'].map(titleOf));
    await page.getByTestId('clips-bulk-export').click();
    const dialog = page.getByTestId('clips-export-all-dialog');
    await expect(dialog).toBeVisible();
    const tile = dialog.getByRole('button', { name: /^720p(?! 60)/ });
    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    const startedBatch = answer(page, 'POST', '/clips/exports');
    await dialog.getByTestId('clips-export-all-start').click();
    const response = await startedBatch;
    expect(response.status(), await response.text()).toBe(202);
    const body = (await response.json()) as { batchId?: string; batch?: { batchId: string } };
    const batchId = body.batchId ?? body.batch?.batchId ?? '';
    expect(batchId).not.toBe('');
    ai.batches.push(batchId);

    await expect(dialog.getByTestId('clips-export-all-counts')).toHaveText('3 of 3 done', {
      timeout: 200_000,
    });
    await expect
      .poll(
        () =>
          prisma.notifications.count({
            where: { organizationId: DEMO_ORG, meta: { path: ['batchId'], equals: batchId } },
          }),
        { timeout: 30_000 },
      )
      .toBe(1);
    const notice = await prisma.notifications.findFirst({
      where: { organizationId: DEMO_ORG, meta: { path: ['batchId'], equals: batchId } },
    });
    expect(notice?.title).toBe('Your clips are ready');
    expect(notice?.content).toBe('3 clips are ready.');
    // Still one, a moment later: each finished export does not add its own.
    await page.waitForTimeout(2_000);
    expect(
      await prisma.notifications.count({
        where: { organizationId: DEMO_ORG, meta: { path: ['batchId'], equals: batchId } },
      }),
    ).toBe(1);
  });

  test('13. Create Montage from two videos and export it', async () => {
    // One clip of the stream and one of the two speakers.
    await tick([titleOf('Face Camera'), titleOf('Two Speakers')]);
    await page.getByTestId('clips-bulk-montage').click();
    const dialog = page.getByTestId('clips-montage-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('clips-montage-row')).toHaveCount(2);
    const vertical = dialog
      .getByTestId('clips-montage-shape')
      .getByRole('button', { name: /^Vertical/ });
    if ((await vertical.count()) > 0) await vertical.click();
    const made = answer(page, 'POST', '/clips/montages');
    await dialog.getByTestId('clips-montage-create').click();
    const response = await made;
    expect(response.status(), await response.text()).toBe(201);
    s.montageId = ((await response.json()) as { clip: { id: string } }).clip.id;
    run.clips.push({ org: DEMO_ORG, id: s.montageId });
    await expect(page).toHaveURL(new RegExp(`/clips/edit/${s.montageId}$`), { timeout: 30_000 });
    await openClipEditor(page, DEMO_ORG, s.montageId);

    await openEditorTab(page, 'export');
    const panel = page.getByTestId('clip-export-panel');
    const tile = panel.getByRole('button', { name: /^720p(?! 60)/ });
    await tile.click();
    const exported = answer(page, 'POST', `/clips/${s.montageId}/exports`);
    await page.getByTestId('clip-panel-export').click();
    expect((await exported).status()).toBe(202);
    await expect(panel.getByTestId('clip-export-result')).toBeVisible({ timeout: 200_000 });
    const { exports } = await getJson<{
      exports: Array<{ media: { id: string; name: string; durationMs: number | null } | null }>;
    }>(page.request, `/clips/${s.montageId}/exports`);
    const media = exports[0]?.media;
    if (!media) throw new Error('The montage export has no Media file');
    run.media.push({ org: DEMO_ORG, id: media.id });
    s.montageMediaName = media.name;
    expect(media.durationMs ?? 0).toBeGreaterThan(7_000);
  });
});

/* ========================================================================== */
/* Sources and posting (14, 15): no render                                    */
/* ========================================================================== */

test.describe('Sources and posting', () => {
  test.beforeAll(() => started('sources-and-posting'));
  test.afterAll(() => finished('sources-and-posting'));

  test('14. A link from a new site imports; a site that is off is refused', async () => {
    const link = await firstFree(DEMO_ORG, NEW_SITE_LINKS);
    await page.goto(`/${DEMO_ORG}/clips`);
    const box = page.getByRole('region', { name: 'Bring In A Video' });
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.getByLabel('Video link').fill(link.url);
    const probed = answer(page, 'POST', '/clips/links/probe');
    await box.getByRole('button', { name: 'Find Clips', exact: true }).click();
    expect((await probed).status()).toBe(200);
    const card = page.getByTestId('clips-link-card');
    await card.getByRole('checkbox', { name: SENTENCES.rights }).click();
    const imported = answer(page, 'POST', '/clips/videos');
    await card.getByRole('button', { name: 'Import Video', exact: true }).click();
    const response = await imported;
    expect(response.status(), await response.text()).toBe(201);
    const videoId = ((await response.json()) as { video: { id: string } }).video.id;
    run.videos.push({ org: DEMO_ORG, id: videoId });
    await waitForVideoReady(page.request, videoId, 120_000);

    await page.goto(`/${DEMO_ORG}/clips`);
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.getByLabel('Video link').fill(OFF_SITE_LINK);
    const refused = answer(page, 'POST', '/clips/links/probe');
    await box.getByRole('button', { name: 'Find Clips', exact: true }).click();
    expect((await refused).status()).toBe(422);
    await expect(
      box.getByText('TikTok links are paused for now. You can upload the file instead.'),
    ).toBeVisible();
    await expect(page.getByTestId('clips-link-card')).toHaveCount(0);
  });

  test('15. Posting slots, Next Available, the random time picker; Made With AI reaches the publisher', async () => {
    // Two weekday windows on LinkedIn: 10:00 and 16:00, 15 minutes either side.
    const channel = await prisma.integration.findUnique({
      where: { id: LINKEDIN },
      select: { postingTimes: true },
    });
    if (!channel) throw new Error('No seeded LinkedIn channel');
    ai.postingTimes.push({ id: LINKEDIN, value: channel.postingTimes });
    const windows = [600, 960];
    const patched = await page.request.patch(`${API_URL}/channels/${LINKEDIN}`, {
      data: {
        postingTimes: windows.map((time) => ({ time, windowMinutes: 15, days: [1, 2, 3, 4, 5] })),
      },
    });
    expect(patched.ok(), await patched.text()).toBe(true);

    const inWindow = (at: Date) => {
      const minute = at.getHours() * 60 + at.getMinutes();
      const day = at.getDay();
      return (
        day >= 1 &&
        day <= 5 &&
        windows.some((time) => Math.abs(minute - time) <= 15) &&
        at.getMinutes() % 5 !== 0
      );
    };

    // Post one: Next Available, then onto the calendar.
    await openComposer(page);
    await channelButton(page, /Acme Marketing/).click();
    await writePost(page, `Clips AI slot one ${RUN}`);
    const firstSlot = answer(page, 'GET', '/channels/next-slot');
    await page.getByRole('button', { name: 'Next Available', exact: true }).click();
    const first = new Date(((await (await firstSlot).json()) as { at: string }).at);
    expect(inWindow(first), `first slot ${first.toString()}`).toBe(true);
    expect(await publishAt(page)).toBe(localValue(first));
    const saved = answer(page, 'POST', '/posts');
    await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    const { post } = (await savedResponse.json()) as { post: { group: string; state: string } };
    run.groups.push({ org: DEMO_ORG, group: post.group });
    expect(post.state).toBe('QUEUE');

    // Post two: another minute, in a window, on a weekday.
    await openComposer(page);
    await channelButton(page, /Acme Marketing/).click();
    await writePost(page, `Clips AI slot two ${RUN}`);
    const secondSlot = answer(page, 'GET', '/channels/next-slot');
    await page.getByRole('button', { name: 'Next Available', exact: true }).click();
    const second = new Date(((await (await secondSlot).json()) as { at: string }).at);
    expect(inWindow(second), `second slot ${second.toString()}`).toBe(true);
    expect(second.getTime()).not.toBe(first.getTime());
    expect(localValue(second)).not.toBe(localValue(first));

    // Pick A Random Time: each part of the day fills a time inside it, off the five-minute marks.
    const parts: Array<[string, number, number]> = [
      ['Morning', 6 * 60, 11 * 60 + 59],
      ['Noon', 12 * 60, 13 * 60 + 59],
      ['Afternoon', 14 * 60, 17 * 60 + 59],
      ['Evening', 18 * 60, 21 * 60 + 59],
    ];
    await page.locator('#composer-publish-at').click();
    await page.getByRole('tab', { name: 'Pick A Random Time' }).click();
    for (const [name, from, to] of parts) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByText(/^Your post will be scheduled for .+\.$/)).toBeVisible();
      const minute = minuteOfDay(await publishAt(page));
      expect(minute, name).toBeGreaterThanOrEqual(from);
      expect(minute, name).toBeLessThanOrEqual(to);
      expect(minute % 5, `${name} is off the five-minute marks`).not.toBe(0);
    }
    await page.keyboard.press('Escape');

    // Made With AI: the montage, sent to Instagram, posted now through the stand-in publisher.
    await openClipEditor(page, DEMO_ORG, s.montageId);
    await openEditorTab(page, 'export');
    await page.getByTestId('clip-export-send').click();
    const send = page.getByTestId('clip-send-dialog');
    const outdated = send.getByTestId('clip-send-outdated');
    const shown = send.getByTestId('clip-send-channel').first();
    await expect(outdated.or(shown)).toBeVisible({ timeout: 30_000 });
    if (await outdated.isVisible()) await send.getByTestId('clip-send-old').click();
    const instagram = send
      .locator('[data-testid="clip-send-channel"]:not([data-disabled="true"])')
      .filter({ hasText: 'Acme Studio' });
    await instagram.getByRole('checkbox').click();
    await send.getByTestId('clip-send-caption').fill(`Clips AI made with AI ${RUN}`);
    const sent = answer(page, 'POST', `/clips/${s.montageId}/send`);
    await send.getByTestId('clip-send-open').click();
    const sentResponse = await sent;
    expect(sentResponse.ok(), await sentResponse.text()).toBe(true);
    const { group } = (await sentResponse.json()) as { group: string };
    run.groups.push({ org: DEMO_ORG, group });
    await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/composer\\?group=${group}`), {
      timeout: 30_000,
    });
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });

    const label = composer(page).getByRole('button', { name: 'Made With AI', exact: true });
    await expect(label).toBeVisible({ timeout: 30_000 });
    await label.click();
    await page.getByRole('switch', { name: 'Made With AI' }).click();
    await page.keyboard.press('Escape');
    await expect(
      composer(page).getByRole('button', { name: 'Made With AI: On', exact: true }),
    ).toBeVisible();

    await composer(page).getByRole('button', { name: 'More ways to publish' }).click();
    await page.getByRole('menuitem', { name: 'Post Now' }).click();
    await expect
      .poll(
        async () =>
          (
            await prisma.post.findFirst({
              where: { group, deletedAt: null, releaseURL: { not: null } },
              select: { releaseURL: true },
            })
          )?.releaseURL ?? '',
        { timeout: 90_000 },
      )
      .toMatch(/^https:\/\/simulated\.postgear\.local\/instagram\/.+\?ai=label$/);
    const posted = await prisma.post.findFirst({
      where: { group, deletedAt: null },
      select: { madeWithAi: true },
    });
    expect(posted?.madeWithAi).toBe(true);
  });
});

/* ========================================================================== */
/* Creator tools (16, 17)                                                     */
/* ========================================================================== */

test.describe('Creator tools', () => {
  test.beforeAll(() => started('creator-tools'));
  test.afterAll(() => finished('creator-tools'));

  test('16. Emote Maker from a clip menu: 2.4 s, a crop, Export For Twitch; over 3 s is stopped', async () => {
    const clipTitle = titleOf('Face Camera');
    await page.goto(`/${DEMO_ORG}/clips/video/${s.stream}`);
    await page
      .getByRole('button', { name: `More for ${clipTitle}`, exact: true })
      .first()
      .click();
    await page.getByTestId('clip-make-emote').click();
    await expect(page).toHaveURL(/\/clips\/tools\/emote/, { timeout: 30_000 });
    const maker = page.getByTestId('emote-maker');
    await expect(maker).toBeVisible({ timeout: 30_000 });
    const length = maker.getByTestId('emote-trim-length');
    await expect(length).toHaveText('3.0 s', { timeout: 30_000 });

    // The end grip, dragged left until the stretch is 2.4 seconds.
    const window = maker.getByTestId('emote-trim-window');
    for (let attempt = 0; attempt < 6 && (await length.innerText()) !== '2.4 s'; attempt += 1) {
      const box = await window.boundingBox();
      const strip = await window.locator('..').boundingBox();
      if (!box || !strip) throw new Error('No trim window');
      const shown = Number((await length.innerText()).replace(' s', ''));
      const pxPerSecond = box.width / shown;
      const x = box.x + box.width - 1;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - (shown - 2.4) * pxPerSecond, y, { steps: 6 });
      await page.mouse.up();
    }
    await expect(length).toHaveText('2.4 s');

    // A crop: the box moved with its keys.
    const crop = maker.getByTestId('emote-crop-box');
    const startBox = await crop.boundingBox();
    const movedBy = async () => {
      const now = await crop.boundingBox();
      return (
        Math.abs((now?.x ?? 0) - (startBox?.x ?? 0)) + Math.abs((now?.y ?? 0) - (startBox?.y ?? 0))
      );
    };
    await crop.focus();
    for (const key of ['Shift+ArrowLeft', 'Shift+ArrowUp']) {
      for (let i = 0; i < 3; i += 1) await page.keyboard.press(key);
    }
    if ((await movedBy()) <= 1) {
      // Already in the top left corner: the other way.
      for (const key of ['Shift+ArrowRight', 'Shift+ArrowDown']) {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press(key);
      }
    }
    expect(await movedBy()).toBeGreaterThan(1);

    const exported = answer(page, 'POST', '/clips/emotes/export', 120_000);
    await maker.getByTestId('emote-export-twitch').click();
    const response = await exported;
    expect([200, 202], await response.text()).toContain(response.status());
    const request = response.request().postDataJSON() as Record<string, unknown> & {
      startMs: number;
      endMs: number;
    };
    expect(request.endMs - request.startMs).toBe(2_400);
    const { job } = (await response.json()) as { job: { id: string } };
    await expect(maker.getByTestId('emote-files')).toBeVisible({ timeout: 120_000 });
    const view = await getJson<{
      emote: {
        files: Array<{
          name: string;
          format: string;
          bytes: number;
          frames: number;
          extra: boolean;
          url: string | null;
          size: number;
        }>;
      } | null;
    }>(page.request, `/clips/emotes/${job.id}`);
    const gifs = (view.emote?.files ?? []).filter((file) => file.format === 'gif' && !file.extra);
    expect(gifs).toHaveLength(3);

    let readBack = 'ffprobe';
    for (const file of gifs) {
      expect(file.bytes, file.name).toBeLessThan(512 * 1024);
      expect(file.frames, file.name).toBeLessThanOrEqual(60);
      if (!file.url) throw new Error(`${file.name} has no address`);
      const url = file.url.startsWith('http') ? file.url : `${API_URL}${file.url}`;
      const fetched = await page.request.get(url);
      expect(fetched.status(), file.name).toBe(200);
      const bytes = await fetched.body();
      expect(bytes.length, file.name).toBe(file.bytes);
      const local = test.info().outputPath(file.name);
      writeFileSync(local, bytes);
      const probed = probeGif(local);
      if (!probed) {
        readBack = 'the API (ffprobe did not answer)';
        continue;
      }
      expect(probed.frames, `${file.name} frames read back`).toBeLessThanOrEqual(60);
      expect(probed.frames).toBeGreaterThan(1);
      expect([probed.width, probed.height], file.name).toEqual([file.size, file.size]);
    }
    console.log(
      `[clips-ai] emote GIFs read back with ${readBack}: ${gifs.map((f) => `${f.name} ${f.bytes} B ${f.frames} frames`).join(', ')}`,
    );

    // Over three seconds: the grip stops at 3.0, and the API refuses a longer stretch.
    const box = await window.boundingBox();
    if (!box) throw new Error('No trim window');
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(length).toHaveText('3.0 s');
    const tooLong = await page.request.post(`${API_URL}/clips/emotes/export`, {
      data: { ...request, endMs: request.startMs + 3_500 },
    });
    expect(tooLong.status()).toBe(422);
    expect(((await tooLong.json()) as { error: string }).error).toBe(
      'An emote can be at most 3 seconds long. Pick a shorter stretch.',
    );
  });

  async function openSchedule(shape: 'Portrait' | 'Landscape'): Promise<string> {
    await page.goto(`/${DEMO_ORG}/clips/tools/schedule`);
    const maker = page.getByTestId('schedule-maker');
    await expect(maker).toBeVisible({ timeout: 30_000 });
    await maker.getByLabel('Twitch name').fill('simstreamer');
    await maker.getByRole('button', { name: 'Read Schedule', exact: true }).click();
    await expect(
      maker.getByText(
        "Read SimStreamer's schedule. Change the zone or the clock below and the times follow.",
      ),
    ).toBeVisible({ timeout: 30_000 });
    await maker.getByRole('button', { name: new RegExp(`^${shape}`) }).click();
    await maker
      .getByRole('list', { name: 'Themes' })
      .getByRole('button')
      .filter({ has: page.getByText('Cool', { exact: true }) })
      .click();
    const created = answer(page, 'POST', '/studio/designs');
    await maker.getByRole('button', { name: 'Open In Design Studio', exact: true }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const designId = ((await response.json()) as { design: { id: string } }).design.id;
    ai.designs.push(designId);
    await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/studio/${designId}$`), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('studio-editor')).toBeVisible({ timeout: 30_000 });
    return designId;
  }

  async function exportPng(designId: string): Promise<{ width: number; height: number }> {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export Slides' });
    const png = dialog.getByRole('radio', { name: 'PNG' });
    await png.check();
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Saved 1 image to your media library.' }),
    ).toBeVisible({
      timeout: 120_000,
    });
    const design = await getJson<{ design: { exportedMediaIds: string[] } }>(
      page.request,
      `/studio/designs/${designId}`,
    );
    const mediaId = design.design.exportedMediaIds[0];
    if (!mediaId) throw new Error('The design has no exported image');
    ai.designMedia.push(mediaId);
    const { media } = await getJson<{ media: { url: string; mimeType: string } }>(
      page.request,
      `/media/${mediaId}`,
    );
    expect(media.mimeType).toBe('image/png');
    const url = media.url.startsWith('http') ? media.url : `${API_URL}${media.url}`;
    const file = await page.request.get(url);
    expect(file.status()).toBe(200);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    return pngSize(await file.body());
  }

  test('17. The schedule picture: simstreamer, Cool, Portrait; a hand edit sticks; 1080 by 1350, then Landscape 1920 by 1080', async () => {
    const portrait = await openSchedule('Portrait');
    const opened = await getJson<{ design: { document: unknown } }>(
      page.request,
      `/studio/designs/${portrait}`,
    );
    const text = JSON.stringify(opened.design.document);
    expect(text).toContain('Minecraft Hardcore');

    // A hand edit on the Schedule element sticks.
    const canvas = page.getByRole('region', { name: 'Slide canvas' });
    await canvas
      .getByRole('button', { name: /^Schedule/ })
      .first()
      .click();
    const monday = page.getByRole('textbox', { name: 'Monday stream', exact: true });
    await expect(monday).toBeVisible({ timeout: 30_000 });
    const edit = `Hand Edit ${RUN}`;
    const patched = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/studio/designs/${portrait}`,
      { timeout: 30_000 },
    );
    await monday.fill(edit);
    expect((await patched).ok()).toBe(true);
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (
              await getJson<{ design: { document: unknown } }>(
                page.request,
                `/studio/designs/${portrait}`,
              )
            ).design.document,
          ),
        { timeout: 20_000 },
      )
      .toContain(edit);
    await page.reload();
    await expect(page.getByTestId('studio-editor')).toBeVisible({ timeout: 30_000 });

    expect(await exportPng(portrait)).toEqual({ width: 1080, height: 1350 });

    const landscape = await openSchedule('Landscape');
    expect(await exportPng(landscape)).toEqual({ width: 1920, height: 1080 });
  });
});

/* ========================================================================== */
/* Editor (18)                                                                */
/* ========================================================================== */

test.describe('Editor', () => {
  test.beforeAll(() => started('editor'));
  test.afterAll(() => finished('editor'));

  test('18. An Editor seat: invited, joined, a cut-down rail, drafts only, schedule refused; no second seat', async ({
    browser,
  }) => {
    // The demo plan has one Editor seat and the seeded Editor holds it: the
    // workspace gets exactly one more, so the invite fits and a second does not.
    const editors = await prisma.userOrganization.count({
      where: { organizationId: DEMO_ORG, role: 'EDITOR', disabled: false },
    });
    await putOverride(page.request, DEMO_ORG, SEAT_KEY, editors + 1, REASON);

    const fixture = await createUnonboardedUser('clips-ai-editor');
    editorUser = fixture;
    await prisma.user.update({
      where: { id: fixture.id },
      data: { onboardingCompletedAt: new Date(), onboardingStep: 6 },
    });
    // The invite link read through the API (the Team page's Copy Link), no email sent.
    const invite = await page.request.post(`${API_URL}/orgs/${DEMO_ORG}/invites`, {
      data: { role: 'EDITOR', sendEmail: false, email: fixture.email },
    });
    expect(invite.status(), await invite.text()).toBe(201);
    const invitePath = new URL(((await invite.json()) as { url: string }).url).pathname;

    const editorContext = await browser.newContext({ viewport: VIEWPORT });
    const editor = await editorContext.newPage();
    editor.on('dialog', (dialog) => void dialog.accept());
    try {
      await editor.goto(invitePath);
      await editor.getByRole('link', { name: 'Login to join' }).click();
      await editor.getByLabel('Email').fill(fixture.email);
      await editor.locator('#password').fill(fixture.password);
      await editor.getByRole('button', { name: 'Login', exact: true }).click();
      await expect(editor).toHaveURL(invitePath, { timeout: 30_000 });
      await editor.getByTestId('invite-join').click();
      await expect(editor).not.toHaveURL(invitePath, { timeout: 30_000 });
      const joined = await prisma.userOrganization.findFirst({
        where: { userId: fixture.id, organizationId: DEMO_ORG },
        select: { role: true },
      });
      expect(joined?.role).toBe('EDITOR');
      await switchOrg(editor.request, DEMO_ORG);

      // The rail is cut down to what an Editor may open.
      await editor.goto(`/${DEMO_ORG}/calendar`);
      const rail = editor
        .getByRole('complementary', { name: 'Main' })
        .getByRole('navigation', { name: 'Sections' });
      await expect(rail).toBeVisible({ timeout: 30_000 });
      for (const open of ['calendar', 'clips', 'studio', 'media']) {
        await expect(rail.locator(`a[href="/${DEMO_ORG}/${open}"]`)).toHaveCount(1);
      }
      for (const closed of ['analytics', 'workflows', 'discover', 'seo-analyzer']) {
        await expect(rail.locator(`a[href="/${DEMO_ORG}/${closed}"]`)).toHaveCount(0);
      }
      await editor.goto(`/${DEMO_ORG}/analytics`);
      await expect(editor.getByText('You do not have access to this page.')).toBeVisible({
        timeout: 30_000,
      });

      // A draft saves; scheduling and Post Now are not there.
      await openComposer(editor);
      await channelButton(editor, /Acme Marketing/).click();
      await writePost(editor, `Clips AI editor draft ${RUN}`);
      await expect(composer(editor).getByTestId('composer-editor-hint')).toBeVisible();
      await expect(composer(editor).getByRole('button', { name: 'Next Available' })).toHaveCount(0);
      await expect(
        composer(editor).getByRole('button', { name: 'More ways to publish' }),
      ).toHaveCount(0);
      await expect(
        composer(editor).getByRole('button', { name: 'Add to calendar', exact: true }),
      ).toHaveCount(0);
      await expect(editor.locator('#composer-publish-at')).toHaveCount(0);
      const saved = answer(editor, 'POST', '/posts');
      await composer(editor).getByRole('button', { name: 'Save As Draft', exact: true }).click();
      const savedResponse = await saved;
      expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
      const { post } = (await savedResponse.json()) as { post: { group: string; state: string } };
      run.groups.push({ org: DEMO_ORG, group: post.group });
      expect(post.state).toBe('DRAFT');

      // Asked directly, the API refuses to schedule it or post it now.
      const schedule = await editor.request.put(`${API_URL}/posts/${post.group}/schedule`, {
        data: { publishDate: new Date(Date.now() + 86_400_000).toISOString() },
      });
      expect(schedule.status()).toBe(403);
      expect(((await schedule.json()) as { error: string }).error).toBe(
        'Editors cannot do this. Ask an admin.',
      );
      const now = await editor.request.post(`${API_URL}/posts/${post.group}/publish-now`);
      expect(now.status()).toBe(403);
    } finally {
      await editorContext.close();
    }

    // Every seat is taken now: a second Editor invite is refused.
    const again = await page.request.post(`${API_URL}/orgs/${DEMO_ORG}/invites`, {
      data: { role: 'EDITOR', sendEmail: false, email: `e2e-second-editor-${RUN}@example.com` },
    });
    expect(again.status()).toBe(402);
    expect(((await again.json()) as { error: string }).error).toBe(
      'No editor seats left. Remove an editor or change your plan.',
    );
  });
});

/* ========================================================================== */
/* Cleanup (19)                                                               */
/* ========================================================================== */

test.describe('Cleanup', () => {
  test.beforeAll(() => started('cleanup'));
  test.afterAll(() => finished('cleanup'));

  test('19. Remove a video: its transcript and face file are gone', async () => {
    const kinds = { in: ['TRANSCRIPT', 'FACE_TRACKS'] as Array<'TRANSCRIPT' | 'FACE_TRACKS'> };
    const held = await prisma.clipAsset.findMany({
      where: { videoId: s.stream, kind: kinds },
      select: { kind: true },
    });
    expect(held.some((row) => row.kind === 'TRANSCRIPT')).toBe(true);
    expect(held.some((row) => row.kind === 'FACE_TRACKS')).toBe(true);
    expect(speechAndFaceFiles(DEMO_ORG, s.stream).length).toBeGreaterThan(0);

    await page.goto(`/${DEMO_ORG}/clips?tab=videos`);
    const removed = await page.request.delete(`${API_URL}/clips/videos/${s.stream}`);
    expect(removed.ok(), await removed.text()).toBe(true);

    await expect
      .poll(() => prisma.clipAsset.count({ where: { videoId: s.stream, kind: kinds } }), {
        timeout: 30_000,
      })
      .toBe(0);
    await expect
      .poll(() => speechAndFaceFiles(DEMO_ORG, s.stream), { timeout: 30_000 })
      .toEqual([]);
    const video = await prisma.clipVideo.findUnique({
      where: { id: s.stream },
      select: { deletedAt: true },
    });
    expect(video?.deletedAt).not.toBeNull();
  });
});
