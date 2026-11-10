import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMON_FEED_PATHS,
  discoverFeeds,
  feedFormatOf,
  findFeedLinks,
  MAX_DISCOVERED_FEEDS,
} from './discover-feeds';
import { FEED_ACCEPT } from './sources/rss';
import type { DiscoverFetch, DiscoverFetchResponse } from './types';

const ACME = join(__dirname, '..', 'fixtures', 'competitors', 'acme');
const SITE = readFileSync(join(ACME, 'site.sample.html'), 'utf8');
const BLOG = readFileSync(join(ACME, 'blog-rss.sample.xml'), 'utf8');
const CHANGELOG = readFileSync(join(ACME, 'changelog-atom.sample.xml'), 'utf8');

const SITE_URL = 'https://acme.example/';
const PLAIN_PAGE =
  '<!doctype html><html><head><title>No feeds</title></head><body>Hi</body></html>';

function rssNamed(title: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><title>A post</title></item></channel></rss>`;
}

function atomNamed(title: string): string {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${title}</title><entry><title>An entry</title></entry></feed>`;
}

function link(attributes: string): string {
  return `<link ${attributes}>`;
}

function page(...links: string[]): string {
  return `<!doctype html><html><head>${links.join('')}</head><body></body></html>`;
}

type Answer = Partial<DiscoverFetchResponse> | Error | { thrown: unknown };

/**
 * A site that answers the paths it is given and 404 for every other one. Keys are
 * paths (`/feed`), matched against the path of the address asked.
 */
function siteAnswering(answers: Record<string, Answer> = {}) {
  return jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    const answer = answers[new URL(url).pathname];
    if (answer === undefined) return { status: 404, body: '', finalUrl: url };
    if (answer instanceof Error) throw answer;
    if ('thrown' in answer) throw answer.thrown;
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
}

describe('findFeedLinks', () => {
  it('finds the two feeds the sample site links, in its order, and nothing else', () => {
    expect(findFeedLinks(SITE, SITE_URL)).toEqual([
      // Written as `/blog/rss.xml` on the page.
      { url: 'https://acme.example/blog/rss.xml', title: 'Blog', kind: 'rss' },
      { url: 'https://acme.example/changelog/atom.xml', title: 'Changelog', kind: 'atom' },
    ]);
    // The page also has a stylesheet, an icon and an `hreflang` alternate.
    expect(SITE).toContain('rel="stylesheet"');
    expect(SITE).toContain('hreflang="fr"');
  });

  it('resolves a relative link against the page it is on', () => {
    const html = page(link('rel="alternate" type="application/rss+xml" href="feed.xml"'));

    expect(findFeedLinks(html, 'https://acme.example/blog/')).toEqual([
      { url: 'https://acme.example/blog/feed.xml', title: '', kind: 'rss' },
    ]);
  });

  it('reads rel and type in any case, with other words beside them, in either quote style', () => {
    const html = page(
      link('REL="Alternate Home" TYPE="Application/RSS+XML" HREF="/a.xml" title="A"'),
      link("rel='feed alternate' type=' application/atom+xml ' href='/b.xml' title='B'"),
      link('rel=alternate type=application/rss+xml href=/c.xml title=C'),
    );

    expect(findFeedLinks(html, SITE_URL)).toEqual([
      { url: 'https://acme.example/a.xml', title: 'A', kind: 'rss' },
      { url: 'https://acme.example/b.xml', title: 'B', kind: 'atom' },
      { url: 'https://acme.example/c.xml', title: 'C', kind: 'rss' },
    ]);
  });

  it.each([
    ['a stylesheet', 'rel="stylesheet" href="/site.css"'],
    ['an alternate in another language', 'rel="alternate" hreflang="fr" href="/fr/"'],
    ['an alternate of another type', 'rel="alternate" type="application/json" href="/feed.json"'],
    ['a feed type with no rel', 'type="application/rss+xml" href="/feed.xml"'],
    ['a feed type with another rel', 'rel="canonical" type="application/rss+xml" href="/feed.xml"'],
    ['a feed with no address', 'rel="alternate" type="application/rss+xml"'],
    ['a feed with an empty address', 'rel="alternate" type="application/rss+xml" href=""'],
  ])('ignores %s', (_what, attributes) => {
    expect(findFeedLinks(page(link(attributes)), SITE_URL)).toEqual([]);
  });

  it.each([
    'javascript:alert(1)',
    'data:application/rss+xml,<rss/>',
    'file:///etc/passwd',
    'ftp://acme.example/feed.xml',
  ])('drops a feed whose address is %s', (href) => {
    const html = page(
      link(`rel="alternate" type="application/rss+xml" href="${href}" title="Bad"`),
      link('rel="alternate" type="application/rss+xml" href="/good.xml" title="Good"'),
    );

    expect(findFeedLinks(html, SITE_URL).map((feed) => feed.title)).toEqual(['Good']);
  });

  it('keeps a feed on another host: the API is what checks every address', () => {
    const html = page(
      link('rel="alternate" type="application/rss+xml" href="https://feeds.other.example/acme"'),
    );

    expect(findFeedLinks(html, SITE_URL)).toEqual([
      { url: 'https://feeds.other.example/acme', title: '', kind: 'rss' },
    ]);
  });

  it('names a feed once, however often the page links it', () => {
    const html = page(
      link('rel="alternate" type="application/rss+xml" href="/feed.xml" title="First"'),
      link(
        'rel="alternate" type="application/rss+xml" href="https://acme.example/feed.xml" title="Again"',
      ),
      link('rel="alternate" type="application/atom+xml" href="/atom.xml" title="Other"'),
    );

    expect(findFeedLinks(html, SITE_URL).map((feed) => feed.title)).toEqual(['First', 'Other']);
  });

  it('stops at five', () => {
    const links = Array.from({ length: 7 }, (_, index) =>
      link(`rel="alternate" type="application/rss+xml" href="/feed-${index + 1}.xml"`),
    );
    const feeds = findFeedLinks(page(...links), SITE_URL);

    expect(feeds).toHaveLength(MAX_DISCOVERED_FEEDS);
    expect(feeds.at(-1)?.url).toBe('https://acme.example/feed-5.xml');
  });

  it('makes a title plain text, on one line, of at most 80 characters', () => {
    const html = page(
      link(
        'rel="alternate" type="application/rss+xml" href="/a.xml" title="News &amp; &lt;b&gt;Views&lt;/b&gt;"',
      ),
      link(`rel="alternate" type="application/rss+xml" href="/b.xml" title="${'t'.repeat(120)}"`),
      link('rel="alternate" type="application/rss+xml" href="/c.xml" title="  Two\n  lines  "'),
    );
    const [marked, long, lines] = findFeedLinks(html, SITE_URL);

    expect(marked.title).toBe('News & Views');
    expect(long.title).toHaveLength(80);
    expect(lines.title).toBe('Two lines');
  });

  it('finds nothing on a page with no links, in an empty body, or under a base that is no address', () => {
    expect(findFeedLinks(PLAIN_PAGE, SITE_URL)).toEqual([]);
    expect(findFeedLinks('', SITE_URL)).toEqual([]);
    // Nothing can be resolved against it, so nothing is offered.
    expect(findFeedLinks(SITE, 'not an address')).toEqual([]);
  });
});

describe('feedFormatOf', () => {
  it('tells RSS, Atom and RDF from their opening tag', () => {
    expect(feedFormatOf(BLOG)).toBe('rss');
    expect(feedFormatOf(CHANGELOG)).toBe('atom');
    expect(feedFormatOf('<rss version="2.0">')).toBe('rss');
    expect(feedFormatOf('<RSS>')).toBe('rss');
    expect(feedFormatOf('<feed xmlns="http://www.w3.org/2005/Atom">')).toBe('atom');
    expect(feedFormatOf('<?xml version="1.0"?>\n<rdf:RDF xmlns:rdf="x">')).toBe('rss');
  });

  it('says a page is not a feed', () => {
    expect(feedFormatOf(SITE)).toBeNull();
    expect(feedFormatOf(PLAIN_PAGE)).toBeNull();
    expect(feedFormatOf('')).toBeNull();
    expect(feedFormatOf('{"feed":[]}')).toBeNull();
    // A tag that only begins like one.
    expect(feedFormatOf('<feedback>thanks</feedback>')).toBeNull();
    expect(feedFormatOf('<rssx>')).toBeNull();
  });

  it('looks only at the start of the body', () => {
    expect(feedFormatOf(`${' '.repeat(1_000)}<rss version="2.0">`)).toBe('rss');
    expect(feedFormatOf(`${' '.repeat(3_000)}<rss version="2.0">`)).toBeNull();
  });
});

describe('discoverFeeds', () => {
  it('answers the two feeds the sample site links, without one more request', async () => {
    const fetchMock = siteAnswering();

    expect(await discoverFeeds(SITE, SITE_URL, { fetch: fetchMock })).toEqual([
      { url: 'https://acme.example/blog/rss.xml', title: 'Blog', kind: 'rss' },
      { url: 'https://acme.example/changelog/atom.xml', title: 'Changelog', kind: 'atom' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers the page itself when it is a feed, without a request', async () => {
    const fetchMock = siteAnswering();

    expect(
      await discoverFeeds(BLOG, 'https://acme.example/blog/rss.xml', { fetch: fetchMock }),
    ).toEqual([
      {
        url: 'https://acme.example/blog/rss.xml',
        title: 'Acme Analytics Blog (Sample)',
        kind: 'rss',
      },
    ]);
    expect(
      await discoverFeeds(CHANGELOG, 'https://acme.example/changelog/atom.xml', {
        fetch: fetchMock,
      }),
    ).toEqual([
      {
        url: 'https://acme.example/changelog/atom.xml',
        title: 'Acme Analytics Changelog (Sample)',
        kind: 'atom',
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tries the common paths, in order, only when the page links no feed', async () => {
    const fetchMock = siteAnswering();
    const feeds = await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/about/us', {
      fetch: fetchMock,
    });

    expect(feeds).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      COMMON_FEED_PATHS.map((path) => `https://quiet.example${path}`),
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.accept).toBe(FEED_ACCEPT);
      expect(init.maxBytes).toBe(1024 * 1024);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('keeps only the paths that really answer with a feed', async () => {
    const fetchMock = siteAnswering({
      '/feed': { body: rssNamed('Quiet Blog') },
      // A page that says 200 to everything, as many sites do.
      '/rss': { body: PLAIN_PAGE },
      '/rss.xml': { body: '{"not":"a feed"}' },
      '/atom.xml': { body: atomNamed('Quiet Updates') },
      // Opens like a feed and is cut off.
      '/blog/feed': { body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Cut' },
      '/blog/rss': { status: 500, body: rssNamed('Broken Server') },
      '/index.xml': { status: 403, body: rssNamed('Forbidden') },
    });

    expect(await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock })).toEqual(
      [
        { url: 'https://quiet.example/feed', title: 'Quiet Blog', kind: 'rss' },
        { url: 'https://quiet.example/atom.xml', title: 'Quiet Updates', kind: 'atom' },
      ],
    );
  });

  it('names a feed once when "/feed" and "/feed/" end at one address', async () => {
    const landed = 'https://quiet.example/feed/';
    const fetchMock = siteAnswering({
      '/feed': { body: rssNamed('Quiet Blog'), finalUrl: landed },
      '/feed/': { body: rssNamed('Quiet Blog'), finalUrl: landed },
    });

    expect(await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock })).toEqual(
      [{ url: landed, title: 'Quiet Blog', kind: 'rss' }],
    );
  });

  it('answers where a probe really landed, and the address it asked when that is not said', async () => {
    const fetchMock = siteAnswering({
      '/feed': { body: rssNamed('Moved'), finalUrl: 'https://blog.quiet.example/rss' },
      '/atom.xml': { body: atomNamed('Unsaid'), finalUrl: '' },
    });
    const feeds = await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock });

    expect(feeds.map((feed) => feed.url)).toEqual([
      'https://blog.quiet.example/rss',
      'https://quiet.example/atom.xml',
    ]);
  });

  it('skips a probe that never completes and keeps the rest', async () => {
    const fetchMock = siteAnswering({
      '/feed': new Error('socket hang up'),
      '/rss': { thrown: 'a string' },
      '/rss.xml': { thrown: Object.assign(new Error('too large'), { kind: 'too_large' }) },
      '/atom.xml': { body: atomNamed('Still Here') },
    });

    expect(await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock })).toEqual(
      [{ url: 'https://quiet.example/atom.xml', title: 'Still Here', kind: 'atom' }],
    );
  });

  it('lets a refusal by the address guard through, rather than calling it "no feed"', async () => {
    const refusal = Object.assign(new Error('That host points at a private network.'), {
      kind: 'unsafe_url',
      reason: 'private_address',
    });
    const fetchMock = siteAnswering({
      '/feed': { body: rssNamed('Fine') },
      '/rss': refusal,
    });

    await expect(
      discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock }),
    ).rejects.toBe(refusal);
  });

  it('answers at most five, the first five in the order of the paths', async () => {
    const fetchMock = siteAnswering(
      Object.fromEntries(COMMON_FEED_PATHS.map((path) => [path, { body: rssNamed(path) }])),
    );
    const feeds = await discoverFeeds(PLAIN_PAGE, 'https://busy.example/', { fetch: fetchMock });

    expect(feeds).toHaveLength(MAX_DISCOVERED_FEEDS);
    expect(feeds.map((feed) => feed.title)).toEqual(COMMON_FEED_PATHS.slice(0, 5));
  });

  it("gives every probe the caller's deadline", async () => {
    const fetchMock = siteAnswering();
    const { signal } = new AbortController();
    await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock, signal });

    expect(fetchMock.mock.calls).toHaveLength(COMMON_FEED_PATHS.length);
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBe(signal);
  });

  it('goes on as with any page when the body opens like a feed and is not one', async () => {
    const cut = '<?xml version="1.0"?><rss version="2.0"><channel><title>Cut';
    const fetchMock = siteAnswering({ '/rss.xml': { body: rssNamed('The Real One') } });

    expect(await discoverFeeds(cut, 'https://quiet.example/', { fetch: fetchMock })).toEqual([
      { url: 'https://quiet.example/rss.xml', title: 'The Real One', kind: 'rss' },
    ]);
  });

  it('makes no request at all for a base that is no address', async () => {
    const fetchMock = siteAnswering();

    expect(await discoverFeeds(PLAIN_PAGE, 'not an address', { fetch: fetchMock })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps the title of a probed feed at 80 characters and strips its markup', async () => {
    const fetchMock = siteAnswering({
      '/feed': { body: rssNamed(`&lt;b&gt;Loud&lt;/b&gt; ${'n'.repeat(120)}`) },
    });
    const [feed] = await discoverFeeds(PLAIN_PAGE, 'https://quiet.example/', { fetch: fetchMock });

    expect(feed.title.startsWith('Loud n')).toBe(true);
    expect(feed.title).toHaveLength(80);
  });
});
