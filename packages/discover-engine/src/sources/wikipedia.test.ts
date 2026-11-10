import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse } from '../types';
import {
  createWikipediaSource,
  isWikipediaArticle,
  wikipediaProject,
  wikipediaTopPrefix,
  wikipediaTopUrl,
} from './wikipedia';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const TAMIL = readFileSync(join(FIXTURES, 'chennai', 'wikipedia-ta.2026-11-10.json'), 'utf8');
const ENGLISH = readFileSync(
  join(FIXTURES, 'san-francisco', 'wikipedia-en.2026-11-10.json'),
  'utf8',
);
const FRENCH = readFileSync(join(FIXTURES, 'paris', 'wikipedia-fr.2026-11-10.json'), 'utf8');

/** The morning the fixtures were recorded: yesterday is the 9th, the day before the 8th. */
const NOW = new Date('2026-11-10T08:24:00Z');
const YESTERDAY = '2026-11-09';
const DAY_BEFORE = '2026-11-08';

/** A list in the shape the API answers with, ranked in the order given. */
function list(...articles: [article: unknown, views: unknown][]): string {
  return JSON.stringify({
    items: [
      {
        project: 'en.wikipedia',
        access: 'all-access',
        year: '2026',
        month: '11',
        day: '09',
        articles: articles.map(([article, views], index) => ({ article, views, rank: index + 1 })),
      },
    ],
  });
}

type Answers = Record<string, Partial<DiscoverFetchResponse> | Error>;

/** `.../top/ta.wikipedia/all-access/2026/11/09` to `ta.wikipedia` and `2026-11-09`. */
function asked(url: string): { project: string; day: string } {
  const parts = url.split('/');
  return { project: parts[8], day: parts.slice(-3).join('-') };
}

/** Answers by day; a day not listed is a test bug and fails loudly. */
function sourceAnswering(answers: Answers, now: Date = NOW) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    const { day } = asked(url);
    const answer = answers[day];
    if (answer === undefined) throw new Error(`Unexpected request for ${day}`);
    if (answer instanceof Error) throw answer;
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createWikipediaSource({ fetch: fetchMock, now: () => now }) };
}

const run = (source: ReturnType<typeof sourceAnswering>['source'], language = 'en') =>
  source.fetch({ locality: { ...WORLDWIDE }, language });

const daysAsked = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map(([url]) => asked(url as string).day);

describe('wikipediaProject', () => {
  it.each([
    ['ta', 'ta.wikipedia'],
    ['en', 'en.wikipedia'],
    ['kok', 'kok.wikipedia'],
    ['es-419', 'es.wikipedia'],
    ['pt-419', 'pt.wikipedia'],
    ['zh-Hans', 'zh.wikipedia'],
    ['zh-Hant', 'zh.wikipedia'],
    ['  fr  ', 'fr.wikipedia'],
  ])('reads %j as %s', (language, project) => {
    expect(wikipediaProject(language)).toBe(project);
  });

  it('knows the two editions that do not sit at their language code', () => {
    expect(wikipediaProject('nb')).toBe('no.wikipedia');
    expect(wikipediaProject('fil')).toBe('tl.wikipedia');
  });

  it.each([
    ['TA', 'ta.wikipedia'],
    ['EN-us', 'en.wikipedia'],
    ['ZH-HANS', 'zh.wikipedia'],
    ['NB', 'no.wikipedia'],
  ])('does not mind an upper-case tag: %s', (language, project) => {
    expect(wikipediaProject(language)).toBe(project);
  });

  it.each([
    '',
    ' ',
    'x',
    '12',
    'toolong',
    'not a language tag',
    'ta.wikipedia',
    'ta/../en',
    '../../etc/passwd',
    'en@evil.example',
    'e n',
  ])('reads nonsense as English, so it can never be part of an address: %j', (language) => {
    expect(wikipediaProject(language)).toBe('en.wikipedia');
  });
});

describe('the addresses', () => {
  it('are the ones research verified', () => {
    expect(wikipediaTopUrl('ta.wikipedia', '2026-11-09')).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ta.wikipedia/all-access/2026/11/09',
    );
  });

  it('share a prefix that stops before the day, for simulation to match on', () => {
    const prefix = wikipediaTopPrefix('ta.wikipedia');
    expect(wikipediaTopUrl('ta.wikipedia', '2026-11-09').startsWith(prefix)).toBe(true);
    expect(wikipediaTopUrl('tay.wikipedia', '2026-11-09').startsWith(prefix)).toBe(false);
    expect(prefix.endsWith('/all-access/')).toBe(true);
  });
});

describe('isWikipediaArticle', () => {
  it.each([
    ['Special:Search', 'en'],
    ['Wikipedia:Featured_pictures', 'en'],
    ['File:WhatsApp.svg', 'en'],
    ['Help:IPA/English', 'en'],
    ['Portal:Current_events', 'en'],
    ['Category:Living_people', 'en'],
    ['User_talk:Example', 'en'],
    ['சிறப்பு:Search', 'ta'],
    ['சிறப்பு:RecentChanges', 'ta'],
    ['விக்கிப்பீடியா:சான்று_தேவை', 'ta'],
    ['படிமம்:Tamil_Nadu_map_(Tamil).png', 'ta'],
    ['பயனர்:Lokeswaran_Kaliyappan', 'ta'],
    // An English namespace name works in every edition.
    ['Special:Search', 'ta'],
    ['Wikipédia:Accueil_principal', 'fr'],
    ['Spécial:Recherche', 'fr'],
    ['Fichier:France_relief_location_map.jpg', 'fr'],
    ['Utilisateur:0x010C/script/PopupVandalism.js/box', 'fr'],
  ])('drops the namespace page %s', (article, edition) => {
    expect(isWikipediaArticle(article, edition)).toBe(false);
  });

  it.each([
    ['Ramayana:_Part_1', 'en'],
    ['The_Legend_of_Zelda:_Ocarina_of_Time', 'en'],
    ['Brahmāstra:_Part_One_–_Shiva', 'en'],
    ['புஷ்பா_2:_தி_ரூல்', 'ta'],
    ['தேவரா:_பகுதி_1_(திரைப்படம்)', 'ta'],
    // French puts a space on both sides of its colon.
    ['OSS_117_:_Rio_ne_répond_plus', 'fr'],
    ['Avengers:_Doomsday', 'fr'],
    ['.xxx', 'en'],
    ['Deaths_in_2026', 'en'],
  ])('keeps the article %s', (article, edition) => {
    expect(isWikipediaArticle(article, edition)).toBe(true);
  });

  it('drops the main page of the edition it belongs to, and only there', () => {
    expect(isWikipediaArticle('Main_Page', 'en')).toBe(false);
    expect(isWikipediaArticle('முதற்பக்கம்', 'ta')).toBe(false);
    expect(isWikipediaArticle('मुखपृष्ठ', 'hi')).toBe(false);
    // On another edition the same words are just a title.
    expect(isWikipediaArticle('Main_Page', 'fr')).toBe(true);
  });

  it('knows a main page whichever way its letters are stored', () => {
    const composed = 'Kezdőlap'.normalize('NFC');
    const decomposed = 'Kezdőlap'.normalize('NFD');
    expect(composed).not.toBe(decomposed);
    expect(isWikipediaArticle(composed, 'hu')).toBe(false);
    expect(isWikipediaArticle(decomposed, 'hu')).toBe(false);
  });

  it.each(['xx', 'constructor', '__proto__', 'toString', ''])(
    'does not throw for the edition %j it has no main page for',
    (edition) => {
      expect(isWikipediaArticle('Chennai', edition)).toBe(true);
    },
  );
});

describe('the recorded lists', () => {
  it('gives Tamil readers ten articles, with the search and main pages gone', async () => {
    const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { body: TAMIL } });
    const result = await run(source, 'ta');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ta.wikipedia/all-access/2026/11/09',
    ]);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.answeredDay).toBe(YESTERDAY);
    expect(result.attribution).toEqual({ name: 'Wikipedia', url: 'https://ta.wikipedia.org' });
    expect(result.items.map((item) => [item.title, item.signal?.label])).toEqual([
      ['தமிழ்த் திரைப்படங்களின் பட்டியல், 2026', '1,627 reads'],
      ['மூக்குத்தி அம்மன் 2', '1,240 reads'],
      ['ஜெயிலர் 2', '491 reads'],
      ['தீபாவளி', '475 reads'],
      ['இராவணன்', '449 reads'],
      ['இராமாயணம்', '408 reads'],
      ['பழனி பாபா', '279 reads'],
      ['ஆண் தமிழ்ப் பெயர்கள்', '272 reads'],
      ['தமிழ்த் திரைப்படங்களின் பட்டியல் (ஆண்டு வரிசை)', '269 reads'],
      ['மூக்குத்தி அம்மன்', '244 reads'],
    ]);
  });

  it('maps every field the row needs', async () => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: TAMIL } });
    const [first] = (await run(source, 'ta')).items;

    expect(first).toEqual({
      kind: 'wiki',
      source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
      title: 'தமிழ்த் திரைப்படங்களின் பட்டியல், 2026',
      url: `https://ta.wikipedia.org/wiki/${encodeURIComponent('தமிழ்த்_திரைப்படங்களின்_பட்டியல்,_2026')}`,
      language: 'ta',
      signal: { label: '1,627 reads', rank: 1, views: 1627 },
    });
  });

  it('gives English readers ten, keeps the film with a colon, and shortens the big counts', async () => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: ENGLISH } });
    const { items } = await run(source, 'en');

    expect(items.map((item) => [item.title, item.signal?.label])).toEqual([
      ['Russell Brand', '1M reads'],
      ['Ramayana: Part 1', '831K reads'],
      ['Jensen Huang', '733K reads'],
      ['.xxx', '255K reads'],
      ['Scene (2026 film)', '176K reads'],
      ['Abdul El-Sayed', '148K reads'],
      ['Godzilla Minus Zero', '148K reads'],
      ['Nvidia', '142K reads'],
      ['Deaths in 2026', '139K reads'],
      ['Tommy Walsh (builder)', '134K reads'],
    ]);
    expect(items[1].url).toBe('https://en.wikipedia.org/wiki/Ramayana%3A_Part_1');
    expect(items[1].signal?.views).toBe(830_892);
  });

  it('gives French readers ten, with the main page in its namespace gone', async () => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: FRENCH } });
    const { items, attribution } = await run(source, 'fr');

    expect(attribution.url).toBe('https://fr.wikipedia.org');
    expect(items.map((item) => item.title)).toEqual([
      'Teddy Riner',
      'Un singe en hiver (film)',
      "Liste de sondages sur l'élection présidentielle française de 2027",
      'Stéphane Metzger',
      'Campus Drivers',
      'Russell Brand',
      'Jean Gabin',
      'Christine Angot',
      'Jensen Huang',
      'Affaire Michel Zecler',
    ]);
    expect(items.every((item) => item.language === 'fr')).toBe(true);
  });

  it.each([
    ['ta', TAMIL],
    ['en', ENGLISH],
    ['fr', FRENCH],
  ])('ranks the %s rows one to ten and links each to its own edition', async (language, body) => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body } });
    const { items } = await run(source, language);

    expect(items.map((item) => item.signal?.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const item of items) {
      expect(item.url?.startsWith(`https://${language}.wikipedia.org/wiki/`)).toBe(true);
      expect(item.title).not.toMatch(/:(?! )/);
      expect(item.title).not.toContain('_');
    }
  });
});

describe('the Wikipedia mapping', () => {
  it('ranks by what is shown, not by where the list put it', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: {
        body: list(
          ['Main_Page', 900],
          ['Special:Search', 800],
          ['Chennai', 700],
          ['File:X.jpg', 600],
          ['Ramayana:_Part_1', 500],
        ),
      },
    });
    const { items } = await run(source);

    expect(items.map((item) => [item.title, item.signal?.rank])).toEqual([
      ['Chennai', 1],
      ['Ramayana: Part 1', 2],
    ]);
  });

  it('shows at most ten', async () => {
    const many = Array.from({ length: 40 }, (_, index): [string, number] => [
      `Article_${index + 1}`,
      1_000 - index,
    ]);
    const { source } = sourceAnswering({ [YESTERDAY]: { body: list(...many) } });
    const { items } = await run(source);

    expect(items).toHaveLength(10);
    expect(items.at(-1)?.title).toBe('Article 10');
  });

  it('skips a row it cannot read and keeps the rest', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: {
        body: list(
          ['No_views', undefined],
          ['Views_as_text', '12'],
          ['Negative', -1],
          [42, 10],
          ['   ', 9],
          ['Kept', 8],
        ),
      },
    });
    const result = await run(source);

    expect(result.failed).toBeUndefined();
    expect(result.items.map((item) => [item.title, item.signal?.rank])).toEqual([['Kept', 1]]);
  });

  it('skips a title that is not well-formed text instead of throwing', async () => {
    // Half of a surrogate pair, which `encodeURIComponent` refuses.
    const broken = `{"items":[{"articles":[{"article":"Bad_\\ud800","views":9,"rank":1},{"article":"Good","views":8,"rank":2}]}]}`;
    const { source } = sourceAnswering({ [YESTERDAY]: { body: broken } });

    expect((await run(source)).items.map((item) => item.title)).toEqual(['Good']);
  });

  it('never lets markup or a hidden character into a title', async () => {
    const override = String.fromCodePoint(0x202e);
    const { source } = sourceAnswering({
      [YESTERDAY]: {
        body: list(['<b>Bold</b>_<script>alert(1)</script>claim', 5], [`a${override}b`, 4]),
      },
    });
    const { items } = await run(source);

    expect(items.map((item) => item.title)).toEqual(['Bold claim', 'ab']);
    for (const item of items) expect(item.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
  });

  it('cannot be sent to another site by a title', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: { body: list(['../../evil.example/x?y=1#z', 5], ['//evil.example', 4]) },
    });
    const { items } = await run(source);

    expect(items.map((item) => item.url)).toEqual([
      'https://en.wikipedia.org/wiki/..%2F..%2Fevil.example%2Fx%3Fy%3D1%23z',
      'https://en.wikipedia.org/wiki/%2F%2Fevil.example',
    ]);
  });

  it('says one read, not one reads', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: { body: list(['Quiet', 1], ['Silent', 0]) },
    });
    const { items } = await run(source);

    expect(items.map((item) => item.signal?.label)).toEqual(['1 read', '0 reads']);
  });

  it.each([
    [9_999, '9,999 reads'],
    [10_000, '10K reads'],
    [11_054, '11K reads'],
    [1_234_567, '1.2M reads'],
    [4_009_079, '4M reads'],
  ])('words %d as %s', async (views, label) => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: list(['Chennai', views]) } });
    expect((await run(source)).items[0].signal).toEqual({ label, rank: 1, views });
  });
});

describe('which edition', () => {
  it.each([
    ['fr', 'fr.wikipedia', 'fr'],
    ['pt-419', 'pt.wikipedia', 'pt'],
    ['nb', 'no.wikipedia', 'no'],
    ['not a language tag', 'en.wikipedia', 'en'],
  ])('asks for %j at %s', async (language, project, edition) => {
    const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { body: list(['Chennai', 5]) } });
    const result = await run(source, language);

    expect(asked(fetchMock.mock.calls[0][0]).project).toBe(project);
    expect(result.attribution.url).toBe(`https://${edition}.wikipedia.org`);
    expect(result.items[0]).toMatchObject({
      language: edition,
      url: `https://${edition}.wikipedia.org/wiki/Chennai`,
      source: { url: `https://${edition}.wikipedia.org` },
    });
  });

  it('keeps its own main page out, whatever the edition calls it', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: { body: list(['मुखपृष्ठ', 900], ['दीपावली', 800]) },
    });
    expect((await run(source, 'hi')).items.map((item) => item.title)).toEqual(['दीपावली']);
  });
});

describe('which day', () => {
  it('asks for yesterday by the UTC calendar', async () => {
    const lateInTheDay = new Date('2026-11-10T23:59:59Z');
    const { fetchMock, source } = sourceAnswering(
      { [YESTERDAY]: { body: list(['Chennai', 5]) } },
      lateInTheDay,
    );
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual([YESTERDAY]);
    expect(result.answeredDay).toBe(YESTERDAY);
  });

  it('counts back across a month and a year', async () => {
    const newYear = new Date('2027-01-01T00:10:00Z');
    const { fetchMock, source } = sourceAnswering(
      { '2026-12-31': { status: 404 }, '2026-12-30': { body: list(['Chennai', 5]) } },
      newYear,
    );
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual(['2026-12-31', '2026-12-30']);
    expect(result.answeredDay).toBe('2026-12-30');
  });

  it('asks for the day before when yesterday is not published yet, and says so', async () => {
    const { fetchMock, source } = sourceAnswering({
      [YESTERDAY]: { status: 404 },
      [DAY_BEFORE]: { body: list(['Chennai', 5]) },
    });
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual([YESTERDAY, DAY_BEFORE]);
    expect(result.items.map((item) => item.title)).toEqual(['Chennai']);
    expect(result.answeredDay).toBe(DAY_BEFORE);
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([
      'Wikipedia has not published 2026-11-09 yet, so this is 2026-11-08.',
    ]);
  });

  it('reports not found, not trouble, when neither day is there', async () => {
    const { fetchMock, source } = sourceAnswering({
      [YESTERDAY]: { status: 404 },
      [DAY_BEFORE]: { status: 404 },
    });
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual([YESTERDAY, DAY_BEFORE]);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.answeredDay).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });

  it.each([429, 500, 503])(
    'does not ask again after HTTP %d: that is a request to back off',
    async (status) => {
      const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { status } });
      const result = await run(source);

      expect(daysAsked(fetchMock)).toEqual([YESTERDAY]);
      expect(result).toMatchObject({ items: [], failed: 'upstream' });
    },
  );

  it.each([400, 403, 410])(
    'does not ask again after HTTP %d, and it is not trouble',
    async (status) => {
      const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { status } });
      const result = await run(source);

      expect(daysAsked(fetchMock)).toEqual([YESTERDAY]);
      expect(result).toMatchObject({ items: [], failed: 'not_found' });
    },
  );

  it('does not ask again after a dropped connection', async () => {
    const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: new Error('socket hang up') });
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual([YESTERDAY]);
    expect(result).toMatchObject({ items: [], failed: 'upstream' });
  });

  it('does not ask again after an answer it cannot read', async () => {
    const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { body: '<html>Busy</html>' } });
    const result = await run(source);

    expect(daysAsked(fetchMock)).toEqual([YESTERDAY]);
    expect(result.failed).toBe('upstream');
  });

  it.each([
    [{ status: 503 }, 'upstream'],
    [{ status: 429 }, 'upstream'],
    [new Error('timed out'), 'upstream'],
    [{ body: 'not json' }, 'upstream'],
    [{ status: 403 }, 'not_found'],
  ] as const)('reports what the day before said when it fails too: %j', async (answer, failed) => {
    const { source } = sourceAnswering({ [YESTERDAY]: { status: 404 }, [DAY_BEFORE]: answer });
    const result = await run(source);

    expect(result).toMatchObject({ items: [], failed });
    expect(result.answeredDay).toBeUndefined();
  });

  it('names the day it asked for, not the day written in the body', async () => {
    // Simulation serves one recording for every day, and it must keep reading as yesterday.
    const later = new Date('2027-03-01T06:00:00Z');
    const { source } = sourceAnswering({ '2027-02-28': { body: TAMIL } }, later);
    const result = await run(source, 'ta');

    expect(result.items).toHaveLength(10);
    expect(result.answeredDay).toBe('2027-02-28');
  });
});

describe('an answer in the wrong shape', () => {
  it.each([
    '',
    'null',
    '42',
    '"text"',
    '[]',
    '{}',
    '{"items":"x"}',
    '{"items":[]}',
    '{"items":[null]}',
    '{"items":[{}]}',
    '{"items":[{"articles":"x"}]}',
    '{"items":[{"articles":{"article":"Chennai","views":5}}]}',
    '{"items":[{"articles":[1,2,3]}]}',
    '{"items":[{"articles":[{"article":5,"views":"x"}]}]}',
    '{"items":[{"articles":[{"title":"Chennai","count":5}]}]}',
    '<html><body>Consent</body></html>',
    '{"items":[{"articles":[',
  ])('is trouble upstream, never a throw: %s', async (body) => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body } });
    const result = await run(source);

    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(result.answeredDay).toBeUndefined();
  });

  it('is simply empty, with no failure, when the list has no rows', async () => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: list() } });
    const result = await run(source);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
    expect(result.answeredDay).toBe(YESTERDAY);
  });

  it('is simply empty when every row is a page that is not an article', async () => {
    const { source } = sourceAnswering({
      [YESTERDAY]: { body: list(['Main_Page', 9], ['Special:Search', 8]) },
    });
    const result = await run(source);

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });
});

describe('the request', () => {
  it('asks for JSON, with a size limit and a deadline of its own', async () => {
    const { fetchMock, source } = sourceAnswering({ [YESTERDAY]: { body: list() } });
    await run(source);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.accept).toBe('application/json');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller's deadline for both days when it is given one", async () => {
    const { signal } = new AbortController();
    const { fetchMock, source } = sourceAnswering({
      [YESTERDAY]: { status: 404 },
      [DAY_BEFORE]: { body: list() },
    });
    await source.fetch({ locality: { ...WORLDWIDE }, language: 'en', signal });

    expect(fetchMock.mock.calls.map(([, init]) => init.signal)).toEqual([signal, signal]);
  });

  it('does not need a place: the same list answers for Worldwide', async () => {
    const { source } = sourceAnswering({ [YESTERDAY]: { body: ENGLISH } });
    expect((await run(source, 'en')).items).toHaveLength(10);
  });
});
