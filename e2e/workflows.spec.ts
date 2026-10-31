import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  adoptLeftovers,
  cleanUp,
  DEMO_ORG,
  getWorkflow,
  liveRunForPost,
  MEMBER_EMAIL,
  NAME_PREFIX,
  newCreated,
  publishFailingPost,
  type RunDetail,
  savedSlackMessage,
  signInAs,
  type WorkflowDetail,
} from './helpers/workflows';

/**
 * The Workflow Builder end to end (Sprint 10, Module 14 section 4): make a
 * workflow from the Failed Post Alert template, connect Slack with a made-up
 * webhook link, put data into the Slack message through Insert Data, test it
 * on the built-in sample, turn it on, edit and discard, check a member cannot
 * turn it on, then fail a real post and watch the live run succeed.
 *
 * One workflow, worked on in order by every test on one signed-in admin page.
 * Everything a run makes (the workflow, its Slack connection, the failing
 * post) is removed in `afterAll`, even after a failure; leftovers of an
 * earlier run that was killed are swept up too.
 *
 * Prerequisites, as for the rest of the suite: `docker compose up -d`,
 * `npm run db:seed`, the API on :3001 (`npm run dev:api:e2e`), the Temporal
 * worker and the web app on :3000, with AUTOMATION_SIMULATION and
 * PUBLISH_SIMULATION on (Slack goes to a stand-in, the post fails on its
 * `[simulate:400]` marker).
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const STAMP = `${Date.now()}`;
const WORKFLOW_NAME = `${NAME_PREFIX} ${STAMP}`;
const CONNECTION_NAME = `${NAME_PREFIX} Slack ${STAMP}`;
/** A made-up Slack webhook link: the simulation never calls it. */
const SLACK_LINK = `https://hooks.slack.com/services/TE2E${STAMP.slice(-6)}/BE2E${STAMP.slice(-6)}/e2e${STAMP}x`;
/** Typed after the template's message, before the inserted data. */
const TRIES_WORDS = ' Tries:';
const ATTEMPTS_TOKEN = 'trigger.error.attempts';
/** Typed in step 6 and then discarded. */
const DISCARDED_WORDS = ` Edited ${STAMP}`;
const ADMINS_ONLY = 'Only workspace admins can turn workflows on.';
/** The Slack message field; its label carries the required mark ("Message*"). */
const MESSAGE_LABEL = /^Message\*?$/;

/** A step's run badge settles on one of these (`runs/run-bar.tsx`). */
const FINAL_STATES = ['succeeded', 'dryRun', 'handled', 'failed', 'skipped'];

const created = newCreated();

let context: BrowserContext;
let page: Page;
let workflowId = '';
let slackKey = '';
let liveMessage = '';

test.beforeAll(async ({ browser }) => {
  // Room for a sign-in that has to wait out the throttle's minute.
  test.setTimeout(150_000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await signInAs(page, ADMIN_EMAIL);
  // A run killed before its cleanup leaves its workflow and connection behind.
  await adoptLeftovers(page.request, created, 15 * 60_000);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (!page) return;
  try {
    const log = await cleanUp(page.request, created);
    console.log(['Workflows cleanup:', ...log].join('\n  '));
  } finally {
    await context.close();
  }
});

function builder(): Locator {
  return page.getByTestId('workflow-builder');
}

function slackPanel(): Locator {
  return page.getByRole('complementary', { name: 'Slack step' });
}

function messageBox(): Locator {
  return slackPanel().getByRole('textbox', { name: MESSAGE_LABEL });
}

function stepCard(key: string): Locator {
  return page.locator(`.react-flow__node[data-id="${key}"]`);
}

async function expectSaved(): Promise<void> {
  await expect(builder().getByTestId('save-state')).toHaveAttribute('data-status', 'saved', {
    timeout: 30_000,
  });
}

/** Opens the Slack step's panel on its Configure tab: select the card, then Enter. */
async function openSlackConfigure(): Promise<void> {
  if (!(await slackPanel().isVisible())) {
    await stepCard(slackKey).click();
    await page.keyboard.press('Enter');
  }
  await expect(slackPanel()).toBeVisible();
  await slackPanel()
    .getByRole('tab', { name: /^Configure/ })
    .click();
  await expect(messageBox()).toBeVisible();
}

/** Puts the caret at the very end of the Slack message. */
async function caretAtEnd(): Promise<void> {
  await messageBox().focus();
  await page.keyboard.press('ControlOrMeta+End');
}

test('creates a workflow from the Failed Post Alert template and Finish Setup lists Slack', async () => {
  await page.goto(`/${DEMO_ORG}/workflows`);
  const gallery = page.getByRole('region', { name: 'Start From A Template' });
  const template = gallery.getByRole('button', { name: /Failed Post Alert/ });
  await expect(template).toBeVisible({ timeout: 30_000 });

  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/automations',
  );
  await template.click();
  const response = await answered;
  expect(response.ok(), `create answered HTTP ${response.status()}`).toBe(true);
  const { automation } = (await response.json()) as { automation: WorkflowDetail };
  workflowId = automation.id;
  created.workflowIds.add(workflowId);
  slackKey = automation.draftGraph.nodes.find((node) => node.type === 'notify.slack')?.key ?? '';
  expect(slackKey, 'the template has a Slack step').not.toBe('');
  expect(automation.status).toBe('DRAFT');

  await expect(page).toHaveURL(new RegExp(`/${DEMO_ORG}/workflows/${workflowId}\\?setup=1`), {
    timeout: 30_000,
  });
  await expect(builder()).toBeVisible({ timeout: 30_000 });

  // Finish Setup names the one thing left: the Slack step has no connection.
  const setup = page.getByRole('region', { name: 'Finish Setup' });
  await expect(setup).toBeVisible();
  const slackLine = setup
    .getByRole('button')
    .filter({ hasText: /Choose a Slack connection|Connect a Slack account/ });
  await expect(slackLine).toHaveCount(1);
  await expect(slackLine).toContainText('Slack');

  // Renamed to this run's own name, so the run's cleanup can find it.
  const name = page.getByRole('textbox', { name: 'Workflow name' });
  await name.fill(WORKFLOW_NAME);
  await name.press('Enter');
  await expect
    .poll(async () => (await getWorkflow(page.request, workflowId)).name)
    .toBe(WORKFLOW_NAME);
  await expectSaved();
});

test('connects Slack with a pasted webhook link and the issues chip reads "No issues found"', async () => {
  const setup = page.getByRole('region', { name: 'Finish Setup' });
  await setup
    .getByRole('button')
    .filter({ hasText: /Choose a Slack connection|Connect a Slack account/ })
    .click();
  await expect(slackPanel()).toBeVisible();

  // "Connect Slack" in an empty workspace; "Add Another" next to someone else's Slack.
  await slackPanel()
    .getByRole('button', { name: /^(Connect Slack|Add Another)$/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Connect Slack' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Connection name' }).fill(CONNECTION_NAME);
  await dialog.getByLabel('Slack link').fill(SLACK_LINK);

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/automation-connections',
  );
  await dialog.getByRole('button', { name: 'Save Connection', exact: true }).click();
  const answer = await saved;
  expect(answer.ok(), `save connection answered HTTP ${answer.status()}`).toBe(true);
  const { connection } = (await answer.json()) as { connection: { id: string; name: string } };
  created.connectionIds.add(connection.id);
  await expect(dialog).toBeHidden();

  // The new connection is chosen for the step at once.
  await expect(slackPanel().getByRole('combobox', { name: 'Slack connection' })).toContainText(
    CONNECTION_NAME,
  );
  await expect(page.getByTestId('issues-chip')).toHaveText('No issues found', { timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Finish Setup' })).toContainText('Ready to test.');
  await expectSaved();

  const slack = (await getWorkflow(page.request, workflowId)).draftGraph.nodes.find(
    (node) => node.key === slackKey,
  );
  expect(slack?.config.connectionId).toBe(connection.id);
});

test('inserts data into the Slack message through Insert Data', async () => {
  await openSlackConfigure();
  const before = await savedSlackMessage(page.request, workflowId);
  expect(before).not.toContain(ATTEMPTS_TOKEN);

  await caretAtEnd();
  await page.keyboard.type(TRIES_WORDS);

  const field = slackPanel()
    .locator('[data-chip-input]')
    .filter({ has: page.getByRole('textbox', { name: MESSAGE_LABEL }) });
  await field.getByRole('button', { name: 'Insert Data', exact: true }).click();
  const insert = page.getByRole('dialog', { name: 'Insert data' });
  await expect(insert).toBeVisible();
  await insert.getByRole('textbox', { name: 'Search data' }).fill('Attempts');
  await insert
    .locator('section[data-group="trigger"]')
    .getByRole('button', { name: /Attempts/ })
    .click();
  await expect(insert).toBeHidden();

  // A chip, never curly braces, in the field; the token in the saved draft.
  await expect(messageBox().locator(`[data-chip-path="${ATTEMPTS_TOKEN}"]`)).toHaveCount(1);
  await expect(messageBox()).not.toContainText('{{');
  await expect
    .poll(() => savedSlackMessage(page.request, workflowId), { timeout: 30_000 })
    .toMatch(
      new RegExp(
        `${TRIES_WORDS.trim()}\\s*\\{\\{\\s*${ATTEMPTS_TOKEN.replace(/\./g, '\\.')}\\s*\\}\\}$`,
      ),
    );
  await expectSaved();
  liveMessage = await savedSlackMessage(page.request, workflowId);
});

test('tests the workflow on the built-in sample: every step settles and Slack is a dry run', async () => {
  await page.getByRole('button', { name: 'Choose the test data' }).click();
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/automations/${workflowId}/test-runs`,
  );
  await page.getByRole('menuitem', { name: 'Use The Built-In Sample' }).click();
  const answer = await started;
  expect(answer.ok(), `test run answered HTTP ${answer.status()}`).toBe(true);
  const body = answer.request().postDataJSON() as { triggerData?: string } | null;
  expect(body?.triggerData).toBe('sample');

  const progress = page.getByRole('region', { name: 'Run progress' });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('status')).toHaveText('Succeeded', { timeout: 60_000 });
  await expect(progress.getByTestId('run-bar-summary')).toContainText('4 of 4 steps');

  // Every one of the four cards carries a settled badge.
  const badges = page.locator('.react-flow__node').getByTestId('run-badge');
  await expect(badges).toHaveCount(4);
  await expect
    .poll(async () =>
      (await badges.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-state'))))
        .filter((state) => !FINAL_STATES.includes(state ?? ''))
        .join(','),
    )
    .toBe('');

  const slackBadge = stepCard(slackKey).getByTestId('run-badge');
  await expect(slackBadge).toHaveAttribute('data-state', 'dryRun');
  await expect(slackBadge).toContainText('Dry Run');
});

test('turns the workflow on as an admin: the dialog says what it will do, the badge reads Active v1', async () => {
  const live = page.getByTestId('live-controls');
  await expect(live.getByTestId('status-badge')).toHaveText('Draft');
  const toggle = live.getByRole('switch', { name: 'Activate' });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();

  const dialog = page.getByRole('dialog', { name: 'Turn On Workflow' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('activation-sentence')).toHaveText(
    /^When a post fails to publish, this workflow will .*send a Slack message.*\.$/,
  );

  const activated = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/automations/${workflowId}/activate`,
  );
  await dialog.getByRole('button', { name: 'Turn On', exact: true }).click();
  const answer = await activated;
  expect(answer.ok(), `activate answered HTTP ${answer.status()}`).toBe(true);
  await expect(dialog).toBeHidden();

  await expect(live.getByTestId('status-badge')).toHaveText('Active v1');
  await expect(toggle).toBeChecked();
  await expect(live.getByTestId('unpublished-badge')).toHaveCount(0);

  const workflow = await getWorkflow(page.request, workflowId);
  expect(workflow.status).toBe('ACTIVE');
  expect(workflow.activeVersion).toBe(1);
});

test('an edit shows Unpublished Changes and Discard Changes puts the live message back', async () => {
  const live = page.getByTestId('live-controls');
  await openSlackConfigure();
  await caretAtEnd();
  await page.keyboard.type(DISCARDED_WORDS);
  await expect(messageBox()).toContainText(DISCARDED_WORDS.trim());

  await expect(live.getByTestId('unpublished-badge')).toHaveText('Unpublished Changes', {
    timeout: 30_000,
  });
  await expectSaved();
  expect(await savedSlackMessage(page.request, workflowId)).toContain(DISCARDED_WORDS.trim());

  await live.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Discard Changes?' });
  await expect(confirm).toContainText('The draft goes back to version 1, the live one.');
  await confirm.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(confirm).toBeHidden();

  await expect(live.getByTestId('unpublished-badge')).toHaveCount(0);
  await expect(live.getByTestId('status-badge')).toHaveText('Active v1');
  await expect(messageBox()).not.toContainText(DISCARDED_WORDS.trim());
  await expect(messageBox().locator(`[data-chip-path="${ATTEMPTS_TOKEN}"]`)).toHaveCount(1);

  const workflow = await getWorkflow(page.request, workflowId);
  expect(workflow.hasUnpublishedChanges).toBe(false);
  expect(await savedSlackMessage(page.request, workflowId)).toBe(liveMessage);
});

test('a member sees Activate turned off, with the reason', async ({ browser }) => {
  // Room for a sign-in that has to wait out the throttle's minute.
  test.setTimeout(150_000);
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const member = await memberContext.newPage();
    await signInAs(member, MEMBER_EMAIL);
    await member.goto(`/${DEMO_ORG}/workflows/${workflowId}`);

    const live = member.getByTestId('live-controls');
    await expect(live).toBeVisible({ timeout: 30_000 });
    await expect(live.getByTestId('status-badge')).toHaveText('Active v1');
    const toggle = live.getByRole('switch', { name: 'Activate' });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(ADMINS_ONLY);
  } finally {
    await memberContext.close();
  }
});

test('a post that fails starts a live run, which shows in the Runs tab and succeeds', async () => {
  const group = await publishFailingPost(
    page.request,
    `${NAME_PREFIX} post ${STAMP}, refused on purpose [simulate:400]`,
  );
  created.postGroups.add(group);

  // The worker fails the post, then starts this workflow's live run for it.
  let run: RunDetail | null = null;
  await expect
    .poll(
      async () => {
        run = await liveRunForPost(page.request, workflowId, group);
        return run?.status ?? 'none yet';
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe('SUCCEEDED');
  const liveRun = run as RunDetail | null;
  expect(liveRun).not.toBeNull();
  const slackStep = liveRun?.steps.find((step) => step.nodeKey === slackKey);
  expect(slackStep?.status).toBe('SUCCEEDED');

  // The Runs tab lists it (Refresh Runs until it is there), and opens it.
  await builder().getByRole('tab', { name: 'Runs', exact: true }).click();
  const history = page.getByRole('complementary', { name: 'Run history' });
  const liveRow = history
    .getByTestId('run-row')
    .filter({ hasText: 'Live' })
    .filter({ hasText: 'Succeeded' });
  await expect(async () => {
    if ((await liveRow.count()) === 0) {
      await history.getByRole('button', { name: 'Refresh Runs' }).click();
    }
    await expect(liveRow.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  await page.goto(`/${DEMO_ORG}/workflows/${workflowId}?tab=runs&run=${liveRun?.id ?? ''}`);
  const chosen = page
    .getByRole('complementary', { name: 'Run history' })
    .getByTestId('run-row')
    .and(page.locator('[aria-current="true"]'));
  await expect(chosen).toBeVisible({ timeout: 30_000 });
  await expect(chosen).toContainText('Live');
  await expect(chosen).toContainText('Succeeded');
  await expect(chosen).toContainText('v1');
});
