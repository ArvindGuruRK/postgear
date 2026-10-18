/**
 * `@postgear/seo-engine`'s contract: every type the API (and the engine's own
 * tests) program against.
 *
 * ## Three parts, one shape
 *
 * - The **crawler** fetches one URL and produces a {@link CrawlResult}: what
 *   the page said about itself (meta, headings, links, text) and what the
 *   fetch said about the site (status, timing, TLS, robots, sitemap, broken
 *   links). It never scores anything.
 * - The **evaluators** turn a `CrawlResult` (plus an optional
 *   {@link AuthorityEstimate}) into four {@link CategoryScore}s, each a list of
 *   named, weighted {@link SeoCheck}s. They are pure functions.
 * - The **calculator** folds the four into one 0–100 {@link SeoScoreReport}
 *   with a letter grade.
 *
 * ## What this file must stay free of
 *
 * No Playwright, no Node built-ins, no Prisma. The API mirrors these shapes
 * in `apps/web/src/types/seo.ts` for the browser, so a field added here is
 * added there; the API's `seo.service.ts` is where the two meet.
 */

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/**
 * Why a URL was refused before any byte was fetched. Every reason is a
 * fail-closed outcome: an unresolvable host is refused, not retried.
 */
export type UrlRejectReason =
  | 'invalid'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'host_forbidden'
  | 'unresolvable'
  | 'private_address';

export type UrlSafetyResult =
  | {
      ok: true;
      /** Normalised: lower-cased host, no fragment, no credentials. */
      url: URL;
      /** Every address the host resolved to; all were checked. */
      addresses: string[];
    }
  | { ok: false; reason: UrlRejectReason; message: string };

export interface UrlGuardOptions {
  /**
   * Resolves a host name to its addresses. Injected so tests never touch DNS
   * and so the crawler can pin the address it validated (see `safe-fetch.ts`).
   */
  resolve?: (host: string) => Promise<string[]>;
  /** Ports other than the scheme's default that are allowed. Default: none. */
  allowPorts?: number[];
}

// ---------------------------------------------------------------------------
// The crawl
// ---------------------------------------------------------------------------

/** How the page was fetched. `html` is the fallback when no browser could be used. */
export type CrawlMode = 'browser' | 'html';

/** The stages a crawl reports as it goes: `onStage` in {@link CrawlOptions}. */
export type CrawlStage = 'fetch' | 'robots' | 'sitemap' | 'links';

export interface CrawlOptions {
  /** Hard ceiling for the whole crawl, every sub-fetch included. Default 30 000 ms. */
  timeoutMs?: number;
  /** How many of the page's internal links are checked for a 4xx/5xx. Default 20. */
  maxLinkChecks?: number;
  /** Largest HTML body accepted, in bytes. Default 2 MiB. */
  maxHtmlBytes?: number;
  userAgent?: string;
  /** `auto` (default): a browser when available, else HTML. `on`: browser or fail. `off`: HTML only. */
  browser?: 'auto' | 'on' | 'off';
  signal?: AbortSignal;
  onStage?: (
    stage: CrawlStage,
    status: 'started' | 'done' | 'skipped' | 'failed',
    detail?: string,
  ) => void;
}

export interface Heading {
  /** 1–6. */
  level: number;
  text: string;
}

export interface SeoKeyword {
  term: string;
  count: number;
  /** Percentage of all words (0–100). */
  density: number;
}

/** What the HTML itself says. Produced by `html.parser.ts`, pure. */
export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  /** The `robots` meta content, if any ("noindex, nofollow"). */
  robotsMeta: string | null;
  viewport: string | null;
  lang: string | null;
  charset: string | null;
  headings: Heading[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  images: { count: number; missingAlt: number };
  links: {
    /** Absolute URLs on the same registrable host, de-duplicated. */
    internal: string[];
    external: string[];
    nofollow: number;
  };
  structuredData: { count: number; types: string[]; invalid: number };
  hreflang: number;
  favicon: boolean;
  text: {
    /** The visible text, whitespace-collapsed, for the content evaluator. */
    content: string;
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    /** Flesch reading ease, 0–100; null under 100 words. */
    readability: number | null;
    /** Visible text bytes over HTML bytes, 0–1. */
    textToHtmlRatio: number;
    topKeywords: SeoKeyword[];
  };
}

export type RobotsTxtState = 'present' | 'missing' | 'blocked' | 'unknown';
export type SitemapState = 'present' | 'missing' | 'unknown';

export interface LinkCheckResult {
  checked: number;
  broken: number;
  /** Up to ten broken URLs, for the report. */
  sample: string[];
}

export interface CrawlResult {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  mode: CrawlMode;
  /** From the first byte sent to the last byte of HTML received. */
  responseTimeMs: number;
  fetchedAt: string;
  htmlBytes: number;
  https: boolean;
  /** Null when not over HTTPS, or when the fetch path could not inspect the certificate. */
  certificateValid: boolean | null;
  /** Every hop before `finalUrl`, in order. */
  redirects: string[];
  /** `Content-Encoding` was gzip/br/deflate. */
  compressed: boolean;
  contentType: string | null;
  page: ParsedPage;
  /** `blocked` means robots.txt disallows the crawled path for every agent. */
  robotsTxt: RobotsTxtState;
  sitemap: SitemapState;
  links: LinkCheckResult;
}

/** How a crawl can fail. `retryable` says whether the same URL could succeed a minute later. */
export type CrawlErrorKind =
  | 'unsafe_url'
  | 'unreachable'
  | 'timeout'
  | 'blocked'
  | 'bad_status'
  | 'not_html'
  | 'too_large'
  | 'browser_unavailable'
  | 'aborted';

export class SeoCrawlError extends Error {
  constructor(
    readonly kind: CrawlErrorKind,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown; statusCode?: number; reason?: UrlRejectReason },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SeoCrawlError';
    this.statusCode = options?.statusCode;
    this.reason = options?.reason;
  }

  readonly statusCode?: number;
  /** Set for `unsafe_url`. */
  readonly reason?: UrlRejectReason;
}

export function isSeoCrawlError(error: unknown): error is SeoCrawlError {
  return error instanceof SeoCrawlError;
}

export interface SeoCrawler {
  /** Resolves with the crawl; rejects with a {@link SeoCrawlError}. Never a bare error. */
  crawl(url: string, options?: CrawlOptions): Promise<CrawlResult>;
  /** True when a headless browser can be launched in this process. Cached after the first probe. */
  browserAvailable(): Promise<boolean>;
  /** Closes the browser pool. Safe to call more than once. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Authority (the backlink signal)
// ---------------------------------------------------------------------------

export interface AuthorityEstimate {
  source: 'openpagerank' | 'heuristic' | 'simulation';
  /** 0–100, Moz-style scale. */
  domainAuthority: number;
  /** Open PageRank's 0–10 decimal, when known. */
  pageRank: number | null;
}

export interface AuthorityProvider {
  readonly name: AuthorityEstimate['source'];
  /** Null when the provider has nothing on this domain. Throws only on a provider failure. */
  estimate(hostname: string, options?: { signal?: AbortSignal }): Promise<AuthorityEstimate | null>;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type SeoCategory = 'onPage' | 'technical' | 'content' | 'backlink';

export const SEO_CATEGORIES: readonly SeoCategory[] = [
  'onPage',
  'technical',
  'content',
  'backlink',
] as const;

/** The weights from `project_structure.md`: 30 / 30 / 25 / 15. They sum to 1. */
export const SEO_CATEGORY_WEIGHTS: Readonly<Record<SeoCategory, number>> = Object.freeze({
  onPage: 0.3,
  technical: 0.3,
  content: 0.25,
  backlink: 0.15,
});

export type SeoSeverity = 'critical' | 'warning' | 'info';

export type SeoGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** One rule applied to the crawl. */
export interface SeoCheck {
  /** Stable, kebab-case, unique across categories (`title-length`, `ssl`). */
  id: string;
  category: SeoCategory;
  label: string;
  passed: boolean;
  /** How much a failure matters. `info` when passed. */
  severity: SeoSeverity;
  /** One line: what was found, or why it passed. Never provider or page text longer than a sentence. */
  detail: string;
  /** The measured value, formatted for display, when there is one. */
  value: string | null;
  /** This check's share of its category (0–1). A category's weights sum to 1. */
  weight: number;
  /** 0–1: how well the check was met. Most checks are 0 or 1; a few are graded (length, speed). */
  attainment: number;
}

export interface CategoryScore {
  category: SeoCategory;
  /** 0–100, rounded. */
  score: number;
  weight: number;
  checks: SeoCheck[];
  /** The authority score was estimated from on-page signals, not a backlink index. */
  estimated: boolean;
}

export interface SeoScoreReport {
  /** 0–100, rounded. */
  overall: number;
  grade: SeoGrade;
  scores: Record<SeoCategory, number>;
  categories: CategoryScore[];
}

// ---------------------------------------------------------------------------
// Advice (produced by the AI engine or the rules; shaped here so the API has one type)
// ---------------------------------------------------------------------------

export type SeoImpact = 'high' | 'medium' | 'low';

export interface SeoRecommendation {
  id: string;
  severity: SeoSeverity;
  category: SeoCategory;
  title: string;
  issue: string;
  fix: string;
  impact: SeoImpact;
  checkId: string | null;
  docsUrl: string | null;
}

export interface SeoAdvice {
  source: 'ai' | 'rules';
  model: string | null;
  summary: string;
  recommendations: SeoRecommendation[];
}

/** A crawl plus its report: the input to advice, the body of a stored audit. */
export interface SeoAudit {
  crawl: CrawlResult;
  report: SeoScoreReport;
  authority: AuthorityEstimate | null;
}
