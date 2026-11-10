import type { SourceItem } from '../types';
import { composeFeed, GROUP_CAPS, itemId, NEWS_MAX_AGE_MS } from './compose';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function news(title: string, overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    kind: 'news',
    source: { id: 'google-news', name: 'The Paper' },
    title,
    opaqueUrl: `https://news.google.com/rss/articles/${encodeURIComponent(title)}`,
    publishedAt: hoursAgo(1),
    ...overrides,
  };
}

function trend(title: string, rank: number): SourceItem {
  return {
    kind: 'trend',
    source: { id: 'google-trends', name: 'Google Trends' },
    title,
    url: `https://paper.example/${encodeURIComponent(title)}`,
    signal: { label: '200+ searches', rank },
  };
}

const titles = (group: { items: { title: string }[] }) => group.items.map((item) => item.title);

describe('composeFeed', () => {
  it('keeps groups in the order given, with their ids', () => {
    const groups = composeFeed(
      [
        { id: 'rising', items: [trend('a', 1)] },
        { id: 'city', items: [news('b')] },
      ],
      { now: NOW },
    );
    expect(groups.map((group) => group.id)).toEqual(['rising', 'city']);
  });

  it('orders trends by rank and stories newest first', () => {
    const [rising, city] = composeFeed(
      [
        { id: 'rising', items: [trend('third', 3), trend('first', 1), trend('second', 2)] },
        {
          id: 'city',
          items: [
            news('old', { publishedAt: hoursAgo(9) }),
            news('new', { publishedAt: hoursAgo(1) }),
            news('middle', { publishedAt: hoursAgo(5) }),
          ],
        },
      ],
      { now: NOW },
    );
    expect(titles(rising)).toEqual(['first', 'second', 'third']);
    expect(titles(city)).toEqual(['new', 'middle', 'old']);
  });

  it('puts an undated story last, and keeps it', () => {
    const [city] = composeFeed(
      [{ id: 'city', items: [news('undated', { publishedAt: undefined }), news('dated')] }],
      { now: NOW },
    );
    expect(titles(city)).toEqual(['dated', 'undated']);
  });

  it('drops a story older than 48 hours, and only stories', () => {
    const old = hoursAgo(49);
    const [city, rising] = composeFeed(
      [
        {
          id: 'city',
          items: [
            news('fresh', { publishedAt: hoursAgo(47) }),
            news('stale', { publishedAt: old }),
          ],
        },
        { id: 'rising', items: [{ ...trend('old trend', 1), publishedAt: old }] },
      ],
      { now: NOW },
    );
    expect(titles(city)).toEqual(['fresh']);
    expect(titles(rising)).toEqual(['old trend']);
  });

  it('lets simulation switch the age limit off', () => {
    const [city] = composeFeed(
      [{ id: 'city', items: [news('ancient', { publishedAt: '2020-01-01T00:00:00.000Z' })] }],
      { now: NOW, maxNewsAgeMs: null },
    );
    expect(titles(city)).toEqual(['ancient']);
  });

  it('has a 48 hour default', () => {
    expect(NEWS_MAX_AGE_MS).toBe(48 * 3_600_000);
  });

  it('removes a story repeated within a group and across groups: the first group keeps it', () => {
    const [city, top] = composeFeed(
      [
        { id: 'city', items: [news('Rain in Chennai'), news('RAIN in chennai!')] },
        { id: 'top', items: [news('rain, in   Chennai'), news('Other')] },
      ],
      { now: NOW },
    );
    expect(titles(city)).toEqual(['Rain in Chennai']);
    expect(titles(top)).toEqual(['Other']);
  });

  it('tells apart Tamil titles that differ only by a vowel sign', () => {
    const [city] = composeFeed([{ id: 'city', items: [news('கல்'), news('கால்')] }], { now: NOW });
    expect(titles(city)).toEqual(['கல்', 'கால்']);
  });

  it('drops an item with nothing readable in its title', () => {
    const [city] = composeFeed([{ id: 'city', items: [news('...'), news('Real')] }], { now: NOW });
    expect(titles(city)).toEqual(['Real']);
  });

  it('caps each group at 10 trends and 20 stories', () => {
    const [rising, city] = composeFeed(
      [
        {
          id: 'rising',
          items: Array.from({ length: 15 }, (_, index) => trend(`t${index}`, index + 1)),
        },
        { id: 'city', items: Array.from({ length: 30 }, (_, index) => news(`n${index}`)) },
      ],
      { now: NOW },
    );
    expect(rising.items).toHaveLength(GROUP_CAPS.trend as number);
    expect(city.items).toHaveLength(GROUP_CAPS.news as number);
  });

  it('does not let duplicates use up the room, or a capped story hide from the next group', () => {
    const many = Array.from({ length: 25 }, (_, index) => news(`story ${index}`));
    const [city, top] = composeFeed(
      [
        { id: 'city', items: [news('story 0'), ...many] },
        { id: 'top', items: [many[24]] },
      ],
      { now: NOW },
    );
    expect(city.items).toHaveLength(20);
    expect(titles(top)).toEqual(['story 24']);
  });

  it('gives an item the same id every time, and different items different ids', () => {
    const items = [news('one'), news('two')];
    const first = composeFeed([{ id: 'city', items }], { now: NOW })[0].items;
    const second = composeFeed([{ id: 'city', items: [...items].reverse() }], { now: NOW })[0]
      .items;

    const byTitle = (title: string, list: typeof first) =>
      list.find((item) => item.title === title)?.id;
    expect(byTitle('one', first)).toBe(byTitle('one', second));
    expect(byTitle('one', first)).not.toBe(byTitle('two', first));
  });

  it('builds the id from the address, then the redirect, then the title', () => {
    const [group] = composeFeed(
      [
        {
          id: 'mixed',
          items: [
            {
              ...news('a'),
              kind: 'wiki',
              url: 'https://a.example',
              opaqueUrl: 'https://b.example',
            },
            { ...news('b'), kind: 'wiki', opaqueUrl: 'https://b.example' },
            { ...news('c'), kind: 'wiki', opaqueUrl: undefined },
          ],
        },
      ],
      { now: NOW },
    );
    expect(group.items.map((item) => item.id)).toEqual([
      itemId('google-news', 'https://a.example'),
      itemId('google-news', 'https://b.example'),
      itemId('google-news', 'c'),
    ]);
  });

  it('adds no brief: that is built per request, never cached', () => {
    const [city] = composeFeed([{ id: 'city', items: [news('one')] }], { now: NOW });
    expect(city.items[0]).not.toHaveProperty('brief');
  });

  it('does not change what it was given', () => {
    const items = [
      news('b', { publishedAt: hoursAgo(5) }),
      news('a', { publishedAt: hoursAgo(1) }),
    ];
    composeFeed([{ id: 'city', items }], { now: NOW });
    expect(titles({ items })).toEqual(['b', 'a']);
  });
});
