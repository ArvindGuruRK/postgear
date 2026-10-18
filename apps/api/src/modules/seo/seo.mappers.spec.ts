/**
 * Rows and engine results → wire shapes: the enum casing, null scores until
 * scored, the crawl projection, the stripped `attainment`, defensive JSON
 * reads, and the rules summary.
 */
import { SEOAuditStatus } from '@postgear/db';
import { auditRow, crawlResult, findings, scoreReport } from './seo.fixtures';
import {
  crawlStageDetail,
  gradeOf,
  hostOf,
  readAdvice,
  readAuditData,
  rulesAdvice,
  rulesSummary,
  scoresOf,
  toCategoryScores,
  toCrawlSummary,
  toDetail,
  toSummary,
} from './seo.mappers';

describe('toSummary', () => {
  it('lower-cases the status and leaves scores null until all four exist', () => {
    const summary = toSummary(auditRow({ status: SEOAuditStatus.CRAWLING, onPageScore: 50 }));
    expect(summary).toEqual({
      id: 'audit_1',
      targetUrl: 'https://example.com/',
      finalUrl: null,
      status: 'crawling',
      grade: null,
      overallScore: null,
      scores: null,
      crawlMode: null,
      durationMs: null,
      failureReason: null,
      createdAt: '2026-10-15T10:00:00.000Z',
      completedAt: null,
    });
  });

  it('maps a finished row with a typed grade and crawl mode', () => {
    const summary = toSummary(
      auditRow({
        status: SEOAuditStatus.DONE,
        finalUrl: 'https://example.com/home',
        overallScore: 71,
        grade: 'C',
        onPageScore: 68,
        technicalScore: 82,
        contentScore: 60,
        backlinkScore: 70,
        crawlMode: 'browser',
        durationMs: 8_400,
        completedAt: new Date('2026-10-15T10:00:09.000Z'),
      }),
    );
    expect(summary).toMatchObject({
      status: 'done',
      grade: 'C',
      scores: { onPage: 68, technical: 82, content: 60, backlink: 70 },
      crawlMode: 'browser',
      completedAt: '2026-10-15T10:00:09.000Z',
    });
  });

  it('refuses a grade or crawl mode outside the vocabulary', () => {
    expect(gradeOf('E')).toBeNull();
    expect(gradeOf('A')).toBe('A');
    expect(toSummary(auditRow({ crawlMode: 'curl' })).crawlMode).toBeNull();
    expect(
      scoresOf({ onPageScore: 1, technicalScore: 1, contentScore: 1, backlinkScore: null }),
    ).toBeNull();
  });
});

describe('toCrawlSummary', () => {
  it('projects the crawl: lengths, counts, noindex, and never the page text', () => {
    const crawl = crawlResult({
      page: { ...crawlResult().page, robotsMeta: 'noindex, nofollow' },
    });
    const summary = toCrawlSummary(crawl, {
      source: 'simulation',
      domainAuthority: 42,
      pageRank: 3.1,
    });
    expect(summary).toMatchObject({
      title: 'Example Domain',
      titleLength: 14,
      metaDescriptionLength: 0,
      noindex: true,
      h1Count: 1,
      links: { internal: 2, external: 1, nofollow: 0 },
      brokenLinks: { checked: 2, broken: 0, sample: [] },
      authority: { source: 'simulation', domainAuthority: 42, pageRank: 3.1 },
      text: { wordCount: 120, readability: 62.4 },
    });
    expect(JSON.stringify(summary)).not.toContain('illustrative examples');
    expect(toCrawlSummary(crawlResult(), null).authority).toBeNull();
    expect(toCrawlSummary(crawlResult(), null).noindex).toBe(false);
  });
});

describe('toCategoryScores', () => {
  it('drops the engine’s attainment from every check', () => {
    const categories = toCategoryScores(scoreReport());
    expect(categories).toHaveLength(4);
    expect(categories[0].checks[0]).toEqual({
      id: 'title-length',
      category: 'onPage',
      label: 'Title length',
      passed: true,
      severity: 'info',
      detail: '14 characters',
      value: '14 characters',
      weight: 0.25,
    });
    expect(categories[3].estimated).toBe(true);
  });
});

describe('toDetail', () => {
  it('opens the JSON when it is an audit and includes the previous run', () => {
    const row = auditRow({
      status: SEOAuditStatus.DONE,
      overallScore: 71,
      grade: 'C',
      auditData: { crawl: crawlResult(), report: scoreReport(), authority: null },
      aiAdvice: rulesAdvice(scoreReport(), findings()),
    });
    const previous = auditRow({
      id: 'audit_0',
      overallScore: 64,
      grade: 'D',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
    });
    const detail = toDetail(row, previous);
    expect(detail.crawl?.title).toBe('Example Domain');
    expect(detail.categories).toHaveLength(4);
    expect(detail.advice?.source).toBe('rules');
    expect(detail.previous).toEqual({
      id: 'audit_0',
      overallScore: 64,
      grade: 'D',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
  });

  it('renders a row with no, or malformed, JSON as "no crawl yet"', () => {
    const detail = toDetail(auditRow({ auditData: { crawl: 'nope' }, aiAdvice: 'x' }), null);
    expect(detail.crawl).toBeNull();
    expect(detail.categories).toEqual([]);
    expect(detail.advice).toBeNull();
    expect(detail.previous).toBeNull();
  });
});

describe('readAuditData / readAdvice', () => {
  it('accepts the stored shapes and refuses anything else', () => {
    const audit = { crawl: crawlResult(), report: scoreReport(), authority: null };
    expect(readAuditData(audit)?.report.overall).toBe(71);
    expect(readAuditData({ ...audit, authority: { source: 'heuristic' } })?.authority).toEqual({
      source: 'heuristic',
    });
    expect(readAuditData(null)).toBeNull();
    expect(readAuditData({ crawl: {}, report: {} })).toBeNull();
    expect(readAuditData([])).toBeNull();

    const advice = rulesAdvice(scoreReport(), findings());
    expect(readAdvice(advice)).toEqual(advice);
    expect(readAdvice({ ...advice, model: 7 })?.model).toBeNull();
    expect(readAdvice({ source: 'guess', summary: 's', recommendations: [] })).toBeNull();
    expect(readAdvice('text')).toBeNull();
  });
});

describe('rulesSummary', () => {
  it('counts by severity and names the first critical item', () => {
    const list = [
      ...findings(),
      {
        ...findings()[0],
        id: 'noindex',
        severity: 'critical' as const,
        title: 'Remove noindex',
      },
    ];
    expect(rulesSummary(scoreReport(), list)).toBe(
      'This page scores 71/100 (grade C) with 1 critical issue, 2 warnings and 0 notes; start with "Remove noindex".',
    );
    expect(rulesSummary(scoreReport(), findings())).toContain(
      'start with "Write a meta description"',
    );
    expect(rulesSummary(scoreReport({ overall: 97, grade: 'A' }), [])).toBe(
      'This page scores 97/100 (grade A) and every check passed.',
    );
  });
});

describe('crawlStageDetail / hostOf', () => {
  it('words the crawler’s sub-stages and says nothing about a finished one', () => {
    expect(crawlStageDetail('fetch', 'started')).toBe('Fetching the page…');
    expect(crawlStageDetail('robots', 'done')).toBeNull();
    expect(crawlStageDetail('links', 'skipped')).toBe('Checking links: skipped');
    expect(crawlStageDetail('sitemap', 'failed')).toBe(
      'Looking for a sitemap: could not be completed',
    );
    expect(crawlStageDetail('render', 'started')).toBe('Crawl: render…');
  });

  it('reduces a URL to its host and an invalid one to nothing', () => {
    expect(hostOf('https://Example.com/path?q=1')).toBe('example.com');
    expect(hostOf('not a url')).toBe('');
  });
});
