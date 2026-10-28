import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  API_URL,
  cleanUpStudio,
  DEMO_ORG,
  escapeRegExp,
  expectNothingLeft,
  expectSaved,
  exportedSlides,
  getDesign,
  getPost,
  newRunState,
  type StudioDesign,
  savedAfter,
  signIn,
  slideFileNames,
} from './helpers/studio';

/**
 * The Design Studio end to end (Sprint 9): create a carousel through the
 * wizard, edit it on the canvas, add and undo a slide, write the caption in
 * Preview, export the slides into the media library, send them to the
 * composer as a draft, and share a read-only link that dies when revoked.
 * This is the sprint's "an e2e spec covering create, edit, export and send",
 * plus share.
 *
 * One design, worked on in order by every test on one signed-in page: the
 * API may run with the normal login throttle (10 sign-ins a minute per
 * address), so the file signs in once (twice only after a 429). Everything a
 * run makes (the design, its exported images, the draft post, its share
 * links) is removed in `afterAll`, even after a failure, and the API is then
 * asked again to prove none of it is left.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, the API on :3001 and the web app on :3000. Export draws
 * the slides in the API's Playwright Chromium, so that must be installed.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const STAMP = `${Date.now()}`;
/** A name only this run uses: the exported slides are named after it. */
const TITLE = `E2E Studio ${STAMP}`;
/** The template the wizard picks: five slides, made for a square feed. */
const TEMPLATE = '5 Simple Steps';
const HEADLINE = 'Better Mornings In Five Steps';
const MARKER = `Run ${STAMP}`;
const CAPTION = `${MARKER}: five small steps to a better morning.`;
/** The seeded Instagram channel: JPEG only, up to ten images, so the carousel fits. */
const CHANNEL = /Acme Studio/;

const run = newRunState();
/** Any browser prompt (a leave warning) the page raised; none is expected. */
const prompts: string[] = [];

let context: BrowserContext;
let page: Page;
let designId = '';
let slideCount = 0;
let layouts: string[] = [];

test.beforeAll(async ({ browser }) => {
  // Room for a sign-in that has to wait out the throttle's minute.
  test.setTimeout(150_000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('dialog', (dialog) => {
    prompts.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.accept();
  });
  await signIn(page);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (!page) return;

  try {
    const log = await cleanUpStudio(page.request, run);
    const proof = await expectNothingLeft(page.request, run);
    console.log(['Studio cleanup:', ...log, 'Nothing left:', ...proof].join('\n  '));
  } finally {
    await context.close();
  }
});

function canvas() {
  return page.getByRole('region', { name: 'Slide canvas' });
}

function railSlides() {
  return page.getByRole('list', { name: 'Slides' }).getByRole('listitem');
}

/** The cover's headline as the server has it. */
function headlineOf(design: StudioDesign): string | undefined {
  return design.document.slides[0]?.elements.headline?.text;
}

test('creates a carousel from a template through the wizard', async () => {
  await page.goto(`/${DEMO_ORG}/studio`);
  await expect(page.getByRole('heading', { level: 1, name: 'Design Studio' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: 'Create Design', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/studio/new`));

  // Brand is the one step that can be skipped: the template keeps its own colours.
  await expect(page.getByRole('heading', { name: 'Choose A Brand' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Skip For Now' }).click();

  await expect(page.getByRole('heading', { name: 'Choose A Format' })).toBeVisible();
  await page.getByRole('button', { name: /^Square/ }).click();

  await expect(page.getByRole('heading', { name: 'Choose A Template' })).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/studio/designs',
  );
  await page.getByRole('button', { name: `Use ${TEMPLATE}`, exact: true }).click();

  const response = await created;
  expect(response.ok(), `create answered HTTP ${response.status()}`).toBe(true);
  const { design } = (await response.json()) as { design: StudioDesign };
  designId = design.id;
  run.designId = design.id;
  run.title = TITLE;
  run.marker = MARKER;
  slideCount = design.document.slides.length;
  layouts = design.document.slides.map((slide) => slide.layoutId);
  expect(design.title).toBe(TEMPLATE);
  expect(slideCount, 'a template with several slides').toBeGreaterThan(1);

  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/studio/${designId}$`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('studio-editor')).toBeVisible({ timeout: 30_000 });
  await expect(railSlides()).toHaveCount(slideCount);
  await expect(canvas().getByText(`Slide 1 of ${slideCount}`)).toBeVisible();
  await expectSaved(page);

  // Renamed in place (DS-6.4) to this run's own name.
  await savedAfter(page, designId, async () => {
    await page.getByRole('button', { name: `Rename ${TEMPLATE}`, exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Design name' });
    await name.fill(TITLE);
    await name.press('Enter');
  });
  await expect(page.getByRole('button', { name: `Rename ${TITLE}`, exact: true })).toBeVisible();
  expect((await getDesign(page.request, designId)).title).toBe(TITLE);
});

test('edits the cover headline on the canvas, autosaves it and keeps it after a reload', async () => {
  await savedAfter(page, designId, async () => {
    await canvas().getByRole('button', { name: 'Headline', exact: true }).click();
    const typing = canvas().getByRole('textbox', { name: 'Headline' });
    await expect(typing).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(HEADLINE);
    await page.keyboard.press('Escape');
    await expect(typing).toHaveCount(0);
  });

  expect(headlineOf(await getDesign(page.request, designId))).toBe(HEADLINE);

  await page.reload();
  await expect(page.getByTestId('studio-editor')).toBeVisible({ timeout: 30_000 });
  await expectSaved(page);
  await expect(canvas().locator('[data-slot="headline"]')).toHaveText(HEADLINE);
  // Everything was saved, so leaving asked nothing (DS-6.3).
  expect(prompts).toEqual([]);
});

test('adds a slide from the layout picker and the keyboard Undo takes it away', async () => {
  await expect(railSlides()).toHaveCount(slideCount);

  await savedAfter(page, designId, async () => {
    await page.getByRole('button', { name: 'Add Slide', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add A Slide' });
    await expect(picker.getByText('It goes in as slide 2,')).toBeVisible();
    await picker.getByRole('button', { name: 'Plain', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(railSlides()).toHaveCount(slideCount + 1);
  });
  await expect(canvas().getByText(`Slide 2 of ${slideCount + 1}`)).toBeVisible();
  expect((await getDesign(page.request, designId)).document.slides).toHaveLength(slideCount + 1);

  await savedAfter(page, designId, async () => {
    // Focus on a button, outside every text field: the shortcut is the editor's Undo.
    await page.getByRole('button', { name: 'Add Slide', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(railSlides()).toHaveCount(slideCount);
  });

  const design = await getDesign(page.request, designId);
  expect(design.document.slides.map((slide) => slide.layoutId)).toEqual(layouts);
  expect(headlineOf(design)).toBe(HEADLINE);
});

test('writes the caption in Preview and saves it with the design', async () => {
  await savedAfter(page, designId, async () => {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Preview' });
    await expect(preview.getByRole('tablist', { name: 'Platform' })).toBeVisible();
    await expect(preview.getByRole('region', { name: 'Slides' })).toBeVisible();

    await preview.getByRole('textbox', { name: 'Caption' }).fill(CAPTION);
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toBeHidden();
  });

  expect((await getDesign(page.request, designId)).document.caption).toBe(CAPTION);
});

test('exports every slide as a JPEG into the media library, named after the design', async () => {
  expect(await exportedSlides(page.request, TITLE), 'no image of this run before Export').toEqual(
    [],
  );

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export Slides' });
  const jpeg = dialog.getByRole('radio', { name: 'JPEG' });
  await jpeg.check();
  await expect(jpeg).toBeChecked();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect(
    dialog
      .getByRole('status')
      .filter({ hasText: `Saved ${slideCount} images to your media library.` }),
  ).toBeVisible({ timeout: 120_000 });

  const slides = await exportedSlides(page.request, TITLE);
  for (const slide of slides) run.mediaIds.add(slide.id);

  expect(slides.map((slide) => slide.name)).toEqual(slideFileNames(TITLE, slideCount));
  for (const slide of slides) {
    expect(slide.mimeType, slide.name).toBe('image/jpeg');
    expect([slide.width, slide.height], slide.name).toEqual([1080, 1080]);
  }

  const design = await getDesign(page.request, designId);
  expect(design.status).toBe('EXPORTED');
  expect(design.exportedMediaIds).toEqual(slides.map((slide) => slide.id));

  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('sends the slides and the caption to the composer as a draft', async () => {
  await page.getByRole('button', { name: 'Send To Composer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send To Composer' });
  await expect(dialog.getByText(CAPTION)).toBeVisible();

  const channel = dialog
    .getByRole('group', { name: 'Channels' })
    .getByRole('button', { name: CHANNEL });
  await expect(channel).toBeVisible();
  if ((await channel.getAttribute('aria-pressed')) !== 'true') await channel.click();
  await expect(channel).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: 'Send To Composer', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/composer\\?group=`), {
    timeout: 120_000,
  });
  const group = new URL(page.url()).searchParams.get('group') ?? '';
  expect(group).not.toBe('');
  run.groups.add(group);

  const composer = page.getByRole('dialog', { name: /^(Create|Edit) Post$/ });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer.getByRole('textbox', { name: 'Part 1 of the shared post' })).toContainText(
    CAPTION,
    { timeout: 30_000 },
  );

  const names = slideFileNames(TITLE, slideCount);
  const images = composer
    .getByTestId('thread-part')
    .first()
    .getByRole('img', { name: new RegExp(`^${escapeRegExp(TITLE)} \\d{2}\\.jpg$`) });
  await expect(images).toHaveCount(slideCount);
  for (const [index, name] of names.entries()) {
    await expect(images.nth(index)).toHaveAccessibleName(name);
  }

  const design = await getDesign(page.request, designId);
  const post = await getPost(page.request, group);
  expect(post.state).toBe('DRAFT');
  expect(post.shared).toHaveLength(1);
  expect(post.shared[0]?.media.map((item) => item.id)).toEqual(design.exportedMediaIds);
  expect(post.channels.map((entry) => entry.name)).toEqual(['Acme Studio']);
  expect(design.status).toBe('SENT');
});

test('shares a read-only link that answers 404 once revoked', async ({ browser }) => {
  await page.goto(`/${DEMO_ORG}/studio/${designId}`);
  await expect(page.getByTestId('studio-editor')).toBeVisible({ timeout: 30_000 });
  await expectSaved(page);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Share ${TITLE}` });
  await expect(dialog.getByText('No active links.')).toBeVisible();

  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/studio/designs/${designId}/shares`,
  );
  await dialog.getByRole('button', { name: 'Create Link', exact: true }).click();
  const answer = await created;
  expect(answer.ok(), `create link answered HTTP ${answer.status()}`).toBe(true);

  const field = dialog.getByRole('textbox', { name: 'New link' });
  await expect(field).toHaveValue(/\/share\/design\/[A-Za-z0-9_-]+$/);
  const link = await field.inputValue();
  const token = new URL(link).pathname.split('/').pop() ?? '';
  run.shareTokens.add(token);
  await expect(dialog.getByTestId('share-link')).toHaveCount(1);

  // Somebody with the link and no PostGear account.
  const visitor = await browser.newContext();
  try {
    const shared = await visitor.newPage();
    const opened = await shared.goto(link);
    expect(opened?.status(), 'the live link').toBe(200);

    await expect(shared.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({
      timeout: 30_000,
    });
    const slides = shared.getByRole('region', { name: 'Slides' });
    await expect(slides.getByRole('group', { name: `1 of ${slideCount}` })).toContainText(HEADLINE);
    await expect(shared.getByRole('button', { name: /^Go to slide \d+$/ })).toHaveCount(slideCount);
    await expect(shared.locator('meta[name="robots"][content*="noindex"]')).not.toHaveCount(0);

    // Revoked from the dialog it was made in.
    const revoked = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.startsWith(`/studio/designs/${designId}/shares/`),
    );
    await dialog
      .getByTestId('share-link')
      .getByRole('button', { name: /^Revoke/ })
      .click();
    const confirm = page.getByRole('alertdialog', { name: 'Revoke this link?' });
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
    const gone = await revoked;
    expect(gone.ok(), `revoke answered HTTP ${gone.status()}`).toBe(true);
    await expect(confirm).toBeHidden();
    await expect(dialog.getByTestId('share-link')).toHaveCount(0);
    await expect(field).toBeHidden();

    const dead = await shared.goto(link);
    expect(dead?.status(), 'the revoked link').toBe(404);
    await expect(shared.getByText('This link is no longer available.')).toBeVisible();
    await expect(shared.getByRole('heading', { name: TITLE })).toHaveCount(0);

    const api = await visitor.request.get(
      `${API_URL}/public/design-shares/${encodeURIComponent(token)}`,
    );
    expect(api.status(), 'the API behind the revoked link').toBe(404);
  } finally {
    await visitor.close();
  }

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(prompts).toEqual([]);
});
