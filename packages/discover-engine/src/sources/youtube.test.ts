import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality, WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse, Locality } from '../types';
import { createYoutubeSource, youtubePopularPrefix, youtubePopularUrl } from './youtube';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const sample = (place: string, country: string) =>
  readFileSync(join(FIXTURES, place, `youtube-${country}.sample.json`), 'utf8');

const SAMPLE_IN = sample('chennai', 'IN');
const SAMPLE_US = sample('san-francisco', 'US');
const SAMPLE_FR = sample('paris', 'FR');

/** Made up, and shaped to need encoding, so a slip anywhere shows. */
const KEY = 'AIzaSy-TEST key&not=real';
const ENCODED_KEY = encodeURIComponent(KEY);

const india = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
const france = buildLocality({ countryCode: 'FR' });

const VIDEO = {
  kind: 'youtube#video',
  id: 'TESTvideo01',
  snippet: {
    publishedAt: '2026-11-09T11:00:00Z',
    channelId: 'UCtestChannel00000000001',
    title: 'A test video',
    thumbnails: {
      default: { url: 'https://i.ytimg.com/vi/TESTvideo01/default.jpg', width: 120, height: 90 },
      medium: { url: 'https://i.ytimg.com/vi/TESTvideo01/mqdefault.jpg', width: 320, height: 180 },
      high: { url: 'https://i.ytimg.com/vi/TESTvideo01/hqdefault.jpg', width: 480, height: 360 },
    },
    channelTitle: 'A Test Channel',
  },
  statistics: { viewCount: '8421', likeCount: '10' },
};

const withSnippet = (changes: Record<string, unknown>) => ({
  ...VIDEO,
  snippet: { ...VIDEO.snippet, ...changes },
});

function chart(...videos: unknown[]): string {
  return JSON.stringify({ kind: 'youtube#videoListResponse', items: videos });
}

/** A failed request whose message quotes the address, as a real fetch error can. */
const QUOTES_THE_ADDRESS = Symbol('an error that quotes the address');

type Answer = Partial<DiscoverFetchResponse> | Error | typeof QUOTES_THE_ADDRESS;

function sourceAnswering(answer: Answer, apiKey: string = KEY) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (answer === QUOTES_THE_ADDRESS) throw new Error(`request to ${url} failed: ECONNRESET`);
    if (answer instanceof Error) throw answer;
    // The real binding reports the address it ended at, key and all.
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createYoutubeSource({ fetch: fetchMock, apiKey }) };
}

const run = (source: ReturnType<typeof sourceAnswering>['source'], locality: Locality = india) =>
  source.fetch({ locality, language: 'en' });

/** The one item a chart with a single video gives. */
async function itemFrom(video: unknown) {
  const { source } = sourceAnswering({ body: chart(video) });
  const { items } = await run(source);
  expect(items).toHaveLength(1);
  return items[0];
}

describe('the hand-written samples', () => {
  it.each([
    ['IN', SAMPLE_IN],
    ['US', SAMPLE_US],
    ['FR', SAMPLE_FR],
  ])('for %s say they are samples, and look nothing like a recording', (country, body) => {
    const parsed = JSON.parse(body) as {
      _sample: string;
      kind: string;
      items: {
        id: string;
        snippet: { channelTitle: string; thumbnails: { medium: { url: string } } };
      }[];
    };

    expect(parsed._sample).toBe(
      'Written by hand for tests and simulation. Not a recording: there is no YouTube key.',
    );
    expect(parsed.kind).toBe('youtube#videoListResponse');
    expect(parsed.items).toHaveLength(5);
    parsed.items.forEach((video, index) => {
      expect(video.id).toBe(`SAMPLE_${country}_${index + 1}`);
      expect(video.snippet.channelTitle).toMatch(/^Sample Channel: /);
      expect(video.snippet.thumbnails.medium.url).toBe(
        `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
      );
    });
  });

  it.each([
    ['IN', SAMPLE_IN, india],
    ['US', SAMPLE_US, buildLocality({ countryCode: 'US', regionCode: 'US-CA' })],
    ['FR', SAMPLE_FR, france],
  ])('for %s read as five cards with everything a card shows', async (country, body, locality) => {
    const { source } = sourceAnswering({ body });
    const result = await run(source, locality);

    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'YouTube', url: 'https://www.youtube.com' });
    expect(result.items).toHaveLength(5);
    result.items.forEach((item, index) => {
      const id = `SAMPLE_${country}_${index + 1}`;
      expect(item.kind).toBe('video');
      expect(item.url).toBe(`https://www.youtube.com/watch?v=${id}`);
      expect(item.image).toBe(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
      expect(item.summary).toMatch(/^Sample Channel: /);
      expect(item.publishedAt).toMatch(/^2026-11-0\dT\d\d:\d\d:00\.000Z$/);
      expect(item.source).toEqual({
        id: 'youtube',
        name: 'YouTube',
        url: 'https://www.youtube.com',
      });
    });
  });

  it('maps every field of the first Indian video, Tamil title intact', async () => {
    const { source } = sourceAnswering({ body: SAMPLE_IN });
    const [first] = (await run(source)).items;

    expect(first).toEqual({
      kind: 'video',
      source: { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
      title: 'மாதிரி காணொளி: தீபாவளி இனிப்புகள் பத்து நிமிடங்களில்',
      summary: 'Sample Channel: Chennai Kitchen',
      url: 'https://www.youtube.com/watch?v=SAMPLE_IN_1',
      image: 'https://i.ytimg.com/vi/SAMPLE_IN_1/mqdefault.jpg',
      publishedAt: '2026-11-08T04:30:00.000Z',
      signal: { label: '1.2M views', views: 1_234_567 },
    });
  });

  it('words the counts: short above ten thousand, plain under', async () => {
    const { source } = sourceAnswering({ body: SAMPLE_IN });
    const labels = (await run(source)).items.map((item) => item.signal?.label);

    expect(labels).toEqual(['1.2M views', '845K views', '312K views', '56K views', '9,421 views']);
  });

  it('has a French title in the French sample', async () => {
    const { source } = sourceAnswering({ body: SAMPLE_FR });
    const [first] = (await run(source, france)).items;

    expect(first.title).toBe("Vidéo d'exemple : une tarte aux pommes en dix minutes");
  });

  it('has one video with its view count hidden, in the American sample', async () => {
    const { source } = sourceAnswering({ body: SAMPLE_US });
    const { items } = await run(source, buildLocality({ countryCode: 'US' }));

    expect(items.map((item) => item.signal?.label)).toEqual([
      '2.4M views',
      '732K views',
      '118K views',
      undefined,
      '8,730 views',
    ]);
    expect(items[3].signal).toBeUndefined();
  });
});

describe('the YouTube mapping', () => {
  it.each([
    'Tom & Jerry: the "lost" episode',
    "It's 5 < 6, isn't it?",
    'தீபாவளி சிறப்பு நிகழ்ச்சி',
    `Rain ${String.fromCodePoint(0x1f327)} in Chennai | FULL VIDEO #shorts`,
    'ALL CAPS TITLE!!! (official)',
  ])('shows the title as YouTube gave it: %s', async (title) => {
    expect((await itemFrom(withSnippet({ title }))).title).toBe(title);
  });

  it('takes markup and hidden characters out of a title, and nothing else', async () => {
    const override = String.fromCodePoint(0x202e);
    const item = await itemFrom(
      withSnippet({ title: `<b>Bold</b> <script>alert(1)</script>cl${override}aim &amp; more` }),
    );
    expect(item.title).toBe('Bold claim & more');
  });

  it.each([
    'short',
    'a'.repeat(21),
    'has space01',
    'TESTvideo0/',
    '../../etc',
    'x&list=evil',
    'TESTvideo01#t=1',
    'vidéo000001',
    '',
    42,
    null,
    { videoId: 'TESTvideo01' },
  ])('skips a video whose id is %j', async (id) => {
    const { source } = sourceAnswering({ body: chart({ ...VIDEO, id }, VIDEO) });
    const result = await run(source);

    expect(result.failed).toBeUndefined();
    expect(result.items.map((item) => item.url)).toEqual([
      'https://www.youtube.com/watch?v=TESTvideo01',
    ]);
  });

  it.each(['abc123', 'TESTvideo01', 'a-b_c-D_e-F', 'a'.repeat(20)])(
    'takes the id %s',
    async (id) => {
      expect((await itemFrom({ ...VIDEO, id })).url).toBe(`https://www.youtube.com/watch?v=${id}`);
    },
  );

  it('skips a video with no title or no snippet, and anything that is not a video', async () => {
    const { source } = sourceAnswering({
      body: chart(
        withSnippet({ title: '   ' }),
        withSnippet({ title: 7 }),
        { ...VIDEO, snippet: undefined },
        { ...VIDEO, snippet: 'text' },
        'text',
        null,
        VIDEO,
      ),
    });
    const result = await run(source);

    expect(result.failed).toBeUndefined();
    expect(result.items.map((item) => item.title)).toEqual(['A test video']);
  });

  it('prefers the medium picture, then the high one, then the default', async () => {
    const { medium, high, default: small } = VIDEO.snippet.thumbnails;

    expect((await itemFrom(VIDEO)).image).toBe(medium.url);
    expect((await itemFrom(withSnippet({ thumbnails: { default: small, high } }))).image).toBe(
      high.url,
    );
    expect((await itemFrom(withSnippet({ thumbnails: { default: small } }))).image).toBe(small.url);
    expect(
      (await itemFrom(withSnippet({ thumbnails: { medium: { url: 'javascript:x' }, high } })))
        .image,
    ).toBe(high.url);
  });

  it.each([
    ['no pictures', undefined],
    ['pictures that are not an object', 'text'],
    ['an empty set', {}],
    ['a script', { medium: { url: 'javascript:alert(1)' } }],
    ['a data address', { medium: { url: 'data:image/png;base64,AAAA' } }],
    ['an address that is not text', { medium: { url: 42 }, high: null }],
  ])('has no picture when given %s', async (_what, thumbnails) => {
    expect((await itemFrom(withSnippet({ thumbnails }))).image).toBeUndefined();
  });

  it.each([
    ['no statistics', undefined],
    ['statistics with the count left out', { likeCount: '10' }],
    ['an empty count', { viewCount: '' }],
    ['a count that is not a number', { viewCount: 'many' }],
    ['a negative count', { viewCount: '-5' }],
    ['a null count', { viewCount: null }],
    ['statistics that are not an object', 'hidden'],
  ])('shows no count, and no made-up label, for %s', async (_what, statistics) => {
    const item = await itemFrom({ ...VIDEO, statistics });

    expect(item.title).toBe('A test video');
    expect(item.signal).toBeUndefined();
  });

  it.each([
    ['0', '0 views', 0],
    ['1', '1 view', 1],
    ['8421', '8,421 views', 8421],
    ['56018', '56K views', 56_018],
    ['1234567', '1.2M views', 1_234_567],
    ['3100000000', '3.1B views', 3_100_000_000],
  ])('reads the count %s as %s', async (viewCount, label, views) => {
    expect((await itemFrom({ ...VIDEO, statistics: { viewCount } })).signal).toEqual({
      label,
      views,
    });
  });

  it('names the channel as the summary, or has none', async () => {
    expect((await itemFrom(VIDEO)).summary).toBe('A Test Channel');
    expect((await itemFrom(withSnippet({ channelTitle: undefined }))).summary).toBeUndefined();
    expect((await itemFrom(withSnippet({ channelTitle: '<i>Evil</i> Channel' }))).summary).toBe(
      'Evil Channel',
    );
  });

  it.each(['last week', '', 1_794_222_000, null])(
    'has no publishing time when it is %j',
    async (publishedAt) => {
      expect((await itemFrom(withSnippet({ publishedAt }))).publishedAt).toBeUndefined();
    },
  );

  it('holds the chart to the 25 it asked for', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...VIDEO,
      id: `TESTvideo${String(index + 1).padStart(2, '0')}`,
    }));
    const { source } = sourceAnswering({ body: chart(...many) });
    const { items } = await run(source);

    expect(items).toHaveLength(25);
    expect(items.at(-1)?.url).toBe('https://www.youtube.com/watch?v=TESTvideo25');
  });
});

describe('the quota units', () => {
  it('costs one unit when the chart comes back', async () => {
    const { source } = sourceAnswering({ body: chart(VIDEO) });
    expect((await run(source)).unitsUsed).toBe(1);
  });

  it.each<[string, Answer]>([
    ['a refused key', { status: 403 }],
    ['a country with no chart', { status: 404 }],
    ['a bad request', { status: 400 }],
    ['too many requests', { status: 429 }],
    ['a server error', { status: 500 }],
    ['a dropped connection', new Error('socket hang up')],
    ['an answer that is not JSON', { body: '<html>Sorry</html>' }],
    ['an answer in the wrong shape', { body: '{"error":{}}' }],
    ['an empty chart', { body: chart() }],
  ])('costs one unit after %s too: the request was sent', async (_what, answer) => {
    const { fetchMock, source } = sourceAnswering(answer);
    const result = await run(source);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.unitsUsed).toBe(1);
  });

  it('asks nobody and costs nothing without a country', async () => {
    const { fetchMock, source } = sourceAnswering({ body: chart(VIDEO) });
    const result = await run(source, { ...WORLDWIDE });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.unitsUsed).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});

describe('when YouTube does not answer as expected', () => {
  it('reports a 403 as trouble: the quota is spent or the key is refused', async () => {
    const { source } = sourceAnswering({
      status: 403,
      body: '{"error":{"code":403,"errors":[{"reason":"quotaExceeded"}]}}',
    });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it.each([
    '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    '{"error":{"code":400,"details":[{"reason":"API_KEY_INVALID"}]}}',
  ])('reports a 400 that blames the key as trouble too: %s', async (body) => {
    const { source } = sourceAnswering({ status: 400, body });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it.each([
    [400, '{"error":{"code":400,"errors":[{"reason":"invalidRegionCode"}]}}'],
    [400, ''],
    [404, ''],
    [410, ''],
  ])('reports HTTP %d about the country as not found, not trouble', async (status, body) => {
    const { source } = sourceAnswering({ status, body });
    expect(await run(source)).toMatchObject({ items: [], failed: 'not_found' });
  });

  it.each([429, 500, 503])('reports trouble after HTTP %d', async (status) => {
    const { source } = sourceAnswering({ status });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
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
    '{"items":"x"}',
    '{"items":{"id":"TESTvideo01"}}',
    '{"items":[1,2,3]}',
    '{"items":[{"videoId":"TESTvideo01","title":"renamed fields"}]}',
    '{"error":{"code":200}}',
    '<html><body>Sorry</body></html>',
    '{"items":[',
  ])('reports trouble, never a throw, for the wrong shape: %s', async (body) => {
    const { source } = sourceAnswering({ body });
    expect(await run(source)).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('is simply empty, with no failure, when the chart has no videos', async () => {
    const { source } = sourceAnswering({ body: chart() });
    const result = await run(source);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('the key', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('goes into the address, encoded, and nowhere else in the request', async () => {
    const { fetchMock, source } = sourceAnswering({ body: chart(VIDEO) });
    await run(source);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&chart=mostPopular&regionCode=IN&maxResults=25&key=${ENCODED_KEY}`,
    );
    expect(new URL(url).searchParams.get('key')).toBe(KEY);
    expect(JSON.stringify({ ...init, signal: undefined })).not.toContain('AIzaSy');
  });

  it.each<[string, Answer]>([
    ['a chart', { body: chart(VIDEO) }],
    ['the sample', { body: SAMPLE_IN }],
    ['an empty chart', { body: chart() }],
    ['a refusal', { status: 403 }],
    ['a refusal that repeats the key', { status: 403, body: `{"error":{"message":"${KEY}"}}` }],
    ['a bad request that repeats the key', { status: 400, body: `API key ${KEY} not valid` }],
    ['a not-found that repeats the address', { status: 404, body: youtubePopularUrl('IN', KEY) }],
    ['a server error', { status: 500, body: `key=${ENCODED_KEY}` }],
    ['an answer that is not JSON', { body: `<html>${KEY}</html>` }],
    ['an answer in the wrong shape', { body: `{"key":"${KEY}"}` }],
    ['a dropped connection', new Error(`connect failed for key ${KEY}`)],
    ['a failure whose message quotes the address', QUOTES_THE_ADDRESS],
  ])('appears nowhere in the result after %s', async (_what, answer) => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { source } = sourceAnswering(answer);
    const result = await run(source);
    const printed = JSON.stringify(result);

    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(ENCODED_KEY);
    expect(printed).not.toContain('AIzaSy');
    expect(printed).not.toContain('googleapis.com');
    // Nothing a log could print, because nothing is logged.
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

describe('the request', () => {
  it('asks for the country the place is in', async () => {
    const { fetchMock, source } = sourceAnswering({ body: chart() });
    await run(source, france);

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('regionCode')).toBe('FR');
  });

  it('asks for JSON, with a size limit and a deadline of its own', async () => {
    const { fetchMock, source } = sourceAnswering({ body: chart() });
    await run(source);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.accept).toBe('application/json');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller's deadline when it is given one", async () => {
    const { signal } = new AbortController();
    const { fetchMock, source } = sourceAnswering({ body: chart() });
    await source.fetch({ locality: india, language: 'en', signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });
});

describe('the addresses', () => {
  it('are the one research names, with the key last', () => {
    expect(youtubePopularPrefix('IN')).toBe(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&chart=mostPopular&regionCode=IN&maxResults=25&key=',
    );
    expect(youtubePopularUrl('IN', 'abc')).toBe(`${youtubePopularPrefix('IN')}abc`);
  });

  it('share a prefix that stops before the key, for simulation to match on', () => {
    expect(youtubePopularUrl('IN', KEY).startsWith(youtubePopularPrefix('IN'))).toBe(true);
    expect(youtubePopularUrl('IN', KEY).startsWith(youtubePopularPrefix('US'))).toBe(false);
  });

  it('cannot be steered by what they are given', () => {
    expect(youtubePopularUrl('IN&chart=x', 'k&regionCode=US')).toBe(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&chart=mostPopular&regionCode=IN%26chart%3Dx&maxResults=25&key=k%26regionCode%3DUS',
    );
  });
});
