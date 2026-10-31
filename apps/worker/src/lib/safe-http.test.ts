/**
 * `safeHttpRequest` against a local HTTP server: every outcome, the methods
 * and headers on the wire, `Retry-After`, the kept-body cap, redirects
 * returned (never followed), cancellation, and the pinned DNS lookup.
 *
 * The local server is reached through the "allow private" path. The guard
 * itself is checked with an injected resolver; the pinning test swaps the
 * guard for one that "validated" a name the OS cannot resolve, so the
 * request only arrives if the socket used the pinned address.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseRetryAfter, SAFE_HTTP_MAX_RESPONSE_BYTES, safeHttpRequest } from './safe-http';

jest.mock('@postgear/seo-engine', () => {
  const actual = jest.requireActual('@postgear/seo-engine');
  return { ...actual, assertSafeUrl: jest.fn(actual.assertSafeUrl) };
});
const seo = jest.requireMock('@postgear/seo-engine') as {
  assertSafeUrl: jest.Mock;
};

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let port: number;
let baseUrl: string;
let received: Received[] = [];
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  handler = (_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  };
});

function request(overrides: Partial<Parameters<typeof safeHttpRequest>[0]> = {}) {
  return safeHttpRequest({
    method: 'POST',
    url: `${baseUrl}/send`,
    body: '{"text":"hi"}',
    headers: { 'content-type': 'application/json' },
    timeoutMs: 2_000,
    keepBody: true,
    allowPrivate: true,
    ...overrides,
  });
}

describe('safeHttpRequest outcomes', () => {
  it('sends the method, headers and body, and keeps the answer when asked', async () => {
    const outcome = await request({ headers: { 'content-type': 'application/json', 'x-a': '1' } });

    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 200, body: 'ok' });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/send', body: '{"text":"hi"}' });
    expect(received[0].headers['x-a']).toBe('1');
    expect(received[0].headers['content-length']).toBe('13');
    expect(received[0].headers.host).toBe(`127.0.0.1:${port}`);
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)('sends a %s', async (method) => {
    const outcome = await request({ method, body: undefined, url: `${baseUrl}/x?a=1` });
    expect(outcome.outcome).toBe('ok');
    expect(received[0]).toMatchObject({ method, url: '/x?a=1', body: '' });
  });

  it('drops the answer when it is not kept', async () => {
    const outcome = await request({ keepBody: false });
    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 200 });
    expect('body' in outcome && outcome.body !== undefined).toBe(false);
  });

  it.each([
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
    [429, 'retry'],
    [408, 'retry'],
    [400, 'rejected'],
    [401, 'rejected'],
    [403, 'rejected'],
    [404, 'rejected'],
    [410, 'rejected'],
  ] as const)('classifies a %i as %s and keeps its words', async (status, expected) => {
    handler = (_req, res) => {
      res.statusCode = status;
      res.end('channel_is_archived');
    };

    const outcome = await request();

    expect(outcome).toMatchObject({
      outcome: expected,
      statusCode: status,
      error: `Receiver answered ${status}`,
      body: 'channel_is_archived',
    });
  });

  it('returns a redirect as the answer and never follows it', async () => {
    handler = (req, res) => {
      if (req.url === '/send') {
        res.statusCode = 302;
        res.setHeader('location', `${baseUrl}/elsewhere`);
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end('followed');
    };

    const outcome = await request();

    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 302 });
    expect(outcome.outcome === 'ok' && outcome.headers.location).toBe(`${baseUrl}/elsewhere`);
    expect(received.map((r) => r.url)).toEqual(['/send']);
  });

  it('gives up after the timeout and asks for a retry', async () => {
    handler = () => {
      // Never answers.
    };
    const outcome = await request({ timeoutMs: 300 });
    expect(outcome).toMatchObject({ outcome: 'retry', statusCode: null });
    expect((outcome as { error: string }).error).toMatch(/No response within/);
  });

  it('reports a refused connection as retryable', async () => {
    const outcome = await request({ url: 'http://127.0.0.1:1/send' });
    expect(outcome).toMatchObject({
      outcome: 'retry',
      statusCode: null,
      error: 'Connection refused',
    });
  });

  it('stops at once when cancelled, before or during the call', async () => {
    const before = new AbortController();
    before.abort();
    expect(await request({ signal: before.signal })).toMatchObject({
      outcome: 'retry',
      error: 'Cancelled',
    });
    expect(received).toHaveLength(0);

    handler = () => {
      // Never answers; the abort ends it.
    };
    const during = new AbortController();
    const pending = request({ signal: during.signal, timeoutMs: 5_000 });
    setTimeout(() => during.abort(), 50);
    expect(await pending).toMatchObject({ outcome: 'retry', statusCode: null, error: 'Cancelled' });
  });
});

describe('Retry-After', () => {
  it('turns seconds into retryAfterMs on a 429 and a 503', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.setHeader('retry-after', '7');
      res.end('slow down');
    };
    expect(await request()).toMatchObject({
      outcome: 'retry',
      statusCode: 429,
      retryAfterMs: 7000,
    });

    handler = (_req, res) => {
      res.statusCode = 503;
      res.setHeader('retry-after', '1.5');
      res.end();
    };
    expect(await request()).toMatchObject({
      outcome: 'retry',
      statusCode: 503,
      retryAfterMs: 1500,
    });
  });

  it('leaves retryAfterMs out when the header is missing or odd', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.setHeader('retry-after', 'soon');
      res.end();
    };
    const outcome = await request();
    expect(outcome.outcome).toBe('retry');
    expect('retryAfterMs' in outcome).toBe(false);
  });

  it('parses seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter(['2', '9'], now)).toBe(2_000);
    expect(parseRetryAfter('Sat, 31 Oct 2026 10:00:20 GMT', now)).toBe(20_000);
    expect(parseRetryAfter('Sat, 31 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter('later', now)).toBeUndefined();
  });
});

describe('the response cap', () => {
  it('keeps at most maxResponseBytes of the body and says it was cut', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('x'.repeat(10_000));
    };

    const outcome = await request({ maxResponseBytes: 1_024 });

    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 200, bodyTruncated: true });
    expect(outcome.outcome === 'ok' && outcome.body?.length).toBe(1_024);
  });

  it('defaults the cap to 64 KB', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('y'.repeat(SAFE_HTTP_MAX_RESPONSE_BYTES + 5_000));
    };
    const outcome = await request();
    expect(outcome.outcome === 'ok' && outcome.body?.length).toBe(SAFE_HTTP_MAX_RESPONSE_BYTES);
  });

  it('does not mark a body under the cap as cut', async () => {
    const outcome = await request({ maxResponseBytes: 1_024 });
    expect(outcome).not.toHaveProperty('bodyTruncated');
  });
});

describe('the address guard', () => {
  it('refuses private and metadata addresses before sending anything', async () => {
    const metadata = await request({ url: 'http://169.254.169.254/latest', allowPrivate: false });
    expect(metadata.outcome).toBe('unsafe');

    const resolved = await request({
      url: 'https://hooks.example.com/x',
      allowPrivate: false,
      resolve: async () => ['10.0.0.9'],
    });
    expect(resolved.outcome).toBe('unsafe');
    expect(received).toHaveLength(0);
  });

  it.each([
    ['localhost by name', 'http://localhost/hook'],
    ['a loopback address', 'http://127.0.0.1/hook'],
    ['the IPv6 loopback', 'http://[::1]/hook'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['a 10.x private address', 'https://10.0.0.5/hook'],
    ['a 192.168.x private address', 'https://192.168.1.10/hook'],
    ['a 172.16.x private address', 'https://172.16.0.1/hook'],
  ])('refuses %s when private addresses are not allowed', async (_what, url) => {
    const outcome = await request({ url, allowPrivate: false });

    expect(outcome).toMatchObject({ outcome: 'unsafe', error: expect.any(String) });
    expect(received).toHaveLength(0);
  });

  it('never follows a redirect to a private address, with the guard on', async () => {
    // A public name the guard passed (pinned to this machine, as above)
    // answers with a redirect to the metadata address: the 302 is the answer.
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data');
      res.end();
    };
    const url = `http://redirect-check.invalid:${port}/start`;
    seo.assertSafeUrl.mockResolvedValueOnce({
      ok: true,
      url: new URL(url),
      addresses: ['127.0.0.1'],
    });

    const outcome = await request({ url, allowPrivate: false });

    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 302 });
    expect(received.map((r) => r.url)).toEqual(['/start']);
    expect(seo.assertSafeUrl).toHaveBeenLastCalledWith(url, expect.anything());
  });

  it('with private addresses allowed, still refuses a non-http scheme or a bad link', async () => {
    expect((await request({ url: 'ftp://127.0.0.1/x' })).outcome).toBe('unsafe');
    expect((await request({ url: 'not a link' })).outcome).toBe('unsafe');
  });

  it('connects to the address the guard checked, never resolving the name again', async () => {
    // The guard "validated" a name the OS cannot resolve (.invalid is
    // reserved) to this machine. Only the pinned lookup can get it here.
    const url = `http://pinned-check.invalid:${port}/pinned`;
    seo.assertSafeUrl.mockResolvedValueOnce({
      ok: true,
      url: new URL(url),
      addresses: ['127.0.0.1'],
    });

    const outcome = await request({ url, allowPrivate: false });

    expect(outcome).toMatchObject({ outcome: 'ok', statusCode: 200 });
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/pinned');
    // The Host header still names the real host, as TLS and virtual hosts need.
    expect(received[0].headers.host).toBe(`pinned-check.invalid:${port}`);
  });
});
