import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse, SourceInput } from '../types';
import { createNewsDataSource } from './newsdata';

const SAMPLE = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'samples', 'newsdata-latest.sample.json'),
  'utf8',
);

/** Made up, and shaped to need encoding, so a slip anywhere shows. */
const KEY = 'pub_TEST key&not=real';
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
  return { fetchMock, source: createNewsDataSource({ fetch: fetchMock, apiKey: KEY }) };
}

const asked = (fetchMock: ReturnType<typeof sourceAnswering>['fetchMock']) =>
  Object.fromEntries(new URL(fetchMock.mock.calls[0][0]).searchParams);

const error = (code: string) =>
  JSON.stringify({ status: 'error', results: { message: `about ${KEY}`, code } });

describe('the NewsData.io sample', () => {
  it('reads each story with its publisher, and leaves the duplicate out', async () => {
    const { source } = sourceAnswering({ body: SAMPLE });
    const result = await source.top(chennai);

    expect(result.failed).toBeUndefined();
    expect(result.attribution).toEqual({ name: 'NewsData.io', url: 'https://newsdata.io' });
    expect(result.items).toEqual([
      {
        kind: 'news',
        source: { id: 'newsdata', name: 'Sample Chennai Times', url: 'https://news.example/' },
        title: 'Chennai metro opens two sample stations',
        summary:
          'Two new stations open on the sample line this morning, with trains every six minutes.',
        url: 'https://news.example/chennai/metro-sample-stations',
        image: 'https://news.example/images/metro.jpg',
        publishedAt: '2026-11-10T06:30:00.000Z',
        language: 'en',
      },
      {
        kind: 'news',
        // No name: the source id stands in.
        source: { id: 'newsdata', name: 'samplebusinessline', url: 'https://business.example/' },
        title: 'Sample port handles record cargo',
        url: 'https://business.example/port-record',
        publishedAt: '2026-11-09T18:45:00.000Z',
        language: 'en',
      },
    ]);
  });

  it('asks for the country and language, a category per topic, and a phrase for a place', async () => {
    const top = sourceAnswering({ body: SAMPLE });
    await top.source.top({ ...chennai, language: 'es-419' });
    expect(asked(top.fetchMock)).toEqual({
      country: 'in',
      language: 'es',
      removeduplicate: '1',
      category: 'top',
      apikey: KEY,
    });

    const nation = sourceAnswering({ body: SAMPLE });
    await nation.source.topic(chennai, 'NATION');
    expect(asked(nation.fetchMock).category).toBe('domestic');

    const place = sourceAnswering({ body: SAMPLE });
    await place.source.fetch(chennai);
    expect(asked(place.fetchMock).q).toBe('"Chennai"');
  });

  it('answers an empty list as a quiet day, not a failure', async () => {
    const body = '{"status":"success","totalResults":0,"results":[],"nextPage":null}';
    expect(await sourceAnswering({ body }).source.top(chennai)).toEqual({
      items: [],
      attribution: { name: 'NewsData.io', url: 'https://newsdata.io' },
      warnings: [],
    });
  });
});

describe('when NewsData.io refuses', () => {
  it('reads a refused key as trouble', async () => {
    const result = await sourceAnswering({ status: 401, body: error('Unauthorized') }).source.top(
      chennai,
    );
    expect(result).toMatchObject({
      items: [],
      failed: 'upstream',
      warnings: ['NewsData.io refused the key, or its plan does not cover this.'],
    });
  });

  it('reads a filter it does not support as this place having nothing', async () => {
    const result = await sourceAnswering({
      status: 422,
      body: error('UnsupportedFilter'),
    }).source.top(chennai);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
  });
});

describe('the key', () => {
  it.each<[string, Answer]>([
    ['the sample', { body: SAMPLE }],
    ['a refusal that repeats the key', { status: 401, body: error('Unauthorized') }],
    ['spent credits', { status: 429, body: `apikey=${ENCODED_KEY}` }],
    ['a server error', { status: 500, body: KEY }],
    ['an answer that is not JSON', { body: `<html>${KEY}</html>` }],
    ['a failure whose message quotes the address', QUOTES_THE_ADDRESS],
  ])('appears nowhere in the result after %s', async (_what, answer) => {
    const printed = JSON.stringify(await sourceAnswering(answer).source.top(chennai));

    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(ENCODED_KEY);
    expect(printed).not.toContain('pub_TEST');
    expect(printed).not.toContain('api/1/latest');
  });
});
