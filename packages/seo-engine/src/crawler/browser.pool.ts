/**
 * A small pool of headless-browser pages, and the second SSRF line for the
 * browser path.
 *
 * One Chromium is launched lazily on the first `acquire()` and shared; the
 * pool hands out at most `maxPages` pages at a time (an async semaphore), each
 * in its own context so pages share no cookies or storage. A browser that
 * crashes is simply relaunched on the next `acquire()`.
 *
 * Why the route hook matters more than the pooling: the guard in
 * `url-guard.ts` validates the URL the crawl starts from, but a page then
 * loads scripts, frames and XHRs, and follows redirects, each to a URL nobody
 * validated — and the browser resolves DNS itself, so the pinned-address
 * trick the HTML path uses is not available. So every context routes
 * `**\/*` through a hook that re-runs the guard on each request URL (cached
 * per host for the page's lifetime) and aborts anything private. Images,
 * fonts, media and the like are aborted too, for speed; the markup is what
 * the analyzer needs. Service workers are blocked because they can answer
 * requests without the route ever seeing them.
 *
 * `playwright` is imported lazily, inside the launch, so the package (and
 * every test that mocks the pool) loads without a browser installed;
 * `available()` is how the crawler and the API's `/seo/status` find out.
 */
import type { Browser, BrowserContext, Page, Route } from 'playwright';
import type { UrlGuardOptions } from '../types';
import { assertSafeUrl } from './url-guard';

export interface BrowserPoolLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface BrowserPoolOptions {
  /** Pages handed out at once. Default 2. */
  maxPages?: number;
  userAgent?: string;
  /** Ceiling for the Chromium launch. Default 20 s. */
  launchTimeoutMs?: number;
  /**
   * Extra Chromium switches. The crawler never sets any; the browser test
   * uses `--host-resolver-rules` to point a public-looking name at loopback.
   */
  launchArgs?: string[];
  /** Passed to the guard on every request the page makes. */
  guard?: UrlGuardOptions;
  logger?: BrowserPoolLogger;
}

export interface PooledPage {
  page: Page;
  /** URLs the route hook refused as private, in order — diagnostics for the crawler. */
  refused: string[];
  release(): Promise<void>;
}

export interface BrowserPool {
  acquire(options?: { signal?: AbortSignal }): Promise<PooledPage>;
  release(lease: PooledPage): Promise<void>;
  /** Probes a launch once and caches the answer. */
  available(): Promise<boolean>;
  close(): Promise<void>;
}

export const DEFAULT_MAX_PAGES = 2;
export const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;

/** Resource types a page can skip without changing what the markup says. */
const SKIPPED_RESOURCE_TYPES = new Set([
  'image',
  'media',
  'font',
  'websocket',
  'manifest',
  'texttrack',
  'eventsource',
  'ping',
]);

type Playwright = typeof import('playwright');

class AbortedError extends Error {
  constructor() {
    super('The wait for a browser page was cancelled.');
    this.name = 'AbortError';
  }
}

/** A counting semaphore whose waiters can be cancelled by a signal. */
class Semaphore {
  private readonly waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private free: number;

  constructor(private readonly size: number) {
    this.free = size;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new AbortedError();
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new AbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push({
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      });
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.free = Math.min(this.size, this.free + 1);
  }
}

export function createBrowserPool(options: BrowserPoolOptions = {}): BrowserPool {
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const semaphore = new Semaphore(maxPages);
  const logger = options.logger;

  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  let availability: boolean | null = null;
  let closed = false;

  async function launch(): Promise<Browser> {
    const playwright: Playwright = await import('playwright');
    const args = [
      ...(process.env.SEO_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      ...(options.launchArgs ?? []),
    ];
    const instance = await playwright.chromium.launch({
      headless: true,
      timeout: launchTimeoutMs,
      args,
    });
    instance.on('disconnected', () => {
      // A crash or an external kill: forget it, the next acquire relaunches.
      if (browser === instance) browser = null;
    });
    return instance;
  }

  async function getBrowser(): Promise<Browser> {
    if (closed) throw new Error('The browser pool is closed.');
    if (browser?.isConnected()) return browser;
    if (!launching) {
      launching = launch()
        .then((instance) => {
          browser = instance;
          return instance;
        })
        .finally(() => {
          launching = null;
        });
    }
    return launching;
  }

  /** The guard, applied to every request a page makes. */
  async function installGuard(context: BrowserContext, refused: string[]): Promise<void> {
    const verdicts = new Map<string, Promise<boolean>>();
    await context.route('**/*', async (route: Route) => {
      try {
        const request = route.request();
        if (SKIPPED_RESOURCE_TYPES.has(request.resourceType())) {
          await route.abort('blockedbyclient');
          return;
        }
        const url = request.url();
        if (!/^https?:/i.test(url)) {
          await route.abort('blockedbyclient');
          return;
        }
        const host = new URL(url).host;
        let verdict = verdicts.get(host);
        if (!verdict) {
          verdict = assertSafeUrl(url, options.guard).then((result) => result.ok);
          verdicts.set(host, verdict);
        }
        if (await verdict) {
          await route.continue();
        } else {
          refused.push(url);
          await route.abort('blockedbyclient');
        }
      } catch (error) {
        // The page may have gone away while the verdict was pending; nothing
        // to do, and nothing was fetched.
        logger?.warn('seo.browser.route_failed', { message: (error as Error)?.message });
      }
    });
  }

  const pool: BrowserPool = {
    async acquire(acquireOptions = {}) {
      await semaphore.acquire(acquireOptions.signal);
      let context: BrowserContext | null = null;
      try {
        const instance = await getBrowser();
        context = await instance.newContext({
          userAgent: options.userAgent,
          serviceWorkers: 'block',
          ignoreHTTPSErrors: false,
          javaScriptEnabled: true,
        });
        const refused: string[] = [];
        await installGuard(context, refused);
        const page = await context.newPage();
        let released = false;
        const lease: PooledPage = {
          page,
          refused,
          release: async () => {
            if (released) return;
            released = true;
            await context?.close().catch(() => undefined);
            semaphore.release();
          },
        };
        return lease;
      } catch (error) {
        await context?.close().catch(() => undefined);
        semaphore.release();
        throw error;
      }
    },

    async release(lease) {
      await lease.release();
    },

    async available() {
      if (availability !== null) return availability;
      try {
        await getBrowser();
        availability = true;
      } catch (error) {
        availability = false;
        logger?.warn('seo.browser.unavailable', { message: (error as Error)?.message });
      }
      return availability;
    },

    async close() {
      closed = true;
      const pending = launching;
      launching = null;
      const instance = browser ?? (pending ? await pending.catch(() => null) : null);
      browser = null;
      if (instance) await instance.close().catch(() => undefined);
    },
  };

  return pool;
}
