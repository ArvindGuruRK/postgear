/**
 * The real-Chromium crawl, opt-in: `SEO_BROWSER_TESTS=true npx jest crawler.browser`.
 *
 * Launches Playwright's Chromium against the local test server and exercises
 * the rendered-DOM path, the route hook (images skipped, same-site fetches
 * allowed) and the HTML fallback after a browser timeout. Chromium resolves
 * names itself, so `--host-resolver-rules` maps `test.example` to loopback
 * for the browser the way the injected resolver does for the guard. Skipped
 * by default so the unit run stays hermetic.
 */
import { createBrowserPool } from './browser.pool';
import { createSeoCrawler } from './crawler';
import { html, serveHtml, startTestServer, TEST_HOST, type TestServer } from './test-server';

jest.mock('./url-guard', () =>
  jest.requireActual<typeof import('./test-server')>('./test-server').guardMockFactory(),
);

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

const LAUNCH_ARGS = [`--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`];

describeBrowser('crawler with real Chromium', () => {
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

  it('renders scripts, skips images, allows same-site fetches and probes links', async () => {
    server.routes.set(
      '/',
      serveHtml(
        html(
          `<h1 id="h">Static</h1><img src="/pic.png" alt="x"><a href="/about">About</a>
           <script>
             document.getElementById('h').textContent = 'Rendered by script';
             fetch('http://169.254.169.254/latest/meta-data').catch(() => {});
             fetch('/api').catch(() => {});
           </script>`,
          '<title>Browser test page title</title>',
        ),
      ),
    );
    server.routes.set('/about', serveHtml(html('<h1>About</h1>')));
    server.routes.set('/pic.png', (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end();
    });
    server.routes.set('/api', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });

    const pool = createBrowserPool({
      guard: server.guard,
      launchTimeoutMs: 60_000,
      launchArgs: LAUNCH_ARGS,
    });
    expect(await pool.available()).toBe(true);
    const crawler = createSeoCrawler({
      browser: 'on',
      guard: server.guard,
      pool,
      timeoutMs: 30_000,
    });
    try {
      const result = await crawler.crawl(`${server.origin}/`);
      expect(result.mode).toBe('browser');
      expect(result.statusCode).toBe(200);
      expect(result.page.title).toBe('Browser test page title');
      expect(result.page.headings).toEqual([{ level: 1, text: 'Rendered by script' }]);
      expect(result.responseTimeMs).toBeGreaterThan(0);
      expect(result.links).toEqual({ checked: 1, broken: 0, sample: [] });
      const paths = server.requests.map((r) => r.url);
      expect(paths).toContain('/api');
      expect(paths).not.toContain('/pic.png');
    } finally {
      await crawler.close();
    }
  }, 90_000);

  it('falls back to HTML when the browser navigation times out', async () => {
    // The first request (the browser's) hangs; the fallback's answers at once.
    let first = true;
    server.routes.set('/slow', (req, res) => {
      if (first) {
        first = false;
        return;
      }
      serveHtml(html('<h1>Slow</h1>'))(req, res);
    });
    const warn = jest.fn();
    const pool = createBrowserPool({
      guard: server.guard,
      launchTimeoutMs: 60_000,
      launchArgs: LAUNCH_ARGS,
    });
    const crawler = createSeoCrawler({
      guard: server.guard,
      pool,
      timeoutMs: 8_000,
      logger: { warn },
    });
    try {
      const result = await crawler.crawl(`${server.origin}/slow`);
      expect(result.mode).toBe('html');
      expect(result.statusCode).toBe(200);
      expect(result.page.headings).toEqual([{ level: 1, text: 'Slow' }]);
      expect(warn).toHaveBeenCalledWith(
        'seo.crawl.browser_fallback',
        expect.objectContaining({ kind: 'timeout' }),
      );
    } finally {
      await crawler.close();
    }
  }, 90_000);
});
