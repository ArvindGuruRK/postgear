import { gzipSync } from 'node:zlib';
import { SeoCrawlError } from '../types';
import { classifyFetchError, fetchUrlSafely, headUrlSafely, isHtmlContentType } from './safe-fetch';
import { html, serveHtml, startTestServer, type TestServer } from './test-server';

jest.mock('./url-guard', () =>
  jest.requireActual<typeof import('./test-server')>('./test-server').guardMockFactory(),
);

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.routes.clear();
  server.requests.length = 0;
});

async function failure(promise: Promise<unknown>): Promise<SeoCrawlError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SeoCrawlError) return error;
    throw error;
  }
  throw new Error('expected the fetch to fail');
}

describe('fetchUrlSafely', () => {
  it('fetches a page through the injected resolver and reports timing', async () => {
    server.routes.set('/', serveHtml(html('<h1>Hello</h1>')));
    const response = await fetchUrlSafely(`${server.origin}/`, { guard: server.guard });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Hello</h1>');
    expect(response.finalUrl).toBe(`${server.origin}/`);
    expect(response.https).toBe(false);
    expect(response.certificateValid).toBeNull();
    expect(response.compressed).toBe(false);
    expect(response.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(response.addresses).toEqual(['127.0.0.1']);
    expect(server.requests[0]).toMatchObject({ method: 'GET', url: '/' });
  });

  it('sends the Host header for the name, not the pinned address', async () => {
    let host = '';
    server.routes.set('/', (req, res) => {
      host = req.headers.host ?? '';
      serveHtml(html(''))(req, res);
    });
    await fetchUrlSafely(`${server.origin}/`, { guard: server.guard });
    expect(host).toBe(`test.example:${server.port}`);
  });

  it('follows a 301 to a 200 and records the hop', async () => {
    server.routes.set('/old', (_req, res) => {
      res.writeHead(301, { location: '/new' });
      res.end();
    });
    server.routes.set('/new', serveHtml(html('<p>new</p>')));
    const response = await fetchUrlSafely(`${server.origin}/old`, { guard: server.guard });
    expect(response.statusCode).toBe(200);
    expect(response.finalUrl).toBe(`${server.origin}/new`);
    expect(response.redirects).toEqual([`${server.origin}/old`]);
  });

  it('refuses a redirect to a private host as unsafe_url', async () => {
    server.routes.set('/go', (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    });
    const error = await failure(fetchUrlSafely(`${server.origin}/go`, { guard: server.guard }));
    expect(error.kind).toBe('unsafe_url');
    expect(error.reason).toBe('private_address');
    expect(error.retryable).toBe(false);
    // Only the first request ever reached a server.
    expect(server.requests).toHaveLength(1);
  });

  it('refuses a redirect to localhost', async () => {
    server.routes.set('/go', (_req, res) => {
      res.writeHead(302, { location: `http://localhost:${server.port}/` });
      res.end();
    });
    const error = await failure(fetchUrlSafely(`${server.origin}/go`, { guard: server.guard }));
    expect(error.kind).toBe('unsafe_url');
    expect(error.reason).toBe('host_forbidden');
  });

  it('gives up after too many redirects', async () => {
    server.routes.set('/loop', (_req, res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    });
    const error = await failure(fetchUrlSafely(`${server.origin}/loop`, { guard: server.guard }));
    expect(error.kind).toBe('unreachable');
    expect(error.message).toMatch(/redirects/i);
    expect(server.requests).toHaveLength(6);
  });

  it('rejects a body over the cap as too_large', async () => {
    server.routes.set('/big', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('x'.repeat(5000)));
    });
    const error = await failure(
      fetchUrlSafely(`${server.origin}/big`, { guard: server.guard, maxBytes: 1024 }),
    );
    expect(error.kind).toBe('too_large');
    expect(error.message).not.toContain('xxxx');
  });

  it('rejects a declared content-length over the cap before reading', async () => {
    server.routes.set('/declared', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': '999999' });
      res.write('<html>');
    });
    const error = await failure(
      fetchUrlSafely(`${server.origin}/declared`, { guard: server.guard, maxBytes: 1024 }),
    );
    expect(error.kind).toBe('too_large');
  });

  it('rejects a non-HTML content type', async () => {
    server.routes.set('/data.json', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"secret":"do-not-echo"}');
    });
    const error = await failure(
      fetchUrlSafely(`${server.origin}/data.json`, { guard: server.guard }),
    );
    expect(error.kind).toBe('not_html');
    expect(error.message).not.toContain('do-not-echo');
  });

  it('allows non-HTML when told to (robots.txt)', async () => {
    server.routes.set('/robots.txt', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private');
    });
    const response = await fetchUrlSafely(`${server.origin}/robots.txt`, {
      guard: server.guard,
      requireHtml: false,
    });
    expect(response.body).toContain('Disallow: /private');
  });

  it('maps a 404 to bad_status (not retryable) and a 503 to retryable', async () => {
    server.routes.set('/gone', serveHtml(html('<p>secret body</p>'), 404));
    server.routes.set('/down', serveHtml(html(''), 503));
    const notFound = await failure(
      fetchUrlSafely(`${server.origin}/gone`, { guard: server.guard }),
    );
    expect(notFound.kind).toBe('bad_status');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.retryable).toBe(false);
    expect(notFound.message).not.toContain('secret body');
    const down = await failure(fetchUrlSafely(`${server.origin}/down`, { guard: server.guard }));
    expect(down.retryable).toBe(true);
  });

  it('times out a slow server with a retryable timeout', async () => {
    server.routes.set('/slow', (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html(''));
      }, 2000).unref();
    });
    const started = Date.now();
    const error = await failure(
      fetchUrlSafely(`${server.origin}/slow`, { guard: server.guard, timeoutMs: 200 }),
    );
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('honours an aborted deadline signal with the signal reason', async () => {
    server.routes.set('/slow', (_req, res) => {
      setTimeout(() => res.end(html('')), 2000).unref();
    });
    const controller = new AbortController();
    const deadline = new SeoCrawlError('timeout', 'The crawl did not finish.', true);
    setTimeout(() => controller.abort(deadline), 50);
    const error = await failure(
      fetchUrlSafely(`${server.origin}/slow`, { guard: server.guard, signal: controller.signal }),
    );
    expect(error).toBe(deadline);
  });

  it('decodes a gzip body and reports compression', async () => {
    server.routes.set('/gz', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync(Buffer.from(html('<h1>zipped</h1>'))));
    });
    const response = await fetchUrlSafely(`${server.origin}/gz`, { guard: server.guard });
    expect(response.compressed).toBe(true);
    expect(response.body).toContain('<h1>zipped</h1>');
  });

  it('refuses the URL itself when the guard says so', async () => {
    const error = await failure(fetchUrlSafely('http://127.0.0.1/', { guard: server.guard }));
    expect(error.kind).toBe('unsafe_url');
    const unresolvable = await failure(
      fetchUrlSafely('http://nowhere.example/', { guard: server.guard }),
    );
    expect(unresolvable.reason).toBe('unresolvable');
  });

  it('reports a refused connection as retryable unreachable', async () => {
    const closed = await startTestServer();
    const origin = closed.origin;
    const guard = closed.guard;
    await closed.close();
    const error = await failure(fetchUrlSafely(`${origin}/`, { guard }));
    expect(error.kind).toBe('unreachable');
    expect(error.retryable).toBe(true);
  });
});

describe('headUrlSafely', () => {
  it('uses HEAD when the server supports it', async () => {
    server.routes.set('/page', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.method === 'HEAD' ? undefined : html(''));
    });
    const probe = await headUrlSafely(`${server.origin}/page`, { guard: server.guard });
    expect(probe.statusCode).toBe(200);
    expect(server.requests).toEqual([{ method: 'HEAD', url: '/page' }]);
  });

  it('falls back to a ranged GET when HEAD is refused', async () => {
    server.routes.set('/nohead', (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html(''));
    });
    const probe = await headUrlSafely(`${server.origin}/nohead`, { guard: server.guard });
    expect(probe.statusCode).toBe(200);
    expect(server.requests.map((r) => r.method)).toEqual(['HEAD', 'GET']);
  });

  it('returns a 404 as a result, not an error', async () => {
    const probe = await headUrlSafely(`${server.origin}/missing`, { guard: server.guard });
    expect(probe.statusCode).toBe(404);
  });
});

describe('classifyFetchError', () => {
  it('maps socket codes to kinds and retryability', () => {
    expect(classifyFetchError({ code: 'ENOTFOUND' }, 'h')).toMatchObject({
      kind: 'unreachable',
      retryable: true,
    });
    expect(classifyFetchError({ code: 'ECONNREFUSED' }, 'h').retryable).toBe(true);
    expect(classifyFetchError({ code: 'ECONNRESET' }, 'h').retryable).toBe(true);
    expect(classifyFetchError({ code: 'ETIMEDOUT' }, 'h').kind).toBe('timeout');
    expect(classifyFetchError({ code: 'EPROTO' }, 'h').retryable).toBe(false);
    expect(classifyFetchError(new Error('body: <html>secret</html>'), 'h').message).not.toContain(
      'secret',
    );
  });

  it('passes a SeoCrawlError through', () => {
    const error = new SeoCrawlError('too_large', 'big', false);
    expect(classifyFetchError(error, 'h')).toBe(error);
  });
});

describe('isHtmlContentType', () => {
  it('accepts html and xhtml with parameters only', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('application/json')).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});
