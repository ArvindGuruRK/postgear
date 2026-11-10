import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editionFor } from './geo/editions';
import { CHENNAI, PARIS, SAN_FRANCISCO } from './geo/geocoder/simulated';
import { resolveLanguages } from './geo/languages';
import { buildLocality } from './geo/locality';
import { createFixtureFetch, FIXTURE_FEEDS } from './simulation';
import { composeFeed } from './sources/compose';
import { createGoogleNewsSource, newsTopicUrl, newsTopUrl } from './sources/google-news';
import { createGoogleTrendsSource, trendsFeedUrl } from './sources/google-trends';
import type { DiscoverFetchInit } from './types';

const INIT: DiscoverFetchInit = {
  accept: 'application/rss+xml',
  signal: new AbortController().signal,
  maxBytes: 1_000_000,
};

const TAMIL = /\p{Script=Tamil}/u;
const fixtureFetch = createFixtureFetch();
const trends = createGoogleTrendsSource({ fetch: fixtureFetch });
const news = createGoogleNewsSource({ fetch: fixtureFetch });

describe('the recorded feeds, through the real sources', () => {
  it('gives Chennai ten trends with related headlines', async () => {
    const result = await trends.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result.items).toHaveLength(10);
    expect(result.answeredGeo).toBe('IN-TN');
    expect(result.items.every((item) => (item.related?.length ?? 0) > 0)).toBe(true);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.signal?.traffic).toBeGreaterThan(0);
    }
  });

  it('gives Chennai Tamil stories in Tamil', async () => {
    const { items, failed } = await news.place({ locality: CHENNAI, language: 'ta' });

    expect(failed).toBeUndefined();
    expect(items.length).toBeGreaterThan(20);
    const inTamil = items.filter((item) => TAMIL.test(item.title));
    expect(inTamil.length).toBeGreaterThan(items.length / 2);
    expect(items.every((item) => item.language === 'ta')).toBe(true);
  });

  it('gives Chennai English stories in English', async () => {
    const { items } = await news.place({ locality: CHENNAI, language: 'en' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((item) => TAMIL.test(item.title))).toEqual([]);
  });

  it('gives San Francisco English stories', async () => {
    const { items } = await news.fetch({ locality: SAN_FRANCISCO, language: 'en' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.language === 'en' && !TAMIL.test(item.title))).toBe(true);
  });

  it('gives Paris French stories, and Trending from the country', async () => {
    const stories = await news.place({ locality: PARIS, language: 'fr' });
    expect(stories.items.length).toBeGreaterThan(0);
    expect(stories.items.every((item) => item.language === 'fr')).toBe(true);

    const rising = await trends.fetch({ locality: PARIS, language: 'fr' });
    expect(rising.answeredGeo).toBe('FR');
    expect(rising.items).toHaveLength(10);
    expect(rising.warnings[0]).toContain('FR-IDF');
  });

  it('takes the publisher off every headline, and leaves no markup', async () => {
    const { items } = await news.place({ locality: CHENNAI, language: 'en' });
    for (const item of items) {
      expect(item.title.endsWith(` - ${item.source.name}`)).toBe(false);
      expect(item.title).not.toMatch(/[<>]/);
      expect(item.opaqueUrl).toMatch(/^https:\/\/news\.google\.com\//);
      expect(item.url).toBeUndefined();
    }
  });

  it('keeps the module promises for languages', () => {
    expect(resolveLanguages(CHENNAI)).toEqual(['ta', 'en']);
    expect(resolveLanguages(PARIS)).toEqual(['fr', 'en']);
    expect(CHENNAI.languages).toEqual(['ta', 'en']);
  });

  it('composes into ten trends and twenty stories once the age limit is off', async () => {
    const input = { locality: CHENNAI, language: 'ta' };
    const [rising, city] = composeFeed(
      [
        { id: 'rising', items: (await trends.fetch(input)).items },
        { id: 'city', items: (await news.place(input)).items },
      ],
      { maxNewsAgeMs: null },
    );
    expect(rising.items).toHaveLength(10);
    expect(city.items).toHaveLength(20);
  });
});

describe('createFixtureFetch', () => {
  it('serves a recorded feed by its real address', async () => {
    const answer = await fixtureFetch(trendsFeedUrl('IN-TN'), INIT);
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('<rss');
    expect(answer.finalUrl).toBe(trendsFeedUrl('IN-TN'));
  });

  it('serves a topic from the top stories of that edition', async () => {
    const locale = editionFor('US', 'en');
    const topic = await fixtureFetch(newsTopicUrl('WORLD', locale), INIT);
    const top = await fixtureFetch(newsTopUrl(locale), INIT);
    expect(topic.status).toBe(200);
    expect(topic.body).toBe(top.body);
  });

  it('answers 404 for anything not recorded, never the wrong place', async () => {
    expect((await fixtureFetch(trendsFeedUrl('DE'), INIT)).status).toBe(404);
    expect((await fixtureFetch('https://example.com/feed', INIT)).status).toBe(404);
  });

  it('reads a place with no recording as not found, not as trouble', async () => {
    const berlin = buildLocality({ countryCode: 'DE', regionCode: 'DE-BE', city: 'Berlin' });
    const rising = await trends.fetch({ locality: berlin, language: 'de' });
    expect(rising).toMatchObject({ items: [], failed: 'not_found' });
  });

  describe('with several recordings', () => {
    let directory: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'discover-fixtures-'));
      mkdirSync(join(directory, 'chennai'));
    });

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true });
    });

    it('serves the newest', async () => {
      const write = (date: string) =>
        writeFileSync(join(directory, 'chennai', `trends-IN.${date}.xml`), date);
      write('2026-11-04');
      write('2026-12-01');
      write('2026-01-15');

      const answer = await createFixtureFetch({ directory })(trendsFeedUrl('IN'), INIT);
      expect(answer.body).toBe('2026-12-01');
    });

    it('does not take a different feed with a similar name', async () => {
      writeFileSync(join(directory, 'chennai', 'trends-IN-TN.2026-11-04.xml'), 'wrong');
      const answer = await createFixtureFetch({ directory })(trendsFeedUrl('IN'), INIT);
      expect(answer.status).toBe(404);
    });
  });
});

describe('the fixtures themselves', () => {
  const root = join(__dirname, '..', 'fixtures');
  const files = readdirSync(root).flatMap((place) =>
    readdirSync(join(root, place)).map((file) => join(root, place, file)),
  );

  it('are all there: twelve feeds, three places', () => {
    expect(FIXTURE_FEEDS).toHaveLength(12);
    for (const feed of FIXTURE_FEEDS) {
      const recorded = files.some((file) =>
        file.startsWith(join(root, feed.place, `${feed.name}.`)),
      );
      expect([feed.name, recorded]).toEqual([feed.name, true]);
    }
  });

  it('never name a feed twice', () => {
    const names = FIXTURE_FEEDS.map((feed) => `${feed.place}/${feed.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keep out the two characters this project bans', () => {
    const banned = [0x2014, 0xb7].map((code) => String.fromCodePoint(code));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const character of banned)
        expect([file, text.includes(character)]).toEqual([file, false]);
    }
  });

  it('stay small enough to live in the repository', () => {
    const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });
});
