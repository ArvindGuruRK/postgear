import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import type { CompetitorSourceOptions } from './competitor';
import { createRssSource, FEED_ACCEPT } from './rss';

const ACME = join(__dirname, '..', '..', 'fixtures', 'competitors', 'acme');
const BLOG = readFileSync(join(ACME, 'blog-rss.sample.xml'), 'utf8');
const CHANGELOG = readFileSync(join(ACME, 'changelog-atom.sample.xml'), 'utf8');
const SITE = readFileSync(join(ACME, 'site.sample.html'), 'utf8');

const BLOG_URL = 'https://acme.example/blog/rss.xml';
const CHANGELOG_URL = 'https://acme.example/changelog/atom.xml';

/** The day the samples were written, so the 30 day limit never moves. */
const WRITTEN = () => new Date('2026-11-10T00:00:00Z');

function sourceAnswering(
  response: Partial<DiscoverFetchResponse> | Error | (() => never),
  options: Omit<CompetitorSourceOptions, 'fetch'> = { maxAgeMs: null },
) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    if (typeof response === 'function') return response();
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createRssSource({ fetch: fetchMock, ...options }) };
}

function rssItem(fields: string): string {
  return `<item>${fields}</item>`;
}

function rss(
  items: string[],
  channel = '<title>Rival Blog</title><link>https://rival.example/blog</link>',
): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>${channel}${items.join('')}</channel></rss>`;
}

/** The one item a feed with a single entry gives. */
async function itemFrom(fields: string, url = 'https://rival.example/blog/rss.xml') {
  const { source } = sourceAnswering({ body: rss([rssItem(fields)]) });
  const { items } = await source.read(url);
  expect(items).toHaveLength(1);
  return items[0];
}

describe('the sample blog feed (RSS)', () => {
  it('asks for the feed once, as a feed', async () => {
    const { fetchMock, source } = sourceAnswering({ body: BLOG });
    await source.read(BLOG_URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BLOG_URL);
    expect(init.accept).toBe(FEED_ACCEPT);
    expect(init.maxBytes).toBe(1024 * 1024);
  });

  it('gives every post, newest first, attributed to the blog itself', async () => {
    const { source } = sourceAnswering({ body: BLOG });
    const result = await source.read(BLOG_URL);

    expect(result.failed).toBeUndefined();
    expect(result.unreadable).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({
      name: 'Acme Analytics Blog (Sample)',
      url: 'https://acme.example/blog',
    });
    expect(result.items.map((item) => [item.title, item.publishedAt])).toEqual([
      ['Five ways to cut churn', '2026-11-09T09:00:00.000Z'],
      ['What a good onboarding email looks like', '2026-11-06T14:30:00.000Z'],
      ['Dashboards people open twice & why', '2026-11-03T08:15:00.000Z'],
      ['Our 2026 pricing, explained', '2026-10-28T10:00:00.000Z'],
      ['How we started (an old sample post)', '2026-03-02T10:00:00.000Z'],
    ]);
  });

  it('maps every field a row and the brief need', async () => {
    const { source } = sourceAnswering({ body: BLOG });
    const [first] = (await source.read(BLOG_URL)).items;

    expect(first).toEqual({
      kind: 'competitor',
      source: { id: 'rss', name: 'Acme Analytics Blog (Sample)', url: 'https://acme.example/blog' },
      title: 'Five ways to cut churn',
      // The description is HTML inside CDATA: the tags are gone, the words are not.
      summary:
        'Churn is rarely one big reason. It is five small ones, and each can be measured. Here is how our sample customers found theirs.',
      url: 'https://acme.example/blog/five-ways-to-cut-churn',
      image: 'https://acme.example/images/churn.png',
      publishedAt: '2026-11-09T09:00:00.000Z',
    });
  });

  it('resolves a relative link against the feed, and takes a picture from an image enclosure', async () => {
    const { source } = sourceAnswering({ body: BLOG });
    const second = (await source.read(BLOG_URL)).items[1];

    expect(second.url).toBe('https://acme.example/blog/good-onboarding-email');
    expect(second.image).toBe('https://acme.example/images/onboarding.jpg');
  });

  it('decodes an entity in a title and leaves a post with no picture without one', async () => {
    const { source } = sourceAnswering({ body: BLOG });
    const third = (await source.read(BLOG_URL)).items[2];

    expect(third.title).toBe('Dashboards people open twice & why');
    expect(third.image).toBeUndefined();
  });

  it('drops the March post once it is older than 30 days, and keeps it with the limit off', async () => {
    const limited = sourceAnswering({ body: BLOG }, { now: WRITTEN });
    const unlimited = sourceAnswering({ body: BLOG }, { maxAgeMs: null, now: WRITTEN });

    const kept = (await limited.source.read(BLOG_URL)).items.map((item) => item.title);
    expect(kept).toHaveLength(4);
    expect(kept).not.toContain('How we started (an old sample post)');

    const all = (await unlimited.source.read(BLOG_URL)).items.map((item) => item.title);
    expect(all).toHaveLength(5);
    expect(all).toContain('How we started (an old sample post)');
  });
});

describe('the sample changelog feed (Atom)', () => {
  it('gives the three entries, attributed to the changelog', async () => {
    const { source } = sourceAnswering({ body: CHANGELOG });
    const result = await source.read(CHANGELOG_URL);

    expect(result.failed).toBeUndefined();
    expect(result.attribution).toEqual({
      name: 'Acme Analytics Changelog (Sample)',
      url: 'https://acme.example/changelog',
    });
    expect(result.items).toEqual([
      {
        kind: 'competitor',
        source: {
          id: 'rss',
          name: 'Acme Analytics Changelog (Sample)',
          url: 'https://acme.example/changelog',
        },
        title: 'Version 2.4: scheduled reports',
        summary: 'Reports can now be sent every Monday morning. A sample entry.',
        // Written as `/changelog/2-4` in the feed.
        url: 'https://acme.example/changelog/2-4',
        publishedAt: '2026-11-08T16:00:00.000Z',
      },
      {
        kind: 'competitor',
        source: {
          id: 'rss',
          name: 'Acme Analytics Changelog (Sample)',
          url: 'https://acme.example/changelog',
        },
        title: 'Version 2.3: faster filters',
        // An entry with `<content type="html">` and no summary.
        summary: 'Filters on large tables answer in under a second. A sample entry.',
        url: 'https://acme.example/changelog/2-3',
        publishedAt: '2026-10-30T11:00:00.000Z',
      },
      {
        kind: 'competitor',
        source: {
          id: 'rss',
          name: 'Acme Analytics Changelog (Sample)',
          url: 'https://acme.example/changelog',
        },
        title: 'Version 2.2: single sign-on',
        summary: 'Teams can sign in with their company account. A sample entry.',
        url: 'https://acme.example/changelog/2-2',
        publishedAt: '2026-10-19T09:30:00.000Z',
      },
    ]);
  });
});

describe('the feed mapping', () => {
  it('strips markup from a title and never lets a tag through', async () => {
    const item = await itemFrom(
      '<title><![CDATA[<b>Bold</b> move <script>alert(1)</script>]]></title><link>https://rival.example/a</link>',
    );
    expect(item.title).toBe('Bold move');
    expect(item.title).not.toMatch(/[<>]/);
  });

  it('caps a title at 200 characters', async () => {
    const item = await itemFrom(`<title>${'t'.repeat(300)}</title>`);
    expect(item.title).toHaveLength(200);
    expect(item.title.endsWith('...')).toBe(true);
  });

  it('strips a summary to plain text and caps it at 240 characters', async () => {
    const long = `<p>${'word '.repeat(120)}</p><img src="https://rival.example/x.png">`;
    const item = await itemFrom(
      `<title>Long read</title><description><![CDATA[${long}]]></description>`,
    );

    expect(Array.from(item.summary ?? '')).toHaveLength(240);
    expect(item.summary?.endsWith('...')).toBe(true);
    expect(item.summary).not.toMatch(/[<>]/);
  });

  it('leaves the summary out when the entry has none', async () => {
    const item = await itemFrom('<title>Just a title</title><link>https://rival.example/a</link>');
    expect(item.summary).toBeUndefined();
  });

  it('drops an entry that has no title, and keeps one that has no link', async () => {
    const { source } = sourceAnswering({
      body: rss([
        rssItem('<link>https://rival.example/untitled</link><description>Nameless.</description>'),
        rssItem('<title>   </title><link>https://rival.example/blank</link>'),
        rssItem('<title>No link at all</title>'),
      ]),
    });
    const { items } = await source.read('https://rival.example/blog/rss.xml');

    expect(items.map((item) => [item.title, item.url])).toEqual([['No link at all', undefined]]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'mailto:someone@rival.example'])(
    'never makes %s the address a row opens',
    async (link) => {
      const item = await itemFrom(`<title>Odd link</title><link>${link}</link>`);
      expect(item.url).toBeUndefined();
    },
  );

  it('resolves a relative link against where the feed really answered from', async () => {
    const { source } = sourceAnswering({
      body: rss([rssItem('<title>Moved</title><link>/posts/moved</link>')]),
      finalUrl: 'https://blog.rival.example/feed.xml',
    });
    const [item] = (await source.read('https://rival.example/feed')).items;

    expect(item.url).toBe('https://blog.rival.example/posts/moved');
  });

  it('takes a picture from media:thumbnail, then media:content, then an image enclosure', async () => {
    const thumbnail = await itemFrom(
      '<title>A</title><media:thumbnail url="https://rival.example/thumb.png" /><media:content url="https://rival.example/content.png" /><enclosure url="https://rival.example/enclosure.png" type="image/png" />',
    );
    const content = await itemFrom(
      '<title>B</title><media:content url="https://rival.example/content.png" /><enclosure url="https://rival.example/enclosure.png" type="image/png" />',
    );
    const enclosure = await itemFrom(
      '<title>C</title><enclosure url="/images/enclosure.png" type="IMAGE/PNG" length="10" />',
    );

    expect(thumbnail.image).toBe('https://rival.example/thumb.png');
    expect(content.image).toBe('https://rival.example/content.png');
    expect(enclosure.image).toBe('https://rival.example/images/enclosure.png');
  });

  it('ignores an enclosure that is not an image', async () => {
    const podcast = await itemFrom(
      '<title>Episode 12</title><enclosure url="https://rival.example/ep12.mp3" type="audio/mpeg" length="100" />',
    );
    const untyped = await itemFrom(
      '<title>Episode 13</title><enclosure url="https://rival.example/ep13.bin" />',
    );

    expect(podcast.image).toBeUndefined();
    expect(untyped.image).toBeUndefined();
  });

  it('never makes a script the picture', async () => {
    const item = await itemFrom(
      '<title>A</title><media:thumbnail url="javascript:alert(1)" /><enclosure url="https://rival.example/ok.png" type="image/png" />',
    );
    // The first candidate is refused, so the next safe one is used.
    expect(item.image).toBe('https://rival.example/ok.png');
  });

  it('leaves a date it cannot read out, and keeps the post', async () => {
    const item = await itemFrom('<title>Undated</title><pubDate>some time ago</pubDate>');
    expect(item.publishedAt).toBeUndefined();
  });

  it('gives the newest ten of a longer feed', async () => {
    const entries = Array.from({ length: 15 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return rssItem(`<title>Post ${index + 1}</title><pubDate>2026-11-${day}T08:00:00Z</pubDate>`);
    });
    const { source } = sourceAnswering({ body: rss(entries) });
    const { items } = await source.read('https://rival.example/blog/rss.xml');

    expect(items).toHaveLength(10);
    expect(items[0].title).toBe('Post 15');
    expect(items.at(-1)?.title).toBe('Post 6');
  });

  it('names a feed that does not name itself "RSS", and caps a long name at 80', async () => {
    const unnamed = sourceAnswering({ body: rss([rssItem('<title>A</title>')], '') });
    const long = sourceAnswering({
      body: rss([rssItem('<title>A</title>')], `<title>${'n'.repeat(120)}</title>`),
    });

    const first = await unnamed.source.read('https://rival.example/feed');
    expect(first.attribution).toEqual({ name: 'RSS', url: undefined });
    expect(first.items[0].source).toEqual({ id: 'rss', name: 'RSS', url: undefined });

    const second = await long.source.read('https://rival.example/feed');
    expect(second.attribution.name).toHaveLength(80);
  });

  it("never lets a feed's own home be anything but a web address", async () => {
    const { source } = sourceAnswering({
      body: rss(
        [rssItem('<title>A</title>')],
        '<title>Rival</title><link>javascript:alert(1)</link>',
      ),
    });
    const result = await source.read('https://rival.example/feed');

    expect(result.attribution).toEqual({ name: 'Rival', url: undefined });
  });

  it('answers a feed with nothing in it as an empty list, not a failure', async () => {
    const { source } = sourceAnswering({ body: rss([]) });
    const result = await source.read('https://rival.example/feed');

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });

  it("passes the caller's deadline on", async () => {
    const { fetchMock, source } = sourceAnswering({ body: BLOG });
    const { signal } = new AbortController();
    await source.read(BLOG_URL, signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });
});

describe('a feed that cannot be reached, or read', () => {
  it.each([404, 410, 403])('says nothing is there for a %i', async (status) => {
    const result = await sourceAnswering({ status }).source.read(BLOG_URL);

    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.unreadable).toBeUndefined();
  });

  it.each([429, 500, 503])('says trouble for a %i', async (status) => {
    const result = await sourceAnswering({ status }).source.read(BLOG_URL);

    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(result.unreadable).toBeUndefined();
  });

  it('says trouble for a dropped connection', async () => {
    const result = await sourceAnswering(new Error('socket hang up')).source.read(BLOG_URL);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('says unreadable, and not trouble, for a web page where the feed should be', async () => {
    const result = await sourceAnswering({ body: SITE }).source.read('https://acme.example/');

    expect(result).toEqual({
      items: [],
      attribution: { name: 'RSS' },
      warnings: ['The address did not answer with a feed.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it.each([
    ['an empty body', ''],
    ['plain words', 'Not Found'],
    ['JSON', '{"items":[]}'],
    ['XML that is cut off', '<?xml version="1.0"?><rss version="2.0"><channel><title>Cut'],
  ])('says unreadable for %s', async (_what, body) => {
    const result = await sourceAnswering({ body }).source.read(BLOG_URL);
    expect(result).toMatchObject({ items: [], failed: 'not_found', unreadable: true });
  });

  it('says unreadable for a feed over the size cap', async () => {
    const tooLarge = () => {
      throw Object.assign(new Error('too large'), { kind: 'too_large' });
    };
    const result = await sourceAnswering(tooLarge).source.read(BLOG_URL);

    expect(result).toMatchObject({ items: [], failed: 'not_found', unreadable: true });
  });

  it("never quotes the stranger's body in a warning", async () => {
    const secret = 'internal-hostname-db-01';
    const result = await sourceAnswering({ body: `<html>${secret}</html>` }).source.read(BLOG_URL);

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([
    ['a script', 'javascript:alert(1)'],
    ['another scheme', 'ftp://acme.example/feed.xml'],
    ['a file', 'file:///etc/passwd'],
    ['words', 'not an address'],
    ['nothing', ''],
  ])('makes no request for %s', async (_what, reference) => {
    const { fetchMock, source } = sourceAnswering({ body: BLOG });
    const result = await source.read(reference);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      attribution: { name: 'RSS' },
      warnings: ['The feed address is not a web address.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it('never throws, whatever the fetch does', async () => {
    const throwers = [
      () => {
        throw 'a string';
      },
      () => {
        throw undefined;
      },
    ];

    for (const thrower of throwers) {
      const read = sourceAnswering(thrower as () => never).source.read(BLOG_URL);
      await expect(read).resolves.toMatchObject({ items: [], failed: 'upstream' });
    }
  });

  it('reads a redirect the address guard refused as a feed it cannot read, never as trouble', async () => {
    const refused = () => {
      throw { kind: 'unsafe_url' };
    };

    const result = await sourceAnswering(refused as () => never).source.read(BLOG_URL);

    // Not `upstream`: one feed that redirects inwards must not rest its host for everyone.
    expect(result).toMatchObject({ items: [], failed: 'not_found', unreadable: true });
  });
});

describe('the source itself', () => {
  it('says what it is', () => {
    const { source } = sourceAnswering({});
    expect([source.id, source.name]).toEqual(['rss', 'RSS']);
  });
});
