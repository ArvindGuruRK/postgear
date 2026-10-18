/**
 * A tiny `node:http` server for the crawler tests, bound to 127.0.0.1.
 *
 * The guard refuses 127.0.0.1 whatever a resolver says (that is its job and
 * the tests in `url-guard.test.ts` insist on it), so an offline crawl needs
 * one explicit, narrow exception: the host name `test.example` is treated
 * as public while still connecting to the loopback server. Test files opt
 * in with `jest.mock('./url-guard', guardMockFactory)` (hoisted by Jest), and
 * `guardMockFactory` wraps the **real** `assertSafeUrl`: every other URL
 * (`localhost`, `169.254.169.254`, a redirect to a private host) still gets
 * the production verdict. Nothing in the engine itself is bypassed, and the
 * port the server picked is allowed through the public `allowPorts` option.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UrlGuardOptions, UrlSafetyResult } from '../types';

/** The one host name the mocked guard treats as public. */
export const TEST_HOST = 'test.example';

/**
 * `jest.mock('./url-guard', guardMockFactory)`: keeps everything real except
 * that `test.example` (resolved to loopback by the injected resolver) passes.
 */
export function guardMockFactory(): Record<string, unknown> {
  const actual = jest.requireActual<typeof import('./url-guard')>('./url-guard');
  return {
    ...actual,
    assertSafeUrl: async (input: string, options?: UrlGuardOptions): Promise<UrlSafetyResult> => {
      const result = await actual.assertSafeUrl(input, options);
      if (result.ok || result.reason !== 'private_address') return result;
      let url: URL;
      try {
        url = new URL(actual.normaliseUrl(input));
      } catch {
        return result;
      }
      if (url.hostname !== TEST_HOST) return result;
      const allowed = options?.allowPorts ?? [];
      if (url.port !== '' && !allowed.includes(Number(url.port))) return result;
      return { ok: true, url, addresses: ['127.0.0.1'] };
    },
  };
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
  port: number;
  /** `http://test.example:PORT`: resolved to loopback by the injected resolver. */
  origin: string;
  guard: UrlGuardOptions;
  routes: Map<string, RouteHandler>;
  requests: Array<{ method: string; url: string }>;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const routes = new Map<string, RouteHandler>();
  const requests: TestServer['requests'] = [];

  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '' });
    const path = (req.url ?? '/').split('?')[0];
    const handler = routes.get(path);
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>missing</body></html>');
      return;
    }
    handler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    origin: `http://${TEST_HOST}:${port}`,
    guard: {
      resolve: async (host) => {
        if (host === TEST_HOST) return ['127.0.0.1'];
        if (host === 'public.example') return ['93.184.216.34'];
        throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
      },
      allowPorts: [port],
    },
    routes,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function html(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
}

export function serveHtml(markup: string, status = 200, headers: Record<string, string> = {}) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(markup);
  };
}
