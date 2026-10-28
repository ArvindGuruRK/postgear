import { type CrawlStage, SeoCrawlError } from '../types';
import type { BrowserPool, PooledPage } from './browser.pool';
import { crawlStageLabels, createSeoCrawler, FALLBACK_MIN_REMAINING_MS } from './crawler';
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

type StageEvent = { stage: CrawlStage; status: string; detail?: string };

function recordStages(): {
  events: StageEvent[];
  onStage: (s: CrawlStage, st: string, d?: string) => void;
} {
  const events: StageEvent[] = [];
  return {
    events,
    onStage: (stage, status, detail) => {
      events.push(detail === undefined ? { stage, status } : { stage, status, detail });
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<SeoCrawlError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SeoCrawlError) return error;
    throw error;
  }
  throw new Error('expected the crawl to fail');
}

function siteFixture(): void {
  server.routes.set(
    '/',
    serveHtml(
      html(
        `<h1>Home</h1><p>Welcome to the test site, where every link is checked.</p>
         <a href="/about">About</a> <a href="/missing">Missing</a> <a href="/contact">Contact</a>
         <a href="https://public.example/x">Out</a> <a href="/">Self</a>`,
        '<title>Test site home page title</title><meta name="description" content="A page">',
      ),
    ),
  );
  server.routes.set('/about', serveHtml(html('<h1>About</h1>')));
  server.routes.set('/contact', serveHtml(html('<h1>Contact</h1>')));
  server.routes.set('/robots.txt', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /private\nSitemap: http://test.example/sitemap.xml\n');
  });
}

/** A pool whose page is scripted; nothing is launched. */
function mockPool(options: {
  available?: boolean;
  goto?: () => Promise<unknown>;
  acquireError?: Error;
  html?: string;
}): BrowserPool & { leases: number; released: number } {
  const pool = {
    leases: 0,
    released: 0,
    async available() {
      return options.available ?? true;
    },
    async acquire(): Promise<PooledPage> {
      if (options.acquireError) throw options.acquireError;
      pool.leases += 1;
      const response = {
        status: () => 200,
        headers: () => ({ 'content-type': 'text/html', 'content-encoding': 'gzip' }),
        url: () => `${server.origin}/`,
        securityDetails: async () => null,
        request: () => ({
          redirectedFrom: () => null,
          timing: () => ({ responseEnd: 123 }),
        }),
      };
      const page = {
        goto: options.goto ?? (async () => response),
        waitForLoadState: async () => undefined,
        content: async () => options.html ?? html('<h1>Rendered</h1><p>From the browser.</p>'),
        url: () => `${server.origin}/`,
      };
      return {
        page: page as unknown as PooledPage['page'],
        refused: [],
        release: async () => {
          pool.released += 1;
        },
      };
    },
    async release(lease: PooledPage) {
      await lease.release();
    },
    // The crawler never renders; the pool's render path is the design
    // exporter's (Sprint 9), and a fake that silently returned bytes here
    // would hide a crawler that started using it by mistake.
    async render() {
      throw new Error('The crawler does not render.');
    },
    // Nor prints: that is the Studio's PDF download (Sprint 9b).
    async printImages() {
      throw new Error('The crawler does not print.');
    },
    async close() {},
  };
  return pool;
}

describe('createSeoCrawler (HTML path)', () => {
  it('crawls a site end to end and reports every stage', async () => {
    siteFixture();
    const { events, onStage } = recordStages();
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard, timeoutMs: 10_000 });
    const result = await crawler.crawl(`${server.origin}/`, { onStage });
    await crawler.close();

    expect(result.mode).toBe('html');
    expect(result.statusCode).toBe(200);
    expect(result.requestedUrl).toBe(`${server.origin}/`);
    expect(result.finalUrl).toBe(`${server.origin}/`);
    expect(result.https).toBe(false);
    expect(result.certificateValid).toBeNull();
    expect(result.redirects).toEqual([]);
    expect(result.compressed).toBe(false);
    expect(result.contentType).toMatch(/^text\/html/);
    expect(result.htmlBytes).toBeGreaterThan(100);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.fetchedAt)).not.toBeNaN();
    expect(result.page.title).toBe('Test site home page title');
    expect(result.page.headings).toEqual([{ level: 1, text: 'Home' }]);
    expect(result.page.links.internal).toHaveLength(4);
    expect(result.page.links.external).toEqual(['https://public.example/x']);
    expect(result.robotsTxt).toBe('present');
    expect(result.sitemap).toBe('present');
    expect(result.links).toEqual({ checked: 3, broken: 1, sample: [`${server.origin}/missing`] });

    expect(events).toEqual([
      { stage: 'fetch', status: 'started' },
      { stage: 'fetch', status: 'done', detail: 'html' },
      { stage: 'robots', status: 'started' },
      { stage: 'robots', status: 'done', detail: 'present' },
      { stage: 'sitemap', status: 'started' },
      { stage: 'sitemap', status: 'done', detail: 'present' },
      { stage: 'links', status: 'started' },
      { stage: 'links', status: 'done', detail: '1 of 3 broken' },
    ]);
    // The self link and the external link were never probed.
    const probed = server.requests.filter((r) => r.method === 'HEAD').map((r) => r.url);
    expect(probed.sort()).toEqual(['/about', '/contact', '/missing']);
  });

  it('reports a blocked path, a missing sitemap and skipped link checks', async () => {
    server.routes.set('/private/page', serveHtml(html('<h1>P</h1>')));
    server.routes.set('/robots.txt', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\n');
    });
    const { events, onStage } = recordStages();
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard, maxLinkChecks: 0 });
    const result = await crawler.crawl(`${server.origin}/private/page`, { onStage });
    expect(result.robotsTxt).toBe('blocked');
    expect(result.sitemap).toBe('missing');
    expect(events).toContainEqual({
      stage: 'links',
      status: 'skipped',
      detail: 'Link checks are disabled',
    });
  });

  it('treats a missing robots.txt as missing and an HTML one as missing too', async () => {
    server.routes.set('/', serveHtml(html('<h1>x</h1>')));
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard });
    expect((await crawler.crawl(`${server.origin}/`)).robotsTxt).toBe('missing');
    server.routes.set('/robots.txt', serveHtml(html('<h1>not robots</h1>')));
    expect((await crawler.crawl(`${server.origin}/`)).robotsTxt).toBe('missing');
  });

  it('refuses an unsafe URL before fetching anything, with a reason', async () => {
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard });
    const localhost = await failure(crawler.crawl('http://localhost/'));
    expect(localhost.kind).toBe('unsafe_url');
    expect(localhost.reason).toBe('host_forbidden');
    const metadata = await failure(crawler.crawl('http://169.254.169.254/latest/meta-data'));
    expect(metadata.reason).toBe('private_address');
    expect(server.requests).toHaveLength(0);
  });

  it('surfaces a 404 as bad_status', async () => {
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard });
    const error = await failure(crawler.crawl(`${server.origin}/nope`));
    expect(error.kind).toBe('bad_status');
    expect(error.statusCode).toBe(404);
  });

  it('times out a hanging server within the deadline', async () => {
    server.routes.set('/hang', () => undefined);
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard, timeoutMs: 300 });
    const started = Date.now();
    const error = await failure(crawler.crawl(`${server.origin}/hang`));
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('keeps the deadline across stages: a slow robots.txt costs the links stage, not the crawl', async () => {
    siteFixture();
    server.routes.set('/robots.txt', () => undefined);
    const { events, onStage } = recordStages();
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard, timeoutMs: 1_200 });
    const result = await crawler.crawl(`${server.origin}/`, { onStage });
    expect(result.robotsTxt).toBe('unknown');
    expect(events).toContainEqual({ stage: 'robots', status: 'failed', detail: 'unknown' });
    expect(result.links.checked).toBeLessThanOrEqual(3);
  });

  it('reports a caller abort as aborted', async () => {
    server.routes.set('/hang', () => undefined);
    const controller = new AbortController();
    const crawler = createSeoCrawler({ browser: 'off', guard: server.guard });
    setTimeout(() => controller.abort(), 50);
    const error = await failure(
      crawler.crawl(`${server.origin}/hang`, { signal: controller.signal }),
    );
    expect(error.kind).toBe('aborted');
  });

  it('exposes labels for every stage', () => {
    expect(Object.keys(crawlStageLabels).sort()).toEqual(['fetch', 'links', 'robots', 'sitemap']);
  });
});

describe('createSeoCrawler (browser path, pool mocked)', () => {
  it('uses the rendered markup and the response metadata', async () => {
    siteFixture();
    const pool = mockPool({});
    const crawler = createSeoCrawler({ browser: 'auto', guard: server.guard, pool });
    const result = await crawler.crawl(`${server.origin}/`);
    expect(result.mode).toBe('browser');
    expect(result.page.headings).toEqual([{ level: 1, text: 'Rendered' }]);
    expect(result.compressed).toBe(true);
    expect(result.responseTimeMs).toBe(123);
    expect(pool.leases).toBe(1);
    expect(pool.released).toBe(1);
    expect(await crawler.browserAvailable()).toBe(true);
  });

  it('falls back to HTML when the browser fails and time remains', async () => {
    siteFixture();
    const warn = jest.fn();
    const pool = mockPool({
      goto: async () => {
        throw new Error('page.goto: net::ERR_CONNECTION_RESET');
      },
    });
    const { events, onStage } = recordStages();
    const crawler = createSeoCrawler({ guard: server.guard, pool, logger: { warn } });
    const result = await crawler.crawl(`${server.origin}/`, { onStage });
    expect(result.mode).toBe('html');
    expect(result.page.headings).toEqual([{ level: 1, text: 'Home' }]);
    expect(warn).toHaveBeenCalledWith(
      'seo.crawl.browser_fallback',
      expect.objectContaining({ kind: 'unreachable' }),
    );
    expect(events[1]).toEqual({
      stage: 'fetch',
      status: 'started',
      detail: 'Browser unavailable, fetching HTML',
    });
    expect(pool.released).toBe(1);
  });

  it('falls back when the browser launch itself fails', async () => {
    siteFixture();
    const pool = mockPool({
      acquireError: new Error('browserType.launch: Executable does not exist'),
    });
    const crawler = createSeoCrawler({ guard: server.guard, pool });
    expect((await crawler.crawl(`${server.origin}/`)).mode).toBe('html');
  });

  it('does not fall back when too little of the deadline remains', async () => {
    siteFixture();
    const pool = mockPool({
      goto: async () => {
        throw new Error('page.goto: Timeout 1000ms exceeded.');
      },
    });
    const crawler = createSeoCrawler({
      guard: server.guard,
      pool,
      timeoutMs: FALLBACK_MIN_REMAINING_MS - 1,
    });
    const error = await failure(crawler.crawl(`${server.origin}/`));
    expect(error.kind).toBe('timeout');
  });

  it('does not fall back from a 404 or a non-HTML answer', async () => {
    const pool = mockPool({
      goto: async () => ({
        status: () => 404,
        headers: () => ({ 'content-type': 'text/html' }),
        url: () => `${server.origin}/`,
        securityDetails: async () => null,
        request: () => ({ redirectedFrom: () => null, timing: () => ({ responseEnd: 1 }) }),
      }),
    });
    const crawler = createSeoCrawler({ guard: server.guard, pool });
    const error = await failure(crawler.crawl(`${server.origin}/`));
    expect(error.kind).toBe('bad_status');
    expect(server.requests).toHaveLength(0);
  });

  it('fails with browser_unavailable when browser is on and the pool has none', async () => {
    siteFixture();
    const crawler = createSeoCrawler({
      browser: 'on',
      guard: server.guard,
      pool: mockPool({ available: false }),
    });
    const error = await failure(crawler.crawl(`${server.origin}/`));
    expect(error.kind).toBe('browser_unavailable');
    expect(error.retryable).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it('uses HTML silently in auto mode when the pool has no browser', async () => {
    siteFixture();
    const crawler = createSeoCrawler({ guard: server.guard, pool: mockPool({ available: false }) });
    expect((await crawler.crawl(`${server.origin}/`)).mode).toBe('html');
    expect(await crawler.browserAvailable()).toBe(false);
  });

  it('reports a page the route hook refused as unsafe_url in on mode', async () => {
    const pool = mockPool({
      goto: async () => {
        throw new Error('page.goto: net::ERR_BLOCKED_BY_CLIENT');
      },
    });
    const original = pool.acquire.bind(pool);
    pool.acquire = async () => {
      const lease = await original();
      lease.refused.push('http://10.0.0.1/');
      return lease;
    };
    const crawler = createSeoCrawler({ browser: 'on', guard: server.guard, pool });
    const error = await failure(crawler.crawl(`${server.origin}/`));
    expect(error.kind).toBe('unsafe_url');
    expect(error.reason).toBe('private_address');
  });
});
