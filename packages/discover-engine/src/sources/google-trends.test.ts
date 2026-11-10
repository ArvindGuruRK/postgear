import { buildLocality, WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse, Locality } from '../types';
import { createGoogleTrendsSource, parseTraffic, trendsFeedUrl } from './google-trends';

const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
const india = buildLocality({ countryCode: 'IN' });

function feed(...items: string[]): string {
  return `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel><title>Daily Search Trends</title>${items.join('')}</channel></rss>`;
}

function newsItem(title: string, url: string, source: string): string {
  return `<ht:news_item><ht:news_item_title>${title}</ht:news_item_title><ht:news_item_snippet/><ht:news_item_url>${url}</ht:news_item_url><ht:news_item_source>${source}</ht:news_item_source></ht:news_item>`;
}

const WEATHER = `<item><title>weather &amp; rain</title><ht:approx_traffic>200+</ht:approx_traffic><description/><pubDate>Wed, 4 Nov 2026 11:40:00 -0800</pubDate><ht:picture>https://img.example/1.jpg</ht:picture>${newsItem(
  'Rain &lt;b&gt;today&lt;/b&gt;',
  'https://paper.example/rain',
  'The Paper',
)}${newsItem('Evil', 'javascript:alert(1)', 'Evil')}${newsItem('Storm', 'https://news.example/storm', 'News')}</item>`;
const CRICKET = `<item><title>cricket</title><ht:approx_traffic>2000+</ht:approx_traffic></item>`;
const EMPTY = feed();

type Answers = Record<string, Partial<DiscoverFetchResponse> | Error>;

/** Answers by geo; a geo not listed is a test bug and fails loudly. */
function sourceAnswering(answers: Answers) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    const geo = new URL(url).searchParams.get('geo') as string;
    const answer = answers[geo];
    if (answer === undefined) throw new Error(`Unexpected request for ${geo}`);
    if (answer instanceof Error) throw answer;
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createGoogleTrendsSource({ fetch: fetchMock }) };
}

const run = (source: ReturnType<typeof sourceAnswering>['source'], locality: Locality) =>
  source.fetch({ locality, language: 'en' });

const geosAsked = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get('geo'));

describe('parseTraffic', () => {
  it.each([
    ['200+', 200],
    ['2000+', 2000],
    ['2,000+', 2000],
    ['10K+', 10_000],
    ['1M+', 1_000_000],
    [' 50+ ', 50],
  ])('reads %s as at least %d', (text, value) => {
    expect(parseTraffic(text)).toBe(value);
  });

  it.each(['', 'lots', undefined])('has no number in %j', (text) => {
    expect(parseTraffic(text)).toBeUndefined();
  });
});

describe('the Trends mapping', () => {
  it('maps every field the card needs', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { body: feed(WEATHER) } });
    const { items } = await run(source, chennai);

    expect(items[0]).toEqual({
      kind: 'trend',
      source: {
        id: 'google-trends',
        name: 'Google Trends',
        url: 'https://trends.google.com/trending?geo=IN-TN',
      },
      title: 'weather & rain',
      url: 'https://paper.example/rain',
      image: 'https://img.example/1.jpg',
      publishedAt: '2026-11-04T19:40:00.000Z',
      signal: { label: '200+ searches', rank: 1, traffic: 200 },
      related: [
        { title: 'Rain today', url: 'https://paper.example/rain', source: 'The Paper' },
        { title: 'Storm', url: 'https://news.example/storm', source: 'News' },
      ],
    });
  });

  it('ranks by position in the feed', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { body: feed(CRICKET, WEATHER) } });
    const { items } = await run(source, chennai);
    expect(items.map((item) => [item.title, item.signal?.rank])).toEqual([
      ['cricket', 1],
      ['weather & rain', 2],
    ]);
  });

  it('copes with a trend that has no stories or volume', async () => {
    const { source } = sourceAnswering({
      'IN-TN': { body: feed('<item><title>bare</title></item>') },
    });
    const [item] = (await run(source, chennai)).items;

    expect(item.url).toBeUndefined();
    expect(item.related).toEqual([]);
    expect(item.signal?.label).toBe('Rising');
    expect(item.signal?.traffic).toBeUndefined();
  });

  it('skips an item with no title', async () => {
    const { source } = sourceAnswering({
      'IN-TN': { body: feed('<item><title>  </title></item>', CRICKET) },
    });
    expect((await run(source, chennai)).items.map((item) => item.title)).toEqual(['cricket']);
  });

  it('does not let a picture be a script', async () => {
    const { source } = sourceAnswering({
      'IN-TN': {
        body: feed('<item><title>x</title><ht:picture>javascript:alert(1)</ht:picture></item>'),
      },
    });
    expect((await run(source, chennai)).items[0].image).toBeUndefined();
  });

  it('says which geo answered', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { body: feed(CRICKET) } });
    const result = await run(source, chennai);
    expect(result.answeredGeo).toBe('IN-TN');
    expect(result.warnings).toEqual([]);
    expect(result.attribution.name).toBe('Google Trends');
  });
});

describe('falling back to the country', () => {
  it('asks the country when the region is empty, and says so', async () => {
    const { fetchMock, source } = sourceAnswering({
      'IN-TN': { body: EMPTY },
      IN: { body: feed(CRICKET) },
    });
    const result = await run(source, chennai);

    expect(geosAsked(fetchMock)).toEqual(['IN-TN', 'IN']);
    expect(result.items.map((item) => item.title)).toEqual(['cricket']);
    expect(result.answeredGeo).toBe('IN');
    expect(result.warnings[0]).toContain('IN-TN');
    expect(result.items[0].source.url).toBe('https://trends.google.com/trending?geo=IN');
  });

  it.each([404, 400, 500, 503])('asks the country after HTTP %d', async (status) => {
    const { fetchMock, source } = sourceAnswering({
      'IN-TN': { status },
      IN: { body: feed(CRICKET) },
    });
    expect((await run(source, chennai)).items).toHaveLength(1);
    expect(geosAsked(fetchMock)).toEqual(['IN-TN', 'IN']);
  });

  it('does not ask again after a 429: Google asked us to back off', async () => {
    const { fetchMock, source } = sourceAnswering({ 'IN-TN': { status: 429 } });
    const result = await run(source, chennai);

    expect(geosAsked(fetchMock)).toEqual(['IN-TN']);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('does not ask again after a dropped connection', async () => {
    const { fetchMock, source } = sourceAnswering({ 'IN-TN': new Error('socket hang up') });
    const result = await run(source, chennai);

    expect(geosAsked(fetchMock)).toEqual(['IN-TN']);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('does not ask again after a page that is not a feed', async () => {
    const { fetchMock, source } = sourceAnswering({ 'IN-TN': { body: '<html>Consent</html>' } });
    const result = await run(source, chennai);

    expect(geosAsked(fetchMock)).toEqual(['IN-TN']);
    expect(result.failed).toBe('upstream');
  });

  it('does not ask a country twice', async () => {
    const { fetchMock, source } = sourceAnswering({ IN: { body: EMPTY } });
    const result = await run(source, india);

    expect(geosAsked(fetchMock)).toEqual(['IN']);
    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });

  it('reports not found, not trouble, when neither level has this place', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { status: 404 }, IN: { status: 404 } });
    const result = await run(source, chennai);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
  });

  it('reports trouble when the country then fails', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { body: EMPTY }, IN: { status: 503 } });
    expect((await run(source, chennai)).failed).toBe('upstream');
  });

  it('is simply empty, with no failure, when both levels are empty', async () => {
    const { source } = sourceAnswering({ 'IN-TN': { body: EMPTY }, IN: { body: EMPTY } });
    const result = await run(source, chennai);
    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('Worldwide', () => {
  it('asks nobody, because Trends has no such feed', async () => {
    const { fetchMock, source } = sourceAnswering({});
    const result = await run(source, { ...WORLDWIDE });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});

describe('trendsFeedUrl', () => {
  it('is the address research verified', () => {
    expect(trendsFeedUrl('IN-TN')).toBe('https://trends.google.com/trending/rss?geo=IN-TN');
  });

  it('cannot be steered by what it is given', () => {
    expect(trendsFeedUrl('IN&x=1')).toBe('https://trends.google.com/trending/rss?geo=IN%26x%3D1');
  });
});
