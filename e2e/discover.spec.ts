import { expect, type Page, test } from '@playwright/test';
import {
  ANSWER_TIMEOUT,
  API_URL,
  creditsUsed,
  DEMO_ORG,
  deleteDraft,
  group,
  languageChip,
  openDiscover,
  PAGE_TIMEOUT,
  placeChip,
  recordRequests,
  removeCompetitorsNamed,
  SECOND_ORG,
  STUB_POST_TEXT,
  signIn,
  stubGenerate,
} from './helpers/discover';

/**
 * Discover (Sprint 11), end to end under simulation: the place (the
 * workspace's, the time zone guess, the browser's position, a search), the
 * language, the five tabs, Create Post into the composer, a festival planned
 * as a dated draft, a competitor added and removed, and the reader.
 *
 * Runs against `DISCOVER_SIMULATION=true` and `AI_SIMULATION=true`: the feeds
 * are the recorded files, the place finder is a stand-in that knows Chennai,
 * San Francisco and Paris, the competitor is the sample at `acme.example`,
 * and the reader answers sample articles. Nothing leaves the machine.
 *
 * ## What keeps the tests independent
 *
 * - A chosen place lives in the browser (`localStorage`), and every test gets
 *   a fresh context, so no test sees another's place.
 * - The tests that choose a place use the second seeded workspace, which has
 *   no saved place; the demo workspace's saved one (Chennai, Tamil first) is
 *   read and never written.
 * - `POST /ai/generate` is answered in the browser (see `helpers/discover`),
 *   so no test spends the workspace's credits.
 * - The one competitor and the two drafts are removed by the test that made
 *   them, pass or fail.
 * - The reader is asked for four pages in the whole file, under the limit of
 *   ten a minute per workspace.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`, a
 * seeded database, and `npm run dev:api:e2e` in its own terminal.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB' });

test.beforeEach(() => {
  // The first test to reach a route pays for its compile in dev.
  test.setTimeout(240_000);
});

/** What the sign-in page's own position would be: the middle of Chennai. */
const CHENNAI_POSITION = { latitude: 13.0827, longitude: 80.2707 };

const TAMIL_SCRIPT = /[஀-௿]/;

function firstStory(page: Page) {
  return page.getByRole('tabpanel', { name: 'News' }).getByRole('article').first();
}

async function openPlacePopover(page: Page) {
  await placeChip(page).click();
  await expect(page.getByRole('button', { name: 'Use My Location' })).toBeVisible();
}

/** Picks a channel and drafts with the stand-in; resolves once the result is on screen. */
async function draftInSheet(page: Page) {
  const sheet = page.getByTestId('create-post-sheet');
  await sheet
    .getByRole('group', { name: 'Channels' })
    .getByRole('button', { name: /Acme Marketing/ })
    .click();
  await sheet.getByRole('button', { name: /^Draft With AI/ }).click();
  await expect(sheet.getByTestId('ai-result-part').first()).toContainText(STUB_POST_TEXT, {
    timeout: ANSWER_TIMEOUT,
  });
  return sheet;
}

/** Presses Open In Composer and returns what was saved and the draft's group. */
async function openInComposer(page: Page) {
  const saved = page.waitForRequest(
    (request) => request.url() === `${API_URL}/posts` && request.method() === 'POST',
  );
  await page
    .getByTestId('create-post-sheet')
    .getByRole('button', { name: 'Open In Composer' })
    .click();
  const payload = (await saved).postDataJSON() as { state: string; publishDate: string };

  await expect(page).toHaveURL(/\/composer\?group=/, { timeout: PAGE_TIMEOUT });
  const groupId = new URL(page.url()).searchParams.get('group') ?? '';
  expect(groupId).not.toBe('');
  return { payload, groupId };
}

test.describe('discover', () => {
  test('opens on the workspace place, in its first language, wearing the Simulated sticker', async ({
    page,
  }) => {
    const localities = recordRequests(page, '/discover/locality');
    await signIn(page);
    await openDiscover(page);

    await expect(placeChip(page)).toContainText('Chennai, Tamil Nadu', { timeout: PAGE_TIMEOUT });
    await expect(placeChip(page)).toContainText('Workspace');
    await expect(languageChip(page)).toContainText('Tamil');
    await expect(page.getByRole('main').getByText('Simulated', { exact: true })).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Discover tabs' });
    for (const name of ['Trending', 'News', 'Videos', 'Festivals', 'Competitors']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
    await expect(tabs.getByRole('tab', { name: 'Trending' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await expect(
      page.getByRole('heading', { level: 2, name: 'Rising Searches In Tamil Nadu' }),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT });
    await expect(
      page.getByRole('heading', { level: 2, name: 'What People Are Reading On Tamil Wikipedia' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Worldwide On Bluesky And Mastodon' }),
    ).toBeVisible();
    await expect(group(page, 'trends').getByTestId('discover-card').first()).toBeVisible();
    await expect(group(page, 'wikipedia').getByTestId('discover-wiki-row').first()).toBeVisible();
    await expect(group(page, 'social').getByTestId('discover-social-chip').first()).toBeVisible();

    // Opening the page never asks the browser where it is.
    expect(localities.filter((url) => url.searchParams.has('lat'))).toHaveLength(0);
  });

  test('a workspace with no saved place starts on the time zone guess', async ({ page }) => {
    const localities = recordRequests(page, '/discover/locality');
    await signIn(page);
    await openDiscover(page, SECOND_ORG);

    await expect(placeChip(page)).toContainText('India, from your time zone', {
      timeout: PAGE_TIMEOUT,
    });
    await expect(placeChip(page)).toContainText('Guess');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Rising Searches In India' }),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT });

    // The guess is made from the time zone alone: no position, no permission.
    expect(localities.length).toBeGreaterThan(0);
    for (const url of localities) {
      expect(url.searchParams.get('tz')).toMatch(/^Asia\/(Kolkata|Calcutta)$/);
      expect(url.searchParams.has('lat')).toBe(false);
      expect(url.searchParams.has('lng')).toBe(false);
    }

    // A guess is nobody's choice, so nothing is remembered for it.
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), `pg:discover:${SECOND_ORG}`),
    ).toBeNull();

    await openPlacePopover(page);
    // The workspace's own settings arrive once the page has switched to it.
    await expect(page.getByTestId('discover-workspace-default')).toHaveText(
      'No workspace default yet.',
      { timeout: ANSWER_TIMEOUT },
    );
  });

  test.describe('with location allowed', () => {
    test.use({ geolocation: CHENNAI_POSITION, permissions: ['geolocation'] });

    test('Use My Location finds Chennai from a rounded position and shows Tamil content', async ({
      page,
    }) => {
      const localities = recordRequests(page, '/discover/locality');
      await signIn(page);
      await openDiscover(page, SECOND_ORG);
      await expect(placeChip(page)).toContainText('Guess', { timeout: PAGE_TIMEOUT });

      await openPlacePopover(page);
      await expect(
        page.getByText(
          'We use your location once to find your city. We keep the city, not your position.',
        ),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Use My Location' }).click();

      await expect(placeChip(page)).toContainText('Chennai, Tamil Nadu', {
        timeout: ANSWER_TIMEOUT,
      });
      await expect(placeChip(page)).not.toContainText('Guess');
      await expect(languageChip(page)).toContainText('Tamil');
      await expect(
        page.getByRole('heading', { level: 2, name: 'Rising Searches In Tamil Nadu' }),
      ).toBeVisible({ timeout: ANSWER_TIMEOUT });
      await expect(
        page.getByRole('heading', { level: 2, name: 'What People Are Reading On Tamil Wikipedia' }),
      ).toBeVisible();

      // The position left the browser once, rounded to two decimals (about a kilometre).
      const located = localities.filter((url) => url.searchParams.has('lat'));
      expect(located).toHaveLength(1);
      expect(located[0].searchParams.get('lat')).toBe('13.08');
      expect(located[0].searchParams.get('lng')).toBe('80.27');

      // What is remembered is the city, never the position.
      const remembered = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        `pg:discover:${SECOND_ORG}`,
      );
      expect(remembered).toContain('Chennai');
      expect(remembered).not.toMatch(/13\.08|80\.27|latitude|longitude|"lat"|"lng"/);

      // Tamil news follows the place.
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'News' }).click();
      await expect(firstStory(page).getByRole('heading', { level: 3 })).toHaveText(TAMIL_SCRIPT, {
        timeout: ANSWER_TIMEOUT,
      });

      // A reload keeps the place without asking again.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(placeChip(page)).toContainText('Chennai, Tamil Nadu', { timeout: PAGE_TIMEOUT });
      expect(localities.filter((url) => url.searchParams.has('lat'))).toHaveLength(1);
    });
  });

  test('switching the language chip moves News from Tamil to English and back', async ({
    page,
  }) => {
    const feeds = recordRequests(page, '/discover/feed');
    await signIn(page);
    await openDiscover(page, DEMO_ORG, '?tab=news');

    const heading = firstStory(page).getByRole('heading', { level: 3 });
    await expect(heading).toHaveText(TAMIL_SCRIPT, { timeout: PAGE_TIMEOUT });
    await expect(languageChip(page)).toContainText('Tamil');

    await languageChip(page).click();
    await page.getByRole('option', { name: 'English' }).click();

    await expect(languageChip(page)).toHaveAccessibleName('Language: English');
    await expect(heading).not.toHaveText(TAMIL_SCRIPT, { timeout: ANSWER_TIMEOUT });
    expect(
      feeds.some(
        (url) => url.searchParams.get('kind') === 'news' && url.searchParams.get('lang') === 'en',
      ),
    ).toBe(true);

    // The choice is the person's from here on, and a reload keeps it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(languageChip(page)).toHaveAccessibleName('Language: English', {
      timeout: PAGE_TIMEOUT,
    });
    await expect(page.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');

    await languageChip(page).click();
    await page.getByRole('option', { name: /Tamil/ }).click();
    await expect(heading).toHaveText(TAMIL_SCRIPT, { timeout: ANSWER_TIMEOUT });
  });

  test('Create Post drafts from a trend in the chip language and opens it in the composer', async ({
    page,
  }) => {
    await signIn(page);
    await openDiscover(page);
    const card = group(page, 'trends').getByTestId('discover-card').first();
    await expect(card).toBeVisible({ timeout: PAGE_TIMEOUT });
    const title = (await card.getByRole('heading', { level: 3 }).innerText()).trim();

    const usedBefore = await creditsUsed(page);
    const calls = await stubGenerate(page);
    let draft = '';

    try {
      await card.getByRole('button', { name: `Create Post for ${title}` }).click();
      const sheet = page.getByTestId('create-post-sheet');
      await expect(sheet.getByRole('heading', { name: 'Create Post' })).toBeVisible();
      await expect(sheet.getByTestId('create-post-brief')).toContainText(
        `Rising search in Chennai, Tamil Nadu: "${title}"`,
      );
      await expect(sheet.getByTestId('create-post-language')).toContainText('Tamil');

      // No channel yet: the sheet says so and sends nothing.
      await sheet.getByRole('button', { name: /^Draft With AI/ }).click();
      await expect(sheet.getByText('Choose at least one channel to write for.')).toBeVisible();
      expect(calls).toHaveLength(0);

      await draftInSheet(page);
      expect(calls).toHaveLength(1);
      expect(calls[0].topic).toContain(title);
      expect(calls[0].language).toBe('ta');
      expect(calls[0].channelIds).toHaveLength(1);
      expect(calls[0].withImage).toBe(false);
      expect(calls[0].publishAt).toBeUndefined();
      // The card's own headlines are the research: at most six, each with an address.
      expect(calls[0].sources?.length).toBeGreaterThan(0);
      expect(calls[0].sources?.length).toBeLessThanOrEqual(6);
      for (const source of calls[0].sources ?? []) {
        expect(source.url).toMatch(/^https:\/\//);
      }

      const { payload, groupId } = await openInComposer(page);
      draft = groupId;
      expect(payload.state).toBe('DRAFT');

      const composer = page.getByRole('dialog', { name: 'Edit Post' });
      await expect(
        composer.getByRole('textbox', { name: 'Part 1 of the shared post' }),
      ).toContainText(STUB_POST_TEXT, { timeout: PAGE_TIMEOUT });
      await expect(
        composer.getByRole('group', { name: 'Channels' }).getByRole('button', {
          name: /Acme Marketing/,
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      // The sheet closed as the composer opened, so nothing spent waits under it.
      await expect(page.getByTestId('create-post-sheet')).toHaveCount(0);

      // Nothing was charged: the generation never reached the API.
      expect(await creditsUsed(page)).toBe(usedBefore);
    } finally {
      if (draft) await deleteDraft(page, draft);
    }
  });

  test('Festivals lists the coming weeks and Plan A Post dates the draft', async ({ page }) => {
    await signIn(page);
    await openDiscover(page, DEMO_ORG, '?tab=festivals');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Festivals And Holidays In India' }),
    ).toBeVisible({ timeout: PAGE_TIMEOUT });
    const rows = page.getByTestId('discover-festival-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('discover-festival-section').first()).toBeVisible();
    await expect(rows.first().getByTestId('festival-when')).not.toBeEmpty();

    // A day that has not happened yet: its draft is dated ahead of it. Which
    // day that is depends on today (the list is the next 30 days from the
    // server's clock), so the test takes the first one, whatever its badge.
    const holiday = page
      .getByTestId('discover-festival-row')
      .filter({
        has: page.getByTestId('festival-when').filter({ hasText: /^(in \d+ days?|tomorrow)$/i }),
      })
      .first();
    await expect(holiday).toBeVisible();
    const isPublicHoliday = (await holiday.getByText('Public Holiday').count()) > 0;

    const calls = await stubGenerate(page);
    let draft = '';

    try {
      await holiday.getByRole('button', { name: /^Plan A Post for / }).click();
      const sheet = page.getByTestId('create-post-sheet');
      await expect(sheet.getByTestId('create-post-brief')).toContainText(
        'Festival in Chennai, Tamil Nadu:',
      );
      if (isPublicHoliday) {
        await expect(sheet.getByTestId('create-post-brief')).toContainText('(public holiday)');
      }

      await draftInSheet(page);
      expect(calls).toHaveLength(1);
      const publishAt = calls[0].publishAt ?? '';
      expect(Number.isNaN(Date.parse(publishAt))).toBe(false);
      expect(Date.parse(publishAt)).toBeGreaterThan(Date.now());

      const { payload, groupId } = await openInComposer(page);
      draft = groupId;
      expect(payload.state).toBe('DRAFT');
      // The draft carries the festival's date, not the next full hour.
      expect(Date.parse(payload.publishDate)).toBe(Date.parse(publishAt));
    } finally {
      if (draft) await deleteDraft(page, draft);
    }
  });

  test('a competitor is added by website, shows what it published, and is removed', async ({
    page,
  }) => {
    const name = `Acme E2E ${Date.now()}`;
    await signIn(page);
    await openDiscover(page, DEMO_ORG, '?tab=competitors');
    await expect(page.getByRole('button', { name: 'Add Competitor' }).first()).toBeVisible({
      timeout: PAGE_TIMEOUT,
    });

    try {
      await page.getByRole('button', { name: 'Add Competitor' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add Competitor' });
      await dialog.getByPlaceholder("Enter your competitor's name").fill(name);

      // An address on the person's own network is refused in words, and nothing is fetched.
      const website = dialog.getByPlaceholder("Enter your competitor's website");
      await website.fill('http://127.0.0.1:3000');
      await dialog.getByRole('button', { name: 'Find Feeds' }).click();
      await expect(dialog.getByTestId('competitor-find-error')).toContainText(
        'This address is private or on your own network.',
        { timeout: ANSWER_TIMEOUT },
      );

      await website.fill('acme.example');
      await dialog.getByRole('button', { name: 'Find Feeds' }).click();
      const feeds = dialog.getByTestId('competitor-feed-list');
      await expect(feeds).toContainText('Blog', { timeout: ANSWER_TIMEOUT });
      await expect(feeds).toContainText('Changelog');
      await expect(feeds.getByRole('checkbox', { checked: true })).toHaveCount(2);

      await dialog
        .getByPlaceholder("Enter your competitor's YouTube channel id")
        .fill('UCacmeSampleChannel00000');
      await dialog.getByPlaceholder("Enter your competitor's Bluesky handle").fill('acme.example');
      await dialog
        .getByPlaceholder("Enter your competitor's Mastodon account")
        .fill('acme@mastodon.example');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden({ timeout: ANSWER_TIMEOUT });

      const competitor = page
        .getByTestId('discover-competitor-group')
        .filter({ has: page.getByRole('heading', { name: `Latest From ${name}` }) });
      await expect(competitor).toBeVisible({ timeout: ANSWER_TIMEOUT });
      const items = competitor.getByTestId('discover-competitor-row');
      await expect(items.first()).toBeVisible({ timeout: ANSWER_TIMEOUT });
      for (const badge of ['Blog', 'YouTube', 'Bluesky', 'Mastodon']) {
        await expect(competitor.getByText(badge, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByTestId('competitor-count')).toContainText('of 20');
      await expect(items.first().getByRole('button', { name: /^Create Post for / })).toBeVisible();

      // Remove is asked first, then the group is gone.
      await page.getByRole('button', { name: `More actions for ${name}` }).click();
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Remove Competitor' });
      await expect(confirm).toContainText(`Remove ${name}? Their items disappear from Discover.`);
      await confirm.getByRole('button', { name: 'Remove' }).click();
      await expect(competitor).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
      await expect(page.getByText('Removed', { exact: true }).first()).toBeVisible();
    } finally {
      await removeCompetitorsNamed(page, name);
    }
  });

  test('Read opens a story in the reader, and Create Post From This carries it into the sheet', async ({
    page,
  }) => {
    await signIn(page);
    await openDiscover(page);
    const card = group(page, 'trends').getByTestId('discover-card').first();
    await expect(card).toBeVisible({ timeout: PAGE_TIMEOUT });

    await card.getByRole('button', { name: /^Read / }).click();
    const reader = page.getByTestId('reader-sheet');
    await expect(
      reader.getByRole('heading', { name: 'Harbour market reopens after two years of repairs' }),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT });
    await expect(reader.getByTestId('reader-meta')).toHaveText(
      'The Sample Courier, by A. Reporter, 4 Nov 2026, 2 min read',
    );
    await expect(reader.getByRole('region', { name: 'Article' })).toContainText(
      'The old harbour market opened its gates again on Wednesday morning',
    );
    // Open still goes to the publisher's own page.
    await expect(reader.getByRole('link', { name: /^Open / })).toHaveAttribute(
      'href',
      /^https:\/\//,
    );

    await reader.getByRole('button', { name: 'Create Post From This' }).click();
    const sheet = page.getByTestId('create-post-sheet');
    await expect(sheet.getByRole('heading', { name: 'Create Post' })).toBeVisible();
    await expect(sheet.getByTestId('create-post-brief')).toContainText('Harbour market reopens');
  });

  test('a News story is opened through the link resolver, and a private or non-article page is refused', async ({
    page,
  }) => {
    await signIn(page);
    await openDiscover(page, DEMO_ORG, '?tab=news');
    const story = firstStory(page);
    await expect(story).toBeVisible({ timeout: PAGE_TIMEOUT });

    // The story's address is Google's opaque one; the API finds the publisher's
    // page behind it (here, through the sample pages) and reads that.
    const asked = page.waitForRequest(
      (request) => request.url() === `${API_URL}/discover/read` && request.method() === 'POST',
    );
    await story.getByRole('button', { name: /^Read / }).click();
    const reader = page.getByTestId('reader-sheet');
    expect(((await asked).postDataJSON() as { url: string }).url).toMatch(
      /^https:\/\/news\.google\.com\/rss\/articles\//,
    );
    await expect(reader.getByRole('link', { name: /^Open / })).toHaveAttribute(
      'href',
      'https://reader.example/articles/coimbatore-rain',
      { timeout: ANSWER_TIMEOUT },
    );
    await expect(
      reader.getByRole('heading', { name: 'கோயம்புத்தூரில் கனமழை: பள்ளிகளுக்கு விடுமுறை' }),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT });
    await expect(reader.getByTestId('reader-text')).toHaveText(TAMIL_SCRIPT);
    await page.keyboard.press('Escape');
    await expect(reader).toHaveCount(0);

    // Read A Page: any address the person pastes, checked before it is fetched.
    await page.getByRole('button', { name: 'Read A Page' }).click();
    const address = reader.getByPlaceholder('Enter your page address');
    await address.fill('http://10.0.0.1/');
    await reader.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(reader.getByTestId('reader-error')).toContainText(
      'This page is private or on your own network.',
      { timeout: ANSWER_TIMEOUT },
    );

    await address.fill('https://reader.example/');
    await reader.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(reader.getByTestId('reader-error')).toContainText('This page is not an article.', {
      timeout: ANSWER_TIMEOUT,
    });
    // Nothing to post from a page that could not be read.
    await expect(reader.getByRole('button', { name: 'Create Post From This' })).toBeDisabled();
  });

  test('with location blocked, a search for Paris sets the place and a reload keeps it', async ({
    page,
  }) => {
    const localities = recordRequests(page, '/discover/locality');
    const searches = recordRequests(page, '/discover/locality/search');
    await signIn(page);
    await openDiscover(page, SECOND_ORG);
    await expect(placeChip(page)).toContainText('Guess', { timeout: PAGE_TIMEOUT });

    await openPlacePopover(page);
    await page.getByRole('button', { name: 'Use My Location' }).click();
    await expect(
      page.getByText('Location is blocked in your browser. Search for your city instead.'),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT });
    // No position was ever sent.
    expect(localities.filter((url) => url.searchParams.has('lat'))).toHaveLength(0);

    const search = page.getByRole('textbox', { name: 'Search for a city' });
    await expect(search).toBeFocused();
    await search.fill('paris');
    // Typing alone asks nothing: the search runs on Enter.
    expect(searches).toHaveLength(0);
    await search.press('Enter');
    await page
      .getByRole('list', { name: 'Places found' })
      .getByRole('button', { name: 'Paris, Ile-de-France, France' })
      .click({ timeout: ANSWER_TIMEOUT });
    expect(searches).toHaveLength(1);
    expect(searches[0].searchParams.get('q')).toBe('paris');

    await expect(placeChip(page)).toContainText('Paris', { timeout: ANSWER_TIMEOUT });
    await expect(placeChip(page)).not.toContainText('Guess');
    await expect(languageChip(page)).toContainText('Français');
    await expect(group(page, 'trends').getByRole('heading', { level: 2 })).toContainText(
      /Rising Searches In/,
      { timeout: ANSWER_TIMEOUT },
    );
    await expect(group(page, 'trends').getByTestId('discover-card').first()).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(placeChip(page)).toContainText('Paris', { timeout: PAGE_TIMEOUT });
    await expect(languageChip(page)).toContainText('Français');
    // Remembered in this browser: no second search, and still no position.
    expect(searches).toHaveLength(1);
    expect(localities.filter((url) => url.searchParams.has('lat'))).toHaveLength(0);
  });
});
