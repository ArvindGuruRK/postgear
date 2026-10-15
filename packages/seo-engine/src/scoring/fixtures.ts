/**
 * Crawl results for the scoring tests: one page that does everything right
 * and one that does almost everything wrong. Built by hand rather than
 * through the parser so a parser change cannot silently move the scores.
 */
import type { CrawlResult, ParsedPage } from '../types';

const PASSAGE = Array.from(
  { length: 40 },
  (_, i) =>
    `Widgets make the workshop faster. Our widget guide shows how a widget saves time. Section ${i} explains the widget in plain words.`,
).join(' ');

export function perfectPage(): ParsedPage {
  return {
    title: 'Widget Guide: choosing the right widget for your shop',
    metaDescription:
      'A practical guide to choosing widgets for a small workshop, with sizes, prices and the mistakes to avoid when buying your first one.',
    canonical: 'https://acme.example/widgets',
    robotsMeta: 'index, follow',
    viewport: 'width=device-width, initial-scale=1',
    lang: 'en',
    charset: 'utf-8',
    headings: [
      { level: 1, text: 'Widget guide' },
      { level: 2, text: 'Sizes' },
      { level: 3, text: 'Small' },
      { level: 2, text: 'Prices' },
    ],
    openGraph: { title: 'Widget guide', description: 'Choosing widgets', image: 'https://c/x.png' },
    twitterCard: { card: 'summary_large_image' },
    images: { count: 4, missingAlt: 0 },
    links: {
      internal: [
        'https://acme.example/about',
        'https://acme.example/contact',
        'https://acme.example/pricing',
        'https://acme.example/privacy',
      ],
      external: ['https://en.wikipedia.org/wiki/Widget', 'https://www.linkedin.com/company/acme'],
      nofollow: 0,
    },
    structuredData: { count: 2, types: ['Organization', 'Article'], invalid: 0 },
    hreflang: 0,
    favicon: true,
    text: {
      content: PASSAGE,
      wordCount: 860,
      sentenceCount: 120,
      paragraphCount: 12,
      readability: 62,
      textToHtmlRatio: 0.25,
      topKeywords: [{ term: 'widget', count: 17, density: 2 }],
    },
  };
}

export function perfectCrawl(): CrawlResult {
  return {
    requestedUrl: 'https://acme.example/widgets',
    finalUrl: 'https://acme.example/widgets',
    statusCode: 200,
    mode: 'browser',
    responseTimeMs: 420,
    fetchedAt: '2026-10-15T00:00:00.000Z',
    htmlBytes: 24_000,
    https: true,
    certificateValid: true,
    redirects: [],
    compressed: true,
    contentType: 'text/html; charset=utf-8',
    page: perfectPage(),
    robotsTxt: 'present',
    sitemap: 'present',
    links: { checked: 4, broken: 0, sample: [] },
  };
}

export function barePage(): ParsedPage {
  return {
    title: null,
    metaDescription: null,
    canonical: null,
    robotsMeta: 'noindex, nofollow',
    viewport: null,
    lang: null,
    charset: null,
    headings: [],
    openGraph: {},
    twitterCard: {},
    images: { count: 2, missingAlt: 2 },
    links: { internal: [], external: [], nofollow: 0 },
    structuredData: { count: 0, types: [], invalid: 0 },
    hreflang: 0,
    favicon: false,
    text: {
      content: 'hello world',
      wordCount: 2,
      sentenceCount: 1,
      paragraphCount: 0,
      readability: null,
      textToHtmlRatio: 0.01,
      topKeywords: [],
    },
  };
}

export function bareCrawl(): CrawlResult {
  return {
    requestedUrl: 'http://shop.dev.internal-ish.example/x',
    finalUrl: 'http://shop.dev.internal-ish.example/x',
    statusCode: 200,
    mode: 'html',
    responseTimeMs: 3_100,
    fetchedAt: '2026-10-15T00:00:00.000Z',
    htmlBytes: 900,
    https: false,
    certificateValid: null,
    redirects: ['http://a/', 'http://b/', 'http://c/'],
    compressed: false,
    contentType: 'text/html',
    page: barePage(),
    robotsTxt: 'blocked',
    sitemap: 'missing',
    links: { checked: 4, broken: 3, sample: ['http://x/1', 'http://x/2', 'http://x/3'] },
  };
}
