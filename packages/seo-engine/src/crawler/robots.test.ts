import { isPathBlocked, parseRobotsTxt, robotsPathMatches } from './robots';

describe('parseRobotsTxt', () => {
  it('reads only the wildcard group and every Sitemap line', () => {
    const rules = parseRobotsTxt(`
      # comment
      Sitemap: https://a.example/sitemap.xml
      User-agent: Googlebot
      Disallow: /google-only

      User-agent: *
      User-agent: Bingbot
      Disallow: /private
      Allow: /private/open
      Disallow:

      User-agent: Other
      Disallow: /
      Sitemap: https://a.example/news.xml
    `);
    expect(rules.hasWildcardGroup).toBe(true);
    expect(rules.disallow).toEqual(['/private']);
    expect(rules.allow).toEqual(['/private/open']);
    expect(rules.sitemaps).toEqual(['https://a.example/sitemap.xml', 'https://a.example/news.xml']);
  });

  it('reports no wildcard group when there is none', () => {
    expect(parseRobotsTxt('User-agent: Googlebot\nDisallow: /').hasWildcardGroup).toBe(false);
  });
});

describe('robotsPathMatches', () => {
  it('matches prefixes, wildcards and end anchors', () => {
    expect(robotsPathMatches('/private', '/private/x')).toBe(true);
    expect(robotsPathMatches('/private', '/public')).toBe(false);
    expect(robotsPathMatches('/*.pdf$', '/docs/a.pdf')).toBe(true);
    expect(robotsPathMatches('/*.pdf$', '/docs/a.pdf?x')).toBe(false);
    expect(robotsPathMatches('/', '/anything')).toBe(true);
    expect(robotsPathMatches('', '/anything')).toBe(false);
  });
});

describe('isPathBlocked', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private\nAllow: /private/open');

  it('applies the longest match, allow winning ties', () => {
    expect(isPathBlocked(rules, '/private/secret')).toBe(true);
    expect(isPathBlocked(rules, '/private/open/page')).toBe(false);
    expect(isPathBlocked(rules, '/public')).toBe(false);
    expect(isPathBlocked(parseRobotsTxt('User-agent: *\nDisallow: /'), '/')).toBe(true);
  });
});
