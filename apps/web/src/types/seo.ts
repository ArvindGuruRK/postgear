/**
 * SEO analyzer shapes, mirroring what `/seo/*` returns and streams (Sprint 7).
 *
 * Declared here rather than imported from `@postgear/seo-engine`, for the
 * reason `channel.ts` gives: that package drives a headless browser and must
 * never reach the browser bundle. The engine's `types.ts` and the API's
 * `seo.service.ts` are the sources; keep the three in step.
 */

export type SeoGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type SeoCategory = 'onPage' | 'technical' | 'content' | 'backlink';

export const SEO_CATEGORIES: readonly SeoCategory[] = [
  'onPage',
  'technical',
  'content',
  'backlink',
] as const;

export const SEO_CATEGORY_LABELS: Record<SeoCategory, string> = {
  onPage: 'On-page',
  technical: 'Technical',
  content: 'Content',
  backlink: 'Authority',
};

/** The weights from `project_structure.md`; they sum to 1. */
export const SEO_CATEGORY_WEIGHTS: Record<SeoCategory, number> = {
  onPage: 0.3,
  technical: 0.3,
  content: 0.25,
  backlink: 0.15,
};

export type SeoSeverity = 'critical' | 'warning' | 'info';

export const SEO_SEVERITIES: readonly SeoSeverity[] = ['critical', 'warning', 'info'] as const;

export type SeoAuditStatus = 'pending' | 'crawling' | 'scoring' | 'advising' | 'done' | 'failed';

/** The stages the analyzer streams, in order: what the tracker shows. */
export type SeoStage = 'validate' | 'crawl' | 'score' | 'advise';

export const SEO_STAGES: readonly SeoStage[] = ['validate', 'crawl', 'score', 'advise'] as const;

export type SeoStageStatus = 'started' | 'done' | 'skipped' | 'failed';

/** One rule the evaluators applied. */
export interface SeoCheck {
  /** Stable id, e.g. `title-length`. */
  id: string;
  category: SeoCategory;
  label: string;
  passed: boolean;
  /** How much a failure matters. Informational when `passed`. */
  severity: SeoSeverity;
  /** One line: what was found, or why it passed. */
  detail: string;
  /** The measured value, when there is one to show ("54 characters"). */
  value: string | null;
  /** Share of the category score this check carries (0–1). */
  weight: number;
}

export interface SeoCategoryScore {
  category: SeoCategory;
  /** 0–100. */
  score: number;
  weight: number;
  checks: SeoCheck[];
  /**
   * The authority score was derived from on-page signals rather than a
   * backlink index, because no authority provider is configured.
   */
  estimated: boolean;
}

export type SeoImpact = 'high' | 'medium' | 'low';

export interface SeoRecommendation {
  id: string;
  severity: SeoSeverity;
  category: SeoCategory;
  title: string;
  /** What is wrong and why it matters. */
  issue: string;
  /** What to change, concretely. */
  fix: string;
  impact: SeoImpact;
  /** The check this recommendation acts on, when there is one. */
  checkId: string | null;
  docsUrl: string | null;
}

export interface SeoAdvice {
  /** `ai` when a model wrote it, `rules` when the evaluators' findings were used as-is. */
  source: 'ai' | 'rules';
  model: string | null;
  summary: string;
  recommendations: SeoRecommendation[];
}

export interface SeoKeyword {
  term: string;
  count: number;
  /** Percentage of all words. */
  density: number;
}

export interface SeoCrawlSummary {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  mode: 'browser' | 'html';
  responseTimeMs: number;
  htmlBytes: number;
  https: boolean;
  certificateValid: boolean | null;
  redirects: string[];
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robotsMeta: string | null;
  noindex: boolean;
  viewport: string | null;
  lang: string | null;
  charset: string | null;
  headings: { level: number; text: string }[];
  h1Count: number;
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  images: { count: number; missingAlt: number };
  links: { internal: number; external: number; nofollow: number };
  brokenLinks: { checked: number; broken: number; sample: string[] };
  structuredData: { count: number; types: string[]; invalid: number };
  text: {
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    /** Flesch reading ease, 0–100; null when there is too little text. */
    readability: number | null;
    textToHtmlRatio: number;
    topKeywords: SeoKeyword[];
  };
  robotsTxt: 'present' | 'missing' | 'blocked' | 'unknown';
  sitemap: 'present' | 'missing' | 'unknown';
  hreflang: number;
  favicon: boolean;
  compressed: boolean;
  authority: {
    source: 'openpagerank' | 'heuristic' | 'simulation';
    domainAuthority: number | null;
    pageRank: number | null;
  } | null;
}

export interface SeoScores {
  onPage: number;
  technical: number;
  content: number;
  backlink: number;
}

/** One row of the history list. */
export interface SeoAuditSummary {
  id: string;
  targetUrl: string;
  finalUrl: string | null;
  status: SeoAuditStatus;
  grade: SeoGrade | null;
  overallScore: number | null;
  scores: SeoScores | null;
  crawlMode: 'browser' | 'html' | null;
  durationMs: number | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** `GET /seo/audits/:id`. */
export interface SeoAuditDetail extends SeoAuditSummary {
  crawl: SeoCrawlSummary | null;
  categories: SeoCategoryScore[];
  advice: SeoAdvice | null;
  /** The run before this one for the same URL, for "up 6 since last time". */
  previous: {
    id: string;
    overallScore: number | null;
    grade: SeoGrade | null;
    createdAt: string;
  } | null;
}

/** `GET /seo/audits?url=&limit=`. */
export interface SeoAuditList {
  audits: SeoAuditSummary[];
}

/** `GET /seo/status`. */
export interface SeoStatus {
  /** A headless browser can be launched; otherwise every crawl is HTML-only. */
  browser: boolean;
  /** AI advice is available (an OpenAI key, or simulation). Without it, advice is rule-based. */
  ai: boolean;
  authority: 'openpagerank' | 'heuristic' | 'simulation';
  timeoutMs: number;
  maxConcurrent: number;
  /** Credits one analysis charges for AI advice; 0 when AI is off. */
  adviceCost: number;
}

/** `POST /seo/audits` body. */
export interface SeoAnalyzeRequest {
  url: string;
}

export type SeoErrorKind =
  | 'unsafe_url'
  | 'unreachable'
  | 'timeout'
  | 'blocked'
  | 'not_html'
  | 'too_large'
  | 'busy'
  | 'out_of_credits'
  | 'aborted'
  | 'unexpected';

/** Everything `POST /seo/audits` streams. `credits` rides on the terminal events. */
export type SeoStreamEvent =
  | { type: 'stage'; stage: SeoStage; status: SeoStageStatus; detail?: string }
  | { type: 'audit'; audit: SeoAuditSummary }
  | { type: 'crawl'; crawl: SeoCrawlSummary }
  | {
      type: 'scores';
      overallScore: number;
      grade: SeoGrade;
      scores: SeoScores;
      categories: SeoCategoryScore[];
    }
  | { type: 'advice'; advice: SeoAdvice }
  | { type: 'done'; audit: SeoAuditDetail; credits: import('./ai').AiCredits | null }
  | {
      type: 'error';
      kind: SeoErrorKind;
      message: string;
      retryable: boolean;
      audit: SeoAuditSummary | null;
      credits: import('./ai').AiCredits | null;
    };

export function gradeFor(score: number): SeoGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
