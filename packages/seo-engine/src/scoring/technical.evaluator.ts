/**
 * Technical SEO (30% of the score): what the fetch said about the site.
 *
 * HTTPS, a trusted certificate, a 2xx status and the absence of `noindex` are
 * critical — any one of them keeps the page out of results or marks it "not
 * secure", and no amount of copy fixes that. Speed and broken links are
 * warnings, graded: 800 ms earns full marks and 2.5 s none, matching the
 * range where field data shows bounce rates climbing; a page is only as
 * broken as the share of its links that fail. Everything the site may
 * legitimately not have (structured data, hreflang, a favicon, compression)
 * is information.
 *
 * Unknowns do not cost points. A robots.txt or sitemap the crawler could not
 * fetch in time is `unknown` and scores as if fine — penalising a site for
 * our own timeout would make the score depend on the crawler's luck.
 */
import { type CategoryScore, type CrawlResult, SEO_CATEGORY_WEIGHTS } from '../types';
import { buildCategory, check, plural, ramp } from './checks';

export const RESPONSE_TIME_FULL_MS = 800;
export const RESPONSE_TIME_ZERO_MS = 2_500;
/** Above this the response-time check fails outright (still graded below it). */
export const RESPONSE_TIME_PASS_MS = 1_500;

export function isNoindex(robotsMeta: string | null): boolean {
  if (!robotsMeta) return false;
  const directives = robotsMeta
    .toLowerCase()
    .split(',')
    .map((item) => item.trim());
  return directives.includes('noindex') || directives.includes('none');
}

export function evaluateTechnical(crawl: CrawlResult): CategoryScore {
  const category = 'technical' as const;
  const page = crawl.page;
  const statusOk = crawl.statusCode >= 200 && crawl.statusCode < 300;
  const noindex = isNoindex(page.robotsMeta);
  const brokenShare = crawl.links.checked === 0 ? 0 : crawl.links.broken / crawl.links.checked;
  const hops = crawl.redirects.length;
  const mobileViewport = (page.viewport ?? '').toLowerCase().includes('width');

  const checks = [
    check({
      id: 'https',
      category,
      label: 'HTTPS',
      weight: 0.14,
      severity: 'critical',
      passed: crawl.https,
      detail: crawl.https
        ? 'The page is served over HTTPS.'
        : 'The page is served over plain HTTP.',
    }),
    check({
      id: 'certificate',
      category,
      label: 'TLS certificate',
      weight: 0.08,
      severity: crawl.https ? 'critical' : 'info',
      passed: crawl.https && crawl.certificateValid !== false,
      detail: !crawl.https
        ? 'No certificate: the page is not served over HTTPS.'
        : crawl.certificateValid === false
          ? 'The certificate is not trusted (expired, self-signed or for another host).'
          : crawl.certificateValid === null
            ? 'The certificate could not be inspected; assumed valid.'
            : 'The certificate is valid and trusted.',
    }),
    check({
      id: 'status-ok',
      category,
      label: 'HTTP status',
      weight: 0.1,
      severity: 'critical',
      passed: statusOk,
      detail: statusOk ? 'The page answered 2xx.' : `The page answered HTTP ${crawl.statusCode}.`,
      value: String(crawl.statusCode),
    }),
    check({
      id: 'response-time',
      category,
      label: 'Response time',
      weight: 0.1,
      severity: 'warning',
      passed: crawl.responseTimeMs <= RESPONSE_TIME_PASS_MS,
      attainment: ramp(crawl.responseTimeMs, RESPONSE_TIME_ZERO_MS, RESPONSE_TIME_FULL_MS),
      detail:
        crawl.responseTimeMs <= RESPONSE_TIME_FULL_MS
          ? 'The page responded quickly.'
          : crawl.responseTimeMs <= RESPONSE_TIME_PASS_MS
            ? `The page took ${crawl.responseTimeMs} ms; under ${RESPONSE_TIME_FULL_MS} ms is ideal.`
            : `The page took ${crawl.responseTimeMs} ms to respond, which is slow.`,
      value: `${crawl.responseTimeMs} ms`,
    }),
    check({
      id: 'viewport',
      category,
      label: 'Mobile viewport',
      weight: 0.1,
      severity: 'warning',
      passed: mobileViewport,
      detail: mobileViewport
        ? 'A responsive viewport is declared.'
        : page.viewport
          ? 'The viewport meta does not set a width; phones will render the desktop layout.'
          : 'No viewport meta tag; the page is not mobile-friendly.',
      value: page.viewport,
    }),
    check({
      id: 'robots-txt',
      category,
      label: 'robots.txt',
      weight: 0.07,
      severity: crawl.robotsTxt === 'blocked' ? 'critical' : 'info',
      passed: crawl.robotsTxt === 'present' || crawl.robotsTxt === 'unknown',
      attainment: crawl.robotsTxt === 'blocked' ? 0 : crawl.robotsTxt === 'missing' ? 0.5 : 1,
      detail:
        crawl.robotsTxt === 'present'
          ? 'robots.txt exists and allows this page.'
          : crawl.robotsTxt === 'blocked'
            ? 'robots.txt disallows this page for every crawler.'
            : crawl.robotsTxt === 'missing'
              ? 'No robots.txt; crawlers assume everything is allowed.'
              : 'robots.txt could not be fetched in time.',
      value: crawl.robotsTxt,
    }),
    check({
      id: 'sitemap',
      category,
      label: 'XML sitemap',
      weight: 0.06,
      severity: 'warning',
      passed: crawl.sitemap !== 'missing',
      detail:
        crawl.sitemap === 'present'
          ? 'A sitemap is published.'
          : crawl.sitemap === 'missing'
            ? 'No /sitemap.xml and no Sitemap: line in robots.txt.'
            : 'The sitemap could not be checked in time.',
      value: crawl.sitemap,
    }),
    check({
      id: 'broken-links',
      category,
      label: 'Broken links',
      weight: 0.08,
      severity: 'warning',
      passed: crawl.links.broken === 0,
      attainment: 1 - Math.min(1, brokenShare * 2),
      detail:
        crawl.links.checked === 0
          ? 'No internal links were checked.'
          : crawl.links.broken === 0
            ? `All ${plural(crawl.links.checked, 'checked link')} work.`
            : `${crawl.links.broken} of ${plural(crawl.links.checked, 'checked link')} are broken.`,
      value: crawl.links.checked === 0 ? null : `${crawl.links.broken}/${crawl.links.checked}`,
    }),
    check({
      id: 'noindex',
      category,
      label: 'Indexable',
      weight: 0.1,
      severity: 'critical',
      passed: !noindex,
      detail: noindex
        ? 'A robots meta tag says noindex; search engines will drop this page.'
        : 'No noindex directive.',
      value: page.robotsMeta,
    }),
    check({
      id: 'structured-data',
      category,
      label: 'Structured data',
      weight: 0.05,
      severity: page.structuredData.invalid > 0 ? 'warning' : 'info',
      passed: page.structuredData.count > 0 && page.structuredData.invalid === 0,
      attainment: page.structuredData.count === 0 ? 0 : page.structuredData.invalid === 0 ? 1 : 0.5,
      detail:
        page.structuredData.count === 0
          ? 'No JSON-LD structured data.'
          : page.structuredData.invalid > 0
            ? `${plural(page.structuredData.invalid, 'JSON-LD block')} could not be parsed.`
            : `${plural(page.structuredData.count, 'JSON-LD block')} (${page.structuredData.types.slice(0, 5).join(', ') || 'untyped'}).`,
      value: page.structuredData.types.slice(0, 5).join(', ') || null,
    }),
    check({
      id: 'compression',
      category,
      label: 'Compression',
      weight: 0.04,
      severity: 'info',
      passed: crawl.compressed,
      detail: crawl.compressed
        ? 'The HTML was served compressed.'
        : 'The HTML was not compressed (gzip or brotli).',
    }),
    check({
      id: 'redirect-chain',
      category,
      label: 'Redirects',
      weight: 0.03,
      severity: 'info',
      passed: hops <= 1,
      attainment: hops <= 1 ? 1 : hops === 2 ? 0.5 : 0,
      detail:
        hops === 0
          ? 'No redirects.'
          : hops === 1
            ? 'One redirect before the final page.'
            : `${plural(hops, 'redirect')} before the final page.`,
      value: plural(hops, 'hop'),
    }),
    check({
      id: 'hreflang',
      category,
      label: 'hreflang',
      weight: 0.02,
      severity: 'info',
      passed: true,
      detail:
        page.hreflang > 0
          ? `${plural(page.hreflang, 'language alternate')} declared.`
          : 'No hreflang alternates; fine for a single-language site.',
      value: page.hreflang > 0 ? String(page.hreflang) : null,
    }),
    check({
      id: 'favicon',
      category,
      label: 'Favicon',
      weight: 0.03,
      severity: 'info',
      passed: page.favicon,
      detail: page.favicon ? 'A favicon is linked.' : 'No favicon link.',
    }),
  ];

  return buildCategory(category, SEO_CATEGORY_WEIGHTS.technical, checks);
}
