import { expect, type Page, test } from '@playwright/test';
import { prisma } from '@postgear/db';

/**
 * The composer's second round (2026-10-19, after Postiz's composer and
 * Buffer's header): tags, repeat, per-platform settings, Post now, the
 * header's Templates, the toolbar's signature, underline and emoji, and the
 * `?duplicate=` and `?channel=` links.
 *
 * Runs against the seeded demo workspace: Acme Marketing (LinkedIn, healthy,
 * no platform settings), Acme on X (who can reply) and Acme Studio
 * (Instagram). Publishing is simulated locally (`PUBLISH_SIMULATION=true`),
 * so Post now reaches no real platform.
 *
 * One sign-in for the whole file, shared by every test in order: the login
 * throttle is per address and the rest of the suite signs in too. Everything
 * created here (posts, tags, signatures) is removed afterwards.
 */

const DEMO_ORG = 'seed-demo-org';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe.configure({ mode: 'serial' });

let page: Page;
const created = { groups: [] as string[], tags: [] as string[], signatures: [] as string[] };

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // A test may end with unsaved writing; the composer's "leave this page?"
  // must let the next test's navigation through.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@postgear.local');
  await page.locator('#password').fill('DemoPassword123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 30_000 });
});

test.afterAll(async () => {
  for (const group of created.groups) {
    const response = await page.request.delete(`${API_URL}/posts/${group}`);
    // A post that Post now published is locked against deletion through the
    // API, as any published post is; the test's own copy goes directly.
    if (!response.ok() && response.status() !== 404) {
      await prisma.post.updateMany({
        where: { group, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
  }
  for (const id of created.tags) {
    await page.request.delete(`${API_URL}/tags/${id}`).catch(() => undefined);
  }
  for (const id of created.signatures) {
    await page.request.delete(`${API_URL}/signatures/${id}`).catch(() => undefined);
  }
  await prisma.$disconnect();
  await page.close();
});

function composer() {
  return page.getByRole('dialog', { name: /^(Create|Edit) Post$/ });
}

async function openComposer(query = '') {
  await page.goto(`/${DEMO_ORG}/composer${query}`);
  await expect(composer()).toBeVisible();
  await expect(part(1)).toBeVisible();
}

function channel(name: RegExp) {
  return page.getByRole('group', { name: 'Channels' }).getByRole('button', { name });
}

function part(index: number, scope = 'the shared post') {
  return page.getByRole('textbox', { name: `Part ${index} of ${scope}` });
}

/** Types at the end of an editor. TipTap needs real key events, not `fill`. */
async function write(text: string, index = 1) {
  await part(index).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

async function saveDraft() {
  await composer().getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByText('Draft saved', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\?group=/);
  const group = new URL(page.url()).searchParams.get('group') ?? '';
  if (!created.groups.includes(group)) {
    created.groups.push(group);
  }
  return group;
}

async function reloadComposer() {
  await page.reload();
  await expect(composer()).toBeVisible();
  await expect(part(1)).toBeVisible();
}

test('creates, picks, saves, renames and deletes a tag from the footer', async () => {
  const name = `Launch ${Date.now() % 100000}`;
  const renamed = `${name} day`;

  await openComposer();
  await channel(/Acme Marketing/).click();
  await write('A post with a tag');

  await composer().getByRole('button', { name: 'Add tag' }).click();
  const panel = page.getByRole('dialog', { name: 'Tags' });
  await panel.getByRole('button', { name: 'New tag' }).click();
  await panel.getByLabel('Name').fill(name);
  await panel.getByRole('radio', { name: 'Rose' }).check({ force: true });
  const createdTag = page.waitForResponse(
    (response) => response.url().endsWith('/tags') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Create tag' }).click();
  const { tag } = (await (await createdTag).json()) as { tag: { id: string; color: string } };
  created.tags.push(tag.id);
  expect(tag.color).toBe('rose');

  // A tag made from a post is put on it.
  await expect(panel.getByRole('checkbox', { name })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(composer().getByRole('button', { name: `Tags: ${name}` })).toBeVisible();

  await saveDraft();
  await reloadComposer();
  await expect(composer().getByRole('button', { name: `Tags: ${name}` })).toBeVisible();

  // Rename it: the post's chip follows.
  await composer()
    .getByRole('button', { name: `Tags: ${name}` })
    .click();
  await panel.getByRole('button', { name: `Edit ${name}` }).click();
  await panel.getByLabel('Name').fill(renamed);
  await panel.getByRole('button', { name: 'Save tag' }).click();
  await expect(panel.getByRole('checkbox', { name: renamed })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(composer().getByRole('button', { name: `Tags: ${renamed}` })).toBeVisible();

  // Untick and tick again, then delete it from the workspace, after a yes.
  await composer()
    .getByRole('button', { name: `Tags: ${renamed}` })
    .click();
  await panel.getByRole('checkbox', { name: renamed }).click();
  await expect(panel.getByRole('checkbox', { name: renamed })).not.toBeChecked();
  await panel.getByRole('checkbox', { name: renamed }).click();
  await panel.getByRole('button', { name: `Delete ${renamed}` }).click();
  await expect(panel.getByText(`Delete “${renamed}”?`)).toBeVisible();
  await panel.getByRole('button', { name: 'Delete tag' }).click();
  await expect(panel.getByRole('checkbox', { name: renamed })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(composer().getByRole('button', { name: 'Add tag' })).toBeVisible();

  // The saved post lost it too.
  await reloadComposer();
  await expect(composer().getByRole('button', { name: 'Add tag' })).toBeVisible();
});

test('saves how often a post repeats and reloads it', async () => {
  await openComposer();
  await channel(/Acme Marketing/).click();
  await write('A weekly post');

  await composer().getByRole('button', { name: 'Repeat post' }).click();
  await page.getByRole('menuitemradio', { name: 'Every week' }).click();
  await expect(composer().getByRole('button', { name: 'Repeat: Every week' })).toBeVisible();

  const saved = page.waitForRequest(
    (request) => request.url().endsWith('/posts') && request.method() === 'POST',
  );
  await saveDraft();
  expect((await saved).postDataJSON()).toMatchObject({ intervalInDays: 7, tags: [] });

  await reloadComposer();
  await expect(composer().getByRole('button', { name: 'Repeat: Every week' })).toBeVisible();

  await composer().getByRole('button', { name: 'Repeat: Every week' }).click();
  await page.getByRole('menuitemradio', { name: /Don.t repeat/ }).click();
  await expect(composer().getByRole('button', { name: 'Repeat post' })).toBeVisible();
});

test('saves X’s “who can reply” from the Settings bar and reloads it', async () => {
  await openComposer();
  await channel(/Acme on X/).click();
  await write('Replies from people I follow');

  const bar = composer().getByRole('button', { name: 'Settings', exact: true });
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await bar.click();
  await composer().getByRole('combobox', { name: 'Who can reply' }).click();
  await page.getByRole('option', { name: 'Accounts you follow' }).click();

  const saved = page.waitForRequest(
    (request) => request.url().endsWith('/posts') && request.method() === 'POST',
  );
  await saveDraft();
  expect((await saved).postDataJSON().channels[0].settings).toEqual({
    replySettings: 'following',
  });

  await reloadComposer();
  // On the channel's own tab the bar is named for it.
  await composer()
    .getByRole('tab', { name: /Acme on X/ })
    .click();
  await composer().getByRole('button', { name: 'Acme on X Settings' }).click();
  await expect(composer().getByRole('combobox', { name: 'Who can reply' })).toHaveText(
    /Accounts you follow/,
  );

  // A platform with no options gets no bar.
  await channel(/Acme on X/).click();
  await channel(/Acme Marketing/).click();
  await expect(composer().getByRole('button', { name: /Settings$/ })).toHaveCount(0);
});

test('stops a schedule on a bad setting: toast, the channel’s tab, the field’s message', async () => {
  // The seed has no platform with a free-text setting, so a YouTube channel
  // is added for this test alone, in the second seeded workspace where no
  // other spec looks for channels, and removed after.
  const youtube = await prisma.integration.create({
    data: {
      organizationId: 'seed-second-org',
      internalId: `e2e-composer-youtube-${Date.now()}`,
      providerIdentifier: 'youtube',
      type: 'social',
      name: 'Temp Tube',
      token: 'unused',
      tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      color: 2,
    },
  });

  try {
    await page.goto('/seed-second-org/composer');
    await expect(part(1)).toBeVisible();
    await channel(/Temp Tube/).click();
    await write('A video post');

    // Set on All channels, where each channel's block is headed by it.
    await composer().getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      composer().getByRole('region', { name: 'Temp Tube settings', exact: true }),
    ).toBeVisible();
    await composer().getByRole('textbox', { name: 'Title' }).fill('t'.repeat(101));
    await expect(composer().getByText('101/100')).toBeVisible();
    await composer().getByRole('button', { name: 'Settings', exact: true }).click();

    // Checked before anything is sent, the way the API will check it.
    let sent = false;
    const watch = (request: { url(): string; method(): string }) => {
      if (request.url().endsWith('/posts') && request.method() === 'POST') {
        sent = true;
      }
    };
    page.on('request', watch);
    await composer().getByRole('button', { name: 'Add to calendar' }).click();
    await expect(
      page.getByText('YouTube (Temp Tube): Title must be at most 100 characters.').first(),
    ).toBeVisible();
    await expect(composer().getByRole('tab', { name: /Temp Tube/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(composer().getByRole('button', { name: 'Temp Tube Settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const message = composer().getByRole('alert').filter({ hasText: 'Title must be at most' });
    await expect(message).toBeVisible();
    page.off('request', watch);
    expect(sent).toBe(false);

    // Fixing the field clears its message.
    await composer().getByRole('textbox', { name: 'Title' }).fill('A good title');
    await expect(message).toHaveCount(0);
  } finally {
    await prisma.integration.delete({ where: { id: youtube.id } });
  }
});

test('posts now through the main button’s menu', async () => {
  await openComposer();
  await channel(/Acme Marketing/).click();
  await write(`Right now ${Date.now()}`);

  await composer().getByRole('button', { name: 'More ways to publish' }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/posts') && response.request().method() === 'POST',
  );
  await page.getByRole('menuitem', { name: 'Post now' }).click();
  const response = await saved;
  expect(response.request().postDataJSON()).toMatchObject({ state: 'QUEUE', publishNow: true });
  expect(response.ok()).toBe(true);
  const { post } = (await response.json()) as { post: { group: string } };
  created.groups.push(post.group);

  // Out of the writer's hands: the composer closes and says so.
  await expect(page.getByText('Publishing now', { exact: true }).first()).toBeVisible();
  await expect(composer()).toHaveCount(0);
});

test('fills an empty post from the header’s Templates', async () => {
  await openComposer();
  await composer().getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: /Three Quick Tips/i }).click();
  await expect(part(1)).toContainText('3 quick tips for [your topic]:');
  await expect(part(1)).toContainText('1. [First tip]');
});

test('inserts a saved signature at the cursor', async () => {
  const content = `Signed ${Date.now()}\nThe Acme team`;
  const response = await page.request.post(`${API_URL}/signatures`, {
    data: { content, autoAdd: false },
  });
  expect(response.ok()).toBe(true);
  const { signature } = (await response.json()) as { signature: { id: string } };
  created.signatures.push(signature.id);

  await openComposer();
  await write('Thanks for reading');
  await composer().getByRole('button', { name: 'Insert signature', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Signatures' })
    .getByRole('button', { name: `Insert signature: ${content.split('\n')[0]}` })
    .click();
  await expect(part(1)).toContainText('Thanks for reading');
  await expect(part(1)).toContainText(content.split('\n')[0]);
  await expect(part(1)).toContainText('The Acme team');
  // Focus stays in the editor, so the writing carries on.
  await page.keyboard.type('P.S.');
  await expect(part(1)).toContainText('P.S.');
});

test('starts a blank post with the default signature, without counting it as an edit', async () => {
  const current = await page.request.get(`${API_URL}/signatures/default`);
  const existing = ((await current.json()) as { signature: { content: string } | null }).signature;
  let content = existing?.content;

  // Only made when the workspace has none, so no default of anyone else's
  // is ever replaced.
  let made: string | null = null;
  if (!existing) {
    content = `Default ${Date.now()}`;
    const response = await page.request.post(`${API_URL}/signatures`, {
      data: { content, autoAdd: true },
    });
    made = ((await response.json()) as { signature: { id: string } }).signature.id;
  }

  try {
    await openComposer();
    await expect(part(1)).toContainText((content ?? '').split('\n')[0]);
    // Nothing written yet: closing asks nothing.
    await composer().getByRole('button', { name: 'Close composer' }).last().click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(composer()).toHaveCount(0);
  } finally {
    // The default goes at once: other specs expect blank posts to start empty.
    if (made) {
      await page.request.delete(`${API_URL}/signatures/${made}`);
    }
  }
});

test('underlines with the toolbar and Mod-U, previews it and keeps it', async () => {
  await openComposer();
  await channel(/Acme Marketing/).click();
  await part(1).click();
  await page.keyboard.type('plain ');
  await page.keyboard.press('Control+u');
  await expect(composer().getByRole('button', { name: 'Underline' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.type('under');

  // Posted as combining low lines under each letter, as the preview shows.
  await expect(page.getByTestId('preview-linkedin')).toContainText('plain u̲n̲d̲e̲r̲');

  await saveDraft();
  await reloadComposer();
  await expect(part(1).locator('u')).toHaveText('under');

  // The toolbar button turns it off again.
  await part(1).locator('u').click();
  await composer().getByRole('button', { name: 'Underline' }).click();
  await expect(composer().getByRole('button', { name: 'Underline' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('inserts an emoji from the picker at the cursor', async () => {
  await openComposer();
  await write('Lift off ');
  await composer().getByRole('button', { name: 'Insert emoji' }).click();
  const picker = page.getByRole('dialog', { name: 'Emoji' });
  await picker.getByLabel('Type to search for an emoji').fill('rocket');
  // By code point: "rocket" also finds the astronauts, whose emoji contain it.
  await picker.locator('button[data-unified="1f680"]').click();
  await expect(picker).toHaveCount(0);
  await expect(part(1)).toContainText('Lift off 🚀');
});

test('duplicates a post without its channels, and starts one for a channel', async () => {
  const words = `Original ${Date.now()}`;
  await openComposer();
  await channel(/Acme Marketing/).click();
  await write(words);
  await composer().getByRole('button', { name: 'Repeat post' }).click();
  await page.getByRole('menuitemradio', { name: 'Every day' }).click();
  const group = await saveDraft();

  await openComposer(`?duplicate=${group}`);
  await expect(composer()).toHaveAccessibleName('Create Post');
  await expect(part(1)).toContainText(words);
  await expect(channel(/Acme Marketing/)).toHaveAttribute('aria-pressed', 'false');
  await expect(composer().getByRole('button', { name: 'Repeat post' })).toBeVisible();
  // Starting from someone's words is not an edit either.
  await composer().getByRole('button', { name: 'Close composer' }).last().click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  const { channels } = (await (await page.request.get(`${API_URL}/channels`)).json()) as {
    channels: { id: string; name: string }[];
  };
  const marketing = channels.find((entry) => entry.name === 'Acme Marketing');
  expect(marketing).toBeDefined();

  await openComposer(`?channel=${marketing?.id}`);
  await expect(channel(/Acme Marketing/)).toHaveAttribute('aria-pressed', 'true');
  await expect(channel(/Acme on X/)).toHaveAttribute('aria-pressed', 'false');
});
