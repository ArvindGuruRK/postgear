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
import { buildLocality, WORLDWIDE } from './geo/locality';
import { createFixtureFetch, FIXTURE_FEEDS, recordingsOf } from './simulation';
import { BLUESKY_TRENDS_URL, createBlueskySource } from './sources/bluesky';
import { buildBrief } from './sources/brief';
import { composeFeed, itemId } from './sources/compose';
import { createGoogleNewsSource, newsTopicUrl, newsTopUrl } from './sources/google-news';
import { createGoogleTrendsSource, trendsFeedUrl } from './sources/google-trends';
import { createHolidaysSource, festivalsInWindow, todayIn } from './sources/holidays';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './sources/holidays/google-calendar';
import { createMastodonSource, mastodonTrendsUrl } from './sources/mastodon';
import { createWikipediaSource, isWikipediaArticle, wikipediaTopUrl } from './sources/wikipedia';
import { createYoutubeSource, youtubePopularPrefix, youtubePopularUrl } from './sources/youtube';
import type { DiscoverFetchInit, Locality, SourceItem } from './types';

const INIT: DiscoverFetchInit = {
  accept: 'application/rss+xml',
  signal: new AbortController().signal,
  maxBytes: 1_000_000,
};

const TAMIL = /\p{Script=Tamil}/u;
const fixtureFetch = createFixtureFetch();
const trends = createGoogleTrendsSource({ fetch: fixtureFetch });
const news = createGoogleNewsSource({ fetch: fixtureFetch });

/** The day the Module 05 answers were recorded, so the festival window never moves. */
const RECORDED = () => new Date('2026-11-10T08:00:00Z');
/** Made up, and long enough to find if it ever leaks into an answer. */
const YOUTUBE_KEY = 'made-up-key-for-simulation-0123456789';

const wikipedia = createWikipediaSource({ fetch: fixtureFetch, now: RECORDED });
const bluesky = createBlueskySource({ fetch: fixtureFetch });
const mastodon = createMastodonSource({ fetch: fixtureFetch });
const youtube = createYoutubeSource({ fetch: fixtureFetch, apiKey: YOUTUBE_KEY });
const holidays = createHolidaysSource({ fetch: fixtureFetch, now: RECORDED });

/** What the Festivals tab would show for a place on the day of the recording. */
async function festivalsShownIn(place: Locality): Promise<SourceItem[]> {
  const result = await holidays.fetch({ locality: place, language: place.languages[0] });
  expect([result.failed, result.partial]).toEqual([undefined, undefined]);
  return festivalsInWindow(result.items, todayIn(place.timeZone, RECORDED()));
}

function on(items: readonly SourceItem[], date: string): Array<[string, boolean | undefined]> {
  return items.filter((item) => item.date === date).map((item) => [item.title, item.observance]);
}

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

describe('the recorded Module 05 answers, through the real sources', () => {
  it('gives Chennai ten Tamil Wikipedia rows, with no namespace page and no main page', async () => {
    const result = await wikipedia.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result.failed).toBeUndefined();
    expect(result.answeredDay).toBe('2026-11-09');
    expect(result.attribution).toEqual({ name: 'Wikipedia', url: 'https://ta.wikipedia.org' });
    expect(result.items).toHaveLength(10);
    expect(result.items.map((item) => item.signal?.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    for (const item of result.items) {
      expect(item.kind).toBe('wiki');
      expect(item.language).toBe('ta');
      expect(item.url).toMatch(/^https:\/\/ta\.wikipedia\.org\/wiki\/\S+$/);
      expect(item.signal?.label).toMatch(/^[\d,.]+[KM]? reads?$/);
      expect(item.title).not.toMatch(/:(?! )/);
      expect(item.title).not.toBe('முதற்பக்கம்');
      expect(isWikipediaArticle(item.title.replace(/ /g, '_'), 'ta')).toBe(true);
    }

    const views = result.items.map((item) => item.signal?.views ?? 0);
    expect(views).toEqual([...views].sort((a, b) => b - a));
  });

  it('really had those pages to drop: the recording lists them among its first rows', () => {
    const recording = JSON.parse(
      readFileSync(
        join(__dirname, '..', 'fixtures', 'chennai', 'wikipedia-ta.2026-11-10.json'),
        'utf8',
      ),
    ) as { items: [{ articles: Array<{ article: string }> }] };
    const first = recording.items[0].articles.slice(0, 10).map((entry) => entry.article);

    expect(first).toContain('முதற்பக்கம்');
    expect(first).toContain('சிறப்பு:Search');
    expect(first.filter((article) => !isWikipediaArticle(article, 'ta')).length).toBeGreaterThan(1);
  });

  it('gives English and French their own editions, and keeps an article with a colon', async () => {
    const english = await wikipedia.fetch({ locality: SAN_FRANCISCO, language: 'en' });
    const french = await wikipedia.fetch({ locality: PARIS, language: 'fr' });

    expect(english.items).toHaveLength(10);
    expect(french.items).toHaveLength(10);
    expect(english.items.every((item) => item.url?.startsWith('https://en.wikipedia.org/'))).toBe(
      true,
    );
    expect(french.items.every((item) => item.url?.startsWith('https://fr.wikipedia.org/'))).toBe(
      true,
    );

    const titles = [...english.items, ...french.items].map((item) => item.title);
    expect(titles).not.toContain('Main Page');
    expect(titles.filter((title) => /^(Special|Wikipedia|Wikipédia|Spécial):/.test(title))).toEqual(
      [],
    );
    // A film, not a namespace: the colon is followed by a space.
    expect(english.items.map((item) => item.title)).toContain('Ramayana: Part 1');
  });

  it('reads English Wikipedia for Worldwide, and for Chennai read in English', async () => {
    const world = await wikipedia.fetch({ locality: { ...WORLDWIDE }, language: 'en' });
    const chennai = await wikipedia.fetch({ locality: CHENNAI, language: 'en' });

    expect(world.items).toHaveLength(10);
    expect(chennai.items).toEqual(world.items);
  });

  it('keeps reading the one Wikipedia recording as yesterday on any later day', async () => {
    const later = createWikipediaSource({
      fetch: fixtureFetch,
      now: () => new Date('2027-03-01T12:00:00Z'),
    });
    const result = await later.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result.items).toHaveLength(10);
    expect(result.answeredDay).toBe('2027-02-28');
    expect(result.warnings).toEqual([]);
  });

  it('reads an edition with no recording as not found, after asking for both days', async () => {
    const asked: string[] = [];
    const german = createWikipediaSource({
      fetch: (url, init) => {
        asked.push(url);
        return fixtureFetch(url, init);
      },
      now: RECORDED,
    });
    const result = await german.fetch({ locality: PARIS, language: 'de' });

    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(asked).toEqual([
      wikipediaTopUrl('de.wikipedia', '2026-11-09'),
      wikipediaTopUrl('de.wikipedia', '2026-11-08'),
    ]);
  });

  it('gives ten trends from Bluesky and ten tags from Mastodon', async () => {
    const input = { locality: { ...WORLDWIDE }, language: 'en' };
    const [sky, tags] = await Promise.all([bluesky.fetch(input), mastodon.fetch(input)]);

    expect([sky.failed, tags.failed]).toEqual([undefined, undefined]);
    expect(sky.items).toHaveLength(10);
    expect(tags.items).toHaveLength(10);

    for (const item of sky.items) {
      expect(item.kind).toBe('social');
      expect(item.source).toEqual({ id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app' });
      expect(item.url).toMatch(/^https:\/\/bsky\.app\/profile\//);
      expect(item.signal?.label).toMatch(/^[\d,.]+[KM]? posts?$/);
      expect(item.title).not.toMatch(/[<>]/);
    }
    for (const item of tags.items) {
      expect(item.kind).toBe('social');
      expect(item.source.id).toBe('mastodon');
      expect(item.title).toMatch(/^#\S+$/);
      expect(item.url).toMatch(/^https:\/\/mastodon\.social\/tags\//);
      expect(item.signal?.label).toMatch(/^[\d,.]+[KM]? uses? this week$/);
    }
  });

  it('answers the same social trends whatever the place', async () => {
    const world = await bluesky.fetch({ locality: { ...WORLDWIDE }, language: 'en' });
    const chennai = await bluesky.fetch({ locality: CHENNAI, language: 'ta' });
    expect(chennai.items).toEqual(world.items);
  });

  it('gives India Diwali/Deepavali on 8 November 2026 as a public holiday, once', async () => {
    const shown = await festivalsShownIn(CHENNAI);

    expect(on(shown, '2026-11-08')).toContainEqual(['Diwali/Deepavali', false]);
    expect(shown.filter((item) => /diwali|deepavali/i.test(item.title))).toHaveLength(1);
    // Same day, a different festival: it keeps its own row and its own badge.
    expect(on(shown, '2026-11-08')).toContainEqual(['Naraka Chaturdasi', true]);

    for (const item of shown) {
      expect(item.kind).toBe('festival');
      expect(item.source.id).toBe('holidays');
      expect(typeof item.observance).toBe('boolean');
      expect(item.url).toBeUndefined();
    }
    expect(shown.map((item) => item.date)).toEqual(shown.map((item) => item.date).sort());
  });

  it('hands over far more than the window, so a kept copy still covers next month', async () => {
    const { items } = await holidays.fetch({ locality: CHENNAI, language: 'ta' });
    const shown = festivalsInWindow(items, '2026-11-10');

    expect(items.length).toBeGreaterThan(shown.length);
    // Pongal is two months out: not on the tab today, and an observance when it is.
    expect(on(shown, '2027-01-15')).toEqual([]);
    expect(on(items, '2027-01-15')).toContainEqual(['Pongal', true]);
    expect(on(festivalsInWindow(items, '2027-01-10'), '2027-01-15')).toContainEqual([
      'Pongal',
      true,
    ]);
  });

  it('gives Paris one Armistice Day, a public holiday', async () => {
    const shown = await festivalsShownIn(PARIS);
    expect(on(shown, '2026-11-11')).toEqual([['Armistice Day', false]]);
  });

  it('gives San Francisco Thanksgiving Day, and the day after it from California', async () => {
    const shown = await festivalsShownIn(SAN_FRANCISCO);

    expect(on(shown, '2026-11-26')).toContainEqual(['Thanksgiving Day', false]);
    expect(on(shown, '2026-11-11')).toContainEqual(['Veterans Day', false]);
    expect(on(shown, '2026-11-27')).toEqual([
      ['Black Friday', true],
      ['Day after Thanksgiving Day', false],
    ]);
  });

  it('gives a place with no country no festivals and no videos, without asking', async () => {
    const asked: string[] = [];
    const counting: typeof fixtureFetch = (url, init) => {
      asked.push(url);
      return fixtureFetch(url, init);
    };
    const input = { locality: { ...WORLDWIDE }, language: 'en' };

    const festivals = await createHolidaysSource({ fetch: counting, now: RECORDED }).fetch(input);
    const videos = await createYoutubeSource({ fetch: counting, apiKey: YOUTUBE_KEY }).fetch(input);

    expect(festivals).toMatchObject({ items: [], failed: 'not_found' });
    expect(videos).toMatchObject({ items: [], failed: 'not_found' });
    expect(videos.unitsUsed).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it.each([
    ['Chennai', CHENNAI],
    ['San Francisco', SAN_FRANCISCO],
    ['Paris', PARIS],
  ])(
    'gives %s the five sample videos, counts one unit, and never shows the key',
    async (_name, place) => {
      const result = await youtube.fetch({ locality: place, language: place.languages[0] });

      expect(result.failed).toBeUndefined();
      expect(result.unitsUsed).toBe(1);
      expect(result.items).toHaveLength(5);
      for (const item of result.items) {
        expect(item.kind).toBe('video');
        expect(item.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=SAMPLE_[A-Z]{2}_\d$/);
        expect(item.image).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
        expect(item.summary).toMatch(/^Sample Channel: /);
      }
      expect(JSON.stringify(result)).not.toContain(YOUTUBE_KEY);
    },
  );

  it('keeps a video whose view count is hidden, with no count to show', async () => {
    const { items } = await youtube.fetch({ locality: SAN_FRANCISCO, language: 'en' });
    const hidden = items.filter((item) => item.signal === undefined);

    expect(hidden).toHaveLength(1);
    expect(
      items.filter((item) => /^[\d,.]+[KM]? views?$/.test(item.signal?.label ?? '')),
    ).toHaveLength(4);
  });

  it('keeps all ten Wikipedia rows when they are composed on their own', async () => {
    const { items } = await wikipedia.fetch({ locality: CHENNAI, language: 'ta' });

    const [alone] = composeFeed([{ id: 'wikipedia', items }]);
    expect(alone.items.map((item) => item.signal?.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(alone.items.map((item) => item.id)).size).toBe(10);

    // One call drops a title it has already seen in an earlier group, which
    // would leave a hole in the ranks: so each load is composed by itself.
    const sameTitle: SourceItem = {
      kind: 'trend',
      source: { id: 'google-trends', name: 'Google Trends' },
      title: items[0].title,
    };
    const [, together] = composeFeed([
      { id: 'trends', items: [sameTitle] },
      { id: 'wikipedia', items },
    ]);
    expect(together.items.map((item) => item.signal?.rank)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('writes a brief for each new kind from what was recorded', async () => {
    const world = { locality: { ...WORLDWIDE }, language: 'en' };
    const chennai = { locality: CHENNAI, language: 'ta' };

    const [[wiki], [social], [video]] = await Promise.all(
      [wikipedia.fetch(chennai), bluesky.fetch(world), youtube.fetch(chennai)].map(
        async (result) => composeFeed([{ id: 'group', items: (await result).items }])[0].items,
      ),
    );
    const [festival] = (await festivalsShownIn(CHENNAI))
      .filter((item) => item.title === 'Diwali/Deepavali')
      .map((item) => ({ id: itemId('holidays', `${item.date}|${item.title}`), ...item }));

    expect(buildBrief(wiki, CHENNAI, 'ta')).toMatch(
      /^Widely read on Tamil Wikipedia: "\p{Script=Tamil}.+" \([\d,.]+[KM]? reads\)\.$/u,
    );
    expect(buildBrief(social, CHENNAI, 'ta')).toMatch(
      /^Trending worldwide on Bluesky: ".+" \([\d,.]+[KM]? posts\)\.\nAbout: .+[.!?]$/,
    );
    expect(buildBrief(video, CHENNAI, 'ta')).toMatch(
      /^Trending video in Chennai, Tamil Nadu: ".+" by Sample Channel: .+ \([\d,.]+[KM]? views\)\.$/,
    );
    expect(buildBrief(festival, CHENNAI, 'ta')).toBe(
      'Festival in Chennai, Tamil Nadu: "Diwali/Deepavali" on Sunday 8 November 2026 (public holiday).',
    );
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

  it('serves the one Wikipedia recording of an edition for any day', async () => {
    const recorded = await fixtureFetch(wikipediaTopUrl('ta.wikipedia', '2026-11-09'), INIT);
    const earlier = await fixtureFetch(wikipediaTopUrl('ta.wikipedia', '2024-02-29'), INIT);
    const later = await fixtureFetch(wikipediaTopUrl('ta.wikipedia', '2031-01-01'), INIT);

    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body).items[0].project).toBe('ta.wikipedia');
    expect(earlier.body).toBe(recorded.body);
    expect(later.body).toBe(recorded.body);
    expect(later.finalUrl).toBe(wikipediaTopUrl('ta.wikipedia', '2031-01-01'));
  });

  it('never answers one Wikipedia edition with another', async () => {
    const day = '2026-11-09';
    for (const edition of ['ta', 'en', 'fr']) {
      const answer = await fixtureFetch(wikipediaTopUrl(`${edition}.wikipedia`, day), INIT);
      expect(JSON.parse(answer.body).items[0].project).toBe(`${edition}.wikipedia`);
    }

    // Not recorded, a name that only begins like a recorded one, and a sister project.
    for (const project of ['de.wikipedia', 'tay.wikipedia', 'e.wikipedia', 'ta.wikibooks']) {
      const answer = await fixtureFetch(wikipediaTopUrl(project, day), INIT);
      expect([project, answer.status]).toEqual([project, 404]);
    }
  });

  it('serves the YouTube sample of a country whatever the key', async () => {
    const one = await fixtureFetch(youtubePopularUrl('IN', 'one-key'), INIT);
    const other = await fixtureFetch(youtubePopularUrl('IN', 'another key, with / and &'), INIT);
    // The address with no key at all is the part the sample is matched on.
    const none = await fixtureFetch(youtubePopularPrefix('IN'), INIT);

    expect(youtubePopularUrl('IN', 'one-key').startsWith(youtubePopularPrefix('IN'))).toBe(true);
    expect(one.status).toBe(200);
    expect(JSON.parse(one.body)._sample).toMatch(/^Written by hand/);
    expect(other.body).toBe(one.body);
    expect(none.body).toBe(one.body);
  });

  it('never answers one country with the videos of another', async () => {
    const bodies = await Promise.all(
      ['IN', 'US', 'FR'].map(async (country) => {
        const answer = await fixtureFetch(youtubePopularUrl(country, 'key'), INIT);
        expect(answer.body).toContain(`SAMPLE_${country}_1`);
        return answer.body;
      }),
    );
    expect(new Set(bodies).size).toBe(3);

    for (const country of ['DE', 'I', 'IND']) {
      const answer = await fixtureFetch(youtubePopularUrl(country, 'key'), INIT);
      expect([country, answer.status]).toEqual([country, 404]);
    }
  });

  it('serves the social trends and the calendars by their exact address only', async () => {
    const sky = await fixtureFetch(BLUESKY_TRENDS_URL, INIT);
    const tags = await fixtureFetch(mastodonTrendsUrl(), INIT);
    const india = await fixtureFetch(holidayCalendarUrl(HOLIDAY_CALENDAR_IDS.IN), INIT);

    expect(JSON.parse(sky.body).trends).toHaveLength(10);
    expect(JSON.parse(tags.body)).toHaveLength(10);
    expect(india.body.startsWith('BEGIN:VCALENDAR')).toBe(true);

    expect((await fixtureFetch(`${BLUESKY_TRENDS_URL}0`, INIT)).status).toBe(404);
    expect((await fixtureFetch(mastodonTrendsUrl('mastodon.example'), INIT)).status).toBe(404);
    // A country in the table that was never recorded.
    expect((await fixtureFetch(holidayCalendarUrl(HOLIDAY_CALENDAR_IDS.GB), INIT)).status).toBe(
      404,
    );
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

    it('serves the newest Wikipedia recording, whatever day is asked', async () => {
      const write = (date: string) =>
        writeFileSync(join(directory, 'chennai', `wikipedia-ta.${date}.json`), date);
      write('2026-11-10');
      write('2026-12-24');

      const answer = await createFixtureFetch({ directory })(
        wikipediaTopUrl('ta.wikipedia', '2026-11-09'),
        INIT,
      );
      expect(answer.body).toBe('2026-12-24');
    });

    it('serves a hand-written sample only until there is a real recording', async () => {
      const feed = FIXTURE_FEEDS.find((entry) => entry.name === 'youtube-IN');
      if (!feed) throw new Error('The YouTube sample for India is not in the list.');
      const fetchFrom = createFixtureFetch({ directory });
      const url = youtubePopularUrl('IN', 'key');

      expect(await recordingsOf(directory, feed)).toEqual([]);
      expect((await fetchFrom(url, INIT)).status).toBe(404);

      writeFileSync(join(directory, 'chennai', 'youtube-IN.sample.json'), 'sample');
      expect(await recordingsOf(directory, feed)).toEqual(['youtube-IN.sample.json']);
      expect((await fetchFrom(url, INIT)).body).toBe('sample');

      // By name alone "sample" sorts after every date, so this is a rule, not luck.
      writeFileSync(join(directory, 'chennai', 'youtube-IN.2026-12-01.json'), 'recorded');
      expect(await recordingsOf(directory, feed)).toEqual(['youtube-IN.2026-12-01.json']);
      expect((await fetchFrom(url, INIT)).body).toBe('recorded');
    });

    it('does not take a file of another type for a feed', async () => {
      writeFileSync(join(directory, 'chennai', 'holidays-IN.2026-11-10.json'), 'wrong');
      const answer = await createFixtureFetch({ directory })(
        holidayCalendarUrl(HOLIDAY_CALENDAR_IDS.IN),
        INIT,
      );
      expect(answer.status).toBe(404);
    });
  });
});

describe('the fixtures themselves', () => {
  const root = join(__dirname, '..', 'fixtures');
  const files = readdirSync(root).flatMap((place) =>
    readdirSync(join(root, place)).map((file) => join(root, place, file)),
  );

  it('are all there: twenty-three feeds, three places and Worldwide', async () => {
    expect(FIXTURE_FEEDS).toHaveLength(23);
    expect([...new Set(FIXTURE_FEEDS.map((feed) => feed.place))].sort()).toEqual([
      'chennai',
      'paris',
      'san-francisco',
      'worldwide',
    ]);

    // Asked the way the fixture fetch asks, so a file it would not serve does not count.
    for (const feed of FIXTURE_FEEDS) {
      const served = (await recordingsOf(root, feed)).at(-1);
      expect([feed.name, served !== undefined]).toEqual([feed.name, true]);
      expect([feed.name, served?.endsWith('.sample.json') ?? false]).toEqual([
        feed.name,
        feed.sample === true,
      ]);
    }
  });

  it('have three hand-written samples, YouTube for each place, and say so inside', () => {
    const samples = FIXTURE_FEEDS.filter((feed) => feed.sample).map((feed) => feed.name);
    expect(samples.sort()).toEqual(['youtube-FR', 'youtube-IN', 'youtube-US']);

    // A recording must never carry the mark, and a sample must never lack it.
    for (const file of files.filter((path) => path.endsWith('.json'))) {
      const body: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const marked =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { _sample?: unknown })._sample === 'string';
      expect([file, marked]).toEqual([file, file.endsWith('.sample.json')]);
    }
  });

  it('hold no key in any address they quote', () => {
    for (const file of files) {
      expect([file, /[?&]key=[^&"\s]/.test(readFileSync(file, 'utf8'))]).toEqual([file, false]);
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
