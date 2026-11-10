import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import type { CompetitorSourceOptions } from './competitor';
import {
  createMastodonAccountSource,
  mastodonAccount,
  mastodonLookupUrl,
  mastodonStatusesUrl,
} from './mastodon-account';

const ACME = join(__dirname, '..', '..', 'fixtures', 'competitors', 'acme');
const LOOKUP = readFileSync(join(ACME, 'mastodon-lookup.sample.json'), 'utf8');
const STATUSES = readFileSync(join(ACME, 'mastodon-statuses.sample.json'), 'utf8');

const ACCT = 'acme@mastodon.example';
const ACCOUNT_ID = '110000000000000001';
const LOOKUP_URL = 'https://mastodon.example/api/v1/accounts/lookup?acct=acme';
const STATUSES_URL =
  'https://mastodon.example/api/v1/accounts/110000000000000001/statuses?limit=10&exclude_replies=true&exclude_reblogs=true';
const PROFILE = 'https://mastodon.example/@acme';

type Answer = Partial<DiscoverFetchResponse> | Error;

/** An instance that answers the lookup with one thing and the statuses with another. */
function sourceAnswering(
  answers: { lookup?: Answer; statuses?: Answer },
  options: Omit<CompetitorSourceOptions, 'fetch'> = { maxAgeMs: null },
) {
  const { lookup = { body: LOOKUP }, statuses = { body: STATUSES } } = answers;

  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    const answer = url.includes('/accounts/lookup') ? lookup : statuses;
    if (answer instanceof Error) throw answer;
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createMastodonAccountSource({ fetch: fetchMock, ...options }) };
}

/** A status as an instance sends it, with whatever a test overrides. */
function status(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    created_at: '2026-11-08T17:10:00.000Z',
    url: 'https://mastodon.example/@acme/1',
    content: '<p>A post.</p>',
    reblog: null,
    media_attachments: [],
    ...overrides,
  };
}

async function itemsFrom(...statuses: unknown[]) {
  const { source } = sourceAnswering({ statuses: { body: JSON.stringify(statuses) } });
  const result = await source.read(ACCT);
  expect(result.failed).toBeUndefined();
  return result.items;
}

describe('an account', () => {
  it('is a name and an instance, with or without the first @', () => {
    expect(mastodonAccount('acme@mastodon.example')).toEqual({
      user: 'acme',
      instance: 'mastodon.example',
    });
    expect(mastodonAccount('@acme@mastodon.example')).toEqual({
      user: 'acme',
      instance: 'mastodon.example',
    });
  });

  it('lower-cases the instance and leaves the name as typed', () => {
    expect(mastodonAccount('  Acme_HQ@Mastodon.Example ')).toEqual({
      user: 'Acme_HQ',
      instance: 'mastodon.example',
    });
  });

  it.each([
    ['nothing', ''],
    ['a name with no instance', 'acme'],
    ['a name and an @ with nothing after it', 'acme@'],
    ['an instance with no name', '@mastodon.example'],
    ['two instances', 'acme@mastodon.example@other.example'],
    ['an address literal', 'acme@127.0.0.1'],
    ['the cloud metadata address', 'acme@169.254.169.254'],
    ['an IPv6 literal', 'acme@[::1]'],
    ['a port', 'acme@mastodon.example:8080'],
    ['localhost', 'acme@localhost'],
    ['a path on the instance', 'acme@mastodon.example/api'],
    ['a query on the instance', 'acme@mastodon.example?x=1'],
    ['a space in the name', 'ac me@mastodon.example'],
    ['a name with a path in it', 'acme/../x@mastodon.example'],
    ['a name with a second parameter in it', 'acme&x=1@mastodon.example'],
    ['a name that is too long', `${'a'.repeat(65)}@mastodon.example`],
    ['a profile address', 'https://mastodon.example/@acme'],
  ])('is not %s', (_what, value) => {
    expect(mastodonAccount(value)).toBeNull();
  });

  it('becomes the two addresses that are asked, in turn', () => {
    expect(mastodonLookupUrl({ user: 'acme', instance: 'mastodon.example' })).toBe(LOOKUP_URL);
    expect(mastodonStatusesUrl('mastodon.example', ACCOUNT_ID)).toBe(STATUSES_URL);
  });
});

describe('the sample account', () => {
  it('looks the account up, then reads its statuses: two requests, in that order', async () => {
    const { fetchMock, source } = sourceAnswering({});
    await source.read(ACCT);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([LOOKUP_URL, STATUSES_URL]);
    expect(fetchMock.mock.calls.map(([, init]) => init.accept)).toEqual([
      'application/json',
      'application/json',
    ]);
  });

  it('gives the two posts as rows, newest first, with the markup gone', async () => {
    const { source } = sourceAnswering({});
    const result = await source.read(ACCT);

    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'Mastodon', url: PROFILE });
    expect(result.items).toEqual([
      {
        kind: 'competitor',
        source: { id: 'mastodon', name: 'Mastodon', url: PROFILE },
        // A paragraph with a link in it: the words stay, the tags and the address do not.
        title:
          'Version 2.4 is out: reports that send themselves every Monday. acme.example/changelog/2-4 (A sample post.)',
        url: 'https://mastodon.example/@acme/113000000000000003',
        publishedAt: '2026-11-08T17:10:00.000Z',
      },
      {
        kind: 'competitor',
        source: { id: 'mastodon', name: 'Mastodon', url: PROFILE },
        // A line break in the post reads as a space.
        title: 'We are hiring a support engineer. Remote, four days a week. (A sample post.)',
        url: 'https://mastodon.example/@acme/113000000000000002',
        image: 'https://files.mastodon.example/media/sample-hiring-small.png',
        publishedAt: '2026-11-04T09:00:00.000Z',
      },
    ]);
    for (const item of result.items) expect(item.title).not.toMatch(/[<>]/);
  });

  it('reads the same account for "@acme@Mastodon.Example"', async () => {
    const { fetchMock, source } = sourceAnswering({});
    const { items } = await source.read(' @acme@Mastodon.Example ');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([LOOKUP_URL, STATUSES_URL]);
    expect(items).toHaveLength(2);
  });

  it('drops a post older than 30 days against its clock', async () => {
    const { source } = sourceAnswering({}, { now: () => new Date('2026-12-06T00:00:00Z') });
    const { items } = await source.read(ACCT);

    expect(items.map((item) => item.publishedAt)).toEqual(['2026-11-08T17:10:00.000Z']);
  });

  it("passes the caller's deadline to both requests", async () => {
    const { fetchMock, source } = sourceAnswering({});
    const { signal } = new AbortController();
    await source.read(ACCT, signal);

    expect(fetchMock.mock.calls.map(([, init]) => init.signal)).toEqual([signal, signal]);
  });
});

describe('the Mastodon mapping', () => {
  it('leaves out a boost: the words inside it are someone else', async () => {
    const items = await itemsFrom(
      status({ content: '', reblog: status({ content: '<p>Not theirs.</p>' }) }),
      status({ content: '<p>Boosted with words.</p>', reblog: { id: '9' } }),
      status({ content: '<p>Their own.</p>' }),
      status({ content: '<p>Their own, no reblog key.</p>', reblog: undefined }),
    );

    expect(items.map((item) => item.title)).toEqual(['Their own.', 'Their own, no reblog key.']);
  });

  it.each([
    ['no content', { content: undefined }],
    ['content that is not a string', { content: { html: '<p>x</p>' } }],
    ['an empty paragraph', { content: '<p></p>' }],
    ['nothing but a picture', { content: '' }],
  ])('drops a status with %s', async (_what, overrides) => {
    const items = await itemsFrom(status(overrides), status({ content: '<p>Kept.</p>' }));
    expect(items.map((item) => item.title)).toEqual(['Kept.']);
  });

  it('drops whatever is not a status at all', async () => {
    expect(await itemsFrom('x', 1, null, [], status({ content: '<p>Kept.</p>' }))).toHaveLength(1);
  });

  it('strips every tag, script bodies too, and cuts a long post to 240 characters', async () => {
    const [marked] = await itemsFrom(
      status({
        content:
          '<p>Hello <span class="h-card"><a href="https://x.example/@you">@you</a></span></p><script>alert(1)</script><p>Bye &amp; thanks</p>',
      }),
    );
    const [long] = await itemsFrom(status({ content: `<p>${'word '.repeat(100)}</p>` }));

    expect(marked.title).toBe('Hello @you Bye & thanks');
    expect(Array.from(long.title)).toHaveLength(240);
    expect(long.title.endsWith('...')).toBe(true);
  });

  it.each([
    ['a script', 'javascript:alert(1)'],
    ['something that is not a string', 42],
    ['nothing', undefined],
  ])('never makes %s the address a row opens', async (_what, url) => {
    const [item] = await itemsFrom(status({ url }));
    expect(item.url).toBeUndefined();
  });

  it('takes a picture only from an image attachment', async () => {
    const preview = 'https://files.mastodon.example/media/small.png';
    const [image] = await itemsFrom(
      status({ media_attachments: [{ type: 'image', preview_url: preview }] }),
    );
    const [video] = await itemsFrom(
      status({ media_attachments: [{ type: 'video', preview_url: preview }] }),
    );
    const [gif] = await itemsFrom(
      status({ media_attachments: [{ type: 'gifv', preview_url: preview }] }),
    );
    const [audio] = await itemsFrom(
      status({ media_attachments: [{ type: 'audio', preview_url: preview }] }),
    );

    expect(image.image).toBe(preview);
    expect(video.image).toBeUndefined();
    expect(gif.image).toBeUndefined();
    expect(audio.image).toBeUndefined();
  });

  it.each([
    ['no attachments', undefined],
    ['attachments that are not a list', 'none'],
    ['an empty list', []],
    ['an image with no preview', [{ type: 'image', url: 'https://files.mastodon.example/a.png' }]],
    ['an image whose preview is a script', [{ type: 'image', preview_url: 'javascript:alert(1)' }]],
    ['an attachment that is not an object', ['https://files.mastodon.example/a.png']],
  ])('has no picture for %s', async (_what, media_attachments) => {
    const [item] = await itemsFrom(status({ media_attachments }));
    expect(item.image).toBeUndefined();
  });

  it('leaves a date it cannot read out, and keeps the post', async () => {
    const [item] = await itemsFrom(status({ created_at: 'last week' }));
    expect(item.publishedAt).toBeUndefined();
  });

  it('answers a quiet account with an empty list, not a failure', async () => {
    const { source } = sourceAnswering({ statuses: { body: '[]' } });
    const result = await source.read(ACCT);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('an account that cannot be read', () => {
  it.each([
    ['nothing', ''],
    ['a name with no @', 'acme'],
    ['an address literal for an instance', 'acme@127.0.0.1'],
    ['the cloud metadata address', 'acme@169.254.169.254'],
    ['an instance with a port', 'acme@mastodon.example:6379'],
    ['localhost', 'acme@localhost'],
    ['an instance with a path', 'acme@mastodon.example/api/v1/admin'],
    ['a name with a second parameter in it', 'acme&x=1@mastodon.example'],
  ])('makes no request for %s', async (_what, reference) => {
    const { fetchMock, source } = sourceAnswering({});
    const result = await source.read(reference);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      attribution: { name: 'Mastodon' },
      warnings: ['That is not a Mastodon account.'],
      failed: 'not_found',
    });
  });

  it.each([
    ['a path', '1/../../admin'],
    ['a query', '1?limit=1000'],
    ['a second parameter', '1&x=1'],
    ['a space', '1 2'],
    ['nothing', ''],
    ['an id that is too long', '9'.repeat(65)],
  ])('stops before the second request when the account id has %s', async (_what, id) => {
    const { fetchMock, source } = sourceAnswering({ lookup: { body: JSON.stringify({ id }) } });
    const result = await source.read(ACCT);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([LOOKUP_URL]);
    expect(result).toEqual({
      items: [],
      attribution: { name: 'Mastodon', url: PROFILE },
      warnings: ['The instance answered in a shape this cannot read.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it.each([
    ['not JSON', '<html>Sign in</html>'],
    ['an object with no id', '{"username":"acme"}'],
    ['an id that is a number', '{"id":110000000000000001}'],
    ['a list', '[]'],
    ['null', 'null'],
  ])('stops before the second request when the lookup answers %s', async (_what, body) => {
    const { fetchMock, source } = sourceAnswering({ lookup: { body } });
    const result = await source.read(ACCT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ items: [], failed: 'not_found', unreadable: true });
  });

  it('takes the letters-and-digits id another server that speaks the API gives', async () => {
    const { fetchMock, source } = sourceAnswering({
      lookup: { body: JSON.stringify({ id: 'AbC123xyz' }) },
    });
    await source.read(ACCT);

    expect(fetchMock.mock.calls[1][0]).toBe(mastodonStatusesUrl('mastodon.example', 'AbC123xyz'));
  });

  it('says nothing is there when the lookup answers 404, and asks nothing more', async () => {
    const { fetchMock, source } = sourceAnswering({ lookup: { status: 404 } });
    const result = await source.read(ACCT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.unreadable).toBeUndefined();
    expect(result.attribution).toEqual({ name: 'Mastodon', url: PROFILE });
  });

  it('says trouble when the lookup answers 429 or 5xx, or never completes', async () => {
    for (const lookup of [{ status: 429 }, { status: 503 }, new Error('socket hang up')]) {
      const { fetchMock, source } = sourceAnswering({ lookup });
      const result = await source.read(ACCT);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ items: [], failed: 'upstream' });
    }
  });

  it('says trouble when the statuses answer 429 or 5xx, or never complete', async () => {
    for (const statuses of [{ status: 429 }, { status: 500 }, new Error('socket hang up')]) {
      const { fetchMock, source } = sourceAnswering({ statuses });
      const result = await source.read(ACCT);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ items: [], failed: 'upstream' });
      expect(result.unreadable).toBeUndefined();
    }
  });

  it('says nothing is there when the statuses answer 404', async () => {
    const result = await sourceAnswering({ statuses: { status: 404 } }).source.read(ACCT);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.unreadable).toBeUndefined();
  });

  it.each([
    ['an object', '{"error":"Record not found"}'],
    ['not JSON', '<html>Sign in</html>'],
    ['an empty body', ''],
    ['null', 'null'],
  ])('says unreadable when the statuses answer %s', async (_what, body) => {
    const result = await sourceAnswering({ statuses: { body } }).source.read(ACCT);

    expect(result).toEqual({
      items: [],
      attribution: { name: 'Mastodon', url: PROFILE },
      warnings: ['The instance answered in a shape this cannot read.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it('says unreadable for an answer over the size cap', async () => {
    const tooLarge = Object.assign(new Error('too large'), { kind: 'too_large' });
    const result = await sourceAnswering({ statuses: tooLarge }).source.read(ACCT);

    expect(result).toMatchObject({ items: [], failed: 'not_found', unreadable: true });
  });
});

describe('the source itself', () => {
  it('says what it is', () => {
    const { source } = sourceAnswering({});
    expect([source.id, source.name]).toEqual(['mastodon', 'Mastodon']);
  });
});
