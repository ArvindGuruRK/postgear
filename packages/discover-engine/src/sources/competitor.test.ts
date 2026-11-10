import type { DiscoverFetch, DiscoverFetchInit, DiscoverFetchResponse, SourceItem } from '../types';
import {
  COMPETITOR_MAX_AGE_MS,
  COMPETITOR_MAX_ITEMS,
  COMPETITOR_TEXT_CHARS,
  emptyResult,
  excerpt,
  failedRead,
  isHostName,
  isoDate,
  isRecord,
  newest,
  parseJson,
  readBody,
  resolveHttpUrl,
  unreadable,
} from './competitor';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T00:00:00Z');
const clock = () => NOW;

/** A lone half of a surrogate pair: what cutting an emoji in two leaves behind. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function post(title: string, publishedAt?: string): SourceItem {
  return { kind: 'competitor', source: { id: 'rss', name: 'Blog' }, title, publishedAt };
}

/** A post published this many days before the clock. */
function daysAgo(days: number, title = `${days} days ago`): SourceItem {
  return post(title, new Date(NOW.getTime() - days * DAY_MS).toISOString());
}

function fetchAnswering(response: Partial<DiscoverFetchResponse> | (() => never)) {
  return jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (typeof response === 'function') return response();
    return { status: 200, body: '', finalUrl: url, ...response };
  });
}

describe('excerpt', () => {
  it('leaves a text that fits alone', () => {
    expect(excerpt('A short post.')).toBe('A short post.');
    expect(excerpt('x'.repeat(COMPETITOR_TEXT_CHARS))).toBe('x'.repeat(240));
    expect(excerpt('')).toBe('');
  });

  it('cuts a longer one to the limit, three full stops included', () => {
    const cut = excerpt('x'.repeat(241));
    expect(cut).toBe(`${'x'.repeat(237)}...`);
    expect(cut).toHaveLength(240);
    expect(excerpt('abcdefghij', 8)).toBe('abcde...');
  });

  it('does not leave a space in front of the full stops', () => {
    expect(excerpt('abcd efghij', 8)).toBe('abcd...');
  });

  it('counts an emoji as one character and never cuts one in half', () => {
    const rocket = String.fromCodePoint(0x1f680);
    // Ten characters to a reader, twenty to `String.length`.
    expect(excerpt(rocket.repeat(10), 10)).toBe(rocket.repeat(10));

    const cut = excerpt(rocket.repeat(12), 10);
    expect(cut).toBe(`${rocket.repeat(7)}...`);
    expect(LONE_SURROGATE.test(cut)).toBe(false);
  });

  it('keeps Tamil text whole up to the cut', () => {
    const tamil = 'தமிழ் '.repeat(60);
    const cut = excerpt(tamil);

    expect(Array.from(cut).length).toBeLessThanOrEqual(240);
    expect(cut.endsWith('...')).toBe(true);
    expect(tamil.startsWith(cut.slice(0, -3))).toBe(true);
    expect(cut).not.toContain(String.fromCodePoint(0xfffd));
  });
});

describe('resolveHttpUrl', () => {
  it('resolves a relative link against the feed it came from', () => {
    expect(resolveHttpUrl('/blog/post', 'https://acme.example/blog/rss.xml')).toBe(
      'https://acme.example/blog/post',
    );
    expect(resolveHttpUrl('post-2', 'https://acme.example/blog/rss.xml')).toBe(
      'https://acme.example/blog/post-2',
    );
    expect(resolveHttpUrl('//cdn.example/a.png', 'https://acme.example/')).toBe(
      'https://cdn.example/a.png',
    );
  });

  it('keeps a full address, trimmed', () => {
    expect(resolveHttpUrl('  https://other.example/a  ', 'https://acme.example/')).toBe(
      'https://other.example/a',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>1</script>',
    'mailto:someone@acme.example',
    'ftp://acme.example/feed',
  ])('refuses %s', (link) => {
    expect(resolveHttpUrl(link, 'https://acme.example/')).toBeUndefined();
  });

  it('has nothing to say about a missing link, or a base that is not an address', () => {
    expect(resolveHttpUrl(undefined, 'https://acme.example/')).toBeUndefined();
    expect(resolveHttpUrl(null, 'https://acme.example/')).toBeUndefined();
    expect(resolveHttpUrl('', 'https://acme.example/')).toBeUndefined();
    expect(resolveHttpUrl('/blog/post', 'not an address')).toBeUndefined();
  });
});

describe('newest', () => {
  it('drops what is older than 30 days, against the clock it is given', () => {
    const items = [daysAgo(1), daysAgo(29), daysAgo(31), daysAgo(200)];

    expect(newest(items, { now: clock }).map((item) => item.title)).toEqual([
      '1 days ago',
      '29 days ago',
    ]);
  });

  it('keeps a post from exactly 30 days ago and drops one a moment older', () => {
    const onTheLine = post(
      'on the line',
      new Date(NOW.getTime() - COMPETITOR_MAX_AGE_MS).toISOString(),
    );
    const justOver = post(
      'just over',
      new Date(NOW.getTime() - COMPETITOR_MAX_AGE_MS - 1000).toISOString(),
    );

    expect(newest([justOver, onTheLine], { now: clock })).toEqual([onTheLine]);
  });

  it('keeps everything when the limit is switched off', () => {
    const items = [daysAgo(1), daysAgo(31), daysAgo(2000)];
    expect(newest(items, { maxAgeMs: null, now: clock })).toHaveLength(3);
  });

  it('takes a limit of its own', () => {
    const items = [daysAgo(1), daysAgo(3), daysAgo(8)];
    expect(newest(items, { maxAgeMs: 7 * DAY_MS, now: clock })).toHaveLength(2);
  });

  it('puts the newest first, whatever order they came in', () => {
    const items = [daysAgo(9), daysAgo(1), daysAgo(20), daysAgo(4)];

    expect(newest(items, { now: clock }).map((item) => item.title)).toEqual([
      '1 days ago',
      '4 days ago',
      '9 days ago',
      '20 days ago',
    ]);
  });

  it('keeps a post with no date, or one it cannot read, after the dated ones', () => {
    const items = [post('undated'), daysAgo(5), post('unreadable', 'last Tuesday'), daysAgo(2)];

    expect(newest(items, { now: clock }).map((item) => item.title)).toEqual([
      '2 days ago',
      '5 days ago',
      'undated',
      'unreadable',
    ]);
  });

  it('stops at ten', () => {
    const items = Array.from({ length: 14 }, (_, index) => daysAgo(index + 1));
    const kept = newest(items, { now: clock });

    expect(kept).toHaveLength(COMPETITOR_MAX_ITEMS);
    expect(kept.at(-1)?.title).toBe('10 days ago');
  });

  it('does not reorder the list it was handed', () => {
    const items = [daysAgo(9), daysAgo(1)];
    newest(items, { now: clock });
    expect(items.map((item) => item.title)).toEqual(['9 days ago', '1 days ago']);
  });

  it('reads the real clock when it is given none', () => {
    const fresh = post('fresh', new Date().toISOString());
    const old = post('old', new Date(Date.now() - 40 * DAY_MS).toISOString());
    expect(newest([old, fresh], {})).toEqual([fresh]);
  });
});

describe('readBody', () => {
  const URL = 'https://acme.example/blog/rss.xml';

  it('hands back the body and where it really came from', async () => {
    const fetchMock = fetchAnswering({ body: 'hello', finalUrl: 'https://www.acme.example/rss' });

    expect(await readBody(fetchMock, URL, 'application/json')).toEqual({
      ok: true,
      body: 'hello',
      finalUrl: 'https://www.acme.example/rss',
    });
  });

  it('falls back to the address it asked when the answer names none', async () => {
    const read = await readBody(fetchAnswering({ body: 'x', finalUrl: '' }), URL, 'text/html');
    expect(read).toEqual({ ok: true, body: 'x', finalUrl: URL });
  });

  it('asks with the accept it was given, a size cap and a deadline of its own', async () => {
    const fetchMock = fetchAnswering({});
    await readBody(fetchMock, URL, 'application/json');

    const [url, init] = fetchMock.mock.calls[0] as [string, DiscoverFetchInit];
    expect(url).toBe(URL);
    expect(init.accept).toBe('application/json');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller's deadline when there is one", async () => {
    const fetchMock = fetchAnswering({});
    const { signal } = new AbortController();
    await readBody(fetchMock, URL, 'application/json', signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it.each([429, 500, 502, 503])('calls a %i trouble', async (status) => {
    expect(await readBody(fetchAnswering({ status }), URL, 'text/html')).toEqual({
      ok: false,
      failed: 'upstream',
    });
  });

  it.each([400, 401, 403, 404, 410, 301, 204])(
    'calls a %i nothing at that address, which is not trouble',
    async (status) => {
      expect(await readBody(fetchAnswering({ status }), URL, 'text/html')).toEqual({
        ok: false,
        failed: 'not_found',
      });
    },
  );

  it('calls a request that never completed trouble, whatever was thrown', async () => {
    const throwers = [
      () => {
        throw new Error('socket hang up');
      },
      () => {
        throw 'a string';
      },
      () => {
        throw null;
      },
      () => {
        throw Object.assign(new Error('refused'), { kind: 'unreachable' });
      },
    ];

    for (const thrower of throwers) {
      expect(await readBody(fetchAnswering(thrower as () => never), URL, 'text/html')).toEqual({
        ok: false,
        failed: 'upstream',
      });
    }
  });

  it('calls a body over the size cap unreadable, and not trouble', async () => {
    const tooLarge = () => {
      throw Object.assign(new Error('acme.example sent a page larger than the limit.'), {
        kind: 'too_large',
      });
    };

    expect(await readBody(fetchAnswering(tooLarge), URL, 'text/html')).toEqual({
      ok: false,
      failed: 'not_found',
      unreadable: true,
    });
  });

  it('calls a redirect the address guard refused unreadable, and not trouble', async () => {
    const refused = () => {
      throw Object.assign(new Error('Refused.'), { kind: 'unsafe_url' });
    };

    expect(await readBody(fetchAnswering(refused), URL, 'text/html')).toEqual({
      ok: false,
      failed: 'not_found',
      unreadable: true,
    });
  });
});

describe('the results a source answers a failure with', () => {
  const attribution = { name: 'Bluesky', url: 'https://bsky.app' };

  it('is empty, names its failure and carries no mark it was not given', () => {
    expect(emptyResult(attribution, 'upstream')).toEqual({
      items: [],
      attribution,
      warnings: [],
      failed: 'upstream',
    });
    expect('unreadable' in emptyResult(attribution, 'upstream')).toBe(false);
  });

  it('says unreadable as not found, never as trouble, with one sentence of ours', () => {
    expect(unreadable(attribution, 'Bluesky answered in a shape this cannot read.')).toEqual({
      items: [],
      attribution,
      warnings: ['Bluesky answered in a shape this cannot read.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it('turns a failed read into the matching result', () => {
    expect(failedRead(attribution, { ok: false, failed: 'upstream' })).toEqual({
      items: [],
      attribution,
      warnings: [],
      failed: 'upstream',
    });
    expect(failedRead(attribution, { ok: false, failed: 'not_found', unreadable: true })).toEqual({
      items: [],
      attribution,
      warnings: [],
      failed: 'not_found',
      unreadable: true,
    });
  });
});

describe('isHostName', () => {
  it.each([
    'acme.example',
    'mastodon.social',
    'news.acme.co.uk',
    'my-site.example',
    'acme.xn--p1ai',
    'a1.io',
  ])('takes %s', (host) => {
    expect(isHostName(host)).toBe(true);
  });

  it.each([
    ['a bare name', 'localhost'],
    ['an IPv4 address', '127.0.0.1'],
    ['a public IPv4 address', '93.184.216.34'],
    ['an IPv6 address', '[::1]'],
    ['a port', 'acme.example:8080'],
    ['a path', 'acme.example/feed'],
    ['a scheme', 'https://acme.example'],
    ['a query', 'acme.example?x=1'],
    ['credentials', 'user@acme.example'],
    ['capitals, which the callers lower first', 'Acme.Example'],
    ['a label that starts with a hyphen', '-acme.example'],
    ['a label that ends with a hyphen', 'acme-.example'],
    ['an empty label', 'acme..example'],
    ['a trailing dot', 'acme.example.'],
    ['a space', 'acme .example'],
    ['an underscore', 'ac_me.example'],
    ['three characters', 'a.b'],
    ['nothing', ''],
    [
      'a name longer than a host can be',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.example`,
    ],
  ])('refuses %s', (_what, host) => {
    expect(isHostName(host)).toBe(false);
  });
});

describe('the small readers', () => {
  it('reads a date into ISO, and nothing else into anything', () => {
    expect(isoDate('2026-11-09T11:05:00.000Z')).toBe('2026-11-09T11:05:00.000Z');
    expect(isoDate('Mon, 09 Nov 2026 09:00:00 GMT')).toBe('2026-11-09T09:00:00.000Z');
    expect(isoDate('2026-11-07T15:00:00+05:30')).toBe('2026-11-07T09:30:00.000Z');
    expect(isoDate('soon')).toBeUndefined();
    expect(isoDate(1_794_268_800)).toBeUndefined();
    expect(isoDate(undefined)).toBeUndefined();
  });

  it('knows an object from a list, a null and a word', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(new Error('x'))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it('parses JSON without ever throwing', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1]')).toEqual([1]);
    expect(parseJson('<html>')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });
});
