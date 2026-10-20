/**
 * The analyzer's presentation helpers: what the history groups, what a grade
 * and a severity are coloured, what "vs last run" says, what the clipboard
 * gets, and which URLs the form lets through to the API.
 */
import type { SeoAuditDetail, SeoAuditSummary } from '@/types/seo';
import {
  formatDuration,
  formatRelative,
  gradeVariant,
  groupHistory,
  hostOf,
  isValidUrlInput,
  pathOf,
  reportAsText,
  scoreDelta,
  severityVariant,
} from './seo-view-model';

function audit(overrides: Partial<SeoAuditSummary> & { id: string }): SeoAuditSummary {
  return {
    targetUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 'done',
    grade: 'B',
    overallScore: 82,
    scores: { onPage: 80, technical: 90, content: 75, backlink: 70 },
    crawlMode: 'html',
    durationMs: 3100,
    failureReason: null,
    createdAt: '2026-10-15T10:00:00.000Z',
    completedAt: '2026-10-15T10:00:03.100Z',
    ...overrides,
  };
}

describe('groupHistory', () => {
  it('groups runs by target URL, latest site first, latest run first, trend oldest first', () => {
    const sites = groupHistory([
      audit({ id: 'f', grade: 'F', overallScore: 48, createdAt: '2026-10-01T10:00:00.000Z' }),
      audit({ id: 'b', grade: 'B', overallScore: 82, createdAt: '2026-10-15T10:00:00.000Z' }),
      audit({
        id: 'x',
        targetUrl: 'https://nonexistent.invalid/',
        finalUrl: null,
        status: 'failed',
        grade: null,
        overallScore: null,
        scores: null,
        failureReason: 'Could not resolve the host.',
        createdAt: '2026-10-10T10:00:00.000Z',
      }),
      audit({ id: 'c', grade: 'C', overallScore: 71, createdAt: '2026-10-08T10:00:00.000Z' }),
    ]);

    expect(sites.map((site) => site.host)).toEqual(['example.com', 'nonexistent.invalid']);
    expect(sites[0].latest.id).toBe('b');
    expect(sites[0].audits.map((run) => run.id)).toEqual(['b', 'c', 'f']);
    expect(sites[0].trend).toEqual([
      { x: '2026-10-01T10:00:00.000Z', y: 48 },
      { x: '2026-10-08T10:00:00.000Z', y: 71 },
      { x: '2026-10-15T10:00:00.000Z', y: 82 },
    ]);
    expect(sites[1].latest.status).toBe('failed');
    expect(sites[1].trend).toEqual([]);
  });

  it('leaves failed runs out of the trend but keeps them in the list', () => {
    const [site] = groupHistory([
      audit({ id: 'ok', createdAt: '2026-10-01T10:00:00.000Z' }),
      audit({
        id: 'bad',
        status: 'failed',
        grade: null,
        overallScore: null,
        createdAt: '2026-10-02T10:00:00.000Z',
      }),
    ]);

    expect(site.audits).toHaveLength(2);
    expect(site.latest.id).toBe('bad');
    expect(site.trend).toHaveLength(1);
  });

  it('is empty for no audits', () => {
    expect(groupHistory([])).toEqual([]);
  });
});

describe('tones', () => {
  it('colours grades on the Sprint 5 scale', () => {
    expect(gradeVariant('A')).toBe('success');
    expect(gradeVariant('B')).toBe('success');
    expect(gradeVariant('C')).toBe('secondary');
    expect(gradeVariant('D')).toBe('accent');
    expect(gradeVariant('F')).toBe('danger');
    expect(gradeVariant(null)).toBe('outline');
  });

  it('colours severities like the queue colours outcomes', () => {
    expect(severityVariant('critical')).toBe('danger');
    expect(severityVariant('warning')).toBe('accent');
    expect(severityVariant('info')).toBe('primary');
  });
});

describe('scoreDelta', () => {
  const previous = { overallScore: 71, createdAt: '2026-10-08T10:00:00.000Z' };

  it('says up, down or same against the previous run', () => {
    expect(scoreDelta(82, previous)).toEqual({
      delta: 11,
      direction: 'up',
      previousScore: 71,
      previousAt: previous.createdAt,
    });
    expect(scoreDelta(60, previous)).toMatchObject({ delta: -11, direction: 'down' });
    expect(scoreDelta(71, previous)).toMatchObject({ delta: 0, direction: 'same' });
  });

  it('is null without a previous score', () => {
    expect(scoreDelta(82, null)).toBeNull();
    expect(scoreDelta(82, { overallScore: null, createdAt: previous.createdAt })).toBeNull();
    expect(scoreDelta(null, previous)).toBeNull();
  });
});

describe('isValidUrlInput', () => {
  it('accepts http and https URLs with a host, including ones the API will refuse', () => {
    expect(isValidUrlInput('https://example.com/')).toBe(true);
    expect(isValidUrlInput('  https://example.com/page?x=1  ')).toBe(true);
    expect(isValidUrlInput('http://localhost:3000')).toBe(true);
    expect(isValidUrlInput('http://169.254.169.254/latest/meta-data')).toBe(true);
  });

  it('rejects what the API would answer 400 to', () => {
    expect(isValidUrlInput('')).toBe(false);
    expect(isValidUrlInput('example.com')).toBe(false);
    expect(isValidUrlInput('ftp://example.com/')).toBe(false);
    expect(isValidUrlInput('javascript:alert(1)')).toBe(false);
    expect(isValidUrlInput('https://exa mple.com/')).toBe(false);
  });
});

describe('url parts', () => {
  it('reads the host without www and the path without the root slash', () => {
    expect(hostOf('https://www.example.com/blog/post?x=1')).toBe('example.com');
    expect(pathOf('https://www.example.com/blog/post?x=1')).toBe('/blog/post?x=1');
    expect(pathOf('https://example.com/')).toBe('');
    expect(hostOf('not a url')).toBe('not a url');
    expect(pathOf('not a url')).toBe('');
  });
});

describe('formatting', () => {
  const now = new Date('2026-10-15T12:00:00.000Z');

  it('says how long ago in the nearest unit', () => {
    expect(formatRelative('2026-10-15T11:59:50.000Z', now)).toBe('just now');
    expect(formatRelative('2026-10-15T11:55:00.000Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-15T09:00:00.000Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-13T12:00:00.000Z', now)).toBe('2 d ago');
    expect(formatRelative('not a date', now)).toBe('');
  });

  it('formats durations in the unit that reads', () => {
    expect(formatDuration(840)).toBe('840 ms');
    expect(formatDuration(4210)).toBe('4.2 s');
    expect(formatDuration(null)).toBe('–');
  });
});

describe('reportAsText', () => {
  const advice: NonNullable<SeoAuditDetail['advice']> = {
    source: 'ai',
    model: 'simulation',
    summary: 'Two things to fix first.',
    recommendations: [
      {
        id: 'r2',
        severity: 'info',
        category: 'content',
        title: 'Short page',
        issue: 'Under 300 words.',
        fix: 'Write more.',
        impact: 'low',
        checkId: 'word-count',
        docsUrl: null,
      },
      {
        id: 'r1',
        severity: 'critical',
        category: 'onPage',
        title: 'Missing meta description',
        issue: 'There is none.',
        fix: 'Write one of 120–155 characters.',
        impact: 'high',
        checkId: 'meta-description',
        docsUrl: 'https://developers.google.com/search/docs/appearance/snippet',
      },
    ],
  };

  const detail: SeoAuditDetail = {
    ...audit({ id: 'b' }),
    crawl: null,
    categories: [
      { category: 'onPage', score: 80, weight: 0.3, checks: [], estimated: false },
      { category: 'technical', score: 90, weight: 0.3, checks: [], estimated: false },
      { category: 'content', score: 75, weight: 0.25, checks: [], estimated: false },
      { category: 'backlink', score: 70, weight: 0.15, checks: [], estimated: true },
    ],
    advice,
    previous: { id: 'c', overallScore: 71, grade: 'C', createdAt: '2026-10-08T10:00:00.000Z' },
  };

  it('writes the score line, the comparison, the categories and the grouped fixes', () => {
    expect(reportAsText(detail)).toBe(
      [
        'SEO audit: https://example.com/',
        'Score 82/100, Grade B, 2026-10-15',
        'vs last run (2026-10-08): +11 from 71',
        'On-page 80, Technical 90, Content 75, Authority 70 (estimated)',
        '',
        'What to fix (AI advice, simulation)',
        'Two things to fix first.',
        '',
        'Critical (1)',
        '- Missing meta description: There is none.',
        '  Fix: Write one of 120–155 characters.',
        '  More: https://developers.google.com/search/docs/appearance/snippet',
        '',
        'Info (1)',
        '- Short page: Under 300 words.',
        '  Fix: Write more.',
      ].join('\n'),
    );
  });

  it('says rule-based when no model wrote the advice, and copes with no advice at all', () => {
    const rules = reportAsText({
      ...detail,
      previous: null,
      advice: { ...advice, source: 'rules', model: null, summary: '' },
    });
    expect(rules).toContain('What to fix (rule-based)');
    expect(rules).not.toContain('vs last run');

    const none = reportAsText({ ...detail, advice: null, overallScore: null, grade: null });
    expect(none).toContain('Not scored, 2026-10-15');
    expect(none).not.toContain('What to fix');
  });
});
