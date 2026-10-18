/**
 * Rows and engine results → the JSON the browser reads. Pure, and the only
 * place the two vocabularies meet.
 *
 * A stored audit is a row with five score columns plus two JSON documents:
 * `auditData` (`{ crawl, report, authority }`, the engine's `SeoAudit`) and
 * `aiAdvice` (the engine's `SeoAdvice`). The history list reads the columns
 * only; the detail opens the JSON. Reading the JSON is defensive on purpose:
 * a row written by an older build, or a seed, or a run that crashed
 * between two writes, must render as "no crawl yet" rather than as a 500.
 *
 * The crawl summary is a *projection* of the crawl result: counts instead
 * of link lists, lengths beside the strings the UI shows, and the page's
 * visible text left out (it is the one field that could be hundreds of
 * kilobytes and nothing on the screen needs it).
 */
import type { SEOAuditStatus } from '@postgear/db';
import type {
  AuthorityEstimate,
  CrawlResult,
  SeoAdvice,
  SeoAudit,
  SeoGrade,
  SeoRecommendation,
  SeoScoreReport,
} from '@postgear/seo-engine';
import type { SeoAuditRow } from './seo.repository';
import type {
  SeoAuditDetail,
  SeoAuditPrevious,
  SeoAuditStatus as SeoAuditStatusView,
  SeoAuditSummary,
  SeoCategoryScoreView,
  SeoCrawlSummary,
  SeoScores,
} from './seo.types';

const GRADES: ReadonlySet<string> = new Set<SeoGrade>(['A', 'B', 'C', 'D', 'F']);

export function gradeOf(value: string | null): SeoGrade | null {
  return value !== null && GRADES.has(value) ? (value as SeoGrade) : null;
}

export function statusOf(status: SEOAuditStatus): SeoAuditStatusView {
  return status.toLowerCase() as SeoAuditStatusView;
}

function crawlModeOf(value: string | null): 'browser' | 'html' | null {
  return value === 'browser' || value === 'html' ? value : null;
}

/** The four sub-scores, or null until the scoring stage wrote all of them. */
export function scoresOf(
  row: Pick<SeoAuditRow, 'onPageScore' | 'technicalScore' | 'contentScore' | 'backlinkScore'>,
): SeoScores | null {
  if (
    row.onPageScore === null ||
    row.technicalScore === null ||
    row.contentScore === null ||
    row.backlinkScore === null
  ) {
    return null;
  }

  return {
    onPage: row.onPageScore,
    technical: row.technicalScore,
    content: row.contentScore,
    backlink: row.backlinkScore,
  };
}

export function toSummary(row: SeoAuditRow): SeoAuditSummary {
  return {
    id: row.id,
    targetUrl: row.targetUrl,
    finalUrl: row.finalUrl,
    status: statusOf(row.status),
    grade: gradeOf(row.grade),
    overallScore: row.overallScore,
    scores: scoresOf(row),
    crawlMode: crawlModeOf(row.crawlMode),
    durationMs: row.durationMs,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toPrevious(row: SeoAuditRow): SeoAuditPrevious {
  return {
    id: row.id,
    overallScore: row.overallScore,
    grade: gradeOf(row.grade),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDetail(row: SeoAuditRow, previous: SeoAuditRow | null): SeoAuditDetail {
  const audit = readAuditData(row.auditData);

  return {
    ...toSummary(row),
    crawl: audit ? toCrawlSummary(audit.crawl, audit.authority) : null,
    categories: audit ? toCategoryScores(audit.report) : [],
    advice: readAdvice(row.aiAdvice),
    previous: previous ? toPrevious(previous) : null,
  };
}

// ---------------------------------------------------------------------------
// Engine results → views
// ---------------------------------------------------------------------------

export function toCrawlSummary(
  crawl: CrawlResult,
  authority: AuthorityEstimate | null,
): SeoCrawlSummary {
  const { page } = crawl;

  return {
    requestedUrl: crawl.requestedUrl,
    finalUrl: crawl.finalUrl,
    statusCode: crawl.statusCode,
    mode: crawl.mode,
    responseTimeMs: crawl.responseTimeMs,
    htmlBytes: crawl.htmlBytes,
    https: crawl.https,
    certificateValid: crawl.certificateValid,
    redirects: crawl.redirects,
    title: page.title,
    titleLength: page.title?.length ?? 0,
    metaDescription: page.metaDescription,
    metaDescriptionLength: page.metaDescription?.length ?? 0,
    canonical: page.canonical,
    robotsMeta: page.robotsMeta,
    noindex: /\bnoindex\b/i.test(page.robotsMeta ?? ''),
    viewport: page.viewport,
    lang: page.lang,
    charset: page.charset,
    headings: page.headings.map((heading) => ({ level: heading.level, text: heading.text })),
    h1Count: page.headings.filter((heading) => heading.level === 1).length,
    openGraph: page.openGraph,
    twitterCard: page.twitterCard,
    images: { count: page.images.count, missingAlt: page.images.missingAlt },
    links: {
      internal: page.links.internal.length,
      external: page.links.external.length,
      nofollow: page.links.nofollow,
    },
    brokenLinks: {
      checked: crawl.links.checked,
      broken: crawl.links.broken,
      sample: crawl.links.sample,
    },
    structuredData: {
      count: page.structuredData.count,
      types: page.structuredData.types,
      invalid: page.structuredData.invalid,
    },
    text: {
      wordCount: page.text.wordCount,
      sentenceCount: page.text.sentenceCount,
      paragraphCount: page.text.paragraphCount,
      readability: page.text.readability,
      textToHtmlRatio: page.text.textToHtmlRatio,
      topKeywords: page.text.topKeywords,
    },
    robotsTxt: crawl.robotsTxt,
    sitemap: crawl.sitemap,
    hreflang: page.hreflang,
    favicon: page.favicon,
    compressed: crawl.compressed,
    authority: authority
      ? {
          source: authority.source,
          domainAuthority: authority.domainAuthority,
          pageRank: authority.pageRank,
        }
      : null,
  };
}

/** The report's categories without the engine's internal `attainment`. */
export function toCategoryScores(report: SeoScoreReport): SeoCategoryScoreView[] {
  return report.categories.map((category) => ({
    category: category.category,
    score: category.score,
    weight: category.weight,
    estimated: category.estimated,
    checks: category.checks.map((check) => ({
      id: check.id,
      category: check.category,
      label: check.label,
      passed: check.passed,
      severity: check.severity,
      detail: check.detail,
      value: check.value,
      weight: check.weight,
    })),
  }));
}

/**
 * The advice when no model is involved: the evaluators' findings as they
 * are, under one sentence that says what the numbers mean.
 */
export function rulesAdvice(report: SeoScoreReport, findings: SeoRecommendation[]): SeoAdvice {
  return {
    source: 'rules',
    model: null,
    summary: rulesSummary(report, findings),
    recommendations: findings,
  };
}

export function rulesSummary(report: SeoScoreReport, findings: SeoRecommendation[]): string {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (findings.length === 0) {
    return `This page scores ${report.overall}/100 (grade ${report.grade}) and every check passed.`;
  }

  const top = findings.find((finding) => finding.severity === 'critical') ?? findings[0];
  return `This page scores ${report.overall}/100 (grade ${report.grade}) with ${plural(counts.critical, 'critical issue')}, ${plural(counts.warning, 'warning')} and ${plural(counts.info, 'note')}; start with "${top.title}".`;
}

// ---------------------------------------------------------------------------
// Stored JSON → engine shapes, defensively
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The stored `auditData`, or null when it is missing or not an audit. */
export function readAuditData(value: unknown): SeoAudit | null {
  if (!isRecord(value) || !isRecord(value.crawl) || !isRecord(value.report)) {
    return null;
  }

  const crawl = value.crawl;
  const report = value.report;
  if (
    !isRecord(crawl.page) ||
    !isRecord(crawl.links) ||
    typeof report.overall !== 'number' ||
    !Array.isArray(report.categories)
  ) {
    return null;
  }

  return {
    crawl: crawl as unknown as CrawlResult,
    report: report as unknown as SeoScoreReport,
    authority: isRecord(value.authority) ? (value.authority as unknown as AuthorityEstimate) : null,
  };
}

/** The stored `aiAdvice`, or null when it is missing or not advice. */
export function readAdvice(value: unknown): SeoAdvice | null {
  if (
    !isRecord(value) ||
    (value.source !== 'ai' && value.source !== 'rules') ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.recommendations)
  ) {
    return null;
  }

  return {
    source: value.source,
    model: typeof value.model === 'string' ? value.model : null,
    summary: value.summary,
    recommendations: value.recommendations as SeoRecommendation[],
  };
}

// ---------------------------------------------------------------------------
// Stage copy
// ---------------------------------------------------------------------------

const CRAWL_STAGE_LABELS: Record<string, string> = {
  fetch: 'Fetching the page',
  robots: 'Reading robots.txt',
  sitemap: 'Looking for a sitemap',
  links: 'Checking links',
};

/**
 * The `detail` text for a crawler sub-stage, or null when there is nothing
 * worth saying (a sub-stage finishing is implied by the next one starting).
 * Relayed as `stage crawl started` with this detail, never as a status
 * change of the crawl stage itself: the tracker shows one crawl step.
 */
export function crawlStageDetail(
  stage: string,
  status: 'started' | 'done' | 'skipped' | 'failed',
): string | null {
  const label = CRAWL_STAGE_LABELS[stage] ?? `Crawl: ${stage}`;
  switch (status) {
    case 'started':
      return `${label}…`;
    case 'skipped':
      return `${label}: skipped`;
    case 'failed':
      return `${label}: could not be completed`;
    default:
      return null;
  }
}

/** The host for a `validate done` detail and for the security log: never the full URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
