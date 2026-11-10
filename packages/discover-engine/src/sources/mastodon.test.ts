import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality, WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import { createMastodonSource, MASTODON_INSTANCE, mastodonTrendsUrl } from './mastodon';

const RECORDED = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'worldwide', 'mastodon-tags.2026-11-10.json'),
  'utf8',
);

const DEFAULT_URL = 'https://mastodon.social/api/v1/trends/tags?limit=10';

/** A tag as the API sends it: counts are strings, one row a day, newest first. */
function tag(name: unknown, uses: unknown[] = ['5', '7'], url?: unknown) {
  return {
    id: '1',
    name,
    url: url === undefined ? `https://mastodon.social/tags/${String(name).toLowerCase()}` : url,
    history: uses.map((count, index) => ({
      day: String(1_794_268_800 - index * 86_400),
      accounts: '1',
      uses: count,
    })),
  };
}

function sourceAnswering(response: Partial<DiscoverFetchResponse> | Error, instance?: string) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createMastodonSource({ fetch: fetchMock, instance }) };
}

const run = (source: ReturnType<typeof sourceAnswering>['source']) =>
  source.fetch({ locality: { ...WORLDWIDE }, language: 'en' });

/** The one item a body with a single tag gives. */
async function itemFrom(entry: unknown) {
  const { source } = sourceAnswering({ body: JSON.stringify([entry]) });
  const { items } = await run(source);
  expect(items).toHaveLength(1);
  return items[0];
}

describe('the recorded tags', () => {
  it('gives ten hashtags, each with a link and a week of uses', async () => {
    const { fetchMock, source } = sourceAnswering({ body: RECORDED });
    const result = await run(source);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([DEFAULT_URL]);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'Mastodon', url: 'https://mastodon.social' });
    expect(result.items.map((item) => [item.title, item.signal?.label])).toEqual([
      ['#OddReasonsToCelebrate', '199 uses this week'],
      ['#PunkAnOperaOrClassics', '273 uses this week'],
      ['#MonochromeMonday', '142 uses this week'],
      ['#Monsterdon', '3,312 uses this week'],
      ['#TuneTuesday', '24 uses this week'],
      ['#culturalmusic', '18 uses this week'],
      ['#monoinc', '15 uses this week'],
      ['#Fotomontag', '70 uses this week'],
      ['#segundaficha', '44 uses this week'],
      ['#9november', '78 uses this week'],
    ]);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https:\/\/mastodon\.social\/tags\/[A-Za-z0-9]+$/);
    }
  });

  it('maps every field the chip and the brief need', async () => {
    const { source } = sourceAnswering({ body: RECORDED });
    const [first] = (await run(source)).items;

    expect(first).toEqual({
      kind: 'social',
      source: { id: 'mastodon', name: 'Mastodon', url: 'https://mastodon.social' },
      title: '#OddReasonsToCelebrate',
      url: 'https://mastodon.social/tags/oddreasonstocelebrate',
      signal: { label: '199 uses this week', posts: 199 },
    });
  });
});

describe('the Mastodon mapping', () => {
  it('adds up the uses of every day the instance reports', async () => {
    const item = await itemFrom(tag('Monsterdon', ['3', '3272', '10', '4', '9', '6', '8']));
    expect(item.signal).toEqual({ label: '3,312 uses this week', posts: 3312 });
  });

  it('reads a count sent as a number as well as one sent as a string', async () => {
    expect((await itemFrom(tag('caturday', [3, '4', 5]))).signal?.posts).toBe(12);
  });

  it('leaves out a day it cannot read and counts the rest', async () => {
    const item = await itemFrom(tag('caturday', ['4', 'many', '', '-3', '1.5', null, 6]));
    expect(item.signal).toEqual({ label: '10 uses this week', posts: 10 });
  });

  it.each([
    ['no history', { ...tag('caturday'), history: undefined }],
    ['a history that is not a list', { ...tag('caturday'), history: 'busy' }],
    ['an empty history', tag('caturday', [])],
    ['a history with nothing readable in it', tag('caturday', ['many', null])],
    ['days that are not objects', { ...tag('caturday'), history: [1, 'x', null] }],
  ])('claims no count, and no made-up label, for %s', async (_what, entry) => {
    const item = await itemFrom(entry);

    expect(item.title).toBe('#caturday');
    expect(item.signal).toBeUndefined();
  });

  it('says one use, not one uses, and shortens the big counts', async () => {
    expect((await itemFrom(tag('quiet', ['1', '0']))).signal?.label).toBe('1 use this week');
    expect((await itemFrom(tag('silent', ['0', '0']))).signal?.label).toBe('0 uses this week');
    expect((await itemFrom(tag('loud', ['9000', '2054']))).signal?.label).toBe(
      '11K uses this week',
    );
  });

  it('shows at most ten', async () => {
    const many = Array.from({ length: 15 }, (_, index) => tag(`tag${index + 1}`));
    const { source } = sourceAnswering({ body: JSON.stringify(many) });
    const { items } = await run(source);

    expect(items).toHaveLength(10);
    expect(items.at(-1)?.title).toBe('#tag10');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/tags/caturday',
    'mastodon.social/tags/caturday',
    '',
    42,
    null,
  ])('drops the link %j and keeps the tag', async (url) => {
    const item = await itemFrom(tag('caturday', ['5'], url));

    expect(item.title).toBe('#caturday');
    expect(item.url).toBeUndefined();
  });

  it('does not double the hash when the name already has one', async () => {
    expect((await itemFrom(tag('#caturday'))).title).toBe('#caturday');
    expect((await itemFrom(tag('##caturday'))).title).toBe('#caturday');
  });

  it('keeps a hashtag in another script as it is', async () => {
    expect((await itemFrom(tag('தீபாவளி'))).title).toBe('#தீபாவளி');
  });

  it('never lets markup or a hidden character into a tag', async () => {
    const override = String.fromCodePoint(0x202e);
    const item = await itemFrom(tag(`<b>cat</b>ur${override}day<script>alert(1)</script>`));
    expect(item.title).toBe('#caturday');
  });

  it('skips a tag with no name, and one that is not an object', async () => {
    const { source } = sourceAnswering({
      body: JSON.stringify([tag(''), tag('#'), tag(5), 'text', null, tag('caturday')]),
    });
    const result = await run(source);

    expect(result.failed).toBeUndefined();
    expect(result.items.map((item) => item.title)).toEqual(['#caturday']);
  });
});

describe('the instance', () => {
  it('is mastodon.social unless told otherwise', () => {
    expect(MASTODON_INSTANCE).toBe('mastodon.social');
    expect(mastodonTrendsUrl()).toBe(DEFAULT_URL);
  });

  it.each([
    ['fosstodon.org', 'fosstodon.org'],
    ['  Mastodon.Online ', 'mastodon.online'],
    ['social.vivaldi.net', 'social.vivaldi.net'],
    ['mas-to-don.example.co.uk', 'mas-to-don.example.co.uk'],
  ])('asks the instance %j when it is a host name', async (given, host) => {
    const { fetchMock, source } = sourceAnswering(
      { body: JSON.stringify([tag('caturday')]) },
      given,
    );
    const result = await run(source);

    expect(fetchMock.mock.calls[0][0]).toBe(`https://${host}/api/v1/trends/tags?limit=10`);
    expect(result.attribution).toEqual({ name: 'Mastodon', url: `https://${host}` });
    expect(result.items[0].source).toEqual({
      id: 'mastodon',
      name: 'Mastodon',
      url: `https://${host}`,
    });
    expect(result.warnings).toEqual([]);
  });

  it.each([
    'evil.example/api/v1/trends/tags?x=',
    'evil.example?x=',
    'evil.example#',
    'user:pass@evil.example',
    'mastodon.social@evil.example',
    'evil.example:8080',
    'https://evil.example',
    '127.0.0.1',
    '169.254.169.254',
    '[::1]',
    'localhost',
    'intranet',
    'evil..example',
    '-evil.example',
    'evil-.example',
    '.evil.example',
    'evil.example.',
    'evil example.org',
    'evil.example\n.org',
    'evil_host.example',
    `${'a'.repeat(64)}.example`,
    `${'a.'.repeat(130)}example`,
  ])('never lets %j into an address: it asks the default and says so', async (given) => {
    const { fetchMock, source } = sourceAnswering(
      { body: JSON.stringify([tag('caturday')]) },
      given,
    );
    const result = await run(source);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([DEFAULT_URL]);
    expect(result.items[0].source.url).toBe('https://mastodon.social');
    expect(result.warnings).toEqual([
      'The Mastodon instance is not a host name, so this is mastodon.social.',
    ]);
  });

  it('keeps saying so when the answer is a failure', async () => {
    const { source } = sourceAnswering({ status: 503 }, 'localhost');
    const result = await run(source);

    expect(result.failed).toBe('upstream');
    expect(result.warnings).toHaveLength(1);
  });

  it.each(['', '   '])('reads a blank setting %j as no setting, quietly', async (given) => {
    const { fetchMock, source } = sourceAnswering({ body: '[]' }, given);
    const result = await run(source);

    expect(fetchMock.mock.calls[0][0]).toBe(DEFAULT_URL);
    expect(result.warnings).toEqual([]);
  });
});

describe('when Mastodon does not answer as expected', () => {
  it.each([429, 500, 502, 503])('reports trouble after HTTP %d', async (status) => {
    const { fetchMock, source } = sourceAnswering({ status });
    const result = await run(source);

    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 404])('reports not found, not trouble, after HTTP %d', async (status) => {
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
    '{}',
    '{"error":"Too many requests"}',
    '{"tags":[{"name":"caturday"}]}',
    '[1,2,3]',
    '[{"tag":"renamed field"}]',
    '<html><body>Blocked</body></html>',
    '[{"name":"caturday"',
  ])('reports trouble, never a throw, for the wrong shape: %s', async (body) => {
    const { source } = sourceAnswering({ body });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('is simply empty, with no failure, when nothing is trending', async () => {
    const { source } = sourceAnswering({ body: '[]' });
    const result = await run(source);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('the request', () => {
  it('asks for JSON, with a size limit and a deadline of its own', async () => {
    const { fetchMock, source } = sourceAnswering({ body: '[]' });
    await run(source);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.accept).toBe('application/json');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller's deadline when it is given one", async () => {
    const { signal } = new AbortController();
    const { fetchMock, source } = sourceAnswering({ body: '[]' });
    await source.fetch({ locality: { ...WORLDWIDE }, language: 'en', signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it('asks the same thing for every place and language: it is worldwide', async () => {
    const { fetchMock, source } = sourceAnswering({ body: JSON.stringify([tag('caturday')]) });
    const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
    const result = await source.fetch({ locality: chennai, language: 'ta' });

    expect(fetchMock.mock.calls[0][0]).toBe(DEFAULT_URL);
    expect(result.items).toHaveLength(1);
  });
});
