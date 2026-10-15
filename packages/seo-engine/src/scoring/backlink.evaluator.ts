/**
 * Authority (15% of the score): how much the web trusts this domain.
 *
 * A real answer needs a backlink index, which is what an
 * {@link AuthorityProvider} supplies (Open PageRank's 0–10 decimal, scaled to
 * a 0–100 domain authority). With one, the category is two graded checks and
 * nothing else — there is nothing on the page that can improve it.
 *
 * Without one the category is **estimated** from the signals a trustworthy
 * site tends to show on its own pages: HTTPS, an apex or `www` host rather
 * than a deep subdomain, a mainstream TLD, links to its social profiles,
 * Organization/WebSite structured data, and the about/contact/privacy
 * footer that a real business has. The estimate is capped at 60: these
 * signals can tell an established site from a throwaway, not a strong
 * domain from a weak one, and an `info` check says so and names the fix
 * (connect a provider). `CategoryScore.estimated` carries the flag to the UI.
 */
import {
  type AuthorityEstimate,
  type CategoryScore,
  type CrawlResult,
  SEO_CATEGORY_WEIGHTS,
} from '../types';
import { buildCategory, check } from './checks';

export const ESTIMATE_CAP = 60;

const SOCIAL_HOSTS = [
  'facebook.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'instagram.com',
  'youtube.com',
  'github.com',
  'tiktok.com',
  'pinterest.com',
  'threads.net',
  'mastodon.social',
];

const MAINSTREAM_TLDS = new Set(['com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'dev', 'app']);

const TRUST_PATHS = /\/(about|contact|privacy|terms|imprint|impressum|legal)(\/|\.|$)/i;

export interface AuthoritySignal {
  id: string;
  label: string;
  points: number;
  present: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The on-page signals the estimate is built from, each with its points. */
export function authoritySignals(crawl: CrawlResult): AuthoritySignal[] {
  const host = hostOf(crawl.finalUrl);
  const labels = host.split('.').filter(Boolean);
  const tld = labels[labels.length - 1] ?? '';
  const depth = labels[0] === 'www' ? labels.length - 1 : labels.length;
  const external = crawl.page.links.external;
  const socialHosts = new Set(
    external
      .map(hostOf)
      .map((name) => (name.startsWith('www.') ? name.slice(4) : name))
      .filter((name) =>
        SOCIAL_HOSTS.some((social) => name === social || name.endsWith(`.${social}`)),
      ),
  );
  const types = new Set(crawl.page.structuredData.types.map((type) => type.toLowerCase()));
  const trustLinks = crawl.page.links.internal.some((link) => TRUST_PATHS.test(link));

  return [
    { id: 'https', label: 'Served over HTTPS', points: 10, present: crawl.https },
    { id: 'apex-host', label: 'Apex or www host', points: 10, present: depth <= 2 },
    {
      id: 'tld',
      label: 'Mainstream top-level domain',
      points: 8,
      present: MAINSTREAM_TLDS.has(tld) || tld.length === 2,
    },
    {
      id: 'social-profiles',
      label: 'Links to social profiles',
      points: Math.min(12, socialHosts.size * 4),
      present: socialHosts.size > 0,
    },
    {
      id: 'organization-schema',
      label: 'Organization or WebSite structured data',
      points: 10,
      present: types.has('organization') || types.has('website') || types.has('localbusiness'),
    },
    { id: 'trust-pages', label: 'About, contact or legal pages', points: 10, present: trustLinks },
  ];
}

/** 0–60 from the signals above; the cap is the whole point. */
export function estimateAuthority(crawl: CrawlResult): {
  score: number;
  signals: AuthoritySignal[];
} {
  const signals = authoritySignals(crawl);
  const raw = signals.reduce((sum, signal) => sum + (signal.present ? signal.points : 0), 0);
  return { score: Math.min(ESTIMATE_CAP, raw), signals };
}

export function evaluateBacklink(
  crawl: CrawlResult,
  authority: AuthorityEstimate | null,
): CategoryScore {
  const category = 'backlink' as const;

  if (authority) {
    const domainAuthority = Math.min(100, Math.max(0, authority.domainAuthority));
    const pageRank =
      authority.pageRank === null ? null : Math.min(10, Math.max(0, authority.pageRank));
    const checks = [
      check({
        id: 'domain-authority',
        category,
        label: 'Domain authority',
        weight: 0.6,
        severity: 'warning',
        passed: domainAuthority >= 30,
        attainment: domainAuthority / 100,
        detail:
          domainAuthority >= 50
            ? `Domain authority ${domainAuthority}/100 (${authority.source}).`
            : domainAuthority >= 30
              ? `Domain authority ${domainAuthority}/100 (${authority.source}); earning links from established sites would raise it.`
              : `Domain authority ${domainAuthority}/100 (${authority.source}) is low; few sites link here.`,
        value: `${domainAuthority}/100`,
      }),
      check({
        id: 'page-rank',
        category,
        label: 'PageRank',
        weight: 0.4,
        severity: 'info',
        passed: (pageRank ?? domainAuthority / 10) >= 3,
        attainment: pageRank === null ? domainAuthority / 100 : pageRank / 10,
        detail:
          pageRank === null
            ? 'No PageRank value from the provider; graded from domain authority.'
            : `Open PageRank ${pageRank}/10.`,
        value: pageRank === null ? null : `${pageRank}/10`,
      }),
    ];
    return buildCategory(category, SEO_CATEGORY_WEIGHTS.backlink, checks, false);
  }

  const { score, signals } = estimateAuthority(crawl);
  const present = signals.filter((signal) => signal.present);
  const missing = signals.filter((signal) => !signal.present);
  const checks = [
    check({
      id: 'domain-authority',
      category,
      label: 'Domain authority (estimated)',
      weight: 0.6,
      severity: 'warning',
      passed: score >= 30,
      attainment: score / 100,
      detail: `Estimated ${score}/100 from on-page signals (capped at ${ESTIMATE_CAP}).`,
      value: `~${score}/100`,
    }),
    check({
      id: 'authority-signals',
      category,
      label: 'Trust signals',
      weight: 0.3,
      severity: 'info',
      passed: missing.length === 0,
      attainment: present.length / signals.length,
      detail:
        missing.length === 0
          ? 'Every trust signal is present.'
          : `Missing: ${missing.map((signal) => signal.label.toLowerCase()).join(', ')}.`,
      value: `${present.length}/${signals.length}`,
    }),
    check({
      id: 'authority-source',
      category,
      label: 'Authority data',
      weight: 0.1,
      severity: 'info',
      passed: false,
      // Costs nothing: it is a note that the number above is a guess.
      attainment: 1,
      detail: 'Estimated — connect an authority provider (Open PageRank) for a measured score.',
    }),
  ];
  return buildCategory(category, SEO_CATEGORY_WEIGHTS.backlink, checks, true);
}
