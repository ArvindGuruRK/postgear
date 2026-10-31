/**
 * The worker's gateway client: the binding it adds, the token header, and
 * how every kind of answer becomes a result or a typed `StepFailure`.
 * Also the engine's side of credits: a step's `credits` joins the run's
 * total once, with the row that finished it.
 */
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/activity';
import { buildRegistry } from './executors';
import type { Executor } from './executors/types';
import { StepFailure } from './failures';
import {
  callGateway,
  createGatewayClient,
  GATEWAY_NOT_SET_UP_MESSAGE,
  GATEWAY_UNAUTHORISED_MESSAGE,
  GATEWAY_UNAVAILABLE_MESSAGE,
  type GatewayClient,
} from './gateway-client';
import { graphOf, harness, step } from './testing';

const TOKEN = 'a'.repeat(64);
const silent = { info: jest.fn(), warn: jest.fn() };

function answer(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientAnswering(status: number, body: unknown) {
  const fetch = jest.fn(async (_url: string, _init: RequestInit) => answer(status, body));
  const client = createGatewayClient({
    apiUrl: 'http://localhost:3001/',
    token: TOKEN,
    log: silent,
    fetch,
  });
  return { client, fetch };
}

async function failureOf(promise: Promise<unknown>): Promise<StepFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StepFailure) return error;
    throw error;
  }
  throw new Error('Expected a StepFailure');
}

describe('createGatewayClient', () => {
  it('posts the body with the internal token to the gateway path', async () => {
    const { client, fetch } = clientAnswering(200, { output: { postGroup: 'g1' }, credits: 0 });

    const result = await client.call('/posts/draft', { runId: 'r', text: 'Hi' });

    expect(result).toEqual({ output: { postGroup: 'g1' }, credits: 0 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/internal/automation/posts/draft');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-postgear-internal']).toBe(TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({ runId: 'r', text: 'Hi' });
    expect(init.redirect).toBe('error');
  });

  it('reads credits, never a negative or odd value', async () => {
    expect(
      await clientAnswering(200, { output: {}, credits: 15 }).client.call('/ai/text', {}),
    ).toEqual({ output: {}, credits: 15 });
    expect(
      await clientAnswering(200, { output: {}, credits: -3 }).client.call('/ai/text', {}),
    ).toEqual({ output: {}, credits: 0 });
  });

  it('fails plainly without a token, before any request', async () => {
    const fetch = jest.fn();
    const client = createGatewayClient({
      apiUrl: 'http://api',
      token: undefined,
      log: silent,
      fetch,
    });

    const failure = await failureOf(client.call('/posts/draft', {}));

    expect(failure.kind).toBe('permanent');
    expect(failure.message).toBe(GATEWAY_NOT_SET_UP_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [409, { code: 'in_progress', message: 'Already running.' }, 'retryable', 'in_progress'],
    [408, {}, 'retryable', 'gateway_unavailable'],
    [429, {}, 'retryable', 'gateway_unavailable'],
    [500, {}, 'retryable', 'gateway_unavailable'],
    [503, { message: 'down' }, 'retryable', 'gateway_unavailable'],
  ])('treats %i as worth retrying', async (status, body, kind, code) => {
    const failure = await failureOf(clientAnswering(status, body).client.call('/x', {}));
    expect(failure.kind).toBe(kind);
    expect(failure.code).toBe(code);
  });

  it.each([401, 403, 404])(
    'answers %i with the not-authorised sentence and a log line',
    async (status) => {
      const warn = jest.fn();
      const client = createGatewayClient({
        apiUrl: 'http://api',
        token: TOKEN,
        log: { info: jest.fn(), warn },
        fetch: async () => answer(status, { message: 'Not Found' }),
      });

      const failure = await failureOf(client.call('/posts/draft', {}));

      expect(failure.kind).toBe('permanent');
      expect(failure.message).toBe(GATEWAY_UNAUTHORISED_MESSAGE);
      expect(warn).toHaveBeenCalledWith('automation.gateway_unauthorised', {
        path: '/posts/draft',
        status,
      });
    },
  );

  it('passes the API sentence through on 400 and 422', async () => {
    const failure = await failureOf(
      clientAnswering(422, {
        message: 'Instagram (Bloom Bakery): Add at least one image.',
        code: 'post_invalid',
      }).client.call('/posts/queue', {}),
    );
    expect(failure.kind).toBe('permanent');
    expect(failure.message).toBe('Instagram (Bloom Bakery): Add at least one image.');
    expect(failure.code).toBe('post_invalid');
  });

  it.each([
    ['out_of_credits', 'outOfCredits'],
    ['not_connected', 'notConnected'],
    ['limit_reached', 'limit'],
  ])('maps the %s code to the %s failure', async (code, kind) => {
    const failure = await failureOf(
      clientAnswering(422, { message: 'Stop.', code }).client.call('/ai/text', {}),
    );
    expect(failure.kind).toBe(kind);
  });

  it('retries a network error and an answer without output', async () => {
    const offline = createGatewayClient({
      apiUrl: 'http://api',
      token: TOKEN,
      log: silent,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const network = await failureOf(offline.call('/x', {}));
    expect(network.kind).toBe('retryable');
    expect(network.message).toBe(GATEWAY_UNAVAILABLE_MESSAGE);

    const odd = await failureOf(clientAnswering(200, { ok: true }).client.call('/x', {}));
    expect(odd.kind).toBe('retryable');
  });

  it('lets a cancelled run stop the call as a cancellation, not a retry', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createGatewayClient({
      apiUrl: 'http://api',
      token: TOKEN,
      log: silent,
      fetch: async (_url, init) => {
        init.signal?.throwIfAborted();
        return answer(200, { output: {} });
      },
    });

    await expect(client.call('/x', {}, { signal: controller.signal })).rejects.not.toBeInstanceOf(
      StepFailure,
    );
  });
});

describe('callGateway and run credits', () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const gateway: GatewayClient = {
    async call<T>(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      return { output: { text: 'Fresh bread' } as T, credits: 5 };
    },
  };
  const charging: Executor = {
    type: 'notify.inApp',
    async run(ctx) {
      const { output, credits } = await callGateway(ctx, '/ai/text', { prompt: 'Bread' });
      return { output, credits };
    },
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it('adds the run binding and adds the credits to the run once', async () => {
    const h = harness(
      graphOf([
        step('trig1', 'trigger.manual'),
        step('write1', 'notify.inApp', { config: { title: 'Hi', message: '' } }),
      ]),
      {},
      { gateway, executors: buildRegistry([charging]) },
    );

    await h.activities.executeNodeActivity(h.stepRef('write1'));
    // A replayed activity finds the finished row and acts no more.
    await h.activities.executeNodeActivity(h.stepRef('write1'));

    expect(calls).toEqual([
      {
        path: '/ai/text',
        body: { runId: 'run_1', nodeKey: 'write1', organizationId: 'org_test', prompt: 'Bread' },
      },
    ]);
    expect(h.store.creditsUsed.get('run_1')).toBe(5);
    expect(h.store.latest('run_1', 'write1')?.status).toBe('SUCCEEDED');
  });

  it('fails a gateway step plainly when the worker has no gateway', async () => {
    const h = harness(
      graphOf([
        step('trig1', 'trigger.manual'),
        step('write1', 'notify.inApp', { config: { title: 'Hi', message: '' } }),
      ]),
      {},
      { executors: buildRegistry([charging]) },
    );

    const error = await h.activities.executeNodeActivity(h.stepRef('write1')).catch((e) => e);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).type).toBe(AUTOMATION_FAILURE_TYPES.permanent);
    expect(h.store.latest('run_1', 'write1')?.error?.message).toBe(GATEWAY_NOT_SET_UP_MESSAGE);
    expect(h.store.creditsUsed.get('run_1')).toBeUndefined();
  });
});
