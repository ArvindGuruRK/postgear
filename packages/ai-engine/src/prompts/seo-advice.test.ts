import type { SeoAdviceFinding, SeoAdviceRequest } from '../types';
import {
  buildSeoAdvicePrompt,
  formatFindingLine,
  isHttpUrl,
  parseFindingLine,
  seoAdviceSchema,
} from './seo-advice';

const finding: SeoAdviceFinding = {
  id: 'title-length',
  severity: 'warning',
  category: 'onPage',
  title: 'Shorten the title',
  issue: 'The title is 84 characters; search results cut it at about 60.',
  fix: 'Rewrite the title to 50–60 characters, keeping the main keyword first.',
  impact: 'medium',
  checkId: 'title-length',
  docsUrl: 'https://developers.google.com/search/docs/appearance/title-link',
};

const recommendation = {
  id: 'ssl',
  severity: 'critical' as const,
  category: 'technical' as const,
  title: 'Serve the page over HTTPS',
  issue: 'The page is served over plain HTTP.',
  fix: 'Install a certificate and redirect HTTP to HTTPS.',
  impact: 'high' as const,
  checkId: 'ssl',
  docsUrl: null,
};

const request: SeoAdviceRequest = {
  url: 'https://example.com/',
  overall: 64,
  grade: 'D',
  digest: 'example.com answered in 420 ms over HTTPS. The title is 84 characters.',
  findings: [finding],
};

describe('seoAdviceSchema', () => {
  it('accepts a well-formed answer', () => {
    const parsed = seoAdviceSchema.safeParse({
      summary: 'Fix the title first.',
      recommendations: [recommendation],
    });
    expect(parsed.success).toBe(true);
  });

  it('bounds the summary and the list', () => {
    expect(
      seoAdviceSchema.safeParse({ summary: '', recommendations: [recommendation] }).success,
    ).toBe(false);
    expect(
      seoAdviceSchema.safeParse({ summary: 'x'.repeat(601), recommendations: [recommendation] })
        .success,
    ).toBe(false);
    expect(seoAdviceSchema.safeParse({ summary: 'ok', recommendations: [] }).success).toBe(false);
    expect(
      seoAdviceSchema.safeParse({
        summary: 'ok',
        recommendations: Array.from({ length: 16 }, (_, i) => ({
          ...recommendation,
          id: `r-${i}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('refuses values outside the vocabulary and non-http docs links', () => {
    const bad = (patch: Record<string, unknown>) =>
      seoAdviceSchema.safeParse({
        summary: 'ok',
        recommendations: [{ ...recommendation, ...patch }],
      }).success;
    expect(bad({ severity: 'blocker' })).toBe(false);
    expect(bad({ category: 'speed' })).toBe(false);
    expect(bad({ impact: 'huge' })).toBe(false);
    expect(bad({ docsUrl: 'javascript:alert(1)' })).toBe(false);
    expect(bad({ docsUrl: 'developers.google.com/search' })).toBe(false);
    expect(bad({ docsUrl: 'https://developers.google.com/search' })).toBe(true);
    expect(bad({ docsUrl: null })).toBe(true);
    expect(bad({ checkId: null })).toBe(true);
    expect(bad({ title: '' })).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('finding lines', () => {
  it('round-trip through format and parse', () => {
    expect(parseFindingLine(formatFindingLine(finding))).toEqual(finding);
    const bare = { ...finding, checkId: null, docsUrl: null };
    expect(parseFindingLine(formatFindingLine(bare))).toEqual(bare);
  });

  it('keeps free text readable when it contains the separator or line breaks', () => {
    const tricky = {
      ...finding,
      title: 'Split | this',
      issue: 'Line one\nline two',
      fix: 'A | B',
    };
    const line = formatFindingLine(tricky);
    expect(line.split('\n')).toHaveLength(1);
    const parsed = parseFindingLine(line);
    expect(parsed).toMatchObject({
      id: 'title-length',
      title: 'Split / this',
      issue: 'Line one line two',
      fix: 'A / B',
    });
  });

  it('returns null for lines that are not findings, and falls back inside the vocabulary', () => {
    expect(parseFindingLine('')).toBeNull();
    expect(parseFindingLine('just a sentence')).toBeNull();
    expect(parseFindingLine('a | b | c')).toBeNull();
    expect(
      parseFindingLine('x | severe | speed | T | I | F | enormous | (none) | not-a-url'),
    ).toEqual({
      id: 'x',
      severity: 'info',
      category: 'technical',
      title: 'T',
      issue: 'I',
      fix: 'F',
      impact: 'low',
      checkId: null,
      docsUrl: null,
    });
  });
});

describe('buildSeoAdvicePrompt', () => {
  it('labels every input and lists the findings one per line', () => {
    const { system, user } = buildSeoAdvicePrompt(request);
    expect(system).toContain('technical-SEO consultant');
    expect(system).toContain('Critical = blocks indexing');
    expect(system).toContain('Do not invent facts');
    expect(system).toContain('Google Search Central');
    expect(user).toContain('URL: https://example.com/');
    expect(user).toContain('Score: 64/100');
    expect(user).toContain('Grade: D');
    expect(user).toContain('Findings: 1');
    expect(user).toContain(`<<<Audit\n${request.digest}\n>>>`);
    expect(user).toContain(`<<<Findings\n${formatFindingLine(finding)}\n>>>`);
  });

  it('writes an empty findings block as (none)', () => {
    const { user } = buildSeoAdvicePrompt({ ...request, findings: [] });
    expect(user).toContain('Findings: 0');
    expect(user).toContain('<<<Findings\n(none)\n>>>');
  });
});
