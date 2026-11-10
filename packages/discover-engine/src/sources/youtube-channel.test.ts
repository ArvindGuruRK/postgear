import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import type { CompetitorSourceOptions } from './competitor';
import { FEED_ACCEPT } from './rss';
import {
  createYoutubeChannelSource,
  isYoutubeChannelId,
  youtubeChannelFeedUrl,
} from './youtube-channel';

const SAMPLE = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'competitors', 'acme', 'youtube-channel.sample.xml'),
  'utf8',
);

const CHANNEL = 'UCacmeSampleChannel00000';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;

function sourceAnswering(
  response: Partial<DiscoverFetchResponse> | Error,
  options: Omit<CompetitorSourceOptions, 'fetch'> = { maxAgeMs: null },
) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createYoutubeChannelSource({ fetch: fetchMock, ...options }) };
}

describe('a channel id', () => {
  it('is "UC" and 22 more characters', () => {
    expect(isYoutubeChannelId(CHANNEL)).toBe(true);
    expect(isYoutubeChannelId('UC_x5XG1OV2P6uZZ5FSM9Ttw')).toBe(true);
    expect(isYoutubeChannelId('UC-lHJZR3Gqxm24_Vd_AJ5Yw')).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['too short', 'UCshort'],
    ['one character too long', `${CHANNEL}0`],
    ['another prefix', 'XXacmeSampleChannel00000'],
    ['a lower-case prefix', 'ucacmeSampleChannel00000'],
    ['a handle', '@acmeanalytics'],
    ['a channel address', `https://www.youtube.com/channel/${CHANNEL}`],
    ['a second parameter', 'UCacmeSampleChannel0&x=1'],
    ['a path', 'UCacmeSampleChanne/../..'],
    ['a space inside', 'UCacmeSample hannel00000'],
  ])('is not %s', (_what, value) => {
    expect(isYoutubeChannelId(value)).toBe(false);
  });

  it('becomes the address of the channel feed', () => {
    expect(youtubeChannelFeedUrl(CHANNEL)).toBe(FEED_URL);
  });
});

describe('the sample channel feed', () => {
  it('asks YouTube for that channel, once, as a feed', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    await source.read(CHANNEL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(youtubeChannelFeedUrl(CHANNEL));
    expect(fetchMock.mock.calls[0][1].accept).toBe(FEED_ACCEPT);
  });

  it('gives the two videos as rows, newest first', async () => {
    const { source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(CHANNEL);

    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({
      name: 'Acme Analytics (Sample Channel)',
      url: `https://www.youtube.com/channel/${CHANNEL}`,
    });
    expect(result.items).toEqual([
      {
        kind: 'competitor',
        source: {
          id: 'youtube',
          name: 'Acme Analytics (Sample Channel)',
          url: `https://www.youtube.com/channel/${CHANNEL}`,
        },
        title: 'Reading a retention chart in four minutes',
        summary: 'YouTube video',
        url: 'https://www.youtube.com/watch?v=SAMPLEacme1',
        // From `<media:thumbnail>` inside the entry's `<media:group>`.
        image: 'https://i.ytimg.com/vi/SAMPLEacme1/hqdefault.jpg',
        publishedAt: '2026-11-07T15:00:00.000Z',
      },
      {
        kind: 'competitor',
        source: {
          id: 'youtube',
          name: 'Acme Analytics (Sample Channel)',
          url: `https://www.youtube.com/channel/${CHANNEL}`,
        },
        title: 'Customer story: a bakery that stopped guessing',
        summary: 'YouTube video',
        url: 'https://www.youtube.com/watch?v=SAMPLEacme2',
        image: 'https://i.ytimg.com/vi/SAMPLEacme2/hqdefault.jpg',
        publishedAt: '2026-10-29T12:00:00.000Z',
      },
    ]);
  });

  it('takes an id with stray spaces round it, as people paste one', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(`  ${CHANNEL}\n`);

    expect(fetchMock.mock.calls[0][0]).toBe(FEED_URL);
    expect(result.items).toHaveLength(2);
  });

  it('drops a video older than 30 days against its clock', async () => {
    const { source } = sourceAnswering(
      { body: SAMPLE },
      { now: () => new Date('2026-12-05T00:00:00Z') },
    );
    const { items } = await source.read(CHANNEL);

    expect(items.map((item) => item.title)).toEqual(['Reading a retention chart in four minutes']);
  });

  it('calls a channel whose feed does not name itself "YouTube"', async () => {
    const body =
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc" /></entry></feed>';
    const { source } = sourceAnswering({ body });
    const result = await source.read(CHANNEL);

    expect(result.attribution.name).toBe('YouTube');
    expect(result.items[0]).toMatchObject({
      source: { id: 'youtube', name: 'YouTube' },
      summary: 'YouTube video',
    });
  });
});

describe('a channel that cannot be read', () => {
  it.each([
    ['nothing', ''],
    ['a handle', '@acmeanalytics'],
    ['an id that is too short', 'UCshort'],
    ['an id with a second parameter in it', 'UCacmeSampleChannel0&x=1'],
    ['an address', `https://www.youtube.com/channel/${CHANNEL}`],
    ['an address on another host', 'https://attacker.example/feeds/videos.xml'],
  ])('makes no request for %s', async (_what, reference) => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const result = await source.read(reference);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      attribution: { name: 'YouTube' },
      warnings: ['That is not a YouTube channel id.'],
      failed: 'not_found',
    });
  });

  it('says nothing is there for a 404, which channel feeds answer now and then', async () => {
    const result = await sourceAnswering({ status: 404 }).source.read(CHANNEL);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.unreadable).toBeUndefined();
  });

  it('says trouble for a 429, a 5xx and a dropped connection, and never throws', async () => {
    for (const response of [{ status: 429 }, { status: 500 }, new Error('socket hang up')]) {
      const result = await sourceAnswering(response).source.read(CHANNEL);
      expect(result).toMatchObject({ items: [], failed: 'upstream' });
    }
  });

  it('says unreadable for a consent page where the feed should be', async () => {
    const result = await sourceAnswering({
      body: '<!doctype html><html><body>Before you continue</body></html>',
    }).source.read(CHANNEL);

    expect(result).toMatchObject({
      items: [],
      attribution: { name: 'YouTube' },
      failed: 'not_found',
      unreadable: true,
    });
  });
});

describe('the source itself', () => {
  it('says what it is', () => {
    const { source } = sourceAnswering({});
    expect([source.id, source.name]).toEqual(['youtube', 'YouTube']);
  });
});
