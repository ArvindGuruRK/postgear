import { CHENNAI, PARIS } from '../geo/geocoder/simulated';
import { buildLocality, WORLDWIDE } from '../geo/locality';
import { createFixtureFetch } from '../simulation';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import {
  createGdeltSource,
  GDELT_DOC_URL,
  gdeltDocUrl,
  gdeltQuery,
  parseGdeltBody,
  seenDateIso,
  tidyGdeltTitle,
} from './gdelt';

const RECORDED = () => new Date('2026-11-11T08:00:00Z');

function sourceAnswering(response: Partial<DiscoverFetchResponse> | Error) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createGdeltSource({ fetch: fetchMock, now: RECORDED }) };
}

const article = (fields: Record<string, unknown>) => ({
  url: 'https://www.thehindu.com/news/cities/chennai/rain.ece',
  title: 'Rain in Chennai',
  seendate: '20261111T063000Z',
  socialimage: 'https://www.thehindu.com/rain.jpg',
  domain: 'thehindu.com',
  language: 'English',
  sourcecountry: 'India',
  ...fields,
});

describe('the GDELT query', () => {
  it('names the city, the FIPS country and the language, and is null for Worldwide', () => {
    expect(gdeltQuery(CHENNAI, 'ta')).toBe('"Chennai" sourcecountry:IN sourcelang:tamil');
    // Germany is GM in FIPS, and an ISO code is never passed through.
    const bavaria = buildLocality({ countryCode: 'DE', regionCode: 'DE-BY', regionName: 'Bayern' });
    expect(gdeltQuery(bavaria, 'de-DE')).toBe('"Bayern" sourcecountry:GM sourcelang:german');
    // A language GDELT does not read, and a country its list cannot be trusted for, drop their filters.
    const guinea = buildLocality({ countryCode: 'GN', countryName: 'Guinea' });
    expect(gdeltQuery(guinea, 'ff')).toBe('"Guinea"');
    expect(gdeltQuery(WORLDWIDE, 'en')).toBeNull();

    expect(gdeltDocUrl('"San Francisco" sourcecountry:US')).toBe(
      `${GDELT_DOC_URL}?query=%22San%20Francisco%22%20sourcecountry%3AUS&mode=artlist&format=json&maxrecords=20&timespan=24h&sort=datedesc`,
    );
  });
});

describe('the GDELT source', () => {
  it('reads the Paris recording: one row per story, tidied, with its publisher and language', async () => {
    const source = createGdeltSource({ fetch: createFixtureFetch(), now: RECORDED });
    const result = await source.fetch({ locality: PARIS, language: 'fr' });

    expect(result.failed).toBeUndefined();
    // Thirteen articles, one story syndicated three times.
    expect(result.items).toHaveLength(11);
    expect(result.attribution).toEqual({
      name: 'GDELT Project',
      url: 'https://www.gdeltproject.org',
    });
    expect(result.items[0]).toMatchObject({
      kind: 'news',
      source: { id: 'gdelt', name: 'leparisien.fr', url: 'https://leparisien.fr' },
      publishedAt: '2026-11-11T06:30:00.000Z',
      language: 'fr',
    });
    expect(result.items.every((item) => item.url?.startsWith('https://'))).toBe(true);
    expect(result.items.map((item) => item.title)).toContain(
      'Blotzheim. Au casino Barrière, une saison artistique pleine dhumour autour de Kev Adams et du stand - up',
    );
  });

  it('reads an empty list, `{}` and an unrecorded place as a quiet day, not a failure', async () => {
    const quiet = (result: { items: unknown[]; failed?: string }) => [result.items, result.failed];

    for (const body of ['{"articles":[]}', '{}', '']) {
      const { source } = sourceAnswering({ body });
      expect(quiet(await source.fetch({ locality: CHENNAI, language: 'ta' }))).toEqual([
        [],
        undefined,
      ]);
    }

    const simulated = createGdeltSource({ fetch: createFixtureFetch(), now: RECORDED });
    const berlin = buildLocality({ countryCode: 'DE', city: 'Berlin' });
    expect(quiet(await simulated.fetch({ locality: berlin, language: 'de' }))).toEqual([
      [],
      undefined,
    ]);
  });

  it('tells trouble from a refused query, and never asks for Worldwide', async () => {
    const outcome = async (response: Partial<DiscoverFetchResponse> | Error) =>
      (await sourceAnswering(response).source.fetch({ locality: CHENNAI, language: 'ta' })).failed;

    const slowDown =
      'Please limit requests to one every 5 seconds or contact us for larger queries.';
    expect(await outcome({ status: 429, body: slowDown })).toBe('upstream');
    expect(await outcome({ status: 200, body: slowDown })).toBe('upstream');
    expect(await outcome({ status: 503 })).toBe('upstream');
    expect(await outcome(new Error('socket hang up'))).toBe('upstream');
    expect(await outcome({ body: '{"articles": "nope"}' })).toBe('upstream');
    expect(await outcome({ body: 'The specified phrase is too short.' })).toBe('not_found');

    const { fetchMock, source } = sourceAnswering({ body: '{}' });
    expect(await source.fetch({ locality: WORLDWIDE, language: 'en' })).toMatchObject({
      failed: 'not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps only web addresses, names a publisher by a real host, and drops a stamp from the future', async () => {
    const body = JSON.stringify({
      articles: [
        article({ url: 'javascript:alert(1)', title: 'Script link' }),
        article({ url: 'https://news.example/a', title: 'Bad picture', socialimage: 'data:x' }),
        article({ url: 'https://news.example/b', title: 'Odd domain', domain: 'x.com/<b>' }),
        article({ url: 'https://news.example/c', title: 'Tomorrow', seendate: '20261112T080000Z' }),
        article({ title: '<b>Chennai</b> &amp; rain\u202E , today' }),
      ],
    });
    const { source } = sourceAnswering({ body });
    const { items } = await source.fetch({ locality: CHENNAI, language: 'en' });

    expect(items.map((item) => item.title)).toEqual([
      'Bad picture',
      'Odd domain',
      'Chennai & rain, today',
    ]);
    expect(items[0].image).toBeUndefined();
    expect(items[1].source).toEqual({
      id: 'gdelt',
      name: 'news.example',
      url: 'https://news.example',
    });
    expect(items[2]).toMatchObject({ language: 'en', image: 'https://www.thehindu.com/rain.jpg' });
  });
});

describe('reading what GDELT sends', () => {
  it('mends a body with a stray backslash or a raw line break, and keeps real escapes', () => {
    const broken = `{"articles":[{"title":"C:\\Temp \\"quoted\\" \\u00e9 \\\\x\nnext"}]}`;
    const parsed = parseGdeltBody(broken);
    expect(parsed).toEqual({
      kind: 'json',
      value: { articles: [{ title: 'C:\\Temp "quoted" \u00e9 \\x next' }] },
    });
    expect(parseGdeltBody('Your query was invalid.')).toEqual({
      kind: 'text',
      text: 'Your query was invalid.',
    });
  });

  it('reads a seen date, and nothing that is not one', () => {
    expect(seenDateIso('20261111T063000Z')).toBe('2026-11-11T06:30:00.000Z');
    expect(seenDateIso('20260231T063000Z')).toBeUndefined();
    expect(seenDateIso('2026-11-11T06:30:00Z')).toBeUndefined();
    expect(tidyGdeltTitle('Santé . Médicaments , près dun Français : oui ?')).toBe(
      'Santé. Médicaments, près dun Français : oui ?',
    );
  });
});
