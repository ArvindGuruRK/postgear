/**
 * The Notify executors through `executeNodeActivity` (Module 12): the real
 * Slack, Teams and Discord providers under the simulation and its markers,
 * a real send to a local receiver with WEBHOOK_ALLOW_PRIVATE_URLS, the
 * `Retry-After` wait handed to Temporal, and the Email step's checks, dry
 * run and gateway call.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NodeType } from '@postgear/automation';
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { createAutomationActivities } from '../../activities/automation.activities';
import type { ActivityDeps } from '../../activities/deps';
import type { GatewayClient } from '../gateway-client';
import { type MemoryConnection, MemoryRunStore } from '../memory-run-store';
import {
  AUTOMATION_ID,
  graphOf,
  harness,
  line,
  NOW,
  ORG,
  RUN_ID,
  step,
  testOptions,
} from '../testing';
import { EXECUTORS } from '.';
import { emailRecipients, emailSubject, NOTIFY_EXECUTORS } from './notify';

const SLACK_LINK = 'https://hooks.slack.com/services/T0001/B0001/abcdefSECRETa9F2';

function conn(kind: 'slack' | 'teams' | 'discord', overrides: Partial<MemoryConnection> = {}) {
  const links = {
    slack: SLACK_LINK,
    teams:
      'https://prod-12.westus.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=zz77',
    discord: 'https://discord.com/api/webhooks/123/tok-en',
  };
  return {
    id: `conn_${kind}`,
    organizationId: ORG,
    kind,
    name: `Bakery ${kind}`,
    status: 'CONNECTED' as const,
    credentials: { webhookUrl: links[kind] },
    ...overrides,
  };
}

function oneStep(type: NodeType, config: Record<string, unknown>) {
  return graphOf(
    [step('trig1', 'trigger.manual', { name: 'Run Now' }), step('send1', type, { config })],
    [line('trig1', 'send1')],
  );
}

let log: jest.SpyInstance;
beforeEach(() => {
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

describe('the registry', () => {
  it('holds Slack, Teams, Discord and Email', () => {
    expect(NOTIFY_EXECUTORS.map((executor) => executor.type)).toEqual([
      'notify.slack',
      'notify.teams',
      'notify.discord',
      'notify.email',
    ]);
    for (const executor of NOTIFY_EXECUTORS) expect(EXECUTORS.get(executor.type)).toBe(executor);
  });
});

describe('Slack, Teams and Discord under the simulation', () => {
  const configs = {
    'notify.slack': (message: string) => ({ connectionId: 'conn_slack', message, footer: true }),
    'notify.teams': (message: string) => ({ connectionId: 'conn_teams', message }),
    'notify.discord': (message: string) => ({ connectionId: 'conn_discord', message }),
  } as const;
  const kinds = {
    'notify.slack': 'slack',
    'notify.teams': 'teams',
    'notify.discord': 'discord',
  } as const;

  function live(type: keyof typeof configs, message: string) {
    const h = harness(
      oneStep(type, configs[type](message)),
      { mode: 'LIVE' },
      { simulation: true },
    );
    h.store.addConnection(conn(kinds[type]));
    return h;
  }

  it.each(Object.keys(configs) as (keyof typeof configs)[])(
    '%s succeeds with a realistic output and logs the stand-in line',
    async (type) => {
      const h = live(type, 'Post failed on Bloom Bakery Instagram');

      await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).resolves.toMatchObject({
        status: 'succeeded',
      });
      const output = h.store.latest(RUN_ID, 'send1')?.output as Record<string, unknown>;
      expect(output.sent).toBe(true);
      if (type === 'notify.discord') expect(output.messageId).toMatch(/^\d+$/);
      if (type === 'notify.teams') expect(output.result).toBe('Teams accepted the message.');
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^\\[automation:simulate\\] ${kinds[type]} to Bakery ${kinds[type]} \\(.+/\\.\\.\\..{4}\\): "Post failed on Bloom Bakery Instagram"$`,
          ),
        ),
      );
      // The log line never carries the link itself.
      expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
    },
  );

  it.each([
    ['[simulate:429]', AUTOMATION_FAILURE_TYPES.retryable, 'rate_limited'],
    ['[simulate:5xx]', AUTOMATION_FAILURE_TYPES.retryable, 'unavailable'],
    ['[simulate:400]', AUTOMATION_FAILURE_TYPES.permanent, 'rejected'],
    ['[simulate:401]', AUTOMATION_FAILURE_TYPES.notConnected, 'connection_refused'],
    ['[simulate:403]', AUTOMATION_FAILURE_TYPES.notConnected, 'connection_refused'],
  ])('a Slack message with %s fails as %s', async (marker, type, code) => {
    const h = live('notify.slack', `Heads up ${marker}`);

    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).rejects.toMatchObject({
      type,
    });
    expect(h.store.latest(RUN_ID, 'send1')?.error).toMatchObject({ code });
    const status = h.store.connections[0].status;
    expect(status).toBe(
      type === AUTOMATION_FAILURE_TYPES.notConnected ? 'NEEDS_RECONNECT' : 'CONNECTED',
    );
  });

  it('[simulate:429x2] fails attempts 1 and 2 and succeeds on attempt 3', async () => {
    const h = live('notify.slack', 'Heads up [simulate:429x2]');

    for (const attempt of [1, 2]) {
      h.attempt.value = attempt;
      await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).rejects.toMatchObject({
        type: AUTOMATION_FAILURE_TYPES.retryable,
      });
    }
    h.attempt.value = 3;
    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).resolves.toEqual({
      status: 'succeeded',
      ports: ['out'],
      attempt: 3,
    });
    const rows = await h.store.listSteps(h.ref, 'send1');
    expect(rows.map((row) => [row.attempt, row.status])).toEqual([
      [1, 'FAILED'],
      [2, 'FAILED'],
      [3, 'SUCCEEDED'],
    ]);
  });

  it('stays a dry run in a test that does not send for real', async () => {
    const h = harness(
      oneStep('notify.slack', configs['notify.slack']('Hello team')),
      {},
      { simulation: true },
    );
    h.store.addConnection(conn('slack'));

    await h.activities.executeNodeActivity(h.stepRef('send1'));

    expect(h.store.latest(RUN_ID, 'send1')?.output).toEqual({
      dryRun: true,
      wouldSend: 'Would send to Slack Bakery slack: "Hello team"',
    });
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('[automation:simulate]'));
  });
});

describe('real sends', () => {
  let server: Server;
  let baseUrl: string;
  let answer: { status: number; body: string; headers?: Record<string, string> };
  let bodies: string[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        bodies.push(body);
        res.statusCode = answer.status;
        for (const [name, value] of Object.entries(answer.headers ?? {}))
          res.setHeader(name, value);
        res.end(answer.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    bodies = [];
    answer = { status: 200, body: 'ok' };
  });

  /** Live activities on a memory store, with the worker env the test names. */
  function liveActivities(allowPrivate: boolean) {
    const store = new MemoryRunStore();
    store.addRun({
      id: RUN_ID,
      organizationId: ORG,
      automationId: AUTOMATION_ID,
      automationName: 'Failed Post Alert',
      mode: 'LIVE',
      status: 'RUNNING',
      startedAt: NOW,
      options: testOptions(),
      graph: oneStep('notify.slack', { connectionId: 'conn_slack', message: 'Hi', footer: false }),
    });
    store.addConnection(
      conn('slack', { credentials: { webhookUrl: `${baseUrl}/services/T/B/x` } }),
    );
    const deps = {
      env: {
        AUTOMATION_SIMULATION: 'false',
        WEBHOOK_ALLOW_PRIVATE_URLS: allowPrivate ? 'true' : 'false',
      },
      temporalClient: async () => {
        throw new Error('No Temporal client in this test.');
      },
    } as unknown as ActivityDeps;
    const attempt = { value: 1 };
    const activities = createAutomationActivities(deps, {
      store,
      now: () => NOW,
      attempt: () => attempt.value,
    });
    return { store, activities, ref: { runId: RUN_ID, organizationId: ORG, nodeKey: 'send1' } };
  }

  it('reach a local receiver only with WEBHOOK_ALLOW_PRIVATE_URLS', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = liveActivities(false);
    await expect(refused.activities.executeNodeActivity(refused.ref)).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      message: 'This link is not allowed.',
    });
    expect(bodies).toHaveLength(0);
    warn.mockRestore();

    const allowed = liveActivities(true);
    await expect(allowed.activities.executeNodeActivity(allowed.ref)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(JSON.parse(bodies[0])).toMatchObject({ text: 'Hi' });
  });

  it('hand a Retry-After wait to Temporal as the next retry delay', async () => {
    answer = { status: 429, body: 'rate_limited', headers: { 'retry-after': '12' } };
    const { activities, ref, store } = liveActivities(true);

    await expect(activities.executeNodeActivity(ref)).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
      nonRetryable: false,
      nextRetryDelay: 12_000,
      message: 'Slack asked PostGear to slow down. PostGear will try again.',
    });
    expect(store.latest(RUN_ID, 'send1')?.error).toMatchObject({ code: 'rate_limited' });
  });

  it('mark the connection Needs Reconnect when Slack says the channel is archived', async () => {
    answer = { status: 410, body: 'channel_is_archived' };
    const { activities, ref, store } = liveActivities(true);

    await expect(activities.executeNodeActivity(ref)).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.notConnected,
      message: 'Slack is disconnected. Reconnect it in Connections.',
    });
    expect(store.connections[0]).toMatchObject({
      status: 'NEEDS_RECONNECT',
      lastError: 'Slack is disconnected. Reconnect it in Connections.',
    });
  });
});

describe('Email', () => {
  function fakeGateway(
    output: unknown = { sent: 2, recipients: ['k***@example.com', 'a***@example.com'] },
  ) {
    const call = jest.fn(async (_path: string, _body: Record<string, unknown>) => ({
      output,
      credits: 0,
    }));
    return { call } as unknown as GatewayClient & { call: typeof call };
  }

  function emailRun(
    config: Record<string, unknown>,
    options: {
      mode?: 'TEST' | 'LIVE';
      simulation?: boolean;
      gateway?: GatewayClient;
      sendForReal?: string[];
    } = {},
  ) {
    const gateway = options.gateway ?? fakeGateway();
    const h = harness(
      oneStep('notify.email', { subject: 'Weekly report', message: 'All good', ...config }),
      {
        mode: options.mode ?? 'LIVE',
        options: testOptions({ sendForReal: options.sendForReal ?? [] }),
      },
      { simulation: options.simulation, gateway },
    );
    return { h, gateway: gateway as ReturnType<typeof fakeGateway> };
  }

  it('dry-runs a test: says who would get it, sends nothing', async () => {
    const { h, gateway } = emailRun(
      { to: ['kim@example.com', 'ash@example.com'] },
      { mode: 'TEST' },
    );

    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).resolves.toMatchObject({
      status: 'dryRun',
    });
    expect(h.store.latest(RUN_ID, 'send1')?.output).toEqual({
      dryRun: true,
      wouldSend: 'Would email 2 people: Weekly report',
    });
    expect(gateway.call).not.toHaveBeenCalled();
  });

  it('sends through the gateway with the binding and the resolved fields', async () => {
    const { h, gateway } = emailRun({
      to: ['kim@example.com', 'ash@example.com'],
      subject: 'Line one\nline two',
    });

    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(gateway.call).toHaveBeenCalledWith(
      '/email',
      {
        runId: RUN_ID,
        nodeKey: 'send1',
        organizationId: ORG,
        to: ['kim@example.com', 'ash@example.com'],
        subject: 'Line one line two',
        message: 'All good',
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(h.store.latest(RUN_ID, 'send1')?.output).toEqual({
      sent: 2,
      recipients: ['k***@example.com', 'a***@example.com'],
    });
  });

  it('still goes to the API under the simulation (PostGear’s own mail path)', async () => {
    const { h, gateway } = emailRun({ to: ['kim@example.com'] }, { simulation: true });
    await h.activities.executeNodeActivity(h.stepRef('send1'));
    expect(gateway.call).toHaveBeenCalledTimes(1);
  });

  it('obeys the simulation markers before calling the API', async () => {
    const { h, gateway } = emailRun(
      { to: ['kim@example.com'], message: 'Hi [simulate:429]' },
      { simulation: true },
    );
    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
    });
    expect(gateway.call).not.toHaveBeenCalled();
  });

  it('fails on a value that is not an email address, naming it', async () => {
    const { h, gateway } = emailRun({ to: ['kim@example.com', 'kim at example'] });
    await expect(h.activities.executeNodeActivity(h.stepRef('send1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      message: "'kim' is not an email address.",
    });
    expect(gateway.call).not.toHaveBeenCalled();
  });

  it('checks recipients after resolution: lists split, repeats dropped, at most 10', () => {
    expect(emailRecipients(['a@x.co, b@x.co', 'A@x.co', ' ', 'c@x.co'])).toEqual([
      'a@x.co',
      'b@x.co',
      'c@x.co',
    ]);
    expect(() => emailRecipients(['', '  '])).toThrow('Add at least one email address.');
    expect(() => emailRecipients(['bob@'])).toThrow("'bob@' is not an email address.");
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`).join(',');
    expect(() => emailRecipients([eleven])).toThrow(
      'An Email step can write to at most 10 people.',
    );
  });

  it('keeps the subject on one line and refuses an empty one', () => {
    expect(emailSubject('Hi\r\nBcc: evil@example.com')).toBe('Hi Bcc: evil@example.com');
    expect(Array.from(emailSubject('é'.repeat(300)))).toHaveLength(200);
    expect(() => emailSubject(' \n ')).toThrow('Write a subject.');
  });
});
