/**
 * The two templates Module 13 makes runnable, step by step through
 * `executeNodeActivity` under AUTOMATION_SIMULATION, as a live run:
 *
 * - **Publishing Report**: Post Published, Set Fields, Google Sheets on a
 *   simulated Google connection (the stand-in's row number), Slack.
 * - **Blog To Draft**: Webhook, Generate Text, Create Draft, In-App
 *   Notification, with the webhook's body as trigger data. Generate Text and
 *   Create Draft go through a fake step gateway (their real executors are
 *   Modules 10 and 11), so this checks the data handed along, not the API.
 *
 * Slack, Generate Text and Create Draft are stand-ins here so the test does
 * not depend on other modules' executors; Sheets, Set Fields, the triggers
 * and In-App are the real ones.
 */
import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  triggerSample,
} from '@postgear/automation';
import type { GatewayClient } from '../gateway-client';
import type { MemoryConnection } from '../memory-run-store';
import { resetSimulatedRows } from '../providers/sheets';
import { harness, ORG, testOptions } from '../testing';
import { buildRegistry, EXECUTORS } from './index';
import type { Executor } from './types';

function templateGraph(id: string, fill: (graph: AutomationGraph) => void): AutomationGraph {
  const template = getTemplate(id);
  if (!template) throw new Error(`missing template ${id}`);
  const graph = instantiateTemplate(template, (key) => key);
  fill(graph);
  return graph;
}

function configOf(graph: AutomationGraph, type: string): Record<string, unknown> {
  const node = graph.nodes.find((candidate) => candidate.type === type);
  if (!node) throw new Error(`missing ${type}`);
  return node.config;
}

/** The real registry with these executors in place of the ones of the same type. */
function withExecutors(executors: Executor[]) {
  const replaced = new Set(executors.map((executor) => executor.type));
  return buildRegistry([
    ...[...EXECUTORS.values()].filter((executor) => !replaced.has(executor.type)),
    ...executors,
  ]);
}

const slackStandIn: Executor = {
  type: 'notify.slack',
  async run(ctx) {
    return { output: { sent: true, text: String(ctx.config.message), simulated: true } };
  },
};

/** Generate Text and Create Draft as their modules call the gateway. */
const gatewaySteps: Executor[] = [
  {
    type: 'ai.generateText',
    async run(ctx) {
      const { output, credits } = await ctx.deps.gateway.call('/ai/text', {
        prompt: ctx.config.prompt,
      });
      return { output, credits };
    },
  },
  {
    type: 'postgear.createDraft',
    async run(ctx) {
      const { output } = await ctx.deps.gateway.call('/posts/draft', { text: ctx.config.text });
      return { output };
    },
  },
];

function fakeGateway(): GatewayClient & { calls: { path: string; body: unknown }[] } {
  const calls: { path: string; body: unknown }[] = [];
  return {
    calls,
    async call<T>(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      const output =
        path === '/ai/text'
          ? { text: 'Our Spring Menu is here: https://example.com/spring' }
          : {
              post: { id: 'pst_1', group: 'grp_1' },
              link: 'http://localhost:3000/org_test/composer?group=grp_1',
            };
      return { output: output as T, credits: path === '/ai/text' ? 1 : 0 };
    },
  };
}

beforeEach(() => resetSimulatedRows());

describe('Publishing Report under simulation', () => {
  it('runs every step and logs the post with a simulated row number', async () => {
    const graph = templateGraph('publishing-report', (g) => {
      Object.assign(configOf(g, 'data.googleSheetsAppendRow'), {
        connectionId: 'conn_google',
        spreadsheet: { id: 'simulated-social-report', name: 'Social Report' },
        sheet: { id: 0, title: 'Posts' },
      });
      Object.assign(configOf(g, 'notify.slack'), { connectionId: 'conn_slack' });
    });
    const trigger = graph.nodes.find((node) => node.type === 'trigger.postPublished');
    const h = harness(
      graph,
      {
        mode: 'LIVE',
        options: testOptions(),
        triggerPayload: trigger ? triggerSample(trigger) : {},
      },
      { simulation: true, executors: withExecutors([slackStandIn]) },
    );
    const google: MemoryConnection = {
      id: 'conn_google',
      organizationId: ORG,
      kind: 'google',
      name: 'Simulated Google',
      status: 'CONNECTED',
      credentials: { simulated: true },
    };
    h.store.addConnection(google);
    h.store.addConnection({
      id: 'conn_slack',
      organizationId: ORG,
      kind: 'slack',
      name: 'Marketing Slack',
      status: 'CONNECTED',
      credentials: { webhookUrl: 'https://hooks.slack.com/services/T0/B0/abcdefghijkl' },
    });

    for (const key of ['published', 'fields', 'sheet', 'slack']) {
      const result = await h.activities.executeNodeActivity(h.stepRef(key));
      expect({ key, status: result.status }).toEqual({ key, status: 'succeeded' });
    }

    expect(h.store.latest('run_1', 'sheet')?.output).toMatchObject({
      rowNumber: 2,
      spreadsheet: { name: 'Social Report' },
      sheet: 'Posts',
    });
    const fields = h.store.latest('run_1', 'fields')?.output as Record<string, string>;
    expect(h.store.latest('run_1', 'sheet')?.input).toMatchObject({
      columns: [
        { header: 'Date', value: fields.date },
        { header: 'Channel', value: fields.channel },
        { header: 'Link', value: fields.link },
        { header: 'Preview', value: fields.preview },
      ],
    });
    expect(h.store.latest('run_1', 'slack')?.output).toMatchObject({ sent: true });
  });
});

describe('Blog To Draft under simulation', () => {
  it('turns the webhook body into a draft and a notification', async () => {
    const graph = templateGraph('blog-to-draft', (g) => {
      Object.assign(configOf(g, 'postgear.createDraft'), { channels: ['ch_ig'] });
    });
    const gateway = fakeGateway();
    const h = harness(
      graph,
      {
        mode: 'LIVE',
        options: testOptions(),
        triggerPayload: {
          body: { title: 'Spring Menu', url: 'https://example.com/spring', password: '[hidden]' },
          receivedAt: '2026-11-03T09:00:00.000Z',
          headers: { contentType: 'application/json' },
        },
      },
      { simulation: true, gateway, executors: withExecutors(gatewaySteps) },
    );

    for (const key of ['blog', 'write', 'draft', 'tell']) {
      const result = await h.activities.executeNodeActivity(h.stepRef(key));
      expect({ key, status: result.status }).toEqual({ key, status: 'succeeded' });
    }

    expect(gateway.calls).toEqual([
      {
        path: '/ai/text',
        body: {
          prompt:
            'Write a post that shares this new article: Spring Menu https://example.com/spring',
        },
      },
      {
        path: '/posts/draft',
        body: { text: 'Our Spring Menu is here: https://example.com/spring' },
      },
    ]);
    expect(h.store.notifications).toHaveLength(1);
    expect(h.store.notifications[0]).toMatchObject({
      title: 'A new draft from your blog',
      content: 'Spring Menu',
      link: 'http://localhost:3000/org_test/composer?group=grp_1',
    });
    expect(h.store.creditsUsed.get('run_1')).toBe(1);
  });
});
