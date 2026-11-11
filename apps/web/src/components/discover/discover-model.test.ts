/**
 * Discover's words and choices: what the chips say, which language a place
 * starts in, what is remembered (and what is refused when read back), how old
 * the page says its copy is, and (Module 05) which week a festival is listed
 * under, how far off it reads, and when a post about it is dated. Module 06:
 * where a visit starts once a workspace saved a place, what saving one sends,
 * and the News topic remembered beside the place.
 */
import type { DiscoverGroup, DiscoverItem, DiscoverSettings, Locality } from '@/types/discover';
import {
  ADMINS_ONLY_PLACE,
  copilotHref,
  DRAFT_SOURCES_MAX,
  DRAFT_TOPIC_MAX,
  daysUntil,
  draftLanguages,
  draftSources,
  draftTopic,
  festivalBadge,
  festivalDay,
  festivalPublishAt,
  festivalSections,
  festivalWhen,
  firstLanguage,
  isNewsTopic,
  isWorldwide,
  itemMeta,
  languageFor,
  locationSourceFor,
  MAX_WORKSPACE_LANGUAGES,
  NO_WORKSPACE_DEFAULT,
  openHref,
  placeChipText,
  placeInSentence,
  placePatch,
  placeResultText,
  placeShortText,
  placeStart,
  placeStorageKey,
  readRememberedPlace,
  safeHref,
  serializeRememberedPlace,
  settingsInScope,
  socialChipLabel,
  switchedOff,
  TOPIC_CHOICES,
  TOPIC_NAMES,
  tabFrom,
  updatedText,
  WORLDWIDE_PLACE,
  workspaceDefaultText,
  workspaceLanguages,
  workspaceTopic,
} from './discover-model';
import { languageLabel, languageName } from './language-names';

const CHENNAI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const INDIA: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: 'Asia/Kolkata',
  languages: ['hi', 'en', 'bn', 'ta'],
  newsLanguages: ['hi', 'en', 'bn', 'ta'],
};

const NOW = new Date('2026-11-10T12:00:00Z');

function item(patch: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'a',
    kind: 'trend',
    source: { id: 'google-trends', name: 'Google Trends' },
    title: 'weather coimbatore',
    brief: 'brief',
    ...patch,
  };
}

function group(fetchedAt: string): DiscoverGroup {
  return {
    id: 'trends',
    title: 'Rising Searches In Tamil Nadu',
    subtitle: 'Via Google Trends.',
    attribution: { name: 'Google Trends' },
    items: [item()],
    stale: false,
    fetchedAt,
  };
}

describe('the place chip', () => {
  it('says where the guess came from', () => {
    expect(placeChipText(INDIA, 'guess')).toBe('India, from your time zone');
  });

  it('names the city and region once a place is found or picked', () => {
    expect(placeChipText(CHENNAI, 'browser')).toBe('Chennai, Tamil Nadu');
    expect(placeChipText(CHENNAI, 'search')).toBe('Chennai, Tamil Nadu');
  });

  it('falls back to the region and country, never repeating a name', () => {
    const region = { ...CHENNAI, city: null };
    expect(placeChipText(region, 'search')).toBe('Tamil Nadu, India');
    const cityState = {
      ...CHENNAI,
      countryCode: 'SG',
      countryName: 'Singapore',
      regionCode: null,
      regionName: 'Singapore',
      city: 'Singapore',
    };
    expect(placeChipText(cityState, 'search')).toBe('Singapore');
    expect(placeChipText(INDIA, 'search')).toBe('India');
  });

  it('says Worldwide for no country, whatever chose it', () => {
    expect(placeChipText(WORLDWIDE_PLACE, 'worldwide')).toBe('Worldwide');
    expect(placeChipText(WORLDWIDE_PLACE, 'guess')).toBe('Worldwide');
    expect(isWorldwide(WORLDWIDE_PLACE)).toBe(true);
  });

  it('shortens to the most specific name on a phone', () => {
    expect(placeShortText(CHENNAI)).toBe('Chennai');
    expect(placeShortText(INDIA)).toBe('India');
    expect(placeShortText(WORLDWIDE_PLACE)).toBe('Worldwide');
  });

  it('reads a search result in full, and the place in a sentence', () => {
    expect(placeResultText(CHENNAI)).toBe('Chennai, Tamil Nadu, India');
    expect(placeInSentence(CHENNAI)).toBe('Chennai');
    expect(placeInSentence(WORLDWIDE_PLACE)).toBe('the whole world');
  });
});

describe('the first language', () => {
  it('starts a city in its own first language, whatever the browser prefers', () => {
    expect(firstLanguage(CHENNAI, ['en-US', 'en'])).toBe('ta');
  });

  it('starts a guessed country in a language the browser prefers, when offered', () => {
    expect(firstLanguage(INDIA, ['en-GB', 'en'])).toBe('en');
    expect(firstLanguage(INDIA, ['ta-IN'])).toBe('ta');
  });

  it('starts a guessed country in its first language otherwise', () => {
    expect(firstLanguage(INDIA, ['ja'])).toBe('hi');
    expect(firstLanguage(INDIA)).toBe('hi');
  });

  it('matches an edition spelling by its first part', () => {
    const mexico = { ...INDIA, countryCode: 'MX', newsLanguages: ['es-419'] };
    expect(firstLanguage(mexico, ['es-MX'])).toBe('es-419');
  });

  it('keeps a stored language only when the place offers it', () => {
    expect(languageFor(CHENNAI, 'en')).toBe('en');
    expect(languageFor(CHENNAI, 'fr')).toBe('ta');
    expect(languageFor(CHENNAI, null)).toBe('ta');
  });
});

describe('the remembered choice', () => {
  it('is kept per workspace', () => {
    expect(placeStorageKey('org-a')).toBe('pg:discover:org-a');
    expect(placeStorageKey('org-b')).not.toBe(placeStorageKey('org-a'));
  });

  it('round-trips a place, how it was chosen and the language', () => {
    const raw = serializeRememberedPlace({ place: CHENNAI, source: 'browser', language: 'en' });
    expect(readRememberedPlace(raw)).toEqual({ place: CHENNAI, source: 'browser', language: 'en' });
  });

  it('remembers Worldwide too', () => {
    const raw = serializeRememberedPlace({
      place: WORLDWIDE_PLACE,
      source: 'worldwide',
      language: 'en',
    });
    expect(readRememberedPlace(raw)?.place).toEqual(WORLDWIDE_PLACE);
  });

  it('stores no position and nothing it was not given', () => {
    const raw = serializeRememberedPlace({
      place: { ...CHENNAI, lat: 13.0827 } as unknown as Locality,
      source: 'browser',
      language: 'ta',
    });
    expect(raw).not.toContain('13.08');
    expect(raw).not.toContain('lat');
  });

  it('refuses anything that is not a choice it wrote', () => {
    expect(readRememberedPlace(null)).toBeNull();
    expect(readRememberedPlace('not json')).toBeNull();
    expect(readRememberedPlace('[]')).toBeNull();
    expect(readRememberedPlace(JSON.stringify({ v: 2, place: CHENNAI }))).toBeNull();
    const good = JSON.parse(
      serializeRememberedPlace({ place: CHENNAI, source: 'search', language: 'ta' }),
    );
    expect(readRememberedPlace(JSON.stringify({ ...good, source: 'admin' }))).toBeNull();
    expect(readRememberedPlace(JSON.stringify({ ...good, language: '<b>' }))).toBeNull();
    expect(
      readRememberedPlace(JSON.stringify({ ...good, place: { ...CHENNAI, languages: [] } })),
    ).toBeNull();
    expect(
      readRememberedPlace(JSON.stringify({ ...good, place: { ...CHENNAI, city: 42 } })),
    ).toBeNull();
  });

  it('corrects a language the place no longer offers', () => {
    const good = JSON.parse(
      serializeRememberedPlace({ place: CHENNAI, source: 'search', language: 'ta' }),
    );
    expect(readRememberedPlace(JSON.stringify({ ...good, language: 'fr' }))?.language).toBe('ta');
  });
});

describe('the page', () => {
  it('opens the tab in the address, or Trending', () => {
    expect(tabFrom('news')).toBe('news');
    expect(tabFrom('competitors')).toBe('competitors');
    expect(tabFrom('admin')).toBe('trending');
    expect(tabFrom(['news'])).toBe('trending');
    expect(tabFrom(undefined)).toBe('trending');
  });

  it('dates the copy by its oldest group', () => {
    expect(updatedText([group('2026-11-10T11:58:00Z'), group('2026-11-10T11:35:00Z')], NOW)).toBe(
      'Updated 25 min ago',
    );
    expect(updatedText([group('2026-11-10T11:59:50Z')], NOW)).toBe('Updated just now');
    expect(updatedText([], NOW)).toBeNull();
  });

  it('leaves Wikipedia out of the age: its copy is a whole day by design', () => {
    const wikipedia: DiscoverGroup = { ...group('2026-11-09T14:00:00Z'), id: 'wikipedia' };
    const social: DiscoverGroup = { ...group('2026-11-10T11:55:00Z'), id: 'social' };

    expect(updatedText([group('2026-11-10T11:35:00Z'), wikipedia, social], NOW)).toBe(
      'Updated 25 min ago',
    );
    expect(updatedText([wikipedia], NOW)).toBeNull();
  });

  it('gives the Festivals tab no age at all', () => {
    const festivals: DiscoverGroup = { ...group('2026-11-04T02:00:00Z'), id: 'festivals' };
    expect(updatedText([festivals], NOW)).toBeNull();
  });
});

describe('a card', () => {
  it('opens the real address, then the redirect, then the first related story', () => {
    expect(openHref(item({ url: 'https://a.example/x' }))).toBe('https://a.example/x');
    expect(openHref(item({ opaqueUrl: 'https://news.google.com/rss/articles/x' }))).toBe(
      'https://news.google.com/rss/articles/x',
    );
    expect(
      openHref(item({ related: [{ title: 't', url: 'https://b.example/', source: 'B' }] })),
    ).toBe('https://b.example/');
    expect(openHref(item())).toBeNull();
  });

  it('never makes a link of an address that is not the web', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
  });

  it('says how many searched for a trend, and who published a story', () => {
    const trend = item({
      signal: { label: '500+ searches' },
      publishedAt: '2026-11-10T10:00:00Z',
    });
    expect(itemMeta(trend, NOW)).toBe('500+ searches, 2 hours ago');
    const story = item({
      kind: 'news',
      source: { id: 'google-news', name: 'The Hindu' },
      publishedAt: '2026-11-10T11:30:00Z',
    });
    expect(itemMeta(story, NOW)).toBe('The Hindu, 30 min ago');
    expect(itemMeta(item(), NOW)).toBe('');
  });
});

describe('language names', () => {
  it('names a language in itself, then in English', () => {
    expect(languageLabel('ta')).toBe('தமிழ் Tamil');
    expect(languageLabel('es-419')).toBe('Español (Latinoamérica) Spanish (Latin America)');
  });

  it('says English once', () => {
    expect(languageLabel('en')).toBe('English');
  });

  it('falls back to the browser for a language the table does not have', () => {
    expect(languageName('sw').english).toBe('Swahili');
  });

  it('falls back to the code when nothing knows it', () => {
    expect(languageName('zzz').english).toBe('zzz');
  });
});

describe('drafts (Module 04)', () => {
  const related = [
    { title: 'Heavy rain alert', url: 'https://www.thehindu.com/rain', source: 'The Hindu' },
    { title: 'Bad link', url: 'javascript:alert(1)', source: 'Nobody' },
    { title: 'Same story again', url: 'https://www.thehindu.com/rain', source: 'The Hindu' },
    { title: '  Schools\nshut  ', url: 'https://www.dinamalar.com/schools', source: '' },
  ];

  it('writes from the API brief, on one line and within the limit', () => {
    expect(draftTopic(item({ brief: ' Rising search\nin Tamil Nadu ' }))).toBe(
      'Rising search in Tamil Nadu',
    );
    expect(draftTopic(item({ brief: 'a'.repeat(DRAFT_TOPIC_MAX + 50) }))).toHaveLength(
      DRAFT_TOPIC_MAX,
    );
    // A brief too short for the route falls back to the title.
    expect(draftTopic(item({ brief: ' ' }))).toBe('weather coimbatore');
  });

  it('backs a trend with its related headlines: web addresses only, each once', () => {
    expect(draftSources(item({ url: 'https://www.thehindu.com/rain', related }))).toEqual([
      { title: 'Heavy rain alert', url: 'https://www.thehindu.com/rain', snippet: 'The Hindu' },
      { title: 'Schools shut', url: 'https://www.dinamalar.com/schools', snippet: '' },
    ]);
  });

  it('backs a story with itself first', () => {
    const story = item({
      kind: 'news',
      title: 'சென்னையில் கனமழை',
      source: { id: 'google-news', name: 'Nakkheeran' },
      opaqueUrl: 'https://news.google.com/rss/articles/abc',
      related: related.slice(0, 1),
    });
    expect(draftSources(story)).toEqual([
      {
        title: 'சென்னையில் கனமழை',
        url: 'https://news.google.com/rss/articles/abc',
        snippet: 'Nakkheeran',
      },
      { title: 'Heavy rain alert', url: 'https://www.thehindu.com/rain', snippet: 'The Hindu' },
    ]);
  });

  it('keeps at most six sources, and none when there is nothing safe', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      title: `Story ${index}`,
      url: `https://example.com/${index}`,
      source: 'Example',
    }));
    expect(draftSources(item({ related: many }))).toHaveLength(DRAFT_SOURCES_MAX);
    expect(draftSources(item({ related: [related[1]] }))).toEqual([]);
    expect(draftSources(item())).toEqual([]);
  });

  it("offers the place's languages and English, with the chip's language when the place lacks it", () => {
    expect(draftLanguages(CHENNAI, 'ta')).toEqual(['ta', 'en']);
    expect(draftLanguages(INDIA, 'en')).toEqual(['hi', 'en', 'bn', 'ta']);
    expect(draftLanguages({ ...CHENNAI, languages: ['es'] }, 'es-419')).toEqual([
      'es-419',
      'es',
      'en',
    ]);
  });

  it('sends Draft In Copilot to the AI page with the brief as its topic', () => {
    expect(copilotHref('org-a', item({ brief: 'Rising search: "rain & schools"' }))).toBe(
      '/org-a/ai-copilot?topic=Rising%20search%3A%20%22rain%20%26%20schools%22',
    );
  });
});

describe('more sources (Module 05)', () => {
  it('backs a Wikipedia article and a video with themselves', () => {
    const article = item({
      kind: 'wiki',
      title: 'திருக்குறள்',
      source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
      url: 'https://ta.wikipedia.org/wiki/Thirukkural',
    });
    expect(draftSources(article)).toEqual([
      {
        title: 'திருக்குறள்',
        url: 'https://ta.wikipedia.org/wiki/Thirukkural',
        snippet: 'Wikipedia',
      },
    ]);

    const video = item({
      kind: 'video',
      title: 'Chennai rain, live',
      summary: 'Chennai Live',
      source: { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
      url: 'https://www.youtube.com/watch?v=abc123DEF_-',
    });
    expect(draftSources(video)).toEqual([
      {
        title: 'Chennai rain, live',
        url: 'https://www.youtube.com/watch?v=abc123DEF_-',
        snippet: 'YouTube',
      },
    ]);
  });

  it('gives a festival and a social topic no source of their own', () => {
    const festival = item({ kind: 'festival', title: 'Diwali/Deepavali', date: '2026-11-08' });
    expect(draftSources(festival)).toEqual([]);

    const topic = item({
      kind: 'social',
      title: '#MeerMittwoch',
      source: { id: 'mastodon', name: 'Mastodon' },
      url: 'https://mastodon.social/tags/MeerMittwoch',
    });
    expect(draftSources(topic)).toEqual([]);
  });

  it('never cites an article whose address is not the web', () => {
    const article = item({ kind: 'wiki', url: 'javascript:alert(1)' });
    expect(draftSources(article)).toEqual([]);
  });

  it('tells the two networks apart in a chip name, and says the link leaves', () => {
    const bluesky = item({
      kind: 'social',
      title: 'House speaker picks',
      source: { id: 'bluesky', name: 'Bluesky' },
      signal: { label: '4,625 posts', posts: 4625 },
    });
    expect(socialChipLabel(bluesky)).toBe(
      'House speaker picks on Bluesky, 4,625 posts, opens in a new tab',
    );

    const mastodon = item({
      kind: 'social',
      title: '#MeerMittwoch',
      source: { id: 'mastodon', name: 'Mastodon' },
    });
    expect(socialChipLabel(mastodon)).toBe('#MeerMittwoch on Mastodon, opens in a new tab');
  });

  it('says how many watched a video, and when it went up', () => {
    const video = item({
      kind: 'video',
      signal: { label: '1.2M views', views: 1_200_000 },
      publishedAt: '2026-11-07T12:00:00Z',
    });
    expect(itemMeta(video, NOW)).toBe('1.2M views, 3 days ago');
  });
});

function festival(date: string | undefined, title?: string, observance = true): DiscoverItem {
  const name = title ?? `Festival ${date}`;
  return item({
    id: `${date}|${name}`,
    kind: 'festival',
    source: { id: 'holidays', name: 'Google Calendar' },
    title: name,
    date,
    observance,
  });
}

/** The sections as they are shown: each name with its dates, in order. */
function layout(dates: string[], today: string): [string | null, (string | undefined)[]][] {
  return festivalSections(
    dates.map((date) => festival(date)),
    today,
  ).map((section) => [section.title, section.items.map((entry) => entry.date)]);
}

describe('festivals by week', () => {
  it('sorts a Tuesday into its sections, Monday to Sunday', () => {
    // 10 November 2026 is a Tuesday; its week ends on Sunday the 15th.
    const dates = [
      '2026-11-22',
      '2026-11-03',
      '2026-11-10',
      '2026-12-10',
      '2026-11-15',
      '2026-11-16',
      '2026-11-09',
      '2026-11-23',
      '2026-11-30',
      '2026-12-01',
      '2026-11-08',
    ];

    expect(layout(dates, '2026-11-10')).toEqual([
      ['This Week', ['2026-11-10', '2026-11-15']],
      ['Next Week', ['2026-11-16', '2026-11-22']],
      ['Later This Month', ['2026-11-23', '2026-11-30']],
      ['Next Month', ['2026-12-01', '2026-12-10']],
      ['Just Happened', ['2026-11-09', '2026-11-08', '2026-11-03']],
    ]);
  });

  it('ends This Week on the day itself when today is a Sunday', () => {
    const dates = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-22', '2026-11-23'];

    expect(layout(dates, '2026-11-15')).toEqual([
      ['This Week', ['2026-11-15']],
      ['Next Week', ['2026-11-16', '2026-11-22']],
      ['Later This Month', ['2026-11-23']],
      ['Just Happened', ['2026-11-14']],
    ]);
  });

  it('has no Later This Month on the last days of one', () => {
    // Saturday 28 November: the week ends on the 29th, the next on 6 December.
    const dates = [
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-06',
      '2026-12-07',
      '2026-12-25',
    ];
    expect(layout(dates, '2026-11-28')).toEqual([
      ['This Week', ['2026-11-28', '2026-11-29']],
      ['Next Week', ['2026-11-30', '2026-12-06']],
      ['Next Month', ['2026-12-07', '2026-12-25']],
    ]);

    // Monday 30 November: a whole week that is mostly December is still This Week.
    expect(layout(['2026-11-30', '2026-12-06', '2026-12-13', '2026-12-14'], '2026-11-30')).toEqual([
      ['This Week', ['2026-11-30', '2026-12-06']],
      ['Next Week', ['2026-12-13']],
      ['Next Month', ['2026-12-14']],
    ]);
  });

  it('carries a week across a year end', () => {
    // Tuesday 29 December 2026: the week ends on Sunday 3 January 2027.
    const dates = [
      '2026-12-25',
      '2026-12-31',
      '2027-01-01',
      '2027-01-03',
      '2027-01-04',
      '2027-01-10',
      '2027-01-15',
    ];

    expect(layout(dates, '2026-12-29')).toEqual([
      ['This Week', ['2026-12-31', '2027-01-01', '2027-01-03']],
      ['Next Week', ['2027-01-04', '2027-01-10']],
      ['Next Month', ['2027-01-15']],
      ['Just Happened', ['2026-12-25']],
    ]);
  });

  it('keeps the festivals of one date in the order the API gave them', () => {
    const items = [
      festival('2026-11-08', 'Diwali/Deepavali', false),
      festival('2026-11-08', 'Naraka Chaturdasi'),
      festival('2026-11-09', 'Govardhan Puja'),
      festival('2026-11-24', 'Guru Nanak Jayanti', false),
      festival('2026-11-24', "Guru Tegh Bahadur's Martyrdom Day"),
    ];
    const sections = festivalSections(items, '2026-11-10');

    expect(sections.map((section) => section.id)).toEqual(['later-this-month', 'just-happened']);
    expect(sections[0]?.items.map((entry) => entry.title)).toEqual([
      'Guru Nanak Jayanti',
      "Guru Tegh Bahadur's Martyrdom Day",
    ]);
    // Most recent date first; the two of the 8th stay as they came.
    expect(sections[1]?.items.map((entry) => entry.title)).toEqual([
      'Govardhan Puja',
      'Diwali/Deepavali',
      'Naraka Chaturdasi',
    ]);
  });

  it('drops a festival without a real date, and draws no empty section', () => {
    const items = [festival(undefined), festival('soon'), festival('2026-02-30')];
    expect(festivalSections(items, '2026-11-10')).toEqual([]);
    expect(festivalSections([], '2026-11-10')).toEqual([]);
  });

  it('is one unnamed list in date order when the answer has no usable today', () => {
    const items = [festival('2026-11-24'), festival('2026-11-08')];

    for (const today of [undefined, null, 'tomorrow', '2026-13-01']) {
      const sections = festivalSections(items, today);
      expect(sections).toHaveLength(1);
      expect(sections[0]?.id).toBe('all');
      expect(sections[0]?.title).toBeNull();
      expect(sections[0]?.items.map((entry) => entry.date)).toEqual(['2026-11-08', '2026-11-24']);
    }
  });
});

describe('a festival row', () => {
  it('marks a day off as a Public Holiday and anything else as an Observance', () => {
    expect(festivalBadge({ observance: false })).toEqual({
      label: 'Public Holiday',
      variant: 'success',
    });
    expect(festivalBadge({ observance: true })).toEqual({
      label: 'Observance',
      variant: 'secondary',
    });
    // Unsaid is not a claim of a day off.
    expect(festivalBadge({})).toEqual({ label: 'Observance', variant: 'secondary' });
  });

  it("says how far off it is from the answer's today, never from a clock", () => {
    const today = '2026-11-10';
    expect(festivalWhen('2026-11-10', today)).toBe('today');
    expect(festivalWhen('2026-11-11', today)).toBe('tomorrow');
    expect(festivalWhen('2026-11-15', today)).toBe('in 5 days');
    expect(festivalWhen('2026-12-10', today)).toBe('in 30 days');
    expect(festivalWhen('2026-11-09', today)).toBe('yesterday');
    expect(festivalWhen('2026-11-08', today)).toBe('2 days ago');
    expect(festivalWhen('2026-11-03', today)).toBe('7 days ago');
  });

  it('counts plain calendar days across a month, a year and a leap day', () => {
    expect(daysUntil('2026-12-01', '2026-11-30')).toBe(1);
    expect(festivalWhen('2027-01-01', '2026-12-31')).toBe('tomorrow');
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysUntil('2027-03-01', '2027-02-28')).toBe(1);
    expect(daysUntil('2026-11-03', '2026-11-10')).toBe(-7);
  });

  it('says nothing when either date is not one', () => {
    expect(daysUntil('soon', '2026-11-10')).toBeNull();
    expect(daysUntil('2026-11-10', undefined)).toBeNull();
    expect(festivalWhen('2026-02-30', '2026-11-10')).toBe('');
    expect(festivalWhen(undefined, '2026-11-10')).toBe('');
  });

  it('writes the date and its weekday', () => {
    expect(festivalDay('2026-11-08')).toEqual({ day: '8 Nov', weekday: 'Sunday' });
    expect(festivalDay('2026-09-01')).toEqual({ day: '1 Sep', weekday: 'Tuesday' });
    expect(festivalDay('2027-01-15')).toEqual({ day: '15 Jan', weekday: 'Friday' });
    expect(festivalDay('15 January')).toBeNull();
    expect(festivalDay(undefined)).toBeNull();
  });
});

describe('festivalPublishAt', () => {
  const holiday = (date: string) => ({ date, observance: false });
  const observance = (date: string) => ({ date, observance: true });
  const instant = (iso: string | null) => (iso ? new Date(iso).toISOString() : null);

  it('dates a public holiday for the evening before, on the place clock', () => {
    const diwali = festivalPublishAt(holiday('2026-11-08'), 'Asia/Kolkata');
    expect(diwali).toBe('2026-11-07T18:00:00+05:30');
    expect(instant(diwali)).toBe('2026-11-07T12:30:00.000Z');
  });

  it('dates an observance for that morning', () => {
    const bhaiDuj = festivalPublishAt(observance('2026-11-11'), 'Asia/Kolkata');
    expect(bhaiDuj).toBe('2026-11-11T10:00:00+05:30');
    expect(instant(bhaiDuj)).toBe('2026-11-11T04:30:00.000Z');
    // Unsaid reads as an observance: the day itself.
    expect(festivalPublishAt({ date: '2026-11-11' }, 'Asia/Kolkata')).toBe(
      '2026-11-11T10:00:00+05:30',
    );
  });

  it('is right on both sides of the November clock change in Los Angeles', () => {
    const zone = 'America/Los_Angeles';
    // Clocks go back at 02:00 on Sunday 1 November 2026.
    const before = festivalPublishAt(holiday('2026-11-01'), zone);
    expect(before).toBe('2026-10-31T18:00:00-07:00');
    expect(instant(before)).toBe('2026-11-01T01:00:00.000Z');

    const morningAfter = festivalPublishAt(observance('2026-11-01'), zone);
    expect(morningAfter).toBe('2026-11-01T10:00:00-08:00');
    expect(instant(morningAfter)).toBe('2026-11-01T18:00:00.000Z');

    expect(festivalPublishAt(holiday('2026-11-02'), zone)).toBe('2026-11-01T18:00:00-08:00');
    expect(festivalPublishAt(holiday('2026-11-11'), zone)).toBe('2026-11-10T18:00:00-08:00');
  });

  it('is right on both sides of the March clock change too', () => {
    const zone = 'America/Los_Angeles';
    // Clocks go forward at 02:00 on Sunday 8 March 2026.
    expect(festivalPublishAt(holiday('2026-03-08'), zone)).toBe('2026-03-07T18:00:00-08:00');
    expect(festivalPublishAt(observance('2026-03-08'), zone)).toBe('2026-03-08T10:00:00-07:00');
  });

  it('follows Paris through winter and summer', () => {
    const zone = 'Europe/Paris';
    expect(festivalPublishAt(holiday('2026-11-11'), zone)).toBe('2026-11-10T18:00:00+01:00');
    expect(festivalPublishAt(holiday('2026-07-14'), zone)).toBe('2026-07-13T18:00:00+02:00');
    // The mornings of the two change days, 29 March and 25 October 2026.
    expect(festivalPublishAt(observance('2026-03-29'), zone)).toBe('2026-03-29T10:00:00+02:00');
    expect(festivalPublishAt(observance('2026-10-25'), zone)).toBe('2026-10-25T10:00:00+01:00');
  });

  it('steps the day before back over a month, a year and a leap day', () => {
    const zone = 'Asia/Kolkata';
    expect(festivalPublishAt(holiday('2026-12-01'), zone)).toBe('2026-11-30T18:00:00+05:30');
    expect(festivalPublishAt(holiday('2027-01-01'), zone)).toBe('2026-12-31T18:00:00+05:30');
    expect(festivalPublishAt(holiday('2028-03-01'), zone)).toBe('2028-02-29T18:00:00+05:30');
  });

  it('writes a zone behind UTC by a half hour with its sign and minutes', () => {
    expect(festivalPublishAt(observance('2026-12-01'), 'America/St_Johns')).toBe(
      '2026-12-01T10:00:00-03:30',
    );
  });

  it("reads a place without a time zone on the viewer's clock, then on UTC", () => {
    const diwali = holiday('2026-11-08');
    expect(festivalPublishAt(diwali, null, 'Europe/Paris')).toBe('2026-11-07T18:00:00+01:00');
    expect(festivalPublishAt(diwali, undefined, 'Asia/Kolkata')).toBe('2026-11-07T18:00:00+05:30');
    // A zone this browser does not know is skipped, never thrown on.
    expect(festivalPublishAt(diwali, 'Mars/Olympus_Mons', 'Asia/Kolkata')).toBe(
      '2026-11-07T18:00:00+05:30',
    );
    expect(festivalPublishAt(diwali, null, 'Nowhere/At_All')).toBe('2026-11-07T18:00:00+00:00');
  });

  it('gives a festival that already happened its date all the same', () => {
    // The sheet decides what a past moment means (the next full hour).
    expect(festivalPublishAt(holiday('2021-01-26'), 'Asia/Kolkata')).toBe(
      '2021-01-25T18:00:00+05:30',
    );
  });

  it('has no date for a festival without a real one', () => {
    expect(festivalPublishAt({ observance: false }, 'Asia/Kolkata')).toBeNull();
    expect(festivalPublishAt(holiday('2026-02-30'), 'Asia/Kolkata')).toBeNull();
    expect(festivalPublishAt(holiday('8 November'), 'Asia/Kolkata')).toBeNull();
  });
});

/*
 * Module 06: what the workspace saved. Where a visit starts, what Save For
 * This Workspace sends, the popover's line, and the News topic.
 */

const PARIS: Locality = {
  countryCode: 'FR',
  countryName: 'France',
  regionCode: 'FR-IDF',
  regionName: 'Ile-de-France',
  city: 'Paris',
  timeZone: 'Europe/Paris',
  languages: ['fr', 'en'],
  newsLanguages: ['fr'],
};

function settings(patch: Partial<DiscoverSettings> = {}): DiscoverSettings {
  return {
    countryCode: 'IN',
    regionCode: 'IN-TN',
    regionName: 'Tamil Nadu',
    city: 'Chennai',
    timeZone: 'Asia/Kolkata',
    languages: ['ta', 'en'],
    topics: ['BUSINESS'],
    sources: null,
    locationSource: 'SEARCH',
    place: CHENNAI,
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...patch,
  };
}

const NOTHING_SAVED = settings({
  countryCode: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: [],
  topics: [],
  locationSource: 'NONE',
  place: null,
  updatedAt: null,
});

describe('where a visit starts', () => {
  it('starts from the workspace place, in its first language, when nothing is remembered', () => {
    expect(placeStart(null, settings())).toEqual({
      from: 'workspace',
      place: CHENNAI,
      language: 'ta',
    });
    expect(placeStart(null, settings({ languages: ['en', 'ta'] }))).toMatchObject({
      language: 'en',
    });
  });

  it("falls back to the place's first language when the workspace's is not offered", () => {
    expect(placeStart(null, settings({ place: PARIS, languages: ['ta', 'en'] }))).toEqual({
      from: 'workspace',
      place: PARIS,
      language: 'fr',
    });
    expect(placeStart(null, settings({ languages: [] }))).toMatchObject({ language: 'ta' });
  });

  it('starts from a saved Worldwide too', () => {
    expect(placeStart(null, settings({ place: WORLDWIDE_PLACE, languages: ['en'] }))).toEqual({
      from: 'workspace',
      place: WORLDWIDE_PLACE,
      language: 'en',
    });
  });

  it('guesses when nothing is remembered and nothing is saved', () => {
    expect(placeStart(null, NOTHING_SAVED)).toEqual({ from: 'guess' });
    expect(placeStart(null, null)).toEqual({ from: 'guess' });
  });

  it("lets the person's own place win on this device", () => {
    for (const source of ['browser', 'search'] as const) {
      expect(placeStart({ place: PARIS, source, language: 'fr' }, settings())).toEqual({
        from: 'remembered',
        place: PARIS,
        source,
        language: 'fr',
      });
    }
    expect(
      placeStart({ place: WORLDWIDE_PLACE, source: 'worldwide', language: 'en' }, settings()),
    ).toMatchObject({ from: 'remembered', source: 'worldwide' });
  });

  it('reads a remembered place as before when the workspace saved none', () => {
    const guess = { place: INDIA, source: 'guess', language: 'en' } as const;
    expect(placeStart(guess, NOTHING_SAVED)).toMatchObject({ from: 'remembered', source: 'guess' });
    expect(placeStart(guess, null)).toMatchObject({ from: 'remembered', place: INDIA });
  });

  it('gives a remembered guess up for the workspace place, keeping the switched language', () => {
    expect(placeStart({ place: INDIA, source: 'guess', language: 'en' }, settings())).toEqual({
      from: 'workspace',
      place: CHENNAI,
      language: 'en',
    });
    // Hindi is not a language of the workspace's place.
    expect(placeStart({ place: INDIA, source: 'guess', language: 'hi' }, settings())).toMatchObject(
      { from: 'workspace', language: 'ta' },
    );
  });

  it('follows the workspace place as it is saved now, not as it was remembered', () => {
    const followed = { place: CHENNAI, source: 'workspace', language: 'en' } as const;
    expect(placeStart(followed, settings({ place: PARIS, languages: ['fr'] }))).toEqual({
      from: 'workspace',
      place: PARIS,
      language: 'fr',
    });
    expect(placeStart(followed, settings())).toMatchObject({ place: CHENNAI, language: 'en' });
  });

  it('guesses again once a followed default was cleared, but trusts the record offline', () => {
    const followed = { place: CHENNAI, source: 'workspace', language: 'ta' } as const;
    expect(placeStart(followed, NOTHING_SAVED)).toEqual({ from: 'guess' });
    // The settings could not be read: the last known workspace place is better than a guess.
    expect(placeStart(followed, null)).toMatchObject({ from: 'remembered', source: 'workspace' });
  });
});

describe('saving a place for the workspace', () => {
  it('says how the place was found', () => {
    expect(locationSourceFor('browser')).toBe('BROWSER');
    expect(locationSourceFor('guess')).toBe('TIMEZONE');
    expect(locationSourceFor('search')).toBe('SEARCH');
    expect(locationSourceFor('workspace')).toBe('SEARCH');
    expect(locationSourceFor('worldwide')).toBe('SEARCH');
  });

  it('sends a place whole, and nothing that is not stored', () => {
    expect(placePatch(CHENNAI, 'BROWSER')).toEqual({
      countryCode: 'IN',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      locationSource: 'BROWSER',
    });
  });

  it('sends the fields a country has not got as null, so an old region never stays', () => {
    expect(placePatch(INDIA, 'TIMEZONE')).toEqual({
      countryCode: 'IN',
      regionCode: null,
      regionName: null,
      city: null,
      timeZone: 'Asia/Kolkata',
      locationSource: 'TIMEZONE',
    });
  });

  it('sends Worldwide and a cleared place as nulls, told apart by the source', () => {
    const empty = {
      countryCode: null,
      regionCode: null,
      regionName: null,
      city: null,
      timeZone: null,
    };
    expect(placePatch(WORLDWIDE_PLACE, 'SEARCH')).toEqual({ ...empty, locationSource: 'SEARCH' });
    expect(placePatch(null, 'NONE')).toEqual({ ...empty, locationSource: 'NONE' });
  });

  it("puts the chip's language first, each language once, six at most", () => {
    expect(workspaceLanguages(CHENNAI, 'en')).toEqual(['en', 'ta']);
    expect(workspaceLanguages(CHENNAI, 'ta')).toEqual(['ta', 'en']);
    expect(workspaceLanguages(CHENNAI)).toEqual(['ta', 'en']);

    const many = { ...INDIA, newsLanguages: ['hi', 'en', 'bn', 'ta', 'te', 'mr', 'gu', 'kn'] };
    const saved = workspaceLanguages(many, 'kn');
    expect(saved).toEqual(['kn', 'hi', 'en', 'bn', 'ta', 'te']);
    expect(saved).toHaveLength(MAX_WORKSPACE_LANGUAGES);
  });

  it('writes the line the popover shows', () => {
    expect(workspaceDefaultText(settings())).toBe('Workspace default: Chennai, Tamil Nadu');
    expect(workspaceDefaultText(settings({ place: INDIA }))).toBe('Workspace default: India');
    expect(workspaceDefaultText(settings({ place: WORLDWIDE_PLACE }))).toBe(
      'Workspace default: Worldwide',
    );
    expect(workspaceDefaultText(NOTHING_SAVED)).toBe(NO_WORKSPACE_DEFAULT);
    expect(NO_WORKSPACE_DEFAULT).toBe('No workspace default yet.');
    expect(ADMINS_ONLY_PLACE).toBe('Only workspace admins can change the workspace place.');
  });

  it('reads a switch as on unless it was turned off', () => {
    expect(switchedOff(settings({ sources: { videos: false } }), 'videos')).toBe(true);
    expect(switchedOff(settings({ sources: { videos: false } }), 'festivals')).toBe(false);
    expect(switchedOff(settings({ sources: { videos: true } }), 'videos')).toBe(false);
    expect(switchedOff(settings(), 'videos')).toBe(false);
    expect(switchedOff(null, 'videos')).toBe(false);
  });
});

describe('the News topic', () => {
  it('offers All, then the eight topics in the order Google lists them', () => {
    expect(TOPIC_CHOICES.map((choice) => TOPIC_NAMES[choice])).toEqual([
      'All',
      'World',
      'Nation',
      'Business',
      'Technology',
      'Entertainment',
      'Sports',
      'Science',
      'Health',
    ]);
  });

  it("reads the settings only once the cookie names the address's workspace", () => {
    expect(settingsInScope('org_b', 'org_b')).toBe(true);
    // A bookmark into another workspace: the API would still answer for org_a.
    expect(settingsInScope('org_b', 'org_a')).toBe(false);
    // Right after signing in to an account with two workspaces: no cookie yet.
    expect(settingsInScope('org_b', null)).toBe(false);
  });

  it("defaults to the workspace's first topic, or All", () => {
    expect(workspaceTopic(settings({ topics: ['SPORTS', 'BUSINESS'] }))).toBe('SPORTS');
    expect(workspaceTopic(settings({ topics: [] }))).toBeNull();
    expect(workspaceTopic(null)).toBeNull();
    // Whatever the API sent, only a real topic is ever asked for.
    expect(workspaceTopic(settings({ topics: ['GOSSIP'] as never }))).toBeNull();
  });

  it('remembers a topic with the place, and All as a choice of its own', () => {
    const raw = serializeRememberedPlace({
      place: CHENNAI,
      source: 'search',
      language: 'ta',
      topic: 'BUSINESS',
    });
    expect(JSON.parse(raw)).toMatchObject({ v: 1, topic: 'BUSINESS' });
    expect(readRememberedPlace(raw)?.topic).toBe('BUSINESS');

    const all = serializeRememberedPlace({
      place: CHENNAI,
      source: 'search',
      language: 'ta',
      topic: 'ALL',
    });
    expect(readRememberedPlace(all)?.topic).toBe('ALL');
  });

  it('still reads a record stored before topics existed', () => {
    const old = JSON.stringify({ v: 1, place: CHENNAI, source: 'browser', language: 'ta' });

    const read = readRememberedPlace(old);
    expect(read).toEqual({ place: CHENNAI, source: 'browser', language: 'ta' });
    expect(read).not.toHaveProperty('topic');
    // And writes none until one is picked.
    expect(
      JSON.parse(serializeRememberedPlace({ place: CHENNAI, source: 'browser', language: 'ta' })),
    ).not.toHaveProperty('topic');
  });

  it('drops a topic it does not know, and keeps the rest of the record', () => {
    const odd = JSON.stringify({
      v: 1,
      place: CHENNAI,
      source: 'browser',
      language: 'ta',
      topic: '<script>',
    });
    expect(readRememberedPlace(odd)).toEqual({ place: CHENNAI, source: 'browser', language: 'ta' });
    expect(isNewsTopic('BUSINESS')).toBe(true);
    expect(isNewsTopic('ALL')).toBe(false);
    expect(isNewsTopic(7)).toBe(false);
  });
});
