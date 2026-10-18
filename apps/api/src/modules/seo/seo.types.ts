/**
 * What `/seo/*` returns and streams: the API's copy of
 * `apps/web/src/types/seo.ts`.
 *
 * Declared here rather than imported from the web app (an app must not
 * depend on another app) or from `@postgear/seo-engine` alone (the engine
 * knows crawls and reports, not audits with ids, statuses and history). The
 * shapes the engine already defines (advice, recommendations, grades,
 * categories) are reused as-is so there is one definition of each; the
 * rest mirrors the browser's file field for field. `seo.mappers.ts` is the
 * only place rows and engine results are turned into these.
 */

import type {
  AuthorityEstimate,
  CrawlMode,
  RobotsTxtState,
  SeoAdvice,
  SeoCategory,
  SeoGrade,
  SeoKeyword,
  SeoSeverity,
  SitemapState,
} from '@postgear/seo-engine';
import type { AiCredits } from '../ai/credits/credits.policy';

export type { SeoAdvice, SeoCategory, SeoGrade, SeoRecommendation } from '@postgear/seo-engine';

export type SeoAuditStatus = 'pending' | 'crawling' | 'scoring' | 'advising' | 'done' | 'failed';

/** The stages the analyzer streams, in order. */
export type SeoStage = 'validate' | 'crawl' | 'score' | 'advise';

export type SeoStageStatus = 'started' | 'done' | 'skipped' | 'failed';

/** One rule the evaluators applied, without the engine's internal `attainment`. */
export interface SeoCheckView {
  id: string;
  category: SeoCategory;
  label: string;
  passed: boolean;
  severity: SeoSeverity;
  detail: string;
  value: string | null;
  weight: number;
}

export interface SeoCategoryScoreView {
  category: SeoCategory;
  score: number;
  weight: number;
  checks: SeoCheckView[];
  estimated: boolean;
}

export interface SeoCrawlSummary {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  mode: CrawlMode;
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
    readability: number | null;
    textToHtmlRatio: number;
    topKeywords: SeoKeyword[];
  };
  robotsTxt: RobotsTxtState;
  sitemap: SitemapState;
  hreflang: number;
  favicon: boolean;
  compressed: boolean;
  authority: {
    source: AuthorityEstimate['source'];
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
  crawlMode: CrawlMode | null;
  durationMs: number | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SeoAuditPrevious {
  id: string;
  overallScore: number | null;
  grade: SeoGrade | null;
  createdAt: string;
}

/** `GET /seo/audits/:id`. */
export interface SeoAuditDetail extends SeoAuditSummary {
  crawl: SeoCrawlSummary | null;
  categories: SeoCategoryScoreView[];
  advice: SeoAdvice | null;
  /** The run before this one for the same URL, for "up 6 since last time". */
  previous: SeoAuditPrevious | null;
}

export type SeoAuthorityMode = AuthorityEstimate['source'];

/** `GET /seo/status`. */
export interface SeoStatus {
  browser: boolean;
  ai: boolean;
  authority: SeoAuthorityMode;
  timeoutMs: number;
  maxConcurrent: number;
  /** Credits one analysis charges for AI advice; 0 when AI is off. */
  adviceCost: number;
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
      categories: SeoCategoryScoreView[];
    }
  | { type: 'advice'; advice: SeoAdvice }
  | { type: 'done'; audit: SeoAuditDetail; credits: AiCredits | null }
  | {
      type: 'error';
      kind: SeoErrorKind;
      message: string;
      retryable: boolean;
      audit: SeoAuditSummary | null;
      credits: AiCredits | null;
    };
