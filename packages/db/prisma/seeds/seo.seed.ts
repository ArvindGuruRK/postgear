/**
 * SEO audit history for the demo workspace (Sprint 7).
 *
 * Without these rows the analyzer page can only ever render its empty state
 * on a fresh clone, and the two things the sprint's Definition of Done asks
 * to see (a trend line across re-runs and a prioritised advice list) need
 * history to exist. So: three finished audits of `https://example.com/`
 * over three weeks with a rising score (58/F → 71/C → 84/B), each with a
 * crawl, a full report and advice shaped exactly as the API's
 * `seo.mappers.ts` reads them, plus one failed audit so the "could not be
 * reached" treatment exists too.
 *
 * Idempotent by delete-then-create on fixed ids: an `SEOAudit` row has no
 * natural key to upsert on, and re-seeding should reset the history rather
 * than pile onto it. Every row of this workspace is replaced, which is what
 * a seed of "the demo history" means.
 *
 * The JSON is written by hand against `packages/seo-engine/src/types.ts`
 * rather than produced by the evaluators, because packages/db must not
 * depend on an engine package; if the engine's shapes change, the mappers'
 * defensive reads render these rows as "no crawl yet" rather than failing.
 */
import { type Prisma, type PrismaClient, SEOAuditStatus } from '@prisma/client';

const TARGET_URL = 'https://example.com/';
const FAILED_URL = 'https://nonexistent.invalid/';
const GOOGLE_DOCS = 'https://developers.google.com/search/docs';

type Severity = 'critical' | 'warning' | 'info';
type Category = 'onPage' | 'technical' | 'content' | 'backlink';
type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface Check {
  id: string;
  category: Category;
  label: string;
  passed: boolean;
  severity: Severity;
  detail: string;
  value: string | null;
  weight: number;
  attainment: number;
}

interface Recommendation {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  issue: string;
  fix: string;
  impact: 'high' | 'medium' | 'low';
  checkId: string | null;
  docsUrl: string | null;
}

/** What one seeded run looks like: which problems were still open at the time. */
interface RunShape {
  id: string;
  daysAgo: number;
  overall: number;
  grade: Grade;
  scores: Record<Category, number>;
  durationMs: number;
  mode: 'browser' | 'html';
  /** The ids of the checks that failed on this run. */
  failing: Set<string>;
  metaDescription: string | null;
  wordCount: number;
  responseTimeMs: number;
  missingAlt: number;
  broken: number;
}

function daysAgo(days: number, hour = 9): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 15, 0, 0);
  return date;
}

function check(
  run: RunShape,
  id: string,
  category: Category,
  label: string,
  severity: Severity,
  weight: number,
  copy: { pass: string; fail: string; value?: string | null; partial?: number },
): Check {
  const passed = !run.failing.has(id);
  return {
    id,
    category,
    label,
    passed,
    severity: passed ? 'info' : severity,
    detail: passed ? copy.pass : copy.fail,
    value: copy.value ?? null,
    weight,
    attainment: passed ? 1 : (copy.partial ?? 0),
  };
}

function checksFor(run: RunShape): Check[] {
  const description = run.metaDescription;
  return [
    check(run, 'title-present', 'onPage', 'Title tag', 'critical', 0.2, {
      pass: 'The page has a title.',
      fail: 'The page has no title tag.',
      value: 'Example Domain: plain-language examples',
    }),
    check(run, 'title-length', 'onPage', 'Title length', 'warning', 0.15, {
      pass: '41 characters, inside the 30–60 window.',
      fail: '18 characters; aim for 30–60.',
      value: run.failing.has('title-length') ? '18 characters' : '41 characters',
      partial: 0.5,
    }),
    check(run, 'meta-description-present', 'onPage', 'Meta description', 'warning', 0.2, {
      pass: 'The page has a meta description.',
      fail: 'The page has no meta description, so search engines write their own snippet.',
      value: description === null ? null : `${description.length} characters`,
    }),
    check(run, 'single-h1', 'onPage', 'One H1', 'warning', 0.15, {
      pass: 'Exactly one H1.',
      fail: 'The page has two H1 headings.',
      value: run.failing.has('single-h1') ? '2' : '1',
    }),
    check(run, 'heading-hierarchy', 'onPage', 'Heading hierarchy', 'info', 0.1, {
      pass: 'Headings descend without skipping a level.',
      fail: 'An H4 follows an H2 directly.',
    }),
    check(run, 'image-alt', 'onPage', 'Image alt text', 'warning', 0.1, {
      pass: 'Every image has alt text.',
      fail: `${run.missingAlt} of 6 images have no alt text.`,
      value: `${run.missingAlt} missing`,
      partial: 0.4,
    }),
    check(run, 'open-graph', 'onPage', 'Open Graph tags', 'info', 0.1, {
      pass: 'og:title, og:description and og:image are set.',
      fail: 'No og:image, so shares show no preview.',
    }),

    check(run, 'https', 'technical', 'HTTPS', 'critical', 0.25, {
      pass: 'Served over HTTPS.',
      fail: 'Served over plain HTTP.',
    }),
    check(run, 'certificate', 'technical', 'Certificate', 'critical', 0.1, {
      pass: 'The certificate is valid.',
      fail: 'The certificate could not be verified.',
    }),
    check(run, 'response-time', 'technical', 'Response time', 'warning', 0.2, {
      pass: `${run.responseTimeMs} ms to the last byte.`,
      fail: `${run.responseTimeMs} ms to the last byte; aim for under 800 ms.`,
      value: `${run.responseTimeMs} ms`,
      partial: 0.4,
    }),
    check(run, 'canonical', 'technical', 'Canonical URL', 'warning', 0.15, {
      pass: 'A canonical URL points at this page.',
      fail: 'No canonical link; duplicate URLs may split ranking signals.',
    }),
    check(run, 'robots-txt', 'technical', 'robots.txt', 'info', 0.1, {
      pass: 'robots.txt is present and allows this page.',
      fail: 'No robots.txt was found.',
    }),
    check(run, 'sitemap', 'technical', 'XML sitemap', 'info', 0.1, {
      pass: 'A sitemap is referenced.',
      fail: 'No sitemap was found at /sitemap.xml or in robots.txt.',
    }),
    check(run, 'viewport', 'technical', 'Mobile viewport', 'warning', 0.1, {
      pass: 'A responsive viewport meta tag is set.',
      fail: 'No viewport meta tag; the page is not mobile-friendly.',
    }),

    check(run, 'word-count', 'content', 'Content length', 'warning', 0.3, {
      pass: `${run.wordCount} words of visible text.`,
      fail: `${run.wordCount} words; aim for at least 300.`,
      value: `${run.wordCount} words`,
      partial: 0.4,
    }),
    check(run, 'readability', 'content', 'Readability', 'info', 0.25, {
      pass: 'Flesch reading ease 64: plain English.',
      fail: 'Flesch reading ease 38: hard to read.',
      value: run.failing.has('readability') ? '38' : '64',
      partial: 0.5,
    }),
    check(run, 'keyword-density', 'content', 'Keyword density', 'info', 0.2, {
      pass: 'The top term appears at 2.1%, a natural rate.',
      fail: 'The top term appears at 7.4%, which reads as stuffing.',
      value: run.failing.has('keyword-density') ? '7.4%' : '2.1%',
    }),
    check(run, 'broken-links', 'content', 'Broken links', 'warning', 0.25, {
      pass: 'No broken links among the 12 checked.',
      fail: `${run.broken} of 12 internal links answer 404.`,
      value: `${run.broken} broken`,
      partial: 0.3,
    }),

    check(run, 'domain-authority', 'backlink', 'Domain authority', 'info', 0.6, {
      pass: 'Domain authority 48 (simulated).',
      fail: 'Domain authority 23 (simulated).',
      value: run.failing.has('domain-authority') ? '23' : '48',
      partial: 0.4,
    }),
    check(run, 'trust-pages', 'backlink', 'Trust pages', 'info', 0.2, {
      pass: 'About, contact and privacy pages are linked.',
      fail: 'No privacy or contact page is linked from this page.',
    }),
    check(run, 'social-profiles', 'backlink', 'Social profiles', 'info', 0.2, {
      pass: 'Links to two social profiles.',
      fail: 'No social profile is linked.',
    }),
  ];
}

const REMEDIES: Record<
  string,
  { title: string; fix: string; impact: Recommendation['impact']; docsUrl: string | null }
> = {
  'meta-description-present': {
    title: 'Add a meta description',
    fix: 'Write 120–155 characters that say what the page offers and why to click; include the main keyword once.',
    impact: 'medium',
    docsUrl: `${GOOGLE_DOCS}/appearance/snippet`,
  },
  'title-length': {
    title: 'Lengthen the title',
    fix: 'Rewrite the title to 30–60 characters with the main keyword first and the brand last.',
    impact: 'medium',
    docsUrl: `${GOOGLE_DOCS}/appearance/title-link`,
  },
  'single-h1': {
    title: 'Keep one H1 on the page',
    fix: 'Demote the second H1 to an H2 so the page has one headline.',
    impact: 'low',
    docsUrl: null,
  },
  'image-alt': {
    title: 'Add alt text to every image',
    fix: 'Describe each image in a short phrase; leave decorative images with an empty alt attribute.',
    impact: 'medium',
    docsUrl: `${GOOGLE_DOCS}/appearance/google-images`,
  },
  'open-graph': {
    title: 'Set an Open Graph image',
    fix: 'Add og:image pointing at a 1200×630 image so shares on social networks show a preview.',
    impact: 'low',
    docsUrl: null,
  },
  'response-time': {
    title: 'Speed up the response',
    fix: 'Enable caching for the HTML and compress images; the server took over two seconds to answer.',
    impact: 'high',
    docsUrl: `${GOOGLE_DOCS}/appearance/core-web-vitals`,
  },
  canonical: {
    title: 'Declare a canonical URL',
    fix: 'Add <link rel="canonical" href="https://example.com/"> so duplicate URLs consolidate.',
    impact: 'medium',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/consolidate-duplicate-urls`,
  },
  sitemap: {
    title: 'Publish an XML sitemap',
    fix: 'Generate /sitemap.xml and reference it from robots.txt.',
    impact: 'low',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/sitemaps/overview`,
  },
  'word-count': {
    title: 'Expand the copy',
    fix: 'Add at least 200 words of genuinely useful content: what the product does, for whom, and what to do next.',
    impact: 'high',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/creating-helpful-content`,
  },
  readability: {
    title: 'Simplify the writing',
    fix: 'Shorten sentences to under 20 words and replace jargon; aim for a reading ease above 60.',
    impact: 'low',
    docsUrl: null,
  },
  'broken-links': {
    title: 'Fix the broken links',
    fix: 'Repoint or remove the internal links that answer 404.',
    impact: 'medium',
    docsUrl: null,
  },
  'domain-authority': {
    title: 'Earn links from relevant sites',
    fix: 'Publish something worth citing and ask partners and directories in your niche to link to it.',
    impact: 'medium',
    docsUrl: null,
  },
  'trust-pages': {
    title: 'Link to a contact and privacy page',
    fix: 'Add footer links to a contact page and a privacy policy.',
    impact: 'low',
    docsUrl: null,
  },
};

function recommendationsFor(checks: Check[]): Recommendation[] {
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return checks
    .filter((item) => !item.passed)
    .map((item): Recommendation => {
      const remedy = REMEDIES[item.id] ?? {
        title: `Fix: ${item.label}`,
        fix: item.detail,
        impact: 'low' as const,
        docsUrl: null,
      };
      return {
        id: item.id,
        severity: item.severity,
        category: item.category,
        title: remedy.title,
        issue: item.detail,
        fix: remedy.fix,
        impact: remedy.impact,
        checkId: item.id,
        docsUrl: remedy.docsUrl,
      };
    })
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const WEIGHTS: Record<Category, number> = {
  onPage: 0.3,
  technical: 0.3,
  content: 0.25,
  backlink: 0.15,
};

function auditDataFor(run: RunShape): Prisma.InputJsonValue {
  const checks = checksFor(run);
  const fetchedAt = daysAgo(run.daysAgo).toISOString();
  const categories = (Object.keys(WEIGHTS) as Category[]).map((category) => ({
    category,
    score: run.scores[category],
    weight: WEIGHTS[category],
    estimated: false,
    checks: checks.filter((item) => item.category === category),
  }));

  const crawl = {
    requestedUrl: TARGET_URL,
    finalUrl: TARGET_URL,
    statusCode: 200,
    mode: run.mode,
    responseTimeMs: run.responseTimeMs,
    fetchedAt,
    htmlBytes: 14_880 + run.wordCount * 7,
    https: true,
    certificateValid: true,
    redirects: [],
    compressed: true,
    contentType: 'text/html; charset=utf-8',
    page: {
      title: run.failing.has('title-length')
        ? 'Example Domain'
        : 'Example Domain: plain-language examples',
      metaDescription: run.metaDescription,
      canonical: run.failing.has('canonical') ? null : TARGET_URL,
      robotsMeta: null,
      viewport: 'width=device-width, initial-scale=1',
      lang: 'en',
      charset: 'utf-8',
      headings: run.failing.has('single-h1')
        ? [
            { level: 1, text: 'Example Domain' },
            { level: 1, text: 'Welcome' },
            { level: 2, text: 'More information' },
          ]
        : [
            { level: 1, text: 'Example Domain' },
            { level: 2, text: 'What this domain is for' },
            { level: 2, text: 'More information' },
          ],
      openGraph: run.failing.has('open-graph')
        ? { 'og:title': 'Example Domain' }
        : {
            'og:title': 'Example Domain',
            'og:description': run.metaDescription ?? '',
            'og:image': 'https://example.com/og.png',
          },
      twitterCard: { 'twitter:card': 'summary_large_image' },
      images: { count: 6, missingAlt: run.missingAlt },
      links: {
        internal: [
          'https://example.com/about',
          'https://example.com/contact',
          'https://example.com/pricing',
          'https://example.com/blog',
        ],
        external: ['https://www.iana.org/domains/example'],
        nofollow: 0,
      },
      structuredData: { count: 1, types: ['Organization'], invalid: 0 },
      hreflang: 0,
      favicon: true,
      text: {
        content: 'This domain is for use in illustrative examples in documents.',
        wordCount: run.wordCount,
        sentenceCount: Math.round(run.wordCount / 16),
        paragraphCount: Math.max(2, Math.round(run.wordCount / 90)),
        readability: run.failing.has('readability') ? 38 : 64,
        textToHtmlRatio: Math.min(0.6, Number((run.wordCount / 1_400).toFixed(2))),
        topKeywords: [
          { term: 'domain', count: 6, density: run.failing.has('keyword-density') ? 7.4 : 2.1 },
          { term: 'examples', count: 4, density: 1.4 },
          { term: 'documents', count: 3, density: 1.1 },
        ],
      },
    },
    robotsTxt: 'present',
    sitemap: run.failing.has('sitemap') ? 'missing' : 'present',
    links: {
      checked: 12,
      broken: run.broken,
      sample: run.broken > 0 ? ['https://example.com/old-pricing'] : [],
    },
  };

  const report = {
    overall: run.overall,
    grade: run.grade,
    scores: run.scores,
    categories,
  };

  const authority = {
    source: 'simulation',
    domainAuthority: run.failing.has('domain-authority') ? 23 : 48,
    pageRank: run.failing.has('domain-authority') ? 2.3 : 4.8,
  };

  return { crawl, report, authority } as unknown as Prisma.InputJsonValue;
}

function adviceFor(run: RunShape): Prisma.InputJsonValue {
  const recommendations = recommendationsFor(checksFor(run));
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const item of recommendations) counts[item.severity] += 1;
  const top = recommendations[0];
  const summary = top
    ? `${TARGET_URL} scores ${run.overall}/100 (grade ${run.grade}). The audit raised ${recommendations.length} findings: ${counts.critical} critical, ${counts.warning} warning and ${counts.info} informational. Start with "${top.title}": ${top.issue}`
    : `${TARGET_URL} scores ${run.overall}/100 (grade ${run.grade}) and every check passed.`;

  return {
    source: 'ai',
    model: 'simulation',
    summary,
    recommendations,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * The three runs. Each later run keeps the fixes of the one before, so the
 * trend reads as a site being worked on rather than three unrelated numbers.
 */
const RUNS: RunShape[] = [
  {
    id: 'seed-seo-audit-1',
    daysAgo: 21,
    overall: 58,
    grade: 'F',
    scores: { onPage: 52, technical: 61, content: 55, backlink: 70 },
    durationMs: 11_420,
    mode: 'html',
    failing: new Set([
      'meta-description-present',
      'title-length',
      'single-h1',
      'image-alt',
      'open-graph',
      'response-time',
      'canonical',
      'sitemap',
      'word-count',
      'readability',
      'broken-links',
      'trust-pages',
    ]),
    metaDescription: null,
    wordCount: 140,
    responseTimeMs: 2_310,
    missingAlt: 4,
    broken: 3,
  },
  {
    id: 'seed-seo-audit-2',
    daysAgo: 7,
    overall: 71,
    grade: 'C',
    scores: { onPage: 70, technical: 76, content: 64, backlink: 72 },
    durationMs: 8_860,
    mode: 'browser',
    failing: new Set([
      'image-alt',
      'open-graph',
      'response-time',
      'sitemap',
      'word-count',
      'trust-pages',
    ]),
    metaDescription:
      'Example Domain shows how to use reserved names in documentation, with plain-language examples you can copy.',
    wordCount: 240,
    responseTimeMs: 1_240,
    missingAlt: 2,
    broken: 0,
  },
  {
    id: 'seed-seo-audit-3',
    daysAgo: 1,
    overall: 84,
    grade: 'B',
    scores: { onPage: 88, technical: 86, content: 78, backlink: 80 },
    durationMs: 7_310,
    mode: 'browser',
    failing: new Set(['open-graph', 'word-count']),
    metaDescription:
      'Example Domain shows how to use reserved names in documentation, with plain-language examples you can copy.',
    wordCount: 280,
    responseTimeMs: 640,
    missingAlt: 0,
    broken: 0,
  },
];

export async function seedSeoAudits(prisma: PrismaClient, organizationId: string) {
  await prisma.sEOAudit.deleteMany({ where: { organizationId } });

  for (const run of RUNS) {
    const createdAt = daysAgo(run.daysAgo);
    await prisma.sEOAudit.create({
      data: {
        id: run.id,
        organizationId,
        targetUrl: TARGET_URL,
        finalUrl: TARGET_URL,
        status: SEOAuditStatus.DONE,
        overallScore: run.overall,
        grade: run.grade,
        onPageScore: run.scores.onPage,
        technicalScore: run.scores.technical,
        contentScore: run.scores.content,
        backlinkScore: run.scores.backlink,
        crawlMode: run.mode,
        durationMs: run.durationMs,
        auditData: auditDataFor(run),
        aiAdvice: adviceFor(run),
        createdAt,
        completedAt: new Date(createdAt.getTime() + run.durationMs),
      },
    });
  }

  // A site that does not exist, so the failed treatment is visible in the history.
  const failedAt = daysAgo(2, 16);
  await prisma.sEOAudit.create({
    data: {
      id: 'seed-seo-audit-failed',
      organizationId,
      targetUrl: FAILED_URL,
      status: SEOAuditStatus.FAILED,
      failureReason: 'The site could not be reached.',
      durationMs: 1_980,
      createdAt: failedAt,
    },
  });

  return {
    done: RUNS.map((run) => `${run.id}:${run.overall}/${run.grade}`),
    failed: ['seed-seo-audit-failed'],
  };
}
