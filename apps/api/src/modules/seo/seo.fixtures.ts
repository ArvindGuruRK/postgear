/**
 * Fixtures shared by the SEO specs: one crawl, one report, one row, built
 * by hand against the engine's types so the mappers and the service are
 * tested on the shapes they will really see — without running a crawl.
 * Not a test file (no `.spec`), so Jest does not collect it.
 */
import { SEOAuditStatus } from '@postgear/db';
import type { CrawlResult, SeoRecommendation, SeoScoreReport } from '@postgear/seo-engine';
import type { SeoAuditRow } from './seo.repository';

export function crawlResult(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    mode: 'html',
    responseTimeMs: 412,
    fetchedAt: '2026-10-15T10:00:00.000Z',
    htmlBytes: 18_204,
    https: true,
    certificateValid: true,
    redirects: [],
    compressed: true,
    contentType: 'text/html; charset=utf-8',
    page: {
      title: 'Example Domain',
      metaDescription: null,
      canonical: 'https://example.com/',
      robotsMeta: null,
      viewport: 'width=device-width, initial-scale=1',
      lang: 'en',
      charset: 'utf-8',
      headings: [
        { level: 1, text: 'Example Domain' },
        { level: 2, text: 'More information' },
      ],
      openGraph: { 'og:title': 'Example Domain' },
      twitterCard: {},
      images: { count: 3, missingAlt: 1 },
      links: {
        internal: ['https://example.com/about', 'https://example.com/contact'],
        external: ['https://www.iana.org/domains/example'],
        nofollow: 0,
      },
      structuredData: { count: 1, types: ['Organization'], invalid: 0 },
      hreflang: 0,
      favicon: true,
      text: {
        content: 'This domain is for use in illustrative examples in documents.',
        wordCount: 120,
        sentenceCount: 8,
        paragraphCount: 2,
        readability: 62.4,
        textToHtmlRatio: 0.21,
        topKeywords: [{ term: 'domain', count: 4, density: 3.3 }],
      },
    },
    robotsTxt: 'present',
    sitemap: 'missing',
    links: { checked: 2, broken: 0, sample: [] },
    ...overrides,
  };
}

export function scoreReport(overrides: Partial<SeoScoreReport> = {}): SeoScoreReport {
  return {
    overall: 71,
    grade: 'C',
    scores: { onPage: 68, technical: 82, content: 60, backlink: 70 },
    categories: [
      {
        category: 'onPage',
        score: 68,
        weight: 0.3,
        estimated: false,
        checks: [
          {
            id: 'title-length',
            category: 'onPage',
            label: 'Title length',
            passed: true,
            severity: 'info',
            detail: '14 characters',
            value: '14 characters',
            weight: 0.25,
            attainment: 1,
          },
          {
            id: 'meta-description',
            category: 'onPage',
            label: 'Meta description',
            passed: false,
            severity: 'warning',
            detail: 'The page has no meta description.',
            value: null,
            weight: 0.25,
            attainment: 0,
          },
        ],
      },
      {
        category: 'technical',
        score: 82,
        weight: 0.3,
        estimated: false,
        checks: [
          {
            id: 'ssl',
            category: 'technical',
            label: 'HTTPS',
            passed: true,
            severity: 'info',
            detail: 'Served over HTTPS with a valid certificate.',
            value: null,
            weight: 0.3,
            attainment: 1,
          },
        ],
      },
      {
        category: 'content',
        score: 60,
        weight: 0.25,
        estimated: false,
        checks: [
          {
            id: 'word-count',
            category: 'content',
            label: 'Content length',
            passed: false,
            severity: 'warning',
            detail: '120 words; aim for at least 300.',
            value: '120 words',
            weight: 0.4,
            attainment: 0.4,
          },
        ],
      },
      {
        category: 'backlink',
        score: 70,
        weight: 0.15,
        estimated: true,
        checks: [
          {
            id: 'domain-authority',
            category: 'backlink',
            label: 'Domain authority',
            passed: true,
            severity: 'info',
            detail: 'Estimated from on-page signals.',
            value: '42',
            weight: 1,
            attainment: 0.7,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function findings(): SeoRecommendation[] {
  return [
    {
      id: 'meta-description',
      severity: 'warning',
      category: 'onPage',
      title: 'Write a meta description',
      issue: 'The page has no meta description, so search engines pick their own snippet.',
      fix: 'Add a meta description of 120–155 characters that states what the page offers.',
      impact: 'medium',
      checkId: 'meta-description',
      docsUrl: 'https://developers.google.com/search/docs/appearance/snippet',
    },
    {
      id: 'word-count',
      severity: 'warning',
      category: 'content',
      title: 'Add more copy',
      issue: 'The page has 120 words of visible text.',
      fix: 'Expand the page to at least 300 words of useful content.',
      impact: 'medium',
      checkId: 'word-count',
      docsUrl: null,
    },
  ];
}

export function auditRow(overrides: Partial<SeoAuditRow> = {}): SeoAuditRow {
  return {
    id: 'audit_1',
    targetUrl: 'https://example.com/',
    finalUrl: null,
    status: SEOAuditStatus.PENDING,
    failureReason: null,
    overallScore: null,
    grade: null,
    onPageScore: null,
    technicalScore: null,
    contentScore: null,
    backlinkScore: null,
    crawlMode: null,
    durationMs: null,
    auditData: null,
    aiAdvice: null,
    createdAt: new Date('2026-10-15T10:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}
