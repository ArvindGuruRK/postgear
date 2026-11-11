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
import { COMMON_FEED_PATHS, discoverFeeds } from './discover-feeds';
import { editionFor } from './geo/editions';
import { CHENNAI, PARIS, SAN_FRANCISCO } from './geo/geocoder/simulated';
import { resolveLanguages } from './geo/languages';
import { buildLocality, WORLDWIDE } from './geo/locality';
import { extractArticle } from './reader/extract-article';
import {
  decodeGoogleNewsLink,
  GOOGLE_NEWS_BATCH_URL,
  googleNewsArticleUrl,
  readBatchAnswer,
  readDecodingParams,
} from './reader/google-news-link';
import {
  COMPETITOR_FIXTURES,
  COMPETITOR_SAMPLE,
  createFixtureFetch,
  createReaderFixtureFetch,
  FIXTURE_FEEDS,
  fixtureFileName,
  READER_FIXTURES,
  READER_SAMPLE,
  recordingsOf,
} from './simulation';
import { BLUESKY_TRENDS_URL, createBlueskySource } from './sources/bluesky';
import { blueskyAuthorFeedUrl, createBlueskyAuthorSource } from './sources/bluesky-author';
import { buildBrief } from './sources/brief';
import { composeFeed, itemId } from './sources/compose';
import {
  createGoogleNewsSource,
  newsSearchUrl,
  newsTopicUrl,
  newsTopUrl,
} from './sources/google-news';
import { createGoogleTrendsSource, trendsFeedUrl } from './sources/google-trends';
import { createHolidaysSource, festivalsInWindow, todayIn } from './sources/holidays';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './sources/holidays/google-calendar';
import { createMastodonSource, mastodonTrendsUrl } from './sources/mastodon';
import {
  createMastodonAccountSource,
  mastodonLookupUrl,
  mastodonStatusesUrl,
} from './sources/mastodon-account';
import { createRssSource } from './sources/rss';
import { createWikipediaSource, isWikipediaArticle, wikipediaTopUrl } from './sources/wikipedia';
import { createYoutubeSource, youtubePopularPrefix, youtubePopularUrl } from './sources/youtube';
import { createYoutubeChannelSource, youtubeChannelFeedUrl } from './sources/youtube-channel';
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

/** Every file under a folder, however deep: the competitor samples sit one level further down. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** A hand-written JSON answer says so inside: on the object, or on every row of a list. */
function saysItIsASample(body: unknown): boolean {
  const marked = (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { _sample?: unknown })._sample === 'string';
  return Array.isArray(body) ? body.length > 0 && body.every(marked) : marked(body);
}

describe('the fixtures themselves', () => {
  const root = join(__dirname, '..', 'fixtures');
  const files = filesUnder(root);

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
      expect([file, saysItIsASample(body)]).toEqual([file, file.endsWith('.sample.json')]);
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

describe('the competitor samples (Module 07)', () => {
  const root = join(__dirname, '..', 'fixtures');
  const folder = join(root, 'competitors', 'acme');
  const S = COMPETITOR_SAMPLE;
  const options = { fetch: fixtureFetch, maxAgeMs: null };
  const page = { ...INIT, accept: 'text/html' };

  it('are eight hand-written answers, every one with its file', async () => {
    expect(COMPETITOR_FIXTURES.map((feed) => feed.name).sort()).toEqual([
      'blog-rss',
      'bluesky-author',
      'changelog-atom',
      'mastodon-lookup',
      'mastodon-statuses',
      'news-search',
      'site',
      'youtube-channel',
    ]);

    for (const feed of COMPETITOR_FIXTURES) {
      expect([feed.name, feed.place, feed.sample]).toEqual([feed.name, 'competitors/acme', true]);
      // Asked the way the fixture fetch asks, so a file it would not serve does not count.
      expect([feed.name, await recordingsOf(root, feed)]).toEqual([
        feed.name,
        [fixtureFileName(feed, 'sample')],
      ]);
    }
  });

  it('leave no file in the folder that the list does not name', () => {
    const listed = COMPETITOR_FIXTURES.map((feed) => fixtureFileName(feed, 'sample')).sort();
    expect(readdirSync(folder).sort()).toEqual(listed);
  });

  it('never name a sample twice, by name or by address', () => {
    const names = COMPETITOR_FIXTURES.map((feed) => feed.name);
    const addresses = COMPETITOR_FIXTURES.map((feed) => feed.url);

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('are kept out of the list the recorder fetches from', () => {
    const recorded = FIXTURE_FEEDS.map((feed) => feed.url);

    expect(FIXTURE_FEEDS.filter((feed) => feed.place.startsWith('competitors'))).toEqual([]);
    for (const feed of COMPETITOR_FIXTURES) {
      expect([feed.name, recorded.includes(feed.url)]).toEqual([feed.name, false]);
    }
    for (const address of recorded) {
      expect([address, address.includes('acme.example')]).toEqual([address, false]);
      expect([address, address.includes('mastodon.example')]).toEqual([address, false]);
    }
  });

  it('live on a name reserved for examples, apart from the three real services they stand in for', () => {
    const hosts = [...new Set(COMPETITOR_FIXTURES.map((feed) => new URL(feed.url).hostname))];

    expect(hosts.sort()).toEqual([
      'acme.example',
      'mastodon.example',
      'news.google.com',
      'public.api.bsky.app',
      'www.youtube.com',
    ]);
    expect(S.website).toBe('https://acme.example/');
    expect(S.blueskyHandle.endsWith('.example')).toBe(true);
    expect(S.mastodonAcct.endsWith('.example')).toBe(true);
  });

  it('all say inside that they are samples', () => {
    for (const feed of COMPETITOR_FIXTURES) {
      const file = fixtureFileName(feed, 'sample');
      const text = readFileSync(join(folder, file), 'utf8');

      if (file.endsWith('.json')) {
        expect([file, saysItIsASample(JSON.parse(text))]).toEqual([file, true]);
      } else {
        // A feed or a page: a comment that starts "Sample:", before the content.
        const comment = /<!--\s*Sample:[^>]*-->/.exec(text);
        expect([file, comment !== null]).toEqual([file, true]);
        expect([file, (comment?.index ?? Number.MAX_SAFE_INTEGER) < 100]).toEqual([file, true]);
      }
    }
  });

  it('keep out the two characters this project bans, and hold no key', () => {
    const banned = [0x2014, 0xb7].map((code) => String.fromCodePoint(code));

    for (const file of readdirSync(folder)) {
      const text = readFileSync(join(folder, file), 'utf8');
      for (const character of banned)
        expect([file, text.includes(character)]).toEqual([file, false]);
      expect([file, /[?&]key=[^&"\s]/.test(text)]).toEqual([file, false]);
    }
  });

  it('serve each sample at exactly the address its source asks for', async () => {
    const addresses = [
      S.website,
      S.blogFeed,
      S.changelogFeed,
      youtubeChannelFeedUrl(S.youtubeChannelId),
      blueskyAuthorFeedUrl(S.blueskyHandle),
      mastodonLookupUrl({ user: 'acme', instance: 'mastodon.example' }),
      mastodonStatusesUrl('mastodon.example', S.mastodonAccountId),
      newsSearchUrl(S.name, editionFor(null, 'en')),
    ];

    for (const address of addresses) {
      const answer = await fixtureFetch(address, INIT);
      expect([address, answer.status, answer.finalUrl]).toEqual([address, 200, address]);
      expect(answer.body.length).toBeGreaterThan(100);
    }
  });

  it('answer the news search for any phrase that starts with the name, in any edition', async () => {
    const editions = [editionFor(null, 'en'), editionFor('IN', 'ta'), editionFor('FR', 'fr')];

    for (const edition of editions) {
      for (const phrase of ['Acme', 'Acme Analytics']) {
        const answer = await fixtureFetch(newsSearchUrl(phrase, edition), INIT);
        expect([phrase, edition.ceid, answer.status]).toEqual([phrase, edition.ceid, 200]);
        expect(answer.body).toContain('<!-- Sample:');
      }
    }
  });

  it('never answer the news search for another name', async () => {
    for (const phrase of ['Globex', 'The Acme Company', 'acme', 'Initech Acme']) {
      const answer = await fixtureFetch(newsSearchUrl(phrase, editionFor(null, 'en')), INIT);
      expect([phrase, answer.status, answer.body]).toEqual([phrase, 404, '']);
    }
  });

  it.each([
    ['a page of the site that was not written', 'https://acme.example/pricing'],
    ['a feed that was not written', 'https://acme.example/missing.xml'],
    ['a common feed path', 'https://acme.example/feed'],
    ['the site with no slash', 'https://acme.example'],
    ['the site over plain http', 'http://acme.example/'],
    ['the site with a query', 'https://acme.example/?page=2'],
    ['another host under the same name', 'https://www.acme.example/'],
    ['a name that only begins like it', 'https://acme.example.attacker.test/'],
    ['another channel', youtubeChannelFeedUrl('UCsomeOtherChannel000000')],
    ['another Bluesky handle', blueskyAuthorFeedUrl('globex.example')],
    [
      'another Mastodon account',
      mastodonLookupUrl({ user: 'globex', instance: 'mastodon.example' }),
    ],
    [
      'the same account on another instance',
      mastodonLookupUrl({ user: 'acme', instance: 'other.example' }),
    ],
    [
      'the statuses of another account',
      mastodonStatusesUrl('mastodon.example', '110000000000000002'),
    ],
  ])('answer 404 for %s', async (_what, address) => {
    expect(await fixtureFetch(address, INIT)).toEqual({ status: 404, body: '', finalUrl: address });
  });

  it('finds the two feeds of the sample site, without a probe', async () => {
    const asked: string[] = [];
    const counting: typeof fixtureFetch = (url, init) => {
      asked.push(url);
      return fixtureFetch(url, init);
    };
    const site = await counting(S.website, page);

    expect(await discoverFeeds(site.body, site.finalUrl, { fetch: counting })).toEqual([
      { url: S.blogFeed, title: 'Blog', kind: 'rss' },
      { url: S.changelogFeed, title: 'Changelog', kind: 'atom' },
    ]);
    expect(asked).toEqual([S.website]);
  });

  it('finds no feed on a site that was not written, after trying the common paths', async () => {
    const asked: string[] = [];
    const counting: typeof fixtureFetch = (url, init) => {
      asked.push(url);
      return fixtureFetch(url, init);
    };

    expect(
      await discoverFeeds('<html></html>', 'https://globex.example/', { fetch: counting }),
    ).toEqual([]);
    expect(asked).toEqual(COMMON_FEED_PATHS.map((path) => `https://globex.example${path}`));
  });

  it('gives the hand check its rows: blog, changelog, a video, two networks and the news', async () => {
    const rss = createRssSource(options);
    const answers = {
      blog: await rss.read(S.blogFeed),
      changelog: await rss.read(S.changelogFeed),
      youtube: await createYoutubeChannelSource(options).read(S.youtubeChannelId),
      bluesky: await createBlueskyAuthorSource(options).read(S.blueskyHandle),
      mastodon: await createMastodonAccountSource(options).read(S.mastodonAcct),
      news: await news.search(S.name, { locality: CHENNAI, language: 'ta' }),
    };

    for (const [name, answer] of Object.entries(answers)) {
      expect([name, answer.failed, answer.unreadable]).toEqual([name, undefined, undefined]);
      expect([name, answer.items.every((item) => item.kind === 'competitor')]).toEqual([
        name,
        true,
      ]);
    }
    expect(
      Object.fromEntries(
        Object.entries(answers).map(([name, answer]) => [
          name,
          [answer.items.length, answer.items[0]?.source.id],
        ]),
      ),
    ).toEqual({
      blog: [5, 'rss'],
      changelog: [3, 'rss'],
      youtube: [2, 'youtube'],
      bluesky: [2, 'bluesky'],
      mastodon: [2, 'mastodon'],
      news: [2, 'google-news'],
    });
  });

  it('writes the brief the story asks for from the first blog post', async () => {
    const [post] = (await createRssSource(options).read(S.blogFeed)).items;
    const composed = { ...post, id: itemId(post.source.id, post.url ?? post.title) };

    expect(buildBrief(composed, CHENNAI, 'en', { competitor: 'Acme Analytics' })).toBe(
      "Acme Analytics published: 'Five ways to cut churn'. Write our own take on this topic for our audience, not a summary of theirs.",
    );
  });

  it('reads a feed that was not written as "nothing there", and the site as "not a feed"', async () => {
    const rss = createRssSource(options);

    expect(await rss.read('https://acme.example/missing.xml')).toMatchObject({
      items: [],
      failed: 'not_found',
    });
    expect(await rss.read(S.website)).toMatchObject({
      items: [],
      failed: 'not_found',
      unreadable: true,
    });
  });

  it('keeps every sample row inside the last 30 days of the day they were written, bar the one that is old on purpose', async () => {
    const written = { fetch: fixtureFetch, now: RECORDED };
    const blog = await createRssSource(written).read(S.blogFeed);
    const youtube = await createYoutubeChannelSource(written).read(S.youtubeChannelId);
    const bluesky = await createBlueskyAuthorSource(written).read(S.blueskyHandle);
    const mastodon = await createMastodonAccountSource(written).read(S.mastodonAcct);

    expect([blog, youtube, bluesky, mastodon].map((answer) => answer.items.length)).toEqual([
      4, 2, 2, 2,
    ]);
    expect(blog.items.map((item) => item.title)).not.toContain(
      'How we started (an old sample post)',
    );
  });
});

describe('the reader samples (Module 08)', () => {
  const folder = join(__dirname, '..', 'fixtures', 'reader');
  const R = READER_SAMPLE;
  const F = READER_FIXTURES;
  const readerFetch = createReaderFixtureFetch();
  const page = { ...INIT, accept: 'text/html' };
  const form = {
    ...INIT,
    accept: '*/*',
    post: { body: 'f.req=%5B%5D', contentType: 'application/x-www-form-urlencoded;charset=UTF-8' },
  };
  const fileOf = (name: string) => readFileSync(join(folder, name), 'utf8');
  const STORY = 'CBMiSAMPLEstoryTamil0001';

  it('are five hand-written files, and the folder holds exactly those', () => {
    expect(Object.keys(F).sort()).toEqual([
      'article',
      'frontPage',
      'googleNewsArticle',
      'googleNewsBatch',
      'tamilArticle',
    ]);
    expect(readdirSync(folder).sort()).toEqual(Object.values(F).sort());
    for (const file of Object.values(F)) {
      expect([file, file.includes('.sample.')]).toEqual([file, true]);
      expect([file, statSync(join(folder, file)).size > 200]).toEqual([file, true]);
    }
  });

  it('all say inside that they are samples', () => {
    for (const file of Object.values(F)) {
      const text = fileOf(file);

      if (file.endsWith('.html')) {
        // A page: a comment that starts "Sample:", before the content.
        const comment = /<!--\s*Sample:[^>]*-->/.exec(text);
        expect([file, comment !== null]).toEqual([file, true]);
        expect([file, (comment?.index ?? Number.MAX_SAFE_INTEGER) < 100]).toEqual([file, true]);
      } else {
        // The batch answer cannot hold a comment: one of its rows says so instead.
        const rows: unknown = JSON.parse(text.split(/\r?\n\r?\n/)[1] ?? 'null');
        const marks = (Array.isArray(rows) ? rows : []).filter(
          (row) => Array.isArray(row) && row[0] === '_sample' && typeof row[1] === 'string',
        );
        expect([file, marks.length]).toEqual([file, 1]);
        expect((marks[0] as string[])[1]).toMatch(/^Written by hand/);
      }
    }
  });

  it('say in the two articles themselves that nothing in them happened', () => {
    // The stand-in is shown to a person, so the story has to say it too, not only a comment.
    expect(fileOf(F.article)).toContain('This is a sample article');
    expect(fileOf(F.article)).toContain('The Sample Courier');
    expect(fileOf(F.tamilArticle)).toMatch(TAMIL);
  });

  it('keep out the two characters this project bans, and hold no key', () => {
    const banned = [0x2014, 0xb7].map((code) => String.fromCodePoint(code));

    for (const file of readdirSync(folder)) {
      const text = fileOf(file);
      for (const character of banned)
        expect([file, text.includes(character)]).toEqual([file, false]);
      expect([file, /[?&]key=[^&"\s]/.test(text)]).toEqual([file, false]);
    }
  });

  it('live on a name reserved for examples, and are kept out of the lists the feeds read', () => {
    for (const address of Object.values(R)) {
      expect([address, new URL(address).hostname]).toEqual([address, 'reader.example']);
    }
    expect(new Set(Object.values(R)).size).toBe(Object.values(R).length);

    const listed = [...FIXTURE_FEEDS, ...COMPETITOR_FIXTURES];
    expect(listed.filter((feed) => feed.place.startsWith('reader'))).toEqual([]);
    expect(listed.filter((feed) => feed.url.includes('reader.example'))).toEqual([]);
  });

  it('serve each sample page at its own address', async () => {
    const served: [string, string][] = [
      [R.article, F.article],
      [R.tamilArticle, F.tamilArticle],
      [R.frontPage, F.frontPage],
    ];

    for (const [address, file] of served) {
      expect(await readerFetch(address, page)).toEqual({
        status: 200,
        body: fileOf(file),
        finalUrl: address,
      });
    }
  });

  it('answer 404 for the one address that is always missing', async () => {
    expect(await readerFetch(R.missing, page)).toEqual({
      status: 404,
      body: '',
      finalUrl: R.missing,
    });
  });

  it.each([
    [
      'an RSS link, as a News card carries it',
      `https://news.google.com/rss/articles/${STORY}?oc=5`,
    ],
    ['the address the decoder asks for', googleNewsArticleUrl(STORY)],
    ['an article link', `https://news.google.com/articles/${STORY}`],
    ['a read link', `https://news.google.com/read/${STORY}`],
    ['any other story', 'https://news.google.com/rss/articles/CBMiANOTHERstory00000002?oc=5'],
  ])('answer the sample Google News page for %s', async (_what, address) => {
    const answer = await readerFetch(address, page);

    expect([answer.status, answer.finalUrl]).toEqual([200, address]);
    expect(answer.body).toBe(fileOf(F.googleNewsArticle));
    expect(readDecodingParams(answer.body)).not.toBeNull();
  });

  it('answer the batch sample for the one POST, and for nothing else', async () => {
    const posted = await readerFetch(GOOGLE_NEWS_BATCH_URL, form);
    expect(posted).toEqual({
      status: 200,
      body: fileOf(F.googleNewsBatch),
      finalUrl: GOOGLE_NEWS_BATCH_URL,
    });
    expect(readBatchAnswer(posted.body)).toBe(R.tamilArticle);

    // A form sent anywhere else is refused, whatever the address would answer to a read.
    for (const address of [
      R.article,
      R.frontPage,
      googleNewsArticleUrl(STORY),
      'https://news.google.com/_/DotsSplashUi/data/other',
      'https://publisher.example/login',
    ]) {
      expect(await readerFetch(address, form)).toEqual({
        status: 404,
        body: '',
        finalUrl: address,
      });
    }

    // And reading the endpoint without a form never gives the answer away.
    const read = await readerFetch(GOOGLE_NEWS_BATCH_URL, page);
    expect(read.body).not.toBe(fileOf(F.googleNewsBatch));
  });

  it.each([
    [
      'a publisher a Trends card points at',
      'https://www.publisher.example/news/cities/chennai/a-story/article123.ece',
    ],
    ['another page of the sample site', 'https://reader.example/articles/another-one'],
    ['the sample site with a query', 'https://reader.example/?page=2'],
    ['plain http', 'http://publisher.example/story'],
    ["a competitor's blog post", 'https://acme.example/blog/five-ways-to-cut-churn'],
  ])('answer the English sample, as a stand-in, for %s', async (_what, address) => {
    expect(await readerFetch(address, page)).toEqual({
      status: 200,
      body: fileOf(F.article),
      finalUrl: address,
    });
  });

  it('never reach for the network, whatever they are asked', async () => {
    const real = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('The simulated reader reached for the real fetch.');
    });

    try {
      for (const address of [
        ...Object.values(R),
        googleNewsArticleUrl(STORY),
        'https://www.publisher.example/news/a-story',
        'https://example.org/',
      ]) {
        await readerFetch(address, page);
        await readerFetch(address, form);
      }
      await readerFetch(GOOGLE_NEWS_BATCH_URL, form);
      expect(real).not.toHaveBeenCalled();
    } finally {
      real.mockRestore();
    }
  });

  it('read a folder they are pointed at, so a test can hand them its own pages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'discover-reader-'));
    try {
      mkdirSync(join(directory, 'reader'));
      writeFileSync(join(directory, 'reader', F.article), 'a page of its own');
      const own = createReaderFixtureFetch({ directory });

      expect((await own(R.article, page)).body).toBe('a page of its own');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('walk a News card from its Google link to the Tamil story, offline', async () => {
    const asked: string[] = [];
    const counting: typeof readerFetch = (url, init) => {
      asked.push(`${init.post ? 'POST' : 'GET'} ${url}`);
      return readerFetch(url, init);
    };

    const publisher = await decodeGoogleNewsLink(STORY, { fetch: counting });
    const story = await counting(publisher, page);
    const article = extractArticle(story.body, story.finalUrl);

    expect(asked).toEqual([
      `GET ${googleNewsArticleUrl(STORY)}`,
      `POST ${GOOGLE_NEWS_BATCH_URL}`,
      `GET ${R.tamilArticle}`,
    ]);
    expect(article).toMatchObject({ language: 'ta', readMinutes: 1 });
    expect(article?.title).toMatch(TAMIL);
    expect(article?.text).toMatch(TAMIL);
  });

  it('read the three pages the way the reader will: two articles, and a front page that is not one', async () => {
    const articleOf = async (address: string) => {
      const answer = await readerFetch(address, page);
      return extractArticle(answer.body, answer.finalUrl);
    };

    expect(await articleOf(R.article)).toMatchObject({
      title: 'Harbour market reopens after two years of repairs',
      siteName: 'The Sample Courier',
      byline: 'A. Reporter',
      language: 'en-GB',
      readMinutes: 2,
    });
    expect(await articleOf(R.tamilArticle)).toMatchObject({ language: 'ta' });
    expect(await articleOf(R.frontPage)).toBeNull();
    // The stand-in reads as the same sample, which says in its first paragraph what it is.
    const standIn = await articleOf('https://www.publisher.example/a-story');
    expect(standIn?.excerpt).toContain('This is a sample article');
  });
});
