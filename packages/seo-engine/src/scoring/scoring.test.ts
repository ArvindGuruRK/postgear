import { SEO_CATEGORIES, SEO_CATEGORY_WEIGHTS, type SeoAudit } from '../types';
import { estimateAuthority, evaluateBacklink } from './backlink.evaluator';
import { band, buildCategory, check, ramp, scoreCategory } from './checks';
import { evaluateContent } from './content.evaluator';
import { bareCrawl, perfectCrawl } from './fixtures';
import { countSkippedHeadingLevels, evaluateOnPage } from './on-page.evaluator';
import {
  ADVICE_DIGEST_MAX_CHARS,
  calculateScore,
  evaluateAll,
  findingsFromReport,
  gradeFor,
  summariseForAdvice,
} from './score.calculator';
import { evaluateTechnical, isNoindex } from './technical.evaluator';

const REAL_AUTHORITY = { source: 'openpagerank' as const, domainAuthority: 72, pageRank: 7.2 };

describe('check helpers', () => {
  it('ramp and band grade linearly and clamp', () => {
    expect(ramp(0, 0, 10)).toBe(0);
    expect(ramp(5, 0, 10)).toBe(0.5);
    expect(ramp(50, 0, 10)).toBe(1);
    expect(ramp(2500, 2500, 800)).toBe(0);
    expect(ramp(800, 2500, 800)).toBe(1);
    expect(ramp(1650, 2500, 800)).toBeCloseTo(0.5);
    expect(band(45, [30, 60], [10, 90])).toBe(1);
    expect(band(20, [30, 60], [10, 90])).toBeCloseTo(0.5);
    expect(band(75, [30, 60], [10, 90])).toBeCloseTo(0.5);
    expect(band(200, [30, 60], [10, 90])).toBe(0);
  });

  it('check forces info severity when passed and derives attainment', () => {
    const passed = check({
      id: 'x',
      category: 'onPage',
      label: 'X',
      weight: 1,
      severity: 'critical',
      passed: true,
      detail: 'ok',
    });
    expect(passed.severity).toBe('info');
    expect(passed.attainment).toBe(1);
    const failed = check({ ...passed, passed: false, severity: 'warning', attainment: 1.7 });
    expect(failed.severity).toBe('warning');
    expect(failed.attainment).toBe(1);
  });

  it('scoreCategory is the weighted mean of attainment', () => {
    const a = check({
      id: 'a',
      category: 'onPage',
      label: 'a',
      weight: 0.75,
      severity: 'info',
      passed: true,
      detail: '',
    });
    const b = check({
      id: 'b',
      category: 'onPage',
      label: 'b',
      weight: 0.25,
      severity: 'info',
      passed: false,
      detail: '',
    });
    expect(scoreCategory([a, b])).toBe(75);
    expect(scoreCategory([])).toBe(0);
  });

  it('buildCategory refuses weights that do not sum to 1 or duplicate ids', () => {
    const a = check({
      id: 'a',
      category: 'content',
      label: 'a',
      weight: 0.5,
      severity: 'info',
      passed: true,
      detail: '',
    });
    expect(() => buildCategory('content', 0.25, [a])).toThrow(/sum to 0.500/);
    expect(() => buildCategory('content', 0.25, [a, a])).toThrow(/Duplicate/);
  });
});

describe('evaluators on a perfect crawl', () => {
  const crawl = perfectCrawl();
  const report = evaluateAll(crawl, REAL_AUTHORITY);

  it('scores an A at or above 95', () => {
    expect(report.overall).toBeGreaterThanOrEqual(95);
    expect(report.grade).toBe('A');
    expect(report.scores.onPage).toBe(100);
    expect(report.scores.technical).toBe(100);
    expect(report.scores.content).toBe(100);
  });

  it('has weights summing to 1 in every category with unique ids across categories', () => {
    const ids = new Set<string>();
    for (const category of report.categories) {
      const sum = category.checks.reduce((total, item) => total + item.weight, 0);
      expect(sum).toBeCloseTo(1, 5);
      expect(category.weight).toBe(SEO_CATEGORY_WEIGHTS[category.category]);
      for (const item of category.checks) {
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
        expect(item.attainment).toBeGreaterThanOrEqual(0);
        expect(item.attainment).toBeLessThanOrEqual(1);
        expect(item.detail.split('\n')).toHaveLength(1);
      }
    }
    expect(report.categories.map((c) => c.category)).toEqual([...SEO_CATEGORIES]);
  });

  it('fails nothing except (none) and uses the real authority path', () => {
    const failed = report.categories.flatMap((c) => c.checks.filter((i) => !i.passed));
    expect(failed).toEqual([]);
    const backlink = report.categories.find((c) => c.category === 'backlink');
    expect(backlink?.estimated).toBe(false);
    expect(backlink?.score).toBe(72);
    expect(backlink?.checks.map((c) => c.id)).toEqual(['domain-authority', 'page-rank']);
  });
});

describe('evaluators on a bare page', () => {
  const crawl = bareCrawl();
  const report = evaluateAll(crawl, null);
  const byId = new Map(report.categories.flatMap((c) => c.checks).map((c) => [c.id, c]));

  it('scores an F with the critical checks failed', () => {
    expect(report.grade).toBe('F');
    expect(report.overall).toBeLessThan(40);
    for (const id of ['https', 'noindex', 'title-present', 'single-h1', 'robots-txt']) {
      const item = byId.get(id);
      expect(item?.passed).toBe(false);
      expect(item?.severity).toBe('critical');
    }
  });

  it('grades the warning checks', () => {
    expect(byId.get('response-time')).toMatchObject({ passed: false, severity: 'warning' });
    expect(byId.get('broken-links')).toMatchObject({ passed: false, attainment: 0 });
    expect(byId.get('image-alt')).toMatchObject({ passed: false, attainment: 0 });
    expect(byId.get('redirect-chain')).toMatchObject({ passed: false, attainment: 0 });
    expect(byId.get('word-count')).toMatchObject({ passed: false, severity: 'warning' });
    expect(byId.get('sitemap')).toMatchObject({ passed: false });
  });

  it('estimates authority and says so', () => {
    const backlink = report.categories.find((c) => c.category === 'backlink');
    expect(backlink?.estimated).toBe(true);
    const source = byId.get('authority-source');
    expect(source).toMatchObject({ passed: false, severity: 'info', attainment: 1 });
    expect(source?.detail).toMatch(/connect an authority provider/i);
  });
});

describe('graded on-page checks', () => {
  it('awards partial credit for a long title and a short description', () => {
    const crawl = perfectCrawl();
    crawl.page.title = 'x'.repeat(75);
    crawl.page.metaDescription = 'short description here';
    const category = evaluateOnPage(crawl);
    const title = category.checks.find((c) => c.id === 'title-length');
    expect(title?.passed).toBe(false);
    expect(title?.attainment).toBeGreaterThan(0);
    expect(title?.attainment).toBeLessThan(1);
    expect(title?.value).toBe('75 characters');
    const description = category.checks.find((c) => c.id === 'meta-description-length');
    expect(description?.attainment).toBeGreaterThan(0);
    expect(description?.attainment).toBeLessThan(1);
  });

  it('flags two H1s as a warning and no H1 as critical', () => {
    const crawl = perfectCrawl();
    crawl.page.headings = [
      { level: 1, text: 'a' },
      { level: 1, text: 'b' },
    ];
    expect(evaluateOnPage(crawl).checks.find((c) => c.id === 'single-h1')).toMatchObject({
      passed: false,
      severity: 'warning',
      attainment: 0.5,
    });
    crawl.page.headings = [{ level: 2, text: 'a' }];
    expect(evaluateOnPage(crawl).checks.find((c) => c.id === 'single-h1')?.severity).toBe(
      'critical',
    );
  });

  it('counts skipped heading levels', () => {
    expect(countSkippedHeadingLevels([1, 2, 3, 2])).toBe(0);
    expect(countSkippedHeadingLevels([1, 3])).toBe(1);
    expect(countSkippedHeadingLevels([2])).toBe(1);
    expect(countSkippedHeadingLevels([])).toBe(0);
  });
});

describe('technical specifics', () => {
  it('reads noindex and none directives', () => {
    expect(isNoindex('noindex, follow')).toBe(true);
    expect(isNoindex('NONE')).toBe(true);
    expect(isNoindex('index, nofollow')).toBe(false);
    expect(isNoindex(null)).toBe(false);
  });

  it('does not penalise unknown robots or sitemap states', () => {
    const crawl = perfectCrawl();
    crawl.robotsTxt = 'unknown';
    crawl.sitemap = 'unknown';
    const category = evaluateTechnical(crawl);
    expect(category.checks.find((c) => c.id === 'robots-txt')?.attainment).toBe(1);
    expect(category.checks.find((c) => c.id === 'sitemap')?.passed).toBe(true);
  });

  it('fails the certificate check when the chain is untrusted', () => {
    const crawl = perfectCrawl();
    crawl.certificateValid = false;
    const item = evaluateTechnical(crawl).checks.find((c) => c.id === 'certificate');
    expect(item).toMatchObject({ passed: false, severity: 'critical' });
  });
});

describe('content specifics', () => {
  it('grades word count and readability', () => {
    const crawl = perfectCrawl();
    crawl.page.text.wordCount = 400;
    crawl.page.text.readability = 30;
    crawl.page.text.topKeywords = [{ term: 'widget', count: 40, density: 10 }];
    const category = evaluateContent(crawl);
    expect(category.checks.find((c) => c.id === 'word-count')).toMatchObject({
      passed: true,
      attainment: 0.5,
    });
    const readability = category.checks.find((c) => c.id === 'readability');
    expect(readability?.passed).toBe(false);
    expect(readability?.attainment).toBeCloseTo(0.5, 1);
    expect(category.checks.find((c) => c.id === 'keyword-density')?.attainment).toBe(0);
  });
});

describe('backlink estimate', () => {
  it('caps the heuristic at 60 and lists its signals', () => {
    const crawl = perfectCrawl();
    crawl.finalUrl = 'https://www.acme.com/widgets';
    crawl.page.links.external.push('https://github.com/acme', 'https://x.com/acme');
    const { score, signals } = estimateAuthority(crawl);
    expect(score).toBe(60);
    expect(signals.every((s) => s.present)).toBe(true);
    // The `.example` fixture misses the TLD signal and two social links.
    expect(estimateAuthority(perfectCrawl()).score).toBe(44);
    const bare = estimateAuthority(bareCrawl());
    expect(bare.score).toBeLessThan(20);
  });

  it('grades a real estimate by DA and PageRank', () => {
    const category = evaluateBacklink(perfectCrawl(), {
      source: 'simulation',
      domainAuthority: 40,
      pageRank: null,
    });
    expect(category.estimated).toBe(false);
    expect(category.score).toBe(40);
    expect(category.checks.find((c) => c.id === 'page-rank')?.detail).toMatch(/No PageRank/);
  });
});

describe('calculateScore and gradeFor', () => {
  it('weights the categories 30/30/25/15', () => {
    const report = evaluateAll(perfectCrawl(), {
      source: 'openpagerank',
      domainAuthority: 0,
      pageRank: 0,
    });
    expect(report.scores.backlink).toBe(0);
    expect(report.overall).toBe(85);
    expect(report.grade).toBe('B');
  });

  it('grades at the boundaries', () => {
    expect(gradeFor(100)).toBe('A');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(89)).toBe('B');
    expect(gradeFor(80)).toBe('B');
    expect(gradeFor(79)).toBe('C');
    expect(gradeFor(70)).toBe('C');
    expect(gradeFor(69)).toBe('D');
    expect(gradeFor(60)).toBe('D');
    expect(gradeFor(59)).toBe('F');
    expect(gradeFor(0)).toBe('F');
  });

  it('handles an empty category list', () => {
    expect(calculateScore([])).toMatchObject({ overall: 0, grade: 'F' });
  });
});

describe('findingsFromReport', () => {
  const report = evaluateAll(bareCrawl(), null);
  const findings = findingsFromReport(report);

  it('orders critical before warning before info, then by weight', () => {
    const severities = findings.map((f) => f.severity);
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < severities.length; i += 1) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]]);
    }
    expect(findings[0].checkId).toBe('title-present');
    expect(findings[0].impact).toBe('high');
  });

  it('gives every finding a title, a fix and a docs link where one exists', () => {
    expect(findings.length).toBeGreaterThan(10);
    for (const finding of findings) {
      expect(finding.title).not.toBe('');
      expect(finding.fix).not.toBe('');
      expect(finding.id).toBe(`rec-${finding.checkId}`);
    }
    const https = findings.find((f) => f.checkId === 'https');
    expect(https?.docsUrl).toMatch(/^https:\/\/developers\.google\.com\/search\/docs/);
    expect(https?.issue).toMatch(/plain HTTP/);
  });

  it('returns nothing for a perfect report', () => {
    expect(findingsFromReport(evaluateAll(perfectCrawl(), REAL_AUTHORITY))).toEqual([]);
  });
});

describe('summariseForAdvice', () => {
  it('produces a labelled digest under the cap without the page text', () => {
    const crawl = perfectCrawl();
    crawl.page.text.content = 'SECRET PAGE BODY '.repeat(500);
    const audit: SeoAudit = { crawl, report: evaluateAll(crawl, null), authority: null };
    const digest = summariseForAdvice(audit);
    expect(digest.length).toBeLessThanOrEqual(ADVICE_DIGEST_MAX_CHARS);
    expect(digest).toContain('URL: https://acme.example/widgets');
    expect(digest).toMatch(/^Score: \d+\/100 \([A-F]\)/m);
    expect(digest).toContain('Title (53 chars)');
    expect(digest).toContain('Failed checks:');
    expect(digest).toContain('authority-source');
    expect(digest).not.toContain('SECRET PAGE BODY');
  });

  it('truncates a long failure list rather than overflowing', () => {
    const crawl = bareCrawl();
    crawl.page.headings = Array.from({ length: 300 }, (_, i) => ({ level: 2, text: `H ${i}` }));
    const audit: SeoAudit = { crawl, report: evaluateAll(crawl, null), authority: null };
    expect(summariseForAdvice(audit).length).toBeLessThanOrEqual(ADVICE_DIGEST_MAX_CHARS);
  });
});
