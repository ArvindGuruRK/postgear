/**
 * HTTP Request through `executeNodeActivity`: https only, the address guard,
 * a redirect returned and not followed (against a real local server), JSON
 * bodies that stay valid whatever the data holds, secret headers merged at
 * send time only, `Idempotency-Key` on POST, the app's own words on a 4xx,
 * and the dry-run sentence with the body.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { type SafeHttpOutcome, type SafeHttpRequest, safeHttpRequest } from '../../lib/safe-http';
import { buildRegistry, EXECUTORS } from '../executors';
import { createDataExecutors, type DataExecutorOptions } from '../executors/data';
import type { Executor } from '../executors/types';
import type { MemoryConnection } from '../memory-run-store';
import { graphOf, harness, line, ORG, step, testOptions } from '../testing';
import { ADDRESS_NOT_ALLOWED, answerWords, formFields, readBody } from './http';

const SECRET = 'Bearer sk_live_SECRETVALUE9f2c';

type FakeHttp = jest.Mock<Promise<SafeHttpOutcome>, [SafeHttpRequest]>;

const answered = (
  body: unknown = { id: 'abc123' },
  statusCode = 200,
  headers: IncomingHttpHeaders = { 'content-type': 'application/json; charset=utf-8' },
): SafeHttpOutcome => ({
  outcome: 'ok',
  statusCode,
  headers: { ...headers, 'x-internal': 'drop me' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  durationMs: 1,
});

function withExecutors(executors: Executor[]) {
  const replaced = new Set(executors.map((executor) => executor.type));
  return buildRegistry([
    ...[...EXECUTORS.values()].filter((executor) => !replaced.has(executor.type)),
    ...executors,
  ]);
}

interface Setup {
  url?: string;
  method?: string;
  body?: string;
  bodyType?: string;
  headers?: { name: string; value: string }[];
  responseType?: string;
  live?: boolean;
  simulation?: boolean;
  secretHeaders?: boolean;
  title?: string;
  options?: DataExecutorOptions;
}

function setup(input: Setup = {}) {
  const http: FakeHttp = jest.fn(async (_request: SafeHttpRequest) => answered());
  const graph = graphOf(
    [
      step('trig1', 'trigger.webhook'),
      step('call1', 'data.httpRequest', {
        name: 'Tell The CRM',
        config: {
          method: input.method ?? 'POST',
          url: input.url ?? 'https://api.example.com/hooks/new-post',
          headers: input.headers ?? [{ name: 'X-Source', value: 'PostGear {{ run.mode }}' }],
          ...(input.secretHeaders ? { secretHeadersConnectionId: 'conn_http' } : {}),
          bodyType: input.bodyType ?? 'json',
          body:
            input.body ??
            '{"title": "{{ trigger.body.title }}", "url": "{{ trigger.body.url }}", "tags": {{ trigger.body.tags }}}',
          responseType: input.responseType ?? 'auto',
        },
      }),
    ],
    [line('trig1', 'call1')],
  );
  const h = harness(
    graph,
    {
      mode: input.live === false ? 'TEST' : 'LIVE',
      options: testOptions(),
      triggerPayload: {
        body: {
          title: input.title ?? 'Spring "Menu" \\ is out',
          url: 'https://example.com/spring',
          tags: ['menu', 'spring'],
        },
        receivedAt: '2026-11-03T09:00:00.000Z',
        headers: { contentType: 'application/json' },
      },
    },
    {
      simulation: input.simulation,
      executors: withExecutors(
        createDataExecutors({ http, allowPrivate: () => false, ...input.options }),
      ),
    },
  );
  const connection: MemoryConnection = {
    id: 'conn_http',
    organizationId: ORG,
    kind: 'http',
    name: 'CRM Keys',
    status: 'CONNECTED',
    credentials: { headers: [{ name: 'Authorization', value: SECRET }] },
  };
  h.store.addConnection(connection);
  return { h, http };
}

describe('addresses', () => {
  it('refuses http:// addresses', async () => {
    const { h, http } = setup({ url: 'http://api.example.com/hooks' });
    await expect(h.activities.executeNodeActivity(h.stepRef('call1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
    });
    expect(http).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'call1')?.error).toMatchObject({
      code: 'address_not_allowed',
      retryable: false,
    });
  });

  it('allows http:// only with WEBHOOK_ALLOW_PRIVATE_URLS', async () => {
    const { h, http } = setup({
      url: 'http://localhost:4000/hooks',
      options: { allowPrivate: () => true },
    });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(http.mock.calls[0][0]).toMatchObject({
      url: 'http://localhost:4000/hooks',
      allowPrivate: true,
    });
  });

  it('refuses a name that resolves to a private address (the guard)', async () => {
    const { h } = setup({
      url: 'https://sneaky.example.com/x',
      options: { http: safeHttpRequest, resolve: async () => ['10.0.0.9'] },
    });
    await expect(h.activities.executeNodeActivity(h.stepRef('call1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
    });
    expect(h.store.latest('run_1', 'call1')?.error).toMatchObject({
      code: 'address_not_allowed',
      message: ADDRESS_NOT_ALLOWED,
    });
  });

  describe('against a real server', () => {
    let server: Server;
    let base = '';
    const hits: string[] = [];

    beforeAll(async () => {
      server = createServer((request, response) => {
        hits.push(request.url ?? '');
        if (request.url === '/moved') {
          response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('followed');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns a redirect as the answer and never follows it', async () => {
      const { h } = setup({
        url: `${base}/moved`,
        method: 'GET',
        bodyType: 'none',
        options: { http: safeHttpRequest, allowPrivate: () => true },
      });
      await h.activities.executeNodeActivity(h.stepRef('call1'));
      expect(hits).toEqual(['/moved']);
      expect(h.store.latest('run_1', 'call1')?.output).toEqual({
        status: 302,
        ok: false,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        body: '',
      });
    });
  });
});

describe('the request', () => {
  it('escapes data inside a JSON body, so quotes keep it valid', async () => {
    const { h, http } = setup({ title: 'He said "hi", then left\n\\o/' });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    const sent = http.mock.calls[0][0];
    expect(JSON.parse(sent.body ?? '')).toEqual({
      title: 'He said "hi", then left\n\\o/',
      url: 'https://example.com/spring',
      tags: ['menu', 'spring'],
    });
    expect(sent.headers?.['Content-Type']).toBe('application/json');
  });

  it('refuses a body that is not JSON after the data is filled in', async () => {
    const { h, http } = setup({ body: '{"title": {{ trigger.body.title }}' });
    await expect(h.activities.executeNodeActivity(h.stepRef('call1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
    });
    expect(http).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'call1')?.error).toMatchObject({ code: 'body_not_json' });
  });

  it('sends Idempotency-Key on POST and PATCH, not on GET', async () => {
    const post = setup();
    await post.h.activities.executeNodeActivity(post.h.stepRef('call1'));
    expect(post.http.mock.calls[0][0].headers?.['Idempotency-Key']).toBe('run_1:call1');

    const patch = setup({ method: 'PATCH' });
    await patch.h.activities.executeNodeActivity(patch.h.stepRef('call1'));
    expect(patch.http.mock.calls[0][0].headers?.['Idempotency-Key']).toBe('run_1:call1');

    const get = setup({ method: 'GET', bodyType: 'none' });
    await get.h.activities.executeNodeActivity(get.h.stepRef('call1'));
    expect(get.http.mock.calls[0][0].headers?.['Idempotency-Key']).toBeUndefined();
    expect(get.http.mock.calls[0][0].body).toBeUndefined();
  });

  it('merges secret headers at send time and keeps them out of the step row', async () => {
    const { h, http } = setup({ secretHeaders: true });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    const headers = http.mock.calls[0][0].headers ?? {};
    expect(headers.Authorization).toBe(SECRET);
    expect(headers['X-Source']).toBe('PostGear live');
    expect(JSON.stringify(h.store.latest('run_1', 'call1'))).not.toContain('SECRETVALUE');
  });

  it('keeps data with a line break from adding a header', async () => {
    const { h, http } = setup({
      headers: [{ name: 'X-Title', value: '{{ trigger.body.title }}' }],
      title: 'a\r\nX-Evil: 1',
    });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(http.mock.calls[0][0].headers?.['X-Title']).toBe('a X-Evil: 1');
  });

  it('sends form fields as a form', async () => {
    const { h, http } = setup({
      bodyType: 'form',
      body: 'title={{ trigger.body.title }}\nsource=PostGear',
      title: 'A & B',
    });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    const sent = http.mock.calls[0][0];
    expect(sent.body).toBe('title=A+%26+B&source=PostGear');
    expect(sent.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(formFields('a=1\n\n b = 2=3 ')).toEqual([
      ['a', '1'],
      ['b', '2=3'],
    ]);
  });
});

describe('the answer', () => {
  it('keeps the status, three headers and the parsed JSON body', async () => {
    const { h } = setup();
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(h.store.latest('run_1', 'call1')?.output).toEqual({
      status: 200,
      ok: true,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { id: 'abc123' },
    });
  });

  it('reads JSON or text as asked', () => {
    expect(readBody('{"a":1}', 'application/json', 'auto')).toEqual({ a: 1 });
    expect(readBody('{"a":1}', 'text/plain', 'auto')).toBe('{"a":1}');
    expect(readBody('{"a":1}', 'text/plain', 'json')).toEqual({ a: 1 });
    expect(readBody('{"a":1}', 'application/json', 'text')).toBe('{"a":1}');
    expect(readBody('not json', 'application/json', 'auto')).toBe('not json');
  });

  it('says the answer was cut past 64 KB', async () => {
    const { h, http } = setup();
    http.mockResolvedValueOnce({ ...answered('{"long":'), bodyTruncated: true } as SafeHttpOutcome);
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(h.store.latest('run_1', 'call1')?.output).toMatchObject({
      body: '{"long":',
      note: expect.stringContaining('64 KB'),
    });
  });

  it('fails for good on a 4xx, with the app’s own words', async () => {
    const { h, http } = setup();
    http.mockResolvedValueOnce({
      outcome: 'rejected',
      statusCode: 422,
      error: 'Receiver answered 422',
      body: JSON.stringify({ message: 'Title is too long' }),
      durationMs: 1,
    });
    await expect(h.activities.executeNodeActivity(h.stepRef('call1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
    });
    expect(h.store.latest('run_1', 'call1')?.error).toMatchObject({
      message: 'The other app answered 422: Title is too long',
      retryable: false,
    });
    expect(answerWords('x'.repeat(500))).toHaveLength(200);
  });

  it('retries on 429 and 5xx', async () => {
    const { h, http } = setup();
    http.mockResolvedValueOnce({
      outcome: 'retry',
      statusCode: 503,
      error: 'Receiver answered 503',
      durationMs: 1,
    });
    await expect(h.activities.executeNodeActivity(h.stepRef('call1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
    });
  });
});

describe('tests and simulation', () => {
  it('a dry run says what it would send, with the body, and sends nothing', async () => {
    const { h, http } = setup({ live: false, secretHeaders: true });
    const result = await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(result.status).toBe('dryRun');
    expect(http).not.toHaveBeenCalled();
    const output = h.store.latest('run_1', 'call1')?.output;
    expect(output).toEqual({
      dryRun: true,
      wouldSend: 'Would send POST to api.example.com/hooks/new-post with 3 fields.',
      body: {
        title: 'Spring "Menu" \\ is out',
        url: 'https://example.com/spring',
        tags: ['menu', 'spring'],
      },
    });
    expect(JSON.stringify(output)).not.toContain('SECRETVALUE');
  });

  it('hides secret-named fields in the dry run body', async () => {
    const { h } = setup({ live: false, body: '{"password": "{{ trigger.body.title }}", "n": 1}' });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(h.store.latest('run_1', 'call1')?.output).toMatchObject({
      body: { password: '[hidden]', n: 1 },
    });
  });

  it('answers from the stand-in under AUTOMATION_SIMULATION', async () => {
    const { h, http } = setup({ simulation: true });
    await h.activities.executeNodeActivity(h.stepRef('call1'));
    expect(http).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'call1')?.output).toMatchObject({
      status: 200,
      ok: true,
      simulated: true,
    });
  });
});
