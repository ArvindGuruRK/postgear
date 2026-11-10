/**
 * Discover's words and choices: what the chips say, which language a place
 * starts in, what is remembered (and what is refused when read back), and how
 * old the page says its copy is.
 */
import type { DiscoverGroup, DiscoverItem, Locality } from '@/types/discover';
import {
  copilotHref,
  DRAFT_SOURCES_MAX,
  DRAFT_TOPIC_MAX,
  draftLanguages,
  draftSources,
  draftTopic,
  firstLanguage,
  isWorldwide,
  itemMeta,
  languageFor,
  openHref,
  placeChipText,
  placeInSentence,
  placeResultText,
  placeShortText,
  placeStorageKey,
  readRememberedPlace,
  safeHref,
  serializeRememberedPlace,
  tabFrom,
  updatedText,
  WORLDWIDE_PLACE,
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
