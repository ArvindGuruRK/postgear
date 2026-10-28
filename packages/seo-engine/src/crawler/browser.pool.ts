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
 * validated, and the browser resolves DNS itself, so the pinned-address
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
  /** URLs the route hook refused as private, in order: diagnostics for the crawler. */
  refused: string[];
  release(): Promise<void>;
}

export interface RenderOptions {
  /** A complete, self-contained document. Nothing in it may need the network. */
  html: string;
  width: number;
  height: number;
  type: 'jpeg' | 'png';
  /** JPEG only, 0-100. */
  quality?: number;
  /**
   * A browser-side expression the render waits to become truthy before the
   * shot, asked from outside the page every 20 ms (`waitUntilTrue` says
   * why). The design exporter waits for its text fitter with it.
   */
  waitForFunction?: string;
  /**
   * A browser-side expression evaluated after the wait and before the shot.
   * Its value (anything JSON can carry) comes back as `value`: the exporter
   * reads which slots still overflow this way.
   */
  collect?: string;
  /** Each step (load, wait, shot) gets this long. Default 20 s. */
  timeoutMs?: number;
  /** Aborting closes the page at once, whichever step it is in. */
  signal?: AbortSignal;
}

export interface RenderResult {
  image: Buffer;
  /** What `collect` evaluated to; undefined without one. */
  value: unknown;
}

export interface BrowserPool {
  acquire(options?: { signal?: AbortSignal }): Promise<PooledPage>;
  release(lease: PooledPage): Promise<void>;
  /** Probes a launch once and caches the answer. */
  available(): Promise<boolean>;
  /**
   * Paints a self-contained HTML document and screenshots it at an exact size.
   *
   * Sprint 9's design export (`apps/api/src/modules/studio/design-exporter.ts`)
   * is the caller. It is here, on the pool the SEO crawler already runs,
   * rather than in a second Chromium of its own: one browser process, one
   * place that knows how to launch it, and one answer to `available()`.
   *
   * The render context is stricter than a crawl's, not looser. Every network
   * request is aborted, whatever its host, because the page is handed its
   * fonts and pictures as `data:` URIs and has no legitimate reason to fetch
   * anything; that makes a user's picture incapable of making this browser
   * reach anywhere at all. JavaScript stays on for the one inline script the
   * exporter ships, the shared text fitter.
   */
  render(options: RenderOptions): Promise<RenderResult>;
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
  constructor(message = 'The wait for a browser page was cancelled.') {
    super(message);
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
      // The object queued is the one the abort handler looks for: a waiter
      // that was cancelled has to leave the queue, or the next release would
      // hand its slot to a promise nobody is waiting on and the slot is lost.
      const waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new AbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
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

/** How often a render asks its page whether it is ready (`waitForFunction`). */
const READY_POLL_MS = 20;

/** Named like Playwright's own, so a caller that tells a timeout apart still does. */
class ReadyTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timeout ${timeoutMs}ms exceeded waiting for the page to be ready.`);
    this.name = 'TimeoutError';
  }
}

/**
 * Waits until `expression` is truthy in the page, asking from here.
 *
 * Not `page.waitForFunction`: when its first look finds the page not ready,
 * it goes on polling from inside the page and evaluates a string expression
 * afresh each time, and a page whose Content-Security-Policy leaves out
 * 'unsafe-eval' (the design export page) refuses that eval. A slide whose
 * fonts were still loading at the first look then failed its render, about
 * once in a thousand. A `page.evaluate` call runs through the DevTools
 * protocol, which the page's policy does not govern, so the page keeps its
 * policy and the wait still works.
 *
 * Each ask also races the deadline: a page stuck in a script of its own
 * never answers one.
 */
async function waitUntilTrue(page: Page, expression: string, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadyTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    while (!(await Promise.race([page.evaluate(expression), expired]))) {
      await Promise.race([
        new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_MS)),
        expired,
      ]);
    }
  } finally {
    clearTimeout(timer);
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

    async render(renderOptions) {
      const { signal } = renderOptions;
      const timeoutMs = renderOptions.timeoutMs ?? 20_000;
      const cancelled = () => new AbortedError('The render was cancelled.');

      await semaphore.acquire(signal);
      let context: BrowserContext | null = null;

      // Closing the context is what interrupts a page mid-load or mid-wait:
      // every pending call on it rejects at once, so a cancelled export does
      // not hold a browser slot until its timeouts run out.
      const onAbort = () => {
        void context?.close().catch(() => undefined);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const instance = await getBrowser();
        if (signal?.aborted) throw cancelled();

        context = await instance.newContext({
          viewport: { width: renderOptions.width, height: renderOptions.height },
          deviceScaleFactor: 1,
          serviceWorkers: 'block',
          // Nothing in an export page comes off the network, so nothing is
          // allowed to: a request here would mean a picture or a font was
          // not inlined, and a silent fallback is the one failure mode a
          // "what you edit is what you get" promise cannot survive.
          offline: true,
          javaScriptEnabled: true,
          colorScheme: 'light',
          reducedMotion: 'reduce',
        });
        // An abort that landed while the context was being made found
        // nothing to close.
        if (signal?.aborted) throw cancelled();

        await context.route('**/*', (route: Route) => {
          void route.abort('blockedbyclient').catch(() => undefined);
        });

        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.setContent(renderOptions.html, { waitUntil: 'load', timeout: timeoutMs });

        if (renderOptions.waitForFunction) {
          await waitUntilTrue(page, renderOptions.waitForFunction, timeoutMs);
        }

        const value = renderOptions.collect
          ? await page.evaluate(renderOptions.collect)
          : undefined;

        const image = await page.screenshot({
          type: renderOptions.type,
          quality: renderOptions.type === 'jpeg' ? (renderOptions.quality ?? 92) : undefined,
          clip: { x: 0, y: 0, width: renderOptions.width, height: renderOptions.height },
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
          timeout: timeoutMs,
        });

        return { image, value };
      } catch (error) {
        // The page dies with a "target closed" error when the abort closes
        // it; the caller asked for the cancel, so say that instead.
        if (signal?.aborted) throw cancelled();
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        await context?.close().catch(() => undefined);
        semaphore.release();
      }
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
