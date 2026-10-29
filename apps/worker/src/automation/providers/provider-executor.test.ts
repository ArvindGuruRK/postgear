/**
 * The provider helper on a fake Slack provider, through
 * `executeNodeActivity`: dry runs, real sends with the idempotency key,
 * the simulation and its markers, idempotency, connection checks and
 * redaction of the connection's own values.
 */
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { buildRegistry, EXECUTORS } from '../executors';
import { UNEXPECTED_MESSAGE } from '../failures';
import type { MemoryConnection } from '../memory-run-store';
import { graphOf, harness, line, ORG, OTHER_ORG, step, testOptions } from '../testing';
import { providerExecutor } from './provider-executor';
import type { AutomationProvider, ProviderResult } from './types';

const WEBHOOK = 'https://hooks.slack.com/services/T0001/B0001/abcdefSECRET123456';

interface SlackRequest {
  text: string;
  to: string;
}

function fakeSlack(send?: () => Promise<ProviderResult>) {
  const provider = {
    kind: 'slack' as const,
    build: jest.fn(
      (config: Record<string, unknown>, ctx: { connection: { name: string } | null }) => ({
        text: String(config.message),
        to: ctx.connection?.name ?? 'Slack',
      }),
    ),
    describe: jest.fn((req: SlackRequest) => `Slack message to ${req.to}: '${req.text}'`),
    send: jest.fn(
      send ??
        (async (): Promise<ProviderResult> => ({
          ok: true,
          output: { sent: true, channel: 'Marketing' },
        })),
    ),
    simulate: jest.fn(
      async (): Promise<ProviderResult> => ({ ok: true, output: { sent: true, simulated: true } }),
    ),
  } satisfies AutomationProvider<SlackRequest>;
  return provider;
}

function connection(overrides: Partial<MemoryConnection> = {}): MemoryConnection {
  return {
    id: 'conn_slack',
    organizationId: ORG,
    kind: 'slack',
    name: 'Marketing Slack',
    status: 'CONNECTED',
    credentials: { webhookUrl: WEBHOOK },
    ...overrides,
  };
}

function slackGraph(message = 'New post: {{ trigger.inputs.topic }}', connectionId = 'conn_slack') {
  return graphOf(
    [
      step('trig1', 'trigger.manual', {
        name: 'Run Now',
        config: { fields: [{ key: 'topic', label: 'Topic', type: 'text' }] },
      }),
      step('slack1', 'notify.slack', {
        name: 'Tell The Team',
        config: { connectionId, message, footer: true },
      }),
    ],
    [line('trig1', 'slack1')],
  );
}

function setup(
  options: {
    provider?: ReturnType<typeof fakeSlack>;
    mode?: 'TEST' | 'LIVE';
    sendForReal?: string[];
    simulation?: boolean;
    message?: string;
    connectionId?: string;
    topic?: unknown;
    conn?: MemoryConnection | null;
  } = {},
) {
  const provider = options.provider ?? fakeSlack();
  const h = harness(
    slackGraph(options.message, options.connectionId),
    {
      mode: options.mode ?? 'TEST',
      options: testOptions({ sendForReal: options.sendForReal ?? [] }),
      triggerPayload: { inputs: { topic: 'topic' in options ? options.topic : 'Sourdough' } },
    },
    {
      simulation: options.simulation,
      executors: buildRegistry([...EXECUTORS.values(), providerExecutor('notify.slack', provider)]),
    },
  );
  if (options.conn !== null) h.store.addConnection(options.conn ?? connection());
  return { h, provider };
}

describe('dry runs', () => {
  it('build the request and store what would be sent, without sending or simulating', async () => {
    const { h, provider } = setup({ simulation: true });

    const result = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(result).toEqual({ status: 'dryRun', ports: ['out'], attempt: 1 });
    const row = h.store.latest('run_1', 'slack1');
    expect(row?.status).toBe('DRY_RUN');
    expect(row?.output).toEqual({
      dryRun: true,
      wouldSend: "Slack message to Marketing Slack: 'New post: Sourdough'",
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.simulate).not.toHaveBeenCalled();
  });

  it('do not need a working connection', async () => {
    const { h, provider } = setup({ conn: connection({ status: 'NEEDS_RECONNECT' }) });

    const result = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(result.status).toBe('dryRun');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('still refuse a required field that came out empty, with the step that had no data', async () => {
    const { h, provider } = setup({ message: '{{ trigger.inputs.topic }}', topic: undefined });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      nonRetryable: true,
      message: "'Message' was empty because Run Now had no 'Topic'.",
    });
    const row = h.store.latest('run_1', 'slack1');
    expect(row?.status).toBe('FAILED');
    expect(row?.error).toMatchObject({ code: 'missing_data', retryable: false });
    expect(provider.build).not.toHaveBeenCalled();
  });
});

describe('real sends', () => {
  it('send a step the test sends for real, with the credentials and the idempotency key', async () => {
    const { h, provider } = setup({ sendForReal: ['slack1'] });

    const result = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(result.status).toBe('succeeded');
    expect(provider.send).toHaveBeenCalledTimes(1);
    const [req, credentials, opts] = provider.send.mock.calls[0] as unknown as [
      SlackRequest,
      unknown,
      { idempotencyKey: string },
    ];
    expect(req).toEqual({ text: 'New post: Sourdough', to: 'Marketing Slack' });
    expect(credentials).toEqual({ webhookUrl: WEBHOOK });
    expect(opts.idempotencyKey).toBe('run_1:slack1');
    expect(h.store.latest('run_1', 'slack1')?.output).toEqual({ sent: true, channel: 'Marketing' });
  });

  it('never act twice: a second call returns the stored result without calling the app', async () => {
    const { h, provider } = setup({ mode: 'LIVE' });

    const first = await h.activities.executeNodeActivity(h.stepRef('slack1'));
    h.attempt.value = 2;
    const second = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(first).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
    expect(second).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    await expect(h.store.listSteps(h.ref, 'slack1')).resolves.toHaveLength(1);
  });

  it('stop at once when the connection needs reconnecting', async () => {
    const { h, provider } = setup({
      mode: 'LIVE',
      conn: connection({ status: 'NEEDS_RECONNECT' }),
    });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.notConnected,
      nonRetryable: true,
      message: 'Marketing Slack needs reconnecting. Reconnect it on the Connections page.',
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'slack1')?.status).toBe('FAILED');
  });

  it('treat a connection of another workspace as removed', async () => {
    const { h } = setup({ mode: 'LIVE', conn: connection({ organizationId: OTHER_ORG }) });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.notConnected,
    });
    expect(h.store.latest('run_1', 'slack1')?.error).toMatchObject({ code: 'connection_missing' });
  });

  it('turn an unexpected error into a retryable failure with a plain sentence', async () => {
    const provider = fakeSlack(async () => {
      throw new Error('socket hang up at 10.0.0.4');
    });
    const { h } = setup({ mode: 'LIVE', provider });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
      nonRetryable: false,
      message: UNEXPECTED_MESSAGE,
    });
    expect(warn).toHaveBeenCalledWith('automation.step_unexpected_error', expect.any(Object));
    warn.mockRestore();
    expect(h.store.latest('run_1', 'slack1')?.error).toMatchObject({
      code: 'unexpected',
      retryable: true,
      details: { message: 'socket hang up at 10.0.0.4' },
    });
  });
});

describe('the simulation', () => {
  it('uses simulate() instead of send()', async () => {
    const { h, provider } = setup({ mode: 'LIVE', simulation: true });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(result.status).toBe('succeeded');
    expect(provider.simulate).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'automation.simulated_send',
      expect.objectContaining({
        summary: "Slack message to Marketing Slack: 'New post: Sourdough'",
      }),
    );
    log.mockRestore();
  });

  it.each([
    ['[simulate:429]', AUTOMATION_FAILURE_TYPES.retryable, false, 'rate_limited'],
    ['[simulate:500]', AUTOMATION_FAILURE_TYPES.retryable, false, 'unavailable'],
    ['[simulate:401]', AUTOMATION_FAILURE_TYPES.notConnected, true, 'connection_refused'],
    ['[simulate:400]', AUTOMATION_FAILURE_TYPES.permanent, true, 'rejected'],
  ])('fails on %s as %s', async (marker, type, nonRetryable, code) => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { h, provider } = setup({ mode: 'LIVE', simulation: true, message: `Hi ${marker}` });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toMatchObject({
      type,
      nonRetryable,
    });
    expect(provider.simulate).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'slack1')?.error).toMatchObject({ code });
    log.mockRestore();
  });

  it('flags the connection for a reconnect on [simulate:401]', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { h } = setup({ mode: 'LIVE', simulation: true, message: 'Hi [simulate:401]' });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toBeDefined();

    expect(h.store.connections[0].status).toBe('NEEDS_RECONNECT');
    log.mockRestore();
  });

  it('lets the attempt after a bounded marker through', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { h, provider } = setup({
      mode: 'LIVE',
      simulation: true,
      message: 'Hi [simulate:429x1]',
    });

    await expect(h.activities.executeNodeActivity(h.stepRef('slack1'))).rejects.toBeDefined();
    h.attempt.value = 2;
    const result = await h.activities.executeNodeActivity(h.stepRef('slack1'));

    expect(result).toEqual({ status: 'succeeded', ports: ['out'], attempt: 2 });
    expect(provider.simulate).toHaveBeenCalledTimes(1);
    const rows = await h.store.listSteps(h.ref, 'slack1');
    expect(rows.map((row) => [row.attempt, row.status])).toEqual([
      [1, 'FAILED'],
      [2, 'SUCCEEDED'],
    ]);
    log.mockRestore();
  });
});

describe('redaction', () => {
  it('hides a connection value that data put into a step input or output', async () => {
    const provider = fakeSlack(async () => ({
      ok: true,
      output: { echoed: `sent to ${WEBHOOK}` },
    }));
    const { h } = setup({
      mode: 'LIVE',
      provider,
      message: 'Leaking {{ trigger.inputs.topic }}',
      topic: WEBHOOK,
    });

    await h.activities.executeNodeActivity(h.stepRef('slack1'));

    const row = h.store.latest('run_1', 'slack1');
    expect(row?.input).toMatchObject({ message: '[hidden]', connectionId: 'conn_slack' });
    expect(row?.output).toEqual({ echoed: '[hidden]' });
    expect(JSON.stringify(row)).not.toContain('abcdefSECRET123456');
  });
});
