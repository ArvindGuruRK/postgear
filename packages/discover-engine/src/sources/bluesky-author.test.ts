import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import { blueskyAuthorFeedUrl, blueskyHandle, createBlueskyAuthorSource } from './bluesky-author';
import type { CompetitorSourceOptions } from './competitor';

const SAMPLE = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'competitors', 'acme', 'bluesky-author.sample.json'),
  'utf8',
);

const HANDLE = 'acme.example';
const FEED_URL =
  'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=acme.example&limit=10&filter=posts_no_replies';

function sourceAnswering(
  response: Partial<DiscoverFetchResponse> | Error,
  options: Omit<CompetitorSourceOptions, 'fetch'> = { maxAgeMs: null },
) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createBlueskyAuthorSource({ fetch: fetchMock, ...options }) };
}

/** A feed entry as the AppView sends it, with whatever a test overrides. */
function entry(overrides: {
  uri?: unknown;
  text?: unknown;
  createdAt?: unknown;
  indexedAt?: unknown;
  embed?: unknown;
  reason?: unknown;
  record?: unknown;
}) {
  // Spread, not defaults: a test that passes `undefined` means "leave it out".
  const { uri, text, createdAt, indexedAt } = {
    uri: 'at://did:plc:acme/app.bsky.feed.post/3labc',
    text: 'A post.',
    createdAt: '2026-11-09T11:05:00.000Z',
    indexedAt: '2026-11-09T11:05:02.000Z',
    ...overrides,
  };

  return {
    post: {
      uri,
      author: { did: 'did:plc:acme', handle: HANDLE },
      record:
        'record' in overrides ? overrides.record : { $type: 'app.bsky.feed.post', text, createdAt },
      indexedAt,
      ...('embed' in overrides ? { embed: overrides.embed } : {}),
    },
    ...('reason' in overrides ? { reason: overrides.reason } : {}),
  };
}

async function itemsFrom(...entries: unknown[]) {
  const { source } = sourceAnswering({ body: JSON.stringify({ feed: entries }) });
  const result = await source.read(HANDLE);
  expect(result.failed).toBeUndefined();
  return result.items;
}

describe('a handle', () => {
  it('is taken as people paste it: with an @, in capitals, with spaces round it', () => {
    expect(blueskyHandle('acme.example')).toBe('acme.example');
    expect(blueskyHandle('@acme.example')).toBe('acme.example');
    expect(blueskyHandle('  @Acme.BSKY.Social ')).toBe('acme.bsky.social');
  });

  it.each([
    ['nothing', ''],
    ['a bare word', 'acme'],
    ['a DID', 'did:plc:sampleacme000000000000000'],
    ['a profile address', 'https://bsky.app/profile/acme.example'],
    ['a path', 'acme.example/post/1'],
    ['a second parameter', 'acme.example&limit=100'],
    ['a query', 'acme.example?x=1'],
    ['an address literal', '127.0.0.1'],
    ['a port', 'acme.example:8080'],
    ['a space inside', 'acme .example'],
  ])('is not %s', (_what, value) => {
    expect(blueskyHandle(value)).toBeNull();
  });

  it('becomes the address of the author feed, replies left out', () => {
    expect(blueskyAuthorFeedUrl(HANDLE)).toBe(FEED_URL);
  });
});

describe('the sample author feed', () => {
  it('asks the public AppView once, for JSON', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    await source.read(HANDLE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FEED_URL);
    expect(fetchMock.mock.calls[0][1].accept).toBe('application/json');
  });

  it('gives their two posts, newest first, and leaves the repost out', async () => {
    const { source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(HANDLE);

    expect(JSON.parse(SAMPLE).feed).toHaveLength(3);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'Bluesky', url: 'https://bsky.app' });
    expect(result.items).toEqual([
      {
        kind: 'competitor',
        source: { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app/profile/acme.example' },
        title:
          'New on the blog: five ways to cut churn, each with a number you can check on Monday. (A sample post.)',
        url: 'https://bsky.app/profile/acme.example/post/3lsampleacme1',
        publishedAt: '2026-11-09T11:05:00.000Z',
      },
      {
        kind: 'competitor',
        source: { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app/profile/acme.example' },
        title:
          'Scheduled reports are live. Pick a day, pick a time, and stop exporting by hand. (A sample post.)',
        url: 'https://bsky.app/profile/acme.example/post/3lsampleacme2',
        // The first picture of the post's embed.
        image: 'https://cdn.bsky.app/img/feed_thumbnail/plain/sample/acme2@jpeg',
        publishedAt: '2026-11-05T16:40:00.000Z',
      },
    ]);
    expect(JSON.stringify(result.items)).not.toContain('someone else');
  });

  it('reads the same feed for "@Acme.Example", and links with the plain handle', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const { items } = await source.read(' @Acme.Example ');

    expect(fetchMock.mock.calls[0][0]).toBe(FEED_URL);
    expect(items[0].url).toBe('https://bsky.app/profile/acme.example/post/3lsampleacme1');
    expect(items[0].source.url).toBe('https://bsky.app/profile/acme.example');
  });

  it('drops a post older than 30 days against its clock', async () => {
    const { source } = sourceAnswering(
      { body: SAMPLE },
      { now: () => new Date('2026-12-08T00:00:00Z') },
    );
    const { items } = await source.read(HANDLE);

    expect(items.map((item) => item.publishedAt)).toEqual(['2026-11-09T11:05:00.000Z']);
  });
});

describe('the Bluesky mapping', () => {
  it('leaves out anything with a reason: a repost is not theirs', async () => {
    const items = await itemsFrom(
      entry({ text: 'Reposted.', reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }),
      entry({ text: 'A reason that says nothing.', reason: null }),
      entry({ text: 'Their own.' }),
    );
    expect(items.map((item) => item.title)).toEqual(['Their own.']);
  });

  it.each([
    ['a key with a slash after it', 'at://did:plc:acme/app.bsky.feed.post/3labc/extra'],
    ['a key with a query in it', 'at://did:plc:acme/app.bsky.feed.post/3labc?x=1'],
    ['a key with a space in it', 'at://did:plc:acme/app.bsky.feed.post/3l abc'],
    ['a key that climbs out', 'at://did:plc:acme/app.bsky.feed.post/..%2F..%2Fsettings'],
    ['a key that is too long', `at://did:plc:acme/app.bsky.feed.post/${'k'.repeat(65)}`],
    ['no key', 'at://did:plc:acme/app.bsky.feed.post/'],
    ['another collection', 'at://did:plc:acme/app.bsky.feed.like/3labc'],
    ['a web address', 'https://attacker.example/app.bsky.feed.post/3labc'],
    ['a number', 42],
    ['nothing', undefined],
  ])('drops a post whose address has %s', async (_what, uri) => {
    const items = await itemsFrom(entry({ uri }), entry({ text: 'Kept.' }));
    expect(items.map((item) => item.title)).toEqual(['Kept.']);
  });

  it('builds the link from the handle and the record key, and nothing the answer says', async () => {
    const [item] = await itemsFrom(
      entry({ uri: 'at://attacker.example/app.bsky.feed.post/3l.key_ok-1~' }),
    );
    expect(item.url).toBe('https://bsky.app/profile/acme.example/post/3l.key_ok-1~');
  });

  it.each([
    ['no text', undefined],
    ['text that is not a string', { en: 'hello' }],
    ['an empty text', ''],
    ['only spaces', '   \n '],
  ])('drops a post with %s', async (_what, text) => {
    const items = await itemsFrom(entry({ text }), entry({ text: 'Kept.' }));
    expect(items.map((item) => item.title)).toEqual(['Kept.']);
  });

  it('drops a post with no record at all', async () => {
    const items = await itemsFrom(entry({ record: 'gone' }), entry({ record: null }), 'x', null, {
      post: 'not a post',
    });
    expect(items).toEqual([]);
  });

  it('cuts a long post to 240 characters and strips any markup', async () => {
    const [long] = await itemsFrom(entry({ text: 'word '.repeat(100) }));
    const [marked] = await itemsFrom(entry({ text: 'Hello <b>there</b>\nfriends' }));

    expect(Array.from(long.title)).toHaveLength(240);
    expect(long.title.endsWith('...')).toBe(true);
    expect(marked.title).toBe('Hello there friends');
  });

  it('dates a post by when it was written, or failing that when it was indexed', async () => {
    const [written] = await itemsFrom(entry({}));
    const [indexed] = await itemsFrom(entry({ createdAt: 'yesterday-ish' }));
    const [undated] = await itemsFrom(entry({ createdAt: 12, indexedAt: null }));

    expect(written.publishedAt).toBe('2026-11-09T11:05:00.000Z');
    expect(indexed.publishedAt).toBe('2026-11-09T11:05:02.000Z');
    expect(undated.publishedAt).toBeUndefined();
  });

  it.each([
    ['no embed', undefined],
    ['an embed with no pictures', { $type: 'app.bsky.embed.external#view' }],
    ['an empty list of pictures', { images: [] }],
    ['a picture that is a script', { images: [{ thumb: 'javascript:alert(1)' }] }],
    ['a picture with no thumbnail', { images: [{ fullsize: 'https://cdn.bsky.app/a.jpg' }] }],
    ['pictures that are not objects', { images: ['https://cdn.bsky.app/a.jpg'] }],
  ])('has no picture for %s', async (_what, embed) => {
    const [item] = await itemsFrom(entry({ embed }));
    expect(item.image).toBeUndefined();
  });

  it('gives the newest ten of a busier feed', async () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      entry({
        uri: `at://did:plc:acme/app.bsky.feed.post/3lpost${index}`,
        text: `Post ${index}`,
        createdAt: `2026-11-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
      }),
    );
    const items = await itemsFrom(...entries);

    expect(items).toHaveLength(10);
    expect(items[0].title).toBe('Post 13');
  });

  it('answers a quiet account with an empty list, not a failure', async () => {
    const { source } = sourceAnswering({ body: JSON.stringify({ feed: [] }) });
    const result = await source.read(HANDLE);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('an author that cannot be read', () => {
  it.each([
    ['nothing', ''],
    ['a bare word', 'acme'],
    ['a DID', 'did:plc:sampleacme000000000000000'],
    ['a handle with a second parameter', 'acme.example&actor=other.example'],
    ['a handle with a path', 'acme.example/../admin'],
    ['an address literal', '127.0.0.1'],
  ])('makes no request for %s', async (_what, reference) => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(reference);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      attribution: { name: 'Bluesky', url: 'https://bsky.app' },
      warnings: ['That is not a Bluesky handle.'],
      failed: 'not_found',
    });
  });

  it.each([
    ['not JSON', '<html>Sign in</html>'],
    ['an empty body', ''],
    ['an object with no feed', '{"cursor":"x"}'],
    ['a feed that is not a list', '{"feed":"none"}'],
    ['a list', '[]'],
    ['null', 'null'],
  ])('says unreadable for %s', async (_what, body) => {
    const result = await sourceAnswering({ body }).source.read(HANDLE);

    expect(result).toEqual({
      items: [],
      attribution: { name: 'Bluesky', url: 'https://bsky.app' },
      warnings: ['Bluesky answered in a shape this cannot read.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it.each([429, 500, 502])('says trouble for a %i', async (status) => {
    const result = await sourceAnswering({ status }).source.read(HANDLE);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(result.unreadable).toBeUndefined();
  });

  it.each([400, 404])(
    'says nothing is there for a %i, which an unknown handle gets',
    async (status) => {
      const result = await sourceAnswering({ status }).source.read(HANDLE);
      expect(result).toMatchObject({ items: [], failed: 'not_found' });
      expect(result.unreadable).toBeUndefined();
    },
  );

  it('says trouble for a dropped connection, and never throws', async () => {
    const result = await sourceAnswering(new Error('socket hang up')).source.read(HANDLE);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
  });
});

describe('the source itself', () => {
  it('says what it is', () => {
    const { source } = sourceAnswering({});
    expect([source.id, source.name]).toEqual(['bluesky', 'Bluesky']);
  });
});
