/**
 * The crawler: one URL in, one {@link CrawlResult} out, inside one deadline.
 *
 * ## One ceiling
 *
 * `timeoutMs` (default 30 s, the sprint's "a score within ~30 seconds") is a
 * single `AbortController` armed once at the start. Every sub-step (the
 * browser navigation, the HTML fetch, robots.txt, the sitemap probe, each
 * link check) is handed the remaining time, never its own fresh budget, so
 * a site that is slow at every step still cannot push a crawl past the
 * ceiling. The caller's own `signal` is linked in and reported as `aborted`.
 *
 * ## Browser first, HTML second
 *
 * The page is rendered in headless Chromium when one is available
 * (`browser: 'auto'`), because the markup after scripts ran is what search
 * engines index for most sites today. When the browser cannot launch, times
 * out, or the request says `off`, the plain HTML path (`safe-fetch.ts`) is
 * used instead and the result says `mode: 'html'` so the UI can explain the
 * difference. The fallback is taken only while at least five seconds remain
 * (less than that is a second failure waiting to happen) and never for
 * failures the HTML path would reproduce (a 404, a non-HTML answer, a URL the
 * guard refused). `browser: 'on'` is for callers that would rather fail than
 * score un-rendered markup.
 *
 * ## Best effort around the page
 *
 * robots.txt, the sitemap and the link checks describe the site, not the
 * page; a failure in any of them (the deadline running out included, once
 * the page itself is in hand) is reported as `unknown` (or a skipped
 * stage) and never fails the crawl. Every error that does escape is a
 * {@link SeoCrawlError}: a bare error here would reach the API's stream as
 * "unexpected", which tells the user nothing.
 */
import type { Response as PlaywrightResponse } from 'playwright';
import {
  type CrawlMode,
  type CrawlOptions,
  type CrawlResult,
  type CrawlStage,
  type LinkCheckResult,
  type ParsedPage,
  type RobotsTxtState,
  SeoCrawlError,
  type SeoCrawler,
  type SitemapState,
  type UrlGuardOptions,
} from '../types';
import { type BrowserPool, createBrowserPool, type PooledPage } from './browser.pool';
import { parseHtml } from './html.parser';
import { isPathBlocked, parseRobotsTxt } from './robots';
import {
  badStatusError,
  DEFAULT_MAX_HTML_BYTES,
  DEFAULT_USER_AGENT,
  fetchUrlSafely,
  headUrlSafely,
  isHtmlContentType,
} from './safe-fetch';
import { assertSafeUrl, bareHostname } from './url-guard';

export const DEFAULT_CRAWL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_LINK_CHECKS = 20;
/** Below this much remaining time the HTML fallback is not attempted. */
export const FALLBACK_MIN_REMAINING_MS = 5_000;
/** What an `auto` navigation leaves untouched: the fallback's minimum plus the browser's teardown. */
export const FALLBACK_RESERVE_MS = FALLBACK_MIN_REMAINING_MS + 1_000;
/** How long the browser path waits for the network to go quiet after DOM ready. */
export const NETWORK_IDLE_GRACE_MS = 1_500;
export const PROBE_TIMEOUT_MS = 5_000;
export const LINK_CHECK_CONCURRENCY = 5;
export const ROBOTS_MAX_BYTES = 64 * 1024;

export const crawlStageLabels: Readonly<Record<CrawlStage, string>> = Object.freeze({
  fetch: 'Fetching the page',
  robots: 'Reading robots.txt',
  sitemap: 'Looking for a sitemap',
  links: 'Checking links',
});

export interface SeoCrawlerLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface SeoCrawlerOptions {
  browser?: 'auto' | 'on' | 'off';
  userAgent?: string;
  timeoutMs?: number;
  maxLinkChecks?: number;
  maxHtmlBytes?: number;
  /** Browser pages open at once. Default 2. */
  maxPages?: number;
  logger?: SeoCrawlerLogger;
  /** Resolver and port allowances for every guard check. Injected by tests. */
  guard?: UrlGuardOptions;
  /** A pool to use instead of launching Chromium. Injected by tests. */
  pool?: BrowserPool;
}

// ---------------------------------------------------------------------------
// The deadline
// ---------------------------------------------------------------------------

interface Deadline {
  signal: AbortSignal;
  remaining(): number;
  dispose(): void;
}

function createDeadline(timeoutMs: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  const endsAt = Date.now() + timeoutMs;
  const timer = setTimeout(
    () =>
      controller.abort(
        new SeoCrawlError('timeout', `The crawl did not finish within ${timeoutMs} ms.`, true),
      ),
    timeoutMs,
  );
  const onParentAbort = () =>
    controller.abort(
      new SeoCrawlError('aborted', 'The crawl was cancelled.', false, { cause: parent?.reason }),
    );
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });

  return {
    signal: controller.signal,
    remaining: () => Math.max(0, endsAt - Date.now()),
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

function throwIfExpired(deadline: Deadline): void {
  if (deadline.signal.aborted) {
    const reason = deadline.signal.reason;
    throw reason instanceof SeoCrawlError
      ? reason
      : new SeoCrawlError('aborted', 'The crawl was cancelled.', false, { cause: reason });
  }
}

/**
 * Once the page is in hand only a caller's cancel ends the crawl; the
 * deadline running out during a site check degrades that check to `unknown`.
 */
function throwIfCancelled(deadline: Deadline): void {
  const reason = deadline.signal.reason;
  if (deadline.signal.aborted && reason instanceof SeoCrawlError && reason.kind === 'aborted') {
    throw reason;
  }
}

/** Whatever escaped becomes a `SeoCrawlError`; the deadline's verdict wins. */
function toCrawlError(error: unknown, deadline: Deadline): SeoCrawlError {
  if (deadline.signal.aborted && deadline.signal.reason instanceof SeoCrawlError) {
    return deadline.signal.reason;
  }
  if (error instanceof SeoCrawlError) return error;
  return new SeoCrawlError('unreachable', 'The crawl failed unexpectedly.', false, {
    cause: error,
  });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface FetchedPage {
  mode: CrawlMode;
  finalUrl: string;
  statusCode: number;
  html: string;
  htmlBytes: number;
  responseTimeMs: number;
  certificateValid: boolean | null;
  redirects: string[];
  compressed: boolean;
  contentType: string | null;
}

/** The kinds a browser failure may fall back from; the rest would recur over HTML. */
const FALLBACK_KINDS = new Set(['browser_unavailable', 'unreachable', 'timeout']);

/**
 * Maps a Playwright navigation failure. Chromium's `net::ERR_*` codes are the
 * only part of its message that is kept; the rest (the URL, a call log) is
 * noise the user has no use for.
 */
function classifyBrowserError(
  error: unknown,
  host: string,
  lease: PooledPage | null,
): SeoCrawlError {
  if (error instanceof SeoCrawlError) return error;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = /net::(ERR_[A-Z_]+)/.exec(message)?.[1] ?? '';
  if (/timeout/i.test(message) && !code) {
    return new SeoCrawlError('timeout', `${host} took too long to render.`, true, { cause: error });
  }
  if (code === 'ERR_BLOCKED_BY_CLIENT' && lease && lease.refused.length > 0) {
    return new SeoCrawlError(
      'unsafe_url',
      'The page redirected to a private or reserved address.',
      false,
      { cause: error, reason: 'private_address' },
    );
  }
  const transient =
    code === 'ERR_NAME_NOT_RESOLVED' ||
    code === 'ERR_CONNECTION_REFUSED' ||
    code === 'ERR_CONNECTION_RESET' ||
    code === 'ERR_CONNECTION_TIMED_OUT' ||
    code === 'ERR_TIMED_OUT';
  if (code === 'ERR_CONNECTION_TIMED_OUT' || code === 'ERR_TIMED_OUT') {
    return new SeoCrawlError('timeout', `${host} took too long to respond.`, true, {
      cause: error,
    });
  }
  const label = code ? ` (${code})` : '';
  return new SeoCrawlError(
    'unreachable',
    `The browser could not load ${host}${label}.`,
    transient,
    {
      cause: error,
    },
  );
}

function redirectChain(response: PlaywrightResponse): string[] {
  const chain: string[] = [];
  let request = response.request().redirectedFrom();
  while (request) {
    chain.unshift(request.url());
    request = request.redirectedFrom();
  }
  return chain;
}

async function fetchWithBrowser(
  pool: BrowserPool,
  url: string,
  deadline: Deadline,
  options: { reserveForFallback: boolean },
): Promise<FetchedPage> {
  const host = bareHostname(new URL(url));
  let lease: PooledPage | null = null;
  try {
    lease = await pool.acquire({ signal: deadline.signal });
    const page = lease.page;
    const started = Date.now();
    // In `auto` mode the navigation leaves the fallback its minimum, so a
    // page that never reaches DOM-ready in the browser can still be fetched
    // as HTML; in `on` mode there is no fallback to save time for.
    const budget = options.reserveForFallback
      ? deadline.remaining() - FALLBACK_RESERVE_MS
      : deadline.remaining();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(1_000, budget),
    });
    if (!response) {
      throw new SeoCrawlError('unreachable', `The browser got no response from ${host}.`, false);
    }
    const grace = Math.min(NETWORK_IDLE_GRACE_MS, deadline.remaining());
    if (grace > 0) {
      await page.waitForLoadState('networkidle', { timeout: grace }).catch(() => undefined);
    }
    throwIfExpired(deadline);

    const statusCode = response.status();
    const headers = response.headers();
    const finalUrl = response.url() || page.url();
    const finalHost = bareHostname(new URL(finalUrl));
    if (statusCode >= 400) throw badStatusError(statusCode, finalHost);
    const contentType = headers['content-type'] ?? null;
    if (!isHtmlContentType(contentType)) {
      throw new SeoCrawlError('not_html', `${finalHost} did not return an HTML page.`, false, {
        statusCode,
      });
    }

    const html = await page.content();
    const https = finalUrl.startsWith('https:');
    let certificateValid: boolean | null = null;
    if (https) {
      // Chromium refuses a bad chain before we get here (ignoreHTTPSErrors is
      // off), so an HTTPS response means the chain was trusted; the dates
      // are checked anyway in case a mocked response says otherwise.
      const security = await response.securityDetails().catch(() => null);
      const now = Date.now() / 1000;
      certificateValid = security
        ? (security.validFrom ?? 0) <= now && (security.validTo ?? Number.POSITIVE_INFINITY) >= now
        : true;
    }
    const timing = response.request().timing();
    const responseTimeMs =
      timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : Date.now() - started;

    return {
      mode: 'browser',
      finalUrl,
      statusCode,
      html,
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      responseTimeMs,
      certificateValid,
      redirects: redirectChain(response),
      compressed: (headers['content-encoding'] ?? '') !== '',
      contentType,
    };
  } catch (error) {
    throw classifyBrowserError(error, host, lease);
  } finally {
    await lease?.release().catch(() => undefined);
  }
}

async function fetchWithHtml(
  url: string,
  deadline: Deadline,
  options: { guard?: UrlGuardOptions; userAgent: string; maxHtmlBytes: number },
): Promise<FetchedPage> {
  const response = await fetchUrlSafely(url, {
    signal: deadline.signal,
    timeoutMs: Math.max(1, deadline.remaining()),
    guard: options.guard,
    userAgent: options.userAgent,
    maxBytes: options.maxHtmlBytes,
    requireHtml: true,
  });
  return {
    mode: 'html',
    finalUrl: response.finalUrl,
    statusCode: response.statusCode,
    html: response.body,
    htmlBytes: response.bytes,
    responseTimeMs: response.responseTimeMs,
    certificateValid: response.certificateValid,
    redirects: response.redirects,
    compressed: response.compressed,
    contentType: response.contentType,
  };
}

// ---------------------------------------------------------------------------
// Site checks
// ---------------------------------------------------------------------------

interface SiteCheckContext {
  deadline: Deadline;
  guard?: UrlGuardOptions;
  userAgent: string;
}

async function checkRobots(
  finalUrl: URL,
  context: SiteCheckContext,
): Promise<{ state: RobotsTxtState; sitemaps: string[] }> {
  const robotsUrl = new URL('/robots.txt', finalUrl).toString();
  try {
    const response = await fetchUrlSafely(robotsUrl, {
      signal: context.deadline.signal,
      timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1, context.deadline.remaining())),
      guard: context.guard,
      userAgent: context.userAgent,
      maxBytes: ROBOTS_MAX_BYTES,
      requireHtml: false,
      rejectBadStatus: false,
      accept: 'text/plain,*/*;q=0.5',
    });
    if (response.statusCode === 404 || response.statusCode === 410) {
      return { state: 'missing', sitemaps: [] };
    }
    if (response.statusCode >= 400) return { state: 'unknown', sitemaps: [] };
    // A site that answers robots.txt with its HTML 200 page has no robots.txt.
    if (isHtmlContentType(response.contentType) || /^\s*<(!doctype|html)/i.test(response.body)) {
      return { state: 'missing', sitemaps: [] };
    }
    const rules = parseRobotsTxt(response.body);
    const path = `${finalUrl.pathname}${finalUrl.search}`;
    const state: RobotsTxtState = isPathBlocked(rules, path) ? 'blocked' : 'present';
    return { state, sitemaps: rules.sitemaps };
  } catch (error) {
    throwIfCancelled(context.deadline);
    if (error instanceof SeoCrawlError && error.kind === 'aborted') throw error;
    return { state: 'unknown', sitemaps: [] };
  }
}

async function checkSitemap(
  finalUrl: URL,
  sitemapsFromRobots: string[],
  context: SiteCheckContext,
): Promise<SitemapState> {
  if (sitemapsFromRobots.length > 0) return 'present';
  const sitemapUrl = new URL('/sitemap.xml', finalUrl).toString();
  try {
    const response = await headUrlSafely(sitemapUrl, {
      signal: context.deadline.signal,
      timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1, context.deadline.remaining())),
      guard: context.guard,
      userAgent: context.userAgent,
      rejectBadStatus: false,
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      // A "sitemap" that is really the HTML 200 page does not count.
      return isHtmlContentType(response.headers['content-type'] ?? null) ? 'missing' : 'present';
    }
    if (response.statusCode === 404 || response.statusCode === 410) return 'missing';
    return 'unknown';
  } catch (error) {
    throwIfCancelled(context.deadline);
    if (error instanceof SeoCrawlError && error.kind === 'aborted') throw error;
    return 'unknown';
  }
}

function sameDocument(a: string, b: string): boolean {
  const strip = (value: string) => value.replace(/#.*$/, '').replace(/\/$/, '');
  return strip(a) === strip(b);
}

async function checkLinks(
  page: ParsedPage,
  finalUrl: string,
  maxLinkChecks: number,
  context: SiteCheckContext,
): Promise<LinkCheckResult> {
  const candidates = page.links.internal
    .filter((link) => !sameDocument(link, finalUrl))
    .slice(0, Math.max(0, maxLinkChecks));
  const result: LinkCheckResult = { checked: 0, broken: 0, sample: [] };
  if (candidates.length === 0) return result;

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const link = candidates[cursor];
      cursor += 1;
      if (context.deadline.signal.aborted) return;
      const remaining = context.deadline.remaining();
      if (remaining < 500) return;
      try {
        const response = await headUrlSafely(link, {
          signal: context.deadline.signal,
          timeoutMs: Math.min(PROBE_TIMEOUT_MS, remaining),
          guard: context.guard,
          userAgent: context.userAgent,
          maxRedirects: 3,
        });
        result.checked += 1;
        if (response.statusCode >= 400) {
          result.broken += 1;
          if (result.sample.length < 10) result.sample.push(link);
        }
      } catch (error) {
        if (!(error instanceof SeoCrawlError)) continue;
        if (error.kind === 'aborted') return;
        if (error.kind === 'unsafe_url') continue; // not ours to fetch; not counted
        if (error.kind === 'timeout') {
          // Slow is not broken; it is counted as checked so the share is honest.
          result.checked += 1;
          continue;
        }
        result.checked += 1;
        result.broken += 1;
        if (result.sample.length < 10) result.sample.push(link);
      }
    }
  };

  const workers = Array.from({ length: Math.min(LINK_CHECK_CONCURRENCY, candidates.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return result;
}

// ---------------------------------------------------------------------------
// The crawler
// ---------------------------------------------------------------------------

export function createSeoCrawler(options: SeoCrawlerOptions = {}): SeoCrawler {
  const browserMode = options.browser ?? 'auto';
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_CRAWL_TIMEOUT_MS;
  const defaultMaxLinkChecks = options.maxLinkChecks ?? DEFAULT_MAX_LINK_CHECKS;
  const defaultMaxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const logger = options.logger;
  const guard = options.guard;

  let pool: BrowserPool | null = options.pool ?? null;
  const getPool = (): BrowserPool => {
    if (!pool) {
      pool = createBrowserPool({
        maxPages: options.maxPages,
        userAgent,
        guard,
        logger,
      });
    }
    return pool;
  };

  async function run(
    url: string,
    crawlOptions: CrawlOptions,
    deadline: Deadline,
  ): Promise<CrawlResult> {
    const onStage = crawlOptions.onStage ?? (() => undefined);
    const mode = crawlOptions.browser ?? browserMode;
    const maxHtmlBytes = crawlOptions.maxHtmlBytes ?? defaultMaxHtmlBytes;
    const maxLinkChecks = crawlOptions.maxLinkChecks ?? defaultMaxLinkChecks;
    const agent = crawlOptions.userAgent ?? userAgent;

    const safety = await assertSafeUrl(url, guard);
    if (!safety.ok) {
      throw new SeoCrawlError('unsafe_url', safety.message, false, { reason: safety.reason });
    }
    const requestedUrl = safety.url.toString();
    throwIfExpired(deadline);

    // --- fetch -----------------------------------------------------------
    onStage('fetch', 'started');
    let fetched: FetchedPage | null = null;
    if (mode !== 'off') {
      const available = await getPool().available();
      if (!available && mode === 'on') {
        throw new SeoCrawlError(
          'browser_unavailable',
          'No headless browser is available on this server.',
          false,
        );
      }
      if (available) {
        try {
          fetched = await fetchWithBrowser(getPool(), requestedUrl, deadline, {
            reserveForFallback: mode === 'auto',
          });
        } catch (error) {
          const crawlError = toCrawlError(error, deadline);
          const canFallBack =
            mode === 'auto' &&
            FALLBACK_KINDS.has(crawlError.kind) &&
            !deadline.signal.aborted &&
            deadline.remaining() >= FALLBACK_MIN_REMAINING_MS;
          if (!canFallBack) throw crawlError;
          logger?.warn('seo.crawl.browser_fallback', {
            kind: crawlError.kind,
            message: crawlError.message,
          });
          onStage('fetch', 'started', 'Browser unavailable, fetching HTML');
        }
      }
    }
    if (!fetched) {
      fetched = await fetchWithHtml(requestedUrl, deadline, {
        guard,
        userAgent: agent,
        maxHtmlBytes,
      });
    }
    onStage('fetch', 'done', fetched.mode);
    throwIfExpired(deadline);

    const page = parseHtml(fetched.html, fetched.finalUrl);
    const finalUrl = new URL(fetched.finalUrl);
    const siteContext: SiteCheckContext = { deadline, guard, userAgent: agent };

    // --- robots ----------------------------------------------------------
    onStage('robots', 'started');
    const robots = await checkRobots(finalUrl, siteContext);
    onStage('robots', robots.state === 'unknown' ? 'failed' : 'done', robots.state);
    throwIfCancelled(deadline);

    // --- sitemap ---------------------------------------------------------
    onStage('sitemap', 'started');
    const sitemap = await checkSitemap(finalUrl, robots.sitemaps, siteContext);
    onStage('sitemap', sitemap === 'unknown' ? 'failed' : 'done', sitemap);
    throwIfCancelled(deadline);

    // --- links -----------------------------------------------------------
    let links: LinkCheckResult = { checked: 0, broken: 0, sample: [] };
    if (deadline.signal.aborted || deadline.remaining() < 1_000) {
      onStage('links', 'skipped', 'Out of time');
    } else if (maxLinkChecks <= 0) {
      onStage('links', 'skipped', 'Link checks are disabled');
    } else {
      onStage('links', 'started');
      links = await checkLinks(page, fetched.finalUrl, maxLinkChecks, siteContext);
      onStage('links', 'done', `${links.broken} of ${links.checked} broken`);
    }

    return {
      requestedUrl,
      finalUrl: fetched.finalUrl,
      statusCode: fetched.statusCode,
      mode: fetched.mode,
      responseTimeMs: fetched.responseTimeMs,
      fetchedAt: new Date().toISOString(),
      htmlBytes: fetched.htmlBytes,
      https: finalUrl.protocol === 'https:',
      certificateValid: finalUrl.protocol === 'https:' ? fetched.certificateValid : null,
      redirects: fetched.redirects,
      compressed: fetched.compressed,
      contentType: fetched.contentType,
      page,
      robotsTxt: robots.state,
      sitemap,
      links,
    };
  }

  return {
    async crawl(url, crawlOptions = {}) {
      const deadline = createDeadline(
        crawlOptions.timeoutMs ?? defaultTimeoutMs,
        crawlOptions.signal,
      );
      try {
        return await run(url, crawlOptions, deadline);
      } catch (error) {
        const crawlError = toCrawlError(error, deadline);
        if (crawlError.kind !== 'unsafe_url') {
          logger?.warn('seo.crawl.failed', { kind: crawlError.kind, message: crawlError.message });
        }
        throw crawlError;
      } finally {
        deadline.dispose();
      }
    },

    async browserAvailable() {
      if (browserMode === 'off') return false;
      return getPool().available();
    },

    async close() {
      const current = pool;
      pool = null;
      await current?.close();
    },
  };
}
