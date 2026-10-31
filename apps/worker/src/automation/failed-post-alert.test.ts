/**
 * Module 12's end-to-end check: the Failed Post Alert template, run by the
 * real `automationRunWorkflow` on Temporal's time-skipping test server with
 * the real activities on a memory store, under AUTOMATION_SIMULATION, from
 * a simulated Post Failed event. The Filter passes, Slack goes to the
 * stand-in, the In-App notification is written; and a `[simulate:429x...]`
 * marker in the Slack message is retried by the step's real retry policy
 * until it succeeds.
 */
import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  triggerSample,
} from '@postgear/automation';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import { createAutomationActivities } from '../activities/automation.activities';
import type { ActivityDeps } from '../activities/deps';
import { automationRunWorkflow } from '../workflows/automation-run.workflow';
import { MemoryRunStore } from './memory-run-store';
import { AUTOMATION_ID, NOW, ORG } from './testing';

jest.setTimeout(180_000);

let env: TestWorkflowEnvironment;
let workflowBundle: { code: string };
let seq = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  workflowBundle = await bundleWorkflowCode({
    workflowsPath: require.resolve('../workflows/index'),
  });
});

afterAll(async () => {
  await env?.teardown();
});

/** The template as a new workflow would get it, with its Slack connection picked. */
function failedPostAlert(slackMessage?: string): AutomationGraph {
  const template = getTemplate('failed-post-alert');
  if (!template) throw new Error('Failed Post Alert template is missing');
  const graph = instantiateTemplate(template, (key) => key);
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.type === 'notify.slack'
        ? {
            ...node,
            config: {
              ...node.config,
              connectionId: 'conn_slack',
              ...(slackMessage ? { message: slackMessage } : {}),
            },
          }
        : node,
    ),
  };
}

async function runLive(graph: AutomationGraph) {
  seq += 1;
  const runId = `run_fpa_${seq}`;
  const trigger = graph.nodes.find((node) => node.type === 'trigger.postFailed');
  if (!trigger) throw new Error('No Post Failed trigger');

  const store = new MemoryRunStore();
  store.now = () => NOW;
  store.addRun({
    id: runId,
    organizationId: ORG,
    automationId: AUTOMATION_ID,
    automationName: 'Failed Post Alert',
    mode: 'LIVE',
    status: 'QUEUED',
    graph,
    triggerPayload: triggerSample(trigger),
    createdAt: NOW,
  });
  store.addConnection({
    id: 'conn_slack',
    organizationId: ORG,
    kind: 'slack',
    name: 'Bloom Bakery Alerts',
    status: 'CONNECTED',
    credentials: { webhookUrl: 'https://hooks.slack.com/services/T0001/B0001/abcdefSECRETa9F2' },
  });

  const deps = {
    env: { AUTOMATION_SIMULATION: 'true', WEBHOOK_ALLOW_PRIVATE_URLS: 'false' },
    temporalClient: async () => env.client,
  } as unknown as ActivityDeps;
  // The real attempt number comes from Temporal's activity context.
  const activities = createAutomationActivities(deps, { store });

  const taskQueue = `test-failed-post-alert-${seq}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });
  const outcome = await worker.runUntil(
    env.client.workflow.execute(automationRunWorkflow, {
      taskQueue,
      workflowId: `automation-run:${runId}`,
      args: [{ runId, organizationId: ORG }],
    }),
  );

  const rows = await store.listSteps({ runId, organizationId: ORG });
  const attemptsOf = (key: string) =>
    rows
      .filter((row) => row.nodeKey === key)
      .sort((a, b) => a.attempt - b.attempt)
      .map((row) => [row.attempt, row.status]);
  const latest = (key: string) => store.latest(runId, key);
  return { outcome, store, rows, attemptsOf, latest };
}

/** The run view's words for a step (the web's `stepBadgeText`). */
const badge = (attempts: number) =>
  attempts > 1 ? `Succeeded after ${attempts} attempts` : 'Succeeded';

describe('Failed Post Alert under the simulation', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('passes the Filter, simulates Slack and writes the In-App notification', async () => {
    const { outcome, latest, store } = await runLive(failedPostAlert());

    expect(outcome).toEqual({ outcome: 'succeeded' });
    expect(latest('check')?.status).toBe('SUCCEEDED');
    expect(latest('check')?.ports).toEqual(['out']);
    expect(latest('slack')).toMatchObject({
      status: 'SUCCEEDED',
      output: { sent: true, channel: 'Bloom Bakery Alerts' },
    });
    expect(latest('tell')?.status).toBe('SUCCEEDED');

    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]).toMatchObject({ organizationId: ORG });
    expect(store.notifications[0].title).toMatch(/^A post failed on /);

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[automation:simulate\] slack to Bloom Bakery Alerts \(hooks\.slack\.com\/\.\.\.a9F2\): "A post on Bloom Bakery failed: /,
      ),
    );
  });

  it('retries [simulate:429x1] once: "Succeeded after 2 attempts"', async () => {
    const { outcome, attemptsOf, latest } = await runLive(
      failedPostAlert('A post failed: {{ trigger.error.reasonText }} [simulate:429x1]'),
    );

    expect(outcome).toEqual({ outcome: 'succeeded' });
    expect(attemptsOf('slack')).toEqual([
      [1, 'FAILED'],
      [2, 'SUCCEEDED'],
    ]);
    expect(badge(attemptsOf('slack').length)).toBe('Succeeded after 2 attempts');
    expect(latest('tell')?.status).toBe('SUCCEEDED');
  });

  it('[simulate:429x2] fails attempts 1 and 2 and succeeds on attempt 3', async () => {
    const { outcome, attemptsOf } = await runLive(
      failedPostAlert('A post failed: {{ trigger.error.reasonText }} [simulate:429x2]'),
    );

    expect(outcome).toEqual({ outcome: 'succeeded' });
    expect(attemptsOf('slack')).toEqual([
      [1, 'FAILED'],
      [2, 'FAILED'],
      [3, 'SUCCEEDED'],
    ]);
    expect(badge(attemptsOf('slack').length)).toBe('Succeeded after 3 attempts');
  });
});
