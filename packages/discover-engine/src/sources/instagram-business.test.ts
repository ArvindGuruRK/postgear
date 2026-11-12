import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import {
  businessDiscoveryUsername,
  createInstagramBusinessSource,
  instagramBusinessPrefix,
  instagramUsername,
  isInstagramUsername,
} from './instagram-business';

const SAMPLE = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'competitors', 'acme', 'instagram.sample.json'),
  'utf8',
);

/** Made up, and shaped to need encoding, so a slip anywhere shows. */
const TOKEN = 'EAAG-TEST token&not=real';
const ENCODED_TOKEN = encodeURIComponent(TOKEN);
const REFERENCE = { username: '@Acme.Sample', igUserId: '17841400000000001', accessToken: TOKEN };

/** A failed request whose message quotes the address, as a real fetch error can. */
const QUOTES_THE_ADDRESS = Symbol('an error that quotes the address');
type Answer = Partial<DiscoverFetchResponse> | typeof QUOTES_THE_ADDRESS;

function sourceAnswering(answer: Answer) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (answer === QUOTES_THE_ADDRESS) throw new Error(`request to ${url} failed: ECONNRESET`);
    // The real binding reports the address it ended at, token and all.
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return {
    fetchMock,
    source: createInstagramBusinessSource({ fetch: fetchMock, maxAgeMs: null }),
  };
}

const graphError = (code: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    error: { message: `(#${code}) about ${TOKEN}`, type: 'OAuthException', code, ...extra },
  });

describe('a username', () => {
  it('is taken as people paste it: bare, with an @, or as a profile address', () => {
    expect(instagramUsername('acme.sample')).toBe('acme.sample');
    expect(instagramUsername(' @Acme_Sample ')).toBe('acme_sample');
    expect(instagramUsername('https://www.instagram.com/acme.sample/?igsh=x')).toBe('acme.sample');
    expect(instagramUsername('instagram.com/acme.sample')).toBe('acme.sample');
  });

  it.each([
    '',
    '.acme',
    'acme.',
    'ac..me',
    'a'.repeat(31),
    'acme sample',
    'acme&fields=x',
    'https://www.instagram.com/p/SAMPLEacme01/',
    'https://evil.example/acme.sample',
  ])('is not %j', (value) => {
    expect(instagramUsername(value)).toBeNull();
  });

  it('follows the rules on its own', () => {
    expect(isInstagramUsername('a')).toBe(true);
    expect(isInstagramUsername('a'.repeat(30))).toBe(true);
    expect(isInstagramUsername('a.b_c.9')).toBe(true);
  });
});

describe('the sample account', () => {
  it('asks Business Discovery once, with the token last', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    await source.read(REFERENCE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${instagramBusinessPrefix({ igUserId: '17841400000000001', username: 'acme.sample' })}${ENCODED_TOKEN}`,
    );
    expect(new URL(url).searchParams.get('fields')).toBe(
      'business_discovery.username(acme.sample){username,name,profile_picture_url,followers_count,media_count,media.limit(10){caption,permalink,timestamp,media_type,media_url,thumbnail_url,like_count,comments_count}}',
    );
    expect(url.startsWith('https://graph.facebook.com/v21.0/17841400000000001?')).toBe(true);
    expect(businessDiscoveryUsername(url)).toBe('acme.sample');
    expect(init.accept).toBe('application/json');
  });

  it('gives its four posts, newest first, each with what a card shows', async () => {
    const { source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(REFERENCE);
    const profile = 'https://www.instagram.com/acme.sample/';

    expect(result.failed).toBeUndefined();
    expect(result.attribution).toEqual({ name: 'Instagram', url: 'https://www.instagram.com' });
    expect(result.items).toEqual([
      {
        kind: 'competitor',
        source: { id: 'instagram', name: 'Instagram', url: profile },
        title: 'Scheduled reports are live. (A sample post.)',
        summary:
          'Scheduled reports are live. (A sample post.) Pick a day, pick a time, and stop exporting by hand. #analytics #reporting',
        url: 'https://www.instagram.com/p/SAMPLEacme01/',
        image: 'https://scontent.cdninstagram.com/v/sample/acme01.jpg',
        publishedAt: '2026-11-09T09:30:00.000Z',
        signal: { label: '1,284 likes, 37 comments' },
      },
      {
        kind: 'competitor',
        source: { id: 'instagram', name: 'Instagram', url: profile },
        title: 'Reading a retention chart in four minutes. (A sample reel.)',
        url: 'https://www.instagram.com/reel/SAMPLEacme02/',
        // A video's picture is its thumbnail, and its hidden likes stay hidden.
        image: 'https://scontent.cdninstagram.com/v/sample/acme02-thumb.jpg',
        publishedAt: '2026-11-06T15:00:00.000Z',
        signal: { label: '12 comments' },
      },
      {
        kind: 'competitor',
        source: { id: 'instagram', name: 'Instagram', url: profile },
        title: 'Five ways to cut churn, one slide each. (A sample carousel.)',
        url: 'https://www.instagram.com/p/SAMPLEacme03/',
        image: 'https://scontent.cdninstagram.com/v/sample/acme03-1.jpg',
        publishedAt: '2026-11-03T11:15:00.000Z',
        signal: { label: '46K likes, 1 comment' },
      },
      {
        kind: 'competitor',
        source: { id: 'instagram', name: 'Instagram', url: profile },
        title: 'A photo on Instagram',
        url: 'https://www.instagram.com/p/SAMPLEacme04/',
        image: 'https://scontent.cdninstagram.com/v/sample/acme04.jpg',
        publishedAt: '2026-10-28T08:00:00.000Z',
        signal: { label: '1 like, 0 comments' },
      },
    ]);
  });

  it('never links a post anywhere but Instagram', async () => {
    const body = JSON.stringify({
      business_discovery: {
        media: {
          data: [{ caption: 'Hi', permalink: 'https://evil.example/p/1', media_type: 'IMAGE' }],
        },
      },
    });
    const { items } = await sourceAnswering({ body }).source.read(REFERENCE);
    expect(items.map((item) => [item.title, item.url])).toEqual([['Hi', undefined]]);
  });
});

describe('an account that cannot be read', () => {
  it('reads an unknown or personal account as unreadable, not as trouble', async () => {
    const body = graphError(110, { error_subcode: 2207013, error_user_title: 'Cannot find User' });
    const result = await sourceAnswering({ status: 400, body }).source.read(REFERENCE);

    expect(result).toEqual({
      items: [],
      attribution: { name: 'Instagram', url: 'https://www.instagram.com' },
      warnings: ['Instagram has no business or creator account by that name.'],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it.each([
    [190, 'The connected Instagram account needs to be reconnected.'],
    [
      10,
      'The connected Instagram account needs to be reconnected, with permission to look up other accounts.',
    ],
    [
      200,
      'The connected Instagram account needs to be reconnected, with permission to look up other accounts.',
    ],
  ])(
    "asks for a reconnect after Graph error %i, and marks it as this workspace's",
    async (code, warning) => {
      const result = await sourceAnswering({ status: 400, body: graphError(code) }).source.read(
        REFERENCE,
      );
      expect(result).toMatchObject({
        items: [],
        failed: 'upstream',
        reconnect: true,
        warnings: [warning],
      });
    },
  );

  it.each([4, 17, 32, 613])('reads rate limit %i as trouble, not a reconnect', async (code) => {
    const result = await sourceAnswering({ status: 400, body: graphError(code) }).source.read(
      REFERENCE,
    );
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(result.reconnect).toBeUndefined();
  });

  it('makes no request without an account of our own to ask with', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read({ ...REFERENCE, igUserId: '../me' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 'not_found', reconnect: true });
  });
});

describe('the token', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each<[string, Answer]>([
    ['the sample', { body: SAMPLE }],
    ['an expired token', { status: 400, body: graphError(190, { error_subcode: 463 }) }],
    ['an unknown account', { status: 400, body: graphError(110) }],
    ['a rate limit', { status: 400, body: graphError(4) }],
    [
      'a server error that repeats the address',
      { status: 500, body: `access_token=${ENCODED_TOKEN}` },
    ],
    ['an answer that is not JSON', { body: `<html>${TOKEN}</html>` }],
    ['a failure whose message quotes the address', QUOTES_THE_ADDRESS],
  ])('appears nowhere in the result after %s', async (_what, answer) => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const printed = JSON.stringify(await sourceAnswering(answer).source.read(REFERENCE));

    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain(ENCODED_TOKEN);
    expect(printed).not.toContain('EAAG');
    expect(printed).not.toContain('graph.facebook.com');
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
