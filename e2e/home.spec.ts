import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * Home: the greeting, the sections, a template opening the composer with its
 * text, and the weekly goal (admins change it, members only read it).
 *
 * Signs in once per role and reuses the page, since the login throttle is
 * shared with every other spec. Nothing is left changed: the composer is
 * closed without saving, and the goal is put back the way it was found
 * ("Use suggested" when it was the suggestion).
 */

const SEED_PASSWORD = 'DemoPassword123!';
const DEMO_ORG = 'seed-demo-org';
const HOME = `/${DEMO_ORG}/home`;

test.describe.configure({ mode: 'serial' });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 20_000 });
  return page;
}

/** Home, hydrated: the greeting is written by the browser's own clock. */
async function openHome(page: Page) {
  await page.goto(HOME);
  await expect(page.getByTestId('home-greeting')).toHaveText(/^Good (morning|afternoon|evening)/);
}

/** The goal cell once the dashboard has answered. */
async function loadedGoal(page: Page) {
  const goal = page.getByTestId('home-goal');
  await expect(goal).toHaveAttribute('data-target', /\d+/, { timeout: 15_000 });
  return goal;
}

test.describe('home as an admin', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await signedIn(browser, 'demo@postgear.local');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('greets by time of day and shows every section', async () => {
    await openHome(page);

    // The top bar names the page; the greeting stands in for a title.
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByTestId('home-date')).not.toBeEmpty();

    await expect(page.getByTestId('home-stats')).toBeVisible();
    for (const label of ['Week Streak', 'Weekly Goal', 'AI Credits', 'Team']) {
      await expect(page.getByTestId('home-stats')).toContainText(label);
    }
    // An admin invites from the team card.
    await expect(
      page.getByTestId('home-team').getByRole('button', { name: 'Invite members' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(page.getByText('No comments yet.')).toBeVisible();
    await expect(page.getByTestId('home-template')).toHaveCount(4);
    await expect(page.getByTestId('home-article')).toHaveCount(3);
    // Placeholder articles are not links until the blog exists.
    await expect(page.getByTestId('home-blog').getByRole('link')).toHaveCount(0);

    // Reduced motion gets the waving hand's still frame.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);
    await expect
      .poll(() =>
        page
          .getByTestId('home')
          .locator('picture img')
          .evaluate((image: HTMLImageElement) => image.currentSrc),
      )
      .toContain('waving-hand-still.webp');
    await page.emulateMedia({ reducedMotion: null });
  });

  test('a template opens the composer with its text', async () => {
    await openHome(page);

    await page.getByRole('link', { name: /Three Quick Tips/i }).click();

    const composer = page.getByRole('dialog', { name: /^(Create|Edit) Post$/ });
    await expect(composer).toBeVisible();
    await expect(page).toHaveURL(/\/composer\?template=quick-tips/);
    const editor = page.getByRole('textbox', { name: 'Part 1 of the shared post' });
    await expect(editor).toContainText('3 quick tips for [your topic]:');
    await expect(editor).toContainText('1. [First tip]');

    // Untouched starter text is not the writer's own, so closing asks nothing.
    await composer.getByRole('button', { name: 'Close composer' }).first().click();
    await expect(composer).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${HOME}$`));
  });

  test('changes the weekly goal and puts it back', async () => {
    await openHome(page);
    const goal = await loadedGoal(page);
    const original = Number(await goal.getAttribute('data-target'));
    const wasCustom = (await goal.getAttribute('data-custom')) === 'true';
    const next = original >= 100 ? 99 : original + 1;

    // The pencil on the goal card opens the editor.
    const edit = page.getByRole('button', { name: /Change the goal/ });
    await edit.click();
    const field = page.getByLabel('Posts a week');
    await expect(field).toBeFocused();
    await field.fill(String(next));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(goal).toHaveAttribute('data-target', String(next));
    await expect(goal).toHaveAttribute('data-custom', 'true');

    // Saved on the workspace, not just on screen.
    await openHome(page);
    await expect(await loadedGoal(page)).toHaveAttribute('data-target', String(next));

    await edit.click();
    if (wasCustom) {
      await page.getByLabel('Posts a week').fill(String(original));
      await page.getByRole('button', { name: 'Save' }).click();
    } else {
      await page.getByRole('button', { name: 'Use suggested' }).click();
    }
    await expect(page.getByTestId('home-goal')).toHaveAttribute('data-target', String(original));
    await expect(page.getByTestId('home-goal')).toHaveAttribute('data-custom', String(wasCustom));
  });

  test('card names are set like the section headings', async () => {
    await openHome(page);
    await loadedGoal(page);

    const style = (locator: ReturnType<Page['locator']>) =>
      locator.evaluate((element) => {
        const { fontFamily, fontSize, fontWeight, letterSpacing } = getComputedStyle(element);
        return { fontFamily, fontSize, fontWeight, letterSpacing };
      });
    const heading = await style(page.getByRole('heading', { name: 'Up next' }));

    const labels = page.getByTestId('home-tile-label');
    await expect(labels).toHaveCount(4);
    for (const label of await labels.all()) {
      expect(await style(label)).toEqual(heading);
    }
  });

  test('the gapped bars run their stripes through the gaps as one pattern', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openHome(page);
    await loadedGoal(page);

    // Each cell shows its own slice of one stripe pattern: a cell's offset
    // plus where it sits in the row is the same for every cell (mod the band
    // period, 16 * sqrt(2) px). Cells that each restarted the pattern would
    // differ by their distance apart, and the bands would jump at every gap.
    const PERIOD = 22.63;
    for (const testId of ['home-streak', 'home-goal']) {
      const phases = await page.getByTestId(testId).evaluate((tile, period) => {
        const row = tile.querySelector('[role="img"]');
        if (!row) return [];
        const rowLeft = row.getBoundingClientRect().left;
        return [...row.querySelectorAll('[data-segment="full"] > span')].map((fill) => {
          const left = fill.getBoundingClientRect().left - rowLeft;
          const offset = Number.parseFloat(getComputedStyle(fill).backgroundPositionX);
          return (((left + offset) % period) + period) % period;
        });
      }, PERIOD);

      expect(phases.length, `${testId} has lit cells`).toBeGreaterThan(1);
      expect(Math.max(...phases) - Math.min(...phases), `${testId} stripes line up`).toBeLessThan(
        0.2,
      );
    }
  });

  test('secondary buttons run the hover fill, as everywhere else', async () => {
    await openHome(page);
    await loadedGoal(page);

    // A real `Button`: the goal editor's stepper. The hook marks a control
    // `data-fill-hover` when it is live, `data-filled` while the circle is out.
    await page.getByRole('button', { name: /Change the goal/ }).click();
    const more = page.getByRole('button', { name: 'One more' });
    await expect(more).toHaveAttribute('data-fill-hover', '');
    await more.hover();
    await expect(more).toHaveAttribute('data-filled', '');
    await page.mouse.move(0, 0);
    await expect(more).not.toHaveAttribute('data-filled', '', { timeout: 3_000 });
    await page.keyboard.press('Escape');

    // Every action in a banner too: a button (Reconnect) or a link (View failed
    // posts). Banners only show when something is true, so there may be none.
    const actions = await page.getByTestId('home-banner').locator('a, button').all();
    for (const action of actions) {
      await expect(action).toHaveAttribute('data-fill-hover', '');
    }
    if (actions[0]) {
      await actions[0].hover();
      await expect(actions[0]).toHaveAttribute('data-filled', '');
    }
  });
});

test.describe('home as a member', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await signedIn(browser, 'member@postgear.local');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('reads the weekly goal but cannot change it', async () => {
    await openHome(page);
    const goal = await loadedGoal(page);

    // A plain cell, not the admin's button, and no editor to open.
    await expect(goal).not.toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.getByRole('button', { name: /Change the goal/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'About weekly goal' })).toBeVisible();
    // Members read the team; inviting is an admin's job.
    await expect(
      page.getByTestId('home-team').getByRole('link', { name: 'View team' }),
    ).toBeVisible();
  });
});
