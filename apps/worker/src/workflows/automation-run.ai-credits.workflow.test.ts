/**
 * Out of AI credits, end to end through the run workflow (Module 11): the
 * real activities on the memory store, the real gateway client answering
 * like the API does when `tryCharge` refuses, and the workflow on a
 * time-skipping Temporal test server. Whatever the AI step's On Error says
 * (continue, or an error branch), the run fails at it, nothing after it
 * runs, the step is tried once, and a live run alerts the workspace.
 */
import { AUTOMATION_NOTIFICATION_TYPES, type AutomationRunOutcome } from '@postgear/scheduling';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import { FAILED_TITLE } from '../automation/alerts';
import { createGatewayClient } from '../automation/gateway-client';
import { graphOf, harness, line, ORG, RUN_ID, step } from '../automation/testing';
import { automationRunWorkflow } from './automation-run.workflow';

jest.setTimeout(180_000);

const OUT_OF_CREDITS = 'Not enough AI credits for this step.';

let env: TestWorkflowEnvironment;
let workflowBundle: { code: string };
let seq = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  workflowBundle = await bundleWorkflowCode({ workflowsPath: require.resolve('./index') });
});

afterAll(async () => {
  await env?.teardown();
});

function outOfCreditsGateway() {
  const calls: string[] = [];
  const client = createGatewayClient({
    apiUrl: 'http://api',
    token: 'internal-token',
    log: { info: () => undefined, warn: () => undefined },
    fetch: async (url) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          message: OUT_OF_CREDITS,
          code: 'out_of_credits',
          details: { resetsAt: '2026-12-01T00:00:00.000Z' },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { client, calls };
}

async function runWith(onError: { mode: 'continue' | 'branch' }, mode: 'TEST' | 'LIVE' = 'TEST') {
  const graph = graphOf(
    [
      step('trigger', 'trigger.manual'),
      step('write', 'ai.generateText', {
        name: 'Write Post',
        onError: { ...onError, retries: { max: 2, waitSeconds: 5 } },
        config: { prompt: 'Weekly bread news' },
      }),
      step('after', 'notify.inApp', { config: { title: 'Done', message: 'Done' } }),
      step('alert', 'notify.inApp', { config: { title: 'Failed', message: 'Failed' } }),
    ],
    [line('trigger', 'write'), line('write', 'after'), line('write', 'alert', 'error')],
  );
  const gateway = outOfCreditsGateway();
  const h = harness(graph, { mode }, { gateway: gateway.client });

  seq += 1;
  const taskQueue = `test-ai-credits-${seq}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities: h.activities,
  });
  const outcome: { outcome: AutomationRunOutcome | 'skipped' } = await worker.runUntil(
    env.client.workflow.execute(automationRunWorkflow, {
      taskQueue,
      workflowId: `automation-run:ai-credits-${seq}`,
      args: [{ runId: RUN_ID, organizationId: ORG }],
    }),
  );
  return { outcome, h, calls: gateway.calls };
}

describe.each([{ mode: 'continue' as const }, { mode: 'branch' as const }])(
  'an AI step out of credits with On Error %o',
  (onError) => {
    it('stops the run there: no later step, no error branch, no retry', async () => {
      const { outcome, h, calls } = await runWith(onError);

      expect(outcome).toEqual({ outcome: 'failed' });
      expect(calls).toHaveLength(1);
      const keys = h.store.steps.map((row) => row.nodeKey);
      expect(keys).not.toContain('after');
      expect(keys).not.toContain('alert');
      expect(h.store.latest(RUN_ID, 'write')).toMatchObject({
        status: 'FAILED',
        error: { message: OUT_OF_CREDITS, code: 'out_of_credits' },
      });
      expect(h.store.runs.get(RUN_ID)?.status).toBe('FAILED');
      expect(h.store.runExtras.get(RUN_ID)).toMatchObject({ error: OUT_OF_CREDITS });
    });

    it('a live run also tells the workspace, once, with the sentence and the reset date', async () => {
      const { outcome, h, calls } = await runWith(onError, 'LIVE');

      expect(outcome).toEqual({ outcome: 'failed' });
      expect(calls).toHaveLength(1);
      expect(h.store.steps.map((row) => row.nodeKey)).not.toContain('alert');
      const failed = h.store.notifications.filter(
        (n) => n.type === AUTOMATION_NOTIFICATION_TYPES.failed,
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        title: FAILED_TITLE,
        content: `Publishing Report failed at Write Post: ${OUT_OF_CREDITS} Credits reset on 1 December.`,
      });
    });
  },
);
