/**
 * A robots.txt reader for one question: does the file disallow the crawled
 * path for every agent?
 *
 * Only the `User-agent: *` group is read. The analyzer is not Googlebot and
 * does not pretend to be; what it reports is whether a site has shut the
 * page to crawlers in general, which is the mistake a user wants told about.
 * Matching follows the robots.txt RFC (9309): rules are path prefixes, `*`
 * matches anything, `$` anchors the end, the longest matching rule wins and
 * `Allow` beats `Disallow` on a tie. `Sitemap:` lines are collected from the
 * whole file, as the RFC says they are group-independent.
 */

export interface RobotsRules {
  /** The file had a `User-agent: *` group. */
  hasWildcardGroup: boolean;
  allow: string[];
  disallow: string[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { hasWildcardGroup: false, allow: [], disallow: [], sitemaps: [] };
  let inWildcard = false;
  let readingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'sitemap') {
      if (value) rules.sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group; a User-agent after
      // rules starts a new group.
      if (!readingAgents) inWildcard = false;
      readingAgents = true;
      if (value === '*') {
        inWildcard = true;
        rules.hasWildcardGroup = true;
      }
      continue;
    }
    readingAgents = false;
    if (!inWildcard) continue;
    if (field === 'disallow') {
      if (value) rules.disallow.push(value);
    } else if (field === 'allow') {
      if (value) rules.allow.push(value);
    }
  }

  return rules;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** `pattern` is a robots.txt path rule: a prefix with `*` wildcards and an optional `$` anchor. */
export function robotsPathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = `^${body.split('*').map(escapeRegExp).join('.*')}${anchored ? '$' : ''}`;
  return new RegExp(source).test(path);
}

export function isPathBlocked(rules: RobotsRules, path: string): boolean {
  const longest = (patterns: string[]) =>
    patterns.reduce(
      (best, pattern) =>
        robotsPathMatches(pattern, path) && pattern.length > best ? pattern.length : best,
      -1,
    );
  const disallow = longest(rules.disallow);
  if (disallow === -1) return false;
  const allow = longest(rules.allow);
  return disallow > allow;
}
