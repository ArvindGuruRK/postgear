/**
 * Folds the four categories into one score, turns failed checks into
 * recommendations, and digests an audit for the AI advisor.
 *
 * The composite is the weighted mean of the category scores with the
 * weights from `project_structure.md` (30/30/25/15), rounded once at the
 * end; the grade bands are the school-report ones because that is how users
 * read a letter. `findingsFromReport` is the rule-based advice — what the
 * UI shows when no model is available, and the floor the model's advice is
 * compared against: every failed check gets a title, the issue, a concrete
 * fix and, where one exists, a link to the public documentation that says
 * why. `summariseForAdvice` is the opposite direction: a short, labelled
 * plain-text digest of the audit for a prompt, capped at 2 500 characters so
 * a page with four hundred headings costs the same tokens as one with four.
 */
import {
  type AuthorityEstimate,
  type CategoryScore,
  type CrawlResult,
  SEO_CATEGORY_WEIGHTS,
  type SeoAudit,
  type SeoCategory,
  type SeoCheck,
  type SeoGrade,
  type SeoImpact,
  type SeoRecommendation,
  type SeoScoreReport,
  type SeoSeverity,
} from '../types';
import { evaluateBacklink } from './backlink.evaluator';
import { scoreCategory } from './checks';
import { evaluateContent } from './content.evaluator';
import { evaluateOnPage } from './on-page.evaluator';
import { evaluateTechnical } from './technical.evaluator';

export { scoreCategory };

export const ADVICE_DIGEST_MAX_CHARS = 2_500;

export function gradeFor(score: number): SeoGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function calculateScore(categories: CategoryScore[]): SeoScoreReport {
  const scores: Record<SeoCategory, number> = { onPage: 0, technical: 0, content: 0, backlink: 0 };
  let weighted = 0;
  let totalWeight = 0;
  for (const category of categories) {
    const weight = SEO_CATEGORY_WEIGHTS[category.category];
    scores[category.category] = category.score;
    weighted += weight * category.score;
    totalWeight += weight;
  }
  const overall = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  return { overall, grade: gradeFor(overall), scores, categories };
}

export function evaluateAll(
  crawl: CrawlResult,
  authority: AuthorityEstimate | null,
): SeoScoreReport {
  return calculateScore([
    evaluateOnPage(crawl),
    evaluateTechnical(crawl),
    evaluateContent(crawl),
    evaluateBacklink(crawl, authority),
  ]);
}

// ---------------------------------------------------------------------------
// Rule-based recommendations
// ---------------------------------------------------------------------------

interface Remedy {
  title: string;
  issue: string;
  fix: string;
  docsUrl: string | null;
}

const GOOGLE_DOCS = 'https://developers.google.com/search/docs';

/**
 * One remedy per check id. `issue` may be omitted, in which case the check's
 * own detail (always one safe line) is used.
 */
const REMEDIES: Record<string, Partial<Remedy> & { title: string; fix: string }> = {
  'title-present': {
    title: 'Add a title tag',
    fix: 'Add a <title> in <head> that names the page and the site, 30–60 characters.',
    docsUrl: `${GOOGLE_DOCS}/appearance/title-link`,
  },
  'title-length': {
    title: 'Adjust the title length',
    fix: 'Rewrite the <title> to 30–60 characters, leading with the page topic.',
    docsUrl: `${GOOGLE_DOCS}/appearance/title-link`,
  },
  'meta-description-present': {
    title: 'Add a meta description',
    fix: 'Add <meta name="description"> with a 70–160 character summary that invites a click.',
    docsUrl: `${GOOGLE_DOCS}/appearance/snippet`,
  },
  'meta-description-length': {
    title: 'Adjust the meta description length',
    fix: 'Rewrite the description to 70–160 characters so results show it in full.',
    docsUrl: `${GOOGLE_DOCS}/appearance/snippet`,
  },
  'single-h1': {
    title: 'Use exactly one H1',
    fix: 'Give the page one <h1> that states its topic; demote other H1s to H2.',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/seo-starter-guide`,
  },
  'heading-hierarchy': {
    title: 'Fix the heading order',
    fix: 'Nest headings without skipping levels (H1, then H2, then H3).',
    docsUrl: 'https://www.w3.org/WAI/tutorials/page-structure/headings/',
  },
  'image-alt': {
    title: 'Add alt text to images',
    fix: 'Describe each meaningful image in its alt attribute; use alt="" only for decoration.',
    docsUrl: `${GOOGLE_DOCS}/appearance/google-images`,
  },
  'open-graph': {
    title: 'Complete the Open Graph tags',
    fix: 'Add og:title, og:description and an og:image of at least 1200×630 pixels.',
    docsUrl: 'https://ogp.me/',
  },
  canonical: {
    title: 'Declare a canonical URL',
    fix: 'Add <link rel="canonical"> pointing at the preferred URL of this page.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/consolidate-duplicate-urls`,
  },
  'lang-attribute': {
    title: 'Declare the page language',
    fix: 'Add lang="en" (or the right code) to the <html> element.',
    docsUrl: 'https://www.w3.org/International/questions/qa-html-language-declarations',
  },
  'twitter-card': {
    title: 'Add a Twitter card',
    fix: 'Add <meta name="twitter:card" content="summary_large_image"> alongside the Open Graph tags.',
    docsUrl: 'https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards',
  },
  https: {
    title: 'Serve the page over HTTPS',
    fix: 'Install a certificate and redirect every http:// URL to https://.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/https`,
  },
  certificate: {
    title: 'Fix the TLS certificate',
    fix: 'Renew or replace the certificate so browsers trust it for this host name.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/https`,
  },
  'status-ok': {
    title: 'Return a 200 status',
    fix: 'Make the URL answer 200 OK; fix the error or redirect to the live page.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/http-network-errors`,
  },
  'response-time': {
    title: 'Speed up the response',
    fix: 'Cache the page, enable compression, trim render-blocking resources and use a CDN.',
    docsUrl: 'https://web.dev/articles/ttfb',
  },
  viewport: {
    title: 'Add a mobile viewport',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/mobile/mobile-sites-mobile-first-indexing`,
  },
  'robots-txt': {
    title: 'Fix robots.txt',
    fix: 'Publish /robots.txt and make sure it does not Disallow this page for User-agent: *.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/robots/intro`,
  },
  sitemap: {
    title: 'Publish an XML sitemap',
    fix: 'Generate /sitemap.xml and reference it from robots.txt with a Sitemap: line.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/sitemaps/overview`,
  },
  'broken-links': {
    title: 'Repair broken links',
    fix: 'Update or remove the links that return 4xx/5xx; redirect moved pages.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/http-network-errors`,
  },
  noindex: {
    title: 'Remove the noindex directive',
    fix: 'Delete noindex from the robots meta tag (or X-Robots-Tag) if this page should rank.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/block-indexing`,
  },
  'structured-data': {
    title: 'Add structured data',
    fix: 'Add a JSON-LD block (Organization, Article, Product…) and validate it.',
    docsUrl: `${GOOGLE_DOCS}/appearance/structured-data/intro-structured-data`,
  },
  compression: {
    title: 'Enable compression',
    fix: 'Turn on gzip or brotli for HTML responses at the server or CDN.',
    docsUrl: 'https://web.dev/articles/reduce-network-payloads-using-text-compression',
  },
  'redirect-chain': {
    title: 'Shorten the redirect chain',
    fix: 'Point links and redirects straight at the final URL; one hop at most.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/301-redirects`,
  },
  favicon: {
    title: 'Add a favicon',
    fix: 'Link an icon with <link rel="icon"> so results and tabs show your mark.',
    docsUrl: `${GOOGLE_DOCS}/appearance/favicon-in-search`,
  },
  'word-count': {
    title: 'Add more content',
    fix: 'Expand the page to at least 300 words of useful text; 800+ for competitive topics.',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/creating-helpful-content`,
  },
  readability: {
    title: 'Improve readability',
    fix: 'Use shorter sentences and everyday words; aim for a Flesch score of 50–70.',
    docsUrl: 'https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests',
  },
  'keyword-density': {
    title: 'Focus the topic',
    fix: 'Use the main term naturally in the title, H1 and body (0.5–3% of words) without repeating it.',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/seo-starter-guide`,
  },
  'internal-links': {
    title: 'Add internal links',
    fix: 'Link to at least three related pages on the site with descriptive anchor text.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/links-crawlable`,
  },
  'external-links': {
    title: 'Cite outside sources',
    fix: 'Link to at least one authoritative external source that supports the content.',
    docsUrl: `${GOOGLE_DOCS}/crawling-indexing/links-crawlable`,
  },
  'text-html-ratio': {
    title: 'Reduce markup overhead',
    fix: 'Trim inline scripts and styles, or add content, so visible text is at least 10% of the HTML.',
    docsUrl: null,
  },
  paragraphs: {
    title: 'Break text into paragraphs',
    fix: 'Split the copy into at least three short paragraphs.',
    docsUrl: null,
  },
  'heading-coverage': {
    title: 'Add subheadings',
    fix: 'Add an H2 or H3 roughly every 300 words so readers can scan.',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/seo-starter-guide`,
  },
  'domain-authority': {
    title: 'Earn links from established sites',
    fix: 'Publish content worth citing and reach out to relevant sites and directories.',
    docsUrl: `${GOOGLE_DOCS}/fundamentals/creating-helpful-content`,
  },
  'page-rank': {
    title: 'Build inbound links',
    fix: 'Earn editorial links from pages that already rank for related topics.',
    docsUrl: null,
  },
  'authority-signals': {
    title: 'Show trust signals',
    fix: 'Add about, contact and privacy pages, link your social profiles, and add Organization JSON-LD.',
    docsUrl: `${GOOGLE_DOCS}/appearance/structured-data/organization`,
  },
  'authority-source': {
    title: 'Connect an authority provider',
    fix: 'Set OPEN_PAGERANK_API_KEY so the authority score is measured instead of estimated.',
    docsUrl: 'https://www.domcop.com/openpagerank/what-is-openpagerank',
  },
};

const IMPACT_BY_SEVERITY: Record<SeoSeverity, SeoImpact> = {
  critical: 'high',
  warning: 'medium',
  info: 'low',
};

const SEVERITY_ORDER: Record<SeoSeverity, number> = { critical: 0, warning: 1, info: 2 };

function recommendationFor(check: SeoCheck): SeoRecommendation {
  const remedy = REMEDIES[check.id];
  return {
    id: `rec-${check.id}`,
    severity: check.severity,
    category: check.category,
    title: remedy?.title ?? `Fix: ${check.label}`,
    issue: remedy?.issue ?? check.detail,
    fix: remedy?.fix ?? 'Review this check and address what it reports.',
    impact: IMPACT_BY_SEVERITY[check.severity],
    checkId: check.id,
    docsUrl: remedy?.docsUrl ?? null,
  };
}

/** One recommendation per failed check, critical first, then by weight. */
export function findingsFromReport(report: SeoScoreReport): SeoRecommendation[] {
  const failed = report.categories.flatMap((category) =>
    category.checks.filter((item) => !item.passed).map((item) => ({ item, category })),
  );
  failed.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity];
    if (bySeverity !== 0) return bySeverity;
    const byWeight = b.item.weight * b.category.weight - a.item.weight * a.category.weight;
    if (byWeight !== 0) return byWeight;
    return a.item.id.localeCompare(b.item.id);
  });
  return failed.map(({ item }) => recommendationFor(item));
}

// ---------------------------------------------------------------------------
// The advisor's digest
// ---------------------------------------------------------------------------

function clip(text: string | null, max: number): string {
  if (!text) return '(none)';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * A labelled plain-text digest of the audit, under 2 500 characters. Only
 * one-line facts: never the page text, never more than the first few
 * headings, and failed checks by their safe `detail`.
 */
export function summariseForAdvice(audit: SeoAudit): string {
  const { crawl, report, authority } = audit;
  const page = crawl.page;
  const lines: string[] = [
    `URL: ${clip(crawl.finalUrl, 120)}`,
    `Score: ${report.overall}/100 (${report.grade}) — on-page ${report.scores.onPage}, technical ${report.scores.technical}, content ${report.scores.content}, authority ${report.scores.backlink}${report.categories.find((c) => c.category === 'backlink')?.estimated ? ' (estimated)' : ''}`,
    `Fetch: HTTP ${crawl.statusCode}, ${crawl.mode} mode, ${crawl.responseTimeMs} ms, ${crawl.https ? 'https' : 'http'}${crawl.certificateValid === false ? ' (bad certificate)' : ''}, ${crawl.redirects.length} redirects, ${crawl.compressed ? 'compressed' : 'uncompressed'}`,
    `Title (${page.title?.length ?? 0} chars): ${clip(page.title, 80)}`,
    `Meta description (${page.metaDescription?.length ?? 0} chars): ${clip(page.metaDescription, 120)}`,
    `Headings: ${page.headings.length} total, ${page.headings.filter((h) => h.level === 1).length} H1; first: ${
      page.headings
        .slice(0, 3)
        .map((h) => `H${h.level} "${clip(h.text, 40)}"`)
        .join(', ') || '(none)'
    }`,
    `Content: ${page.text.wordCount} words, ${page.text.paragraphCount} paragraphs, Flesch ${page.text.readability ?? 'n/a'}, text/HTML ${Math.round(page.text.textToHtmlRatio * 100)}%`,
    `Keywords: ${
      page.text.topKeywords
        .slice(0, 5)
        .map((k) => `${k.term} ${k.density}%`)
        .join(', ') || '(none)'
    }`,
    `Links: ${page.links.internal.length} internal, ${page.links.external.length} external, ${page.links.nofollow} nofollow; ${crawl.links.broken}/${crawl.links.checked} checked links broken`,
    `Images: ${page.images.count}, ${page.images.missingAlt} without alt`,
    `Signals: canonical ${page.canonical ? 'yes' : 'no'}, viewport ${page.viewport ? 'yes' : 'no'}, lang ${page.lang ?? 'none'}, robots meta ${page.robotsMeta ?? 'none'}, OG ${Object.keys(page.openGraph).length} tags, twitter ${Object.keys(page.twitterCard).length} tags, JSON-LD ${page.structuredData.count} (${page.structuredData.types.slice(0, 4).join(', ') || 'none'}), hreflang ${page.hreflang}, favicon ${page.favicon ? 'yes' : 'no'}`,
    `Site: robots.txt ${crawl.robotsTxt}, sitemap ${crawl.sitemap}`,
    `Authority: ${authority ? `${authority.domainAuthority}/100 (${authority.source}${authority.pageRank !== null ? `, PR ${authority.pageRank}` : ''})` : 'no provider (estimated)'}`,
  ];

  const header = `${lines.join('\n')}\nFailed checks:`;
  const failed = report.categories.flatMap((category) =>
    category.checks
      .filter((item) => !item.passed)
      .map((item) => `- [${item.severity}] ${item.id}: ${clip(item.detail, 140)}`),
  );
  if (failed.length === 0) failed.push('- none');

  let digest = header;
  for (const line of failed) {
    if (digest.length + line.length + 1 > ADVICE_DIGEST_MAX_CHARS - 20) {
      digest += '\n- (more omitted)';
      break;
    }
    digest += `\n${line}`;
  }
  return digest.length > ADVICE_DIGEST_MAX_CHARS
    ? digest.slice(0, ADVICE_DIGEST_MAX_CHARS)
    : digest;
}
