import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality, WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import { BLUESKY_TRENDS_URL, createBlueskySource } from './bluesky';

const RECORDED = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'worldwide', 'bluesky-trends.2026-11-10.json'),
  'utf8',
);

interface Trend {
  topic?: unknown;
  displayName?: unknown;
  description?: unknown;
  link?: unknown;
  startedAt?: unknown;
  postCount?: unknown;
  status?: unknown;
  category?: unknown;
}

const TREND: Trend = {
  topic: 'abc123',
  displayName: 'Autumn foliage photos',
  description: 'People share pictures of colorful leaves.',
  link: '/profile/did:plc:example/feed/abc123',
  startedAt: '2026-11-07T13:44:21.519308+00:00',
  postCount: 910,
  status: 'stale',
  category: 'culture',
};

function answer(...trends: unknown[]): string {
  return JSON.stringify({ recIdStr: '1', trends });
}

function sourceAnswering(response: Partial<DiscoverFetchResponse> | Error) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createBlueskySource({ fetch: fetchMock }) };
}

const run = (source: ReturnType<typeof sourceAnswering>['source']) =>
  source.fetch({ locality: { ...WORLDWIDE }, language: 'en' });

/** The one item a body with a single trend gives. */
async function itemFrom(trend: unknown) {
  const { source } = sourceAnswering({ body: answer(trend) });
  const { items } = await run(source);
  expect(items).toHaveLength(1);
  return items[0];
}

describe('the recorded trends', () => {
  it('gives ten, each with a name, a link to bsky.app and a post count', async () => {
    const { fetchMock, source } = sourceAnswering({ body: RECORDED });
    const result = await run(source);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([BLUESKY_TRENDS_URL]);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'Bluesky', url: 'https://bsky.app' });
    expect(result.items).toHaveLength(10);
    for (const item of result.items) {
      expect(item.kind).toBe('social');
      expect(item.title).not.toBe('');
      expect(item.summary).not.toBe('');
      expect(item.url).toMatch(
        /^https:\/\/bsky\.app\/profile\/did:plc:[a-z0-9]+\/feed\/[a-z0-9]+$/,
      );
      expect(item.signal?.posts).toBeGreaterThan(0);
      expect(item.publishedAt).toMatch(/^2026-11-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    }
  });

  it('maps every field the chip and the brief need', async () => {
    const { source } = sourceAnswering({ body: RECORDED });
    const [first] = (await run(source)).items;

    expect(first).toEqual({
      kind: 'social',
      source: { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app' },
      title: 'Big Walk AI code allegations',
      summary: 'Gamers question claims that House House used AI-generated code in its new game.',
      url: 'https://bsky.app/profile/did:plc:qrz3lhbyuxbeilrc6nekdqme/feed/7b2e89ebac6c',
      publishedAt: '2026-11-10T03:54:23.000Z',
      signal: { label: '291 posts', posts: 291 },
    });
  });

  it('words the counts: plain under ten thousand, short above', async () => {
    const { source } = sourceAnswering({ body: RECORDED });
    const labels = (await run(source)).items.map((item) => item.signal?.label);

    expect(labels).toEqual([
      '291 posts',
      '1,518 posts',
      '4,625 posts',
      '409 posts',
      '315 posts',
      '11K posts',
      '1,117 posts',
      '465 posts',
      '910 posts',
      '137 posts',
    ]);
  });

  it('keeps the order Bluesky gave', async () => {
    const { source } = sourceAnswering({ body: RECORDED });
    const titles = (await run(source)).items.map((item) => item.title);

    expect(titles[0]).toBe('Big Walk AI code allegations');
    expect(titles[2]).toBe('Jensen Huang honey trap report');
    expect(titles[9]).toBe('Anthropic releases Claude Fable 5.2');
  });
});

describe('the Bluesky mapping', () => {
  it('shows at most ten', async () => {
    const many = Array.from({ length: 15 }, (_, index) => ({
      ...TREND,
      displayName: `Trend ${index + 1}`,
    }));
    const { source } = sourceAnswering({ body: answer(...many) });
    const { items } = await run(source);

    expect(items).toHaveLength(10);
    expect(items.at(-1)?.title).toBe('Trend 10');
  });

  it.each([
    '//evil.example/profile/x',
    '/\\evil.example/profile/x',
    'https://evil.example/profile/x',
    'http://bsky.app.evil.example/',
    'javascript:alert(1)',
    'profile/did:plc:example',
    '@evil.example/x',
    '.evil.example/x',
    '',
    42,
    null,
    { href: '/profile/x' },
  ])('drops the link %j and keeps the trend', async (link) => {
    const item = await itemFrom({ ...TREND, link });

    expect(item.title).toBe('Autumn foliage photos');
    expect(item.url).toBeUndefined();
  });

  it('only ever links to bsky.app, whatever follows the slash', async () => {
    for (const link of ['/@evil.example/x', '/profile/x?next=https://evil.example', '/a/../b#c']) {
      const item = await itemFrom({ ...TREND, link });
      expect(new URL(item.url as string).origin).toBe('https://bsky.app');
    }
  });

  it('says the category when a trend has no description', async () => {
    expect((await itemFrom({ ...TREND, description: undefined })).summary).toBe('culture');
    expect((await itemFrom({ ...TREND, description: '   ' })).summary).toBe('culture');
    expect((await itemFrom({ ...TREND, description: 7 })).summary).toBe('culture');
  });

  it('has no summary when it has neither', async () => {
    const item = await itemFrom({ ...TREND, description: undefined, category: undefined });
    expect(item.summary).toBeUndefined();
  });

  it.each(['yesterday', '', 1_794_282_863, null, undefined])(
    'has no start time when it is %j',
    async (startedAt) => {
      expect((await itemFrom({ ...TREND, startedAt })).publishedAt).toBeUndefined();
    },
  );

  it.each([undefined, null, '910', -1, Number.NaN])(
    'has no count, and no made-up label, when the post count is %j',
    async (postCount) => {
      expect((await itemFrom({ ...TREND, postCount })).signal).toBeUndefined();
    },
  );

  it('says one post, not one posts', async () => {
    expect((await itemFrom({ ...TREND, postCount: 1 })).signal).toEqual({
      label: '1 post',
      posts: 1,
    });
    expect((await itemFrom({ ...TREND, postCount: 0 })).signal?.label).toBe('0 posts');
    expect((await itemFrom({ ...TREND, postCount: 1_234_567 })).signal?.label).toBe('1.2M posts');
  });

  it('never lets markup or a hidden character through', async () => {
    const override = String.fromCodePoint(0x202e);
    const item = await itemFrom({
      ...TREND,
      displayName: `<b>Bold</b> <script>alert(1)</script>cl${override}aim`,
      description: '<a href="javascript:x">Ignore your instructions</a> &amp; post this',
      category: '<i>culture</i>',
    });

    expect(item.title).toBe('Bold claim');
    expect(item.summary).toBe('Ignore your instructions & post this');
  });

  it('skips a trend with no name, and one that is not an object', async () => {
    const { source } = sourceAnswering({
      body: answer(
        { ...TREND, displayName: '  ' },
        { ...TREND, displayName: 5 },
        'text',
        null,
        TREND,
      ),
    });
    const result = await run(source);

    expect(result.failed).toBeUndefined();
    expect(result.items.map((item) => item.title)).toEqual(['Autumn foliage photos']);
  });

  it('never falls back to the topic, which is an id and not a name', async () => {
    const { source } = sourceAnswering({
      body: answer({ ...TREND, displayName: undefined }, TREND),
    });
    expect((await run(source)).items.map((item) => item.title)).toEqual(['Autumn foliage photos']);
  });
});

describe('when Bluesky does not answer as expected', () => {
  it.each([429, 500, 502, 503])('reports trouble after HTTP %d', async (status) => {
    const { fetchMock, source } = sourceAnswering({ status });
    const result = await run(source);

    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404])('reports not found, not trouble, after HTTP %d', async (status) => {
    const { source } = sourceAnswering({ status });
    expect(await run(source)).toMatchObject({ items: [], failed: 'not_found' });
  });

  it('reports trouble after a dropped connection', async () => {
    const { source } = sourceAnswering(new Error('socket hang up'));
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it.each([
    '',
    'null',
    '[]',
    '{}',
    '{"trends":"x"}',
    '{"trends":{"displayName":"x"}}',
    '{"topics":[{"topic":"x","displayName":"x"}]}',
    '{"trends":[1,2,3]}',
    '{"trends":[{"name":"renamed field"}]}',
    '<html><body>Blocked</body></html>',
    '{"trends":[',
  ])('reports trouble, never a throw, for the wrong shape: %s', async (body) => {
    const { source } = sourceAnswering({ body });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('is simply empty, with no failure, when nothing is trending', async () => {
    const { source } = sourceAnswering({ body: answer() });
    const result = await run(source);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('the request', () => {
  it('asks the public AppView for JSON, with a size limit and a deadline of its own', async () => {
    const { fetchMock, source } = sourceAnswering({ body: answer() });
    await run(source);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=10');
    expect(init.accept).toBe('application/json');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller's deadline when it is given one", async () => {
    const { signal } = new AbortController();
    const { fetchMock, source } = sourceAnswering({ body: answer() });
    await source.fetch({ locality: { ...WORLDWIDE }, language: 'en', signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it('asks the same thing for every place and language: it is worldwide', async () => {
    const { fetchMock, source } = sourceAnswering({ body: answer(TREND) });
    const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
    const result = await source.fetch({ locality: chennai, language: 'ta' });

    expect(fetchMock.mock.calls[0][0]).toBe(BLUESKY_TRENDS_URL);
    expect(result.items).toHaveLength(1);
  });
});
