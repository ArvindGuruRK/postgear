import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse, SourceInput } from '../types';
import { createSerpApiNewsSource, SERPAPI_TOPIC_TOKENS } from './serpapi-news';

const SAMPLE = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'samples', 'serpapi-news.sample.json'),
  'utf8',
);

/** Made up, and shaped to need encoding, so a slip anywhere shows. */
const KEY = 'serp-TEST key&not=real';
const ENCODED_KEY = encodeURIComponent(KEY);

const chennai: SourceInput = {
  locality: buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' }),
  language: 'en',
};

const QUOTES_THE_ADDRESS = Symbol('an error that quotes the address');
type Answer = Partial<DiscoverFetchResponse> | typeof QUOTES_THE_ADDRESS;

function sourceAnswering(answer: Answer) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (answer === QUOTES_THE_ADDRESS) throw new Error(`request to ${url} failed: ECONNRESET`);
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createSerpApiNewsSource({ fetch: fetchMock, apiKey: KEY }) };
}

const asked = (fetchMock: ReturnType<typeof sourceAnswering>['fetchMock']) =>
  Object.fromEntries(new URL(fetchMock.mock.calls[0][0]).searchParams);

describe('the SerpApi sample', () => {
  it('reads stories and clusters, with the publisher, a picture and the related stories', async () => {
    const { source } = sourceAnswering({ body: SAMPLE });
    const result = await source.top(chennai);

    expect(result.failed).toBeUndefined();
    expect(result.attribution).toEqual({
      name: 'Google News via SerpApi',
      url: 'https://serpapi.com',
    });
    expect(result.items).toEqual([
      {
        kind: 'news',
        source: { id: 'serpapi', name: 'Sample Chennai Times' },
        title: 'Chennai metro opens two sample stations',
        url: 'https://news.example/chennai/metro-sample-stations',
        image: 'https://news.example/images/metro.jpg',
        publishedAt: '2026-11-10T06:30:00.000Z',
        language: 'en',
        related: [],
      },
      {
        kind: 'news',
        source: { id: 'serpapi', name: 'Sample Daily' },
        title: 'Monsoon rain closes sample schools for a day',
        url: 'https://daily.example/rain-schools',
        image: 'https://daily.example/rain.jpg',
        publishedAt: '2026-11-10T04:00:00.000Z',
        language: 'en',
        // The highlight is not listed again as its own related story.
        related: [
          {
            title: 'What the rain means for your commute',
            url: 'https://herald.example/rain-commute',
            source: 'Sample Herald',
          },
        ],
      },
      {
        kind: 'news',
        source: { id: 'serpapi', name: 'Sample Business Line' },
        title: 'Sample port handles record cargo',
        url: 'https://business.example/port-record',
        publishedAt: '2026-11-09T18:45:00.000Z',
        language: 'en',
        related: [
          {
            title: 'Port record, in three charts',
            url: 'https://charts.example/port',
            source: 'Sample Charts',
          },
        ],
      },
    ]);
  });

  it('turns a search into the newest competitor rows', async () => {
    const { fetchMock, source } = sourceAnswering({ body: SAMPLE });
    const result = await source.search('Acme "Analytics"', chennai);

    expect(asked(fetchMock).q).toBe('"Acme Analytics" when:7d');
    expect(result.items.map((item) => [item.kind, item.related])).toEqual([
      ['competitor', undefined],
      ['competitor', undefined],
      ['competitor', undefined],
    ]);
  });

  it('answers "Google found nothing" as an empty list, not a failure', async () => {
    const body = JSON.stringify({ error: "Google hasn't returned any results for this query." });
    const result = await sourceAnswering({ body }).source.top(chennai);
    expect(result).toEqual({ items: [], attribution: result.attribution, warnings: [] });
  });
});

describe('the requests', () => {
  it('asks for the edition, the front page with no query, a topic by its token', async () => {
    const front = sourceAnswering({ body: SAMPLE });
    await front.source.top(chennai);
    expect(asked(front.fetchMock)).toEqual({
      engine: 'google_news',
      gl: 'in',
      hl: 'en-in',
      api_key: KEY,
    });

    const topic = sourceAnswering({ body: SAMPLE });
    await topic.source.topic(chennai, 'TECHNOLOGY');
    expect(asked(topic.fetchMock).topic_token).toBe(SERPAPI_TOPIC_TOKENS.TECHNOLOGY);
  });

  it('searches the city for a place, and the country for NATION', async () => {
    const place = sourceAnswering({ body: SAMPLE });
    await place.source.fetch(chennai);
    expect(asked(place.fetchMock).q).toBe('"Chennai" when:2d');

    const nation = sourceAnswering({ body: SAMPLE });
    await nation.source.topic(chennai, 'NATION');
    expect(asked(nation.fetchMock).q).toBe('"India" when:2d');
  });
});

describe('the key', () => {
  it.each([401, 403])('is reported as refused after a %i, which is trouble', async (status) => {
    const body =
      '{"error":"Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key"}';
    const result = await sourceAnswering({ status, body }).source.top(chennai);
    expect(result).toMatchObject({
      items: [],
      failed: 'upstream',
      warnings: ['SerpApi refused the key.'],
    });
  });

  it.each<[string, Answer]>([
    ['the sample', { body: SAMPLE }],
    ['a refusal that repeats the key', { status: 401, body: `{"error":"${KEY}"}` }],
    ['a spent plan', { status: 429, body: `api_key=${ENCODED_KEY}` }],
    ['a bad request', { status: 400, body: KEY }],
    ['an answer that is not JSON', { body: `<html>${KEY}</html>` }],
    ['a failure whose message quotes the address', QUOTES_THE_ADDRESS],
  ])('appears nowhere in the result after %s', async (_what, answer) => {
    const printed = JSON.stringify(await sourceAnswering(answer).source.top(chennai));

    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(ENCODED_KEY);
    expect(printed).not.toContain('serp-TEST');
    expect(printed).not.toContain('search.json');
  });
});
