import { editionFor } from '../geo/editions';
import { buildLocality, WORLDWIDE } from '../geo/locality';
import type { DiscoverFetch, DiscoverFetchResponse, SourceInput } from '../types';
import {
  createGoogleNewsSource,
  isNewsTopic,
  NEWS_TOPICS,
  newsPlaceUrl,
  newsTopicUrl,
  newsTopUrl,
  parseRelated,
  stripPublisher,
} from './google-news';

const LINK = 'https://news.google.com/rss/articles/CBMiA?oc=5';
const OTHER_LINK = 'https://news.google.com/rss/articles/CBMiB?oc=5';

const li = (href: string, title: string, source: string) =>
  `<li><a href="${href}" target="_blank">${title}</a>&nbsp;&nbsp;<font color="#6f6f6f">${source}</font></li>`;

function xmlEscape(html: string): string {
  return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function story(options: {
  title?: string;
  link?: string;
  source?: string;
  sourceUrl?: string;
  description?: string;
}): string {
  const {
    title = 'சென்னையில் மழை - Hindu Tamil',
    link = LINK,
    source = 'Hindu Tamil',
    sourceUrl = 'https://www.hindutamil.in',
    description = '',
  } = options;
  return `<item><title>${title}</title><link>${link}</link><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate><description>${xmlEscape(description)}</description><source url="${sourceUrl}">${source}</source></item>`;
}

function feed(...items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>${items.join('')}</channel></rss>`;
}

function sourceAnswering(response: Partial<DiscoverFetchResponse> | Error) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return { fetchMock, source: createGoogleNewsSource({ fetch: fetchMock }) };
}

const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
const inTamil: SourceInput = { locality: chennai, language: 'ta' };

describe('stripPublisher', () => {
  it('takes off the publisher when it really is the tail', () => {
    expect(stripPublisher('Rain in Chennai - The Hindu', 'The Hindu')).toBe('Rain in Chennai');
  });

  it('leaves a title that merely has a dash', () => {
    expect(stripPublisher('Rain - not just a drizzle', 'The Hindu')).toBe(
      'Rain - not just a drizzle',
    );
    expect(stripPublisher('Rain - The Hindu', '')).toBe('Rain - The Hindu');
  });

  it('never strips a title down to nothing', () => {
    expect(stripPublisher(' - The Hindu', 'The Hindu')).toBe(' - The Hindu');
  });
});

describe('parseRelated', () => {
  it('reads the list in the description', () => {
    const description = `<ol>${li(LINK, 'One &amp; only', 'The Hindu')}${li(OTHER_LINK, 'Two', 'BBC')}</ol>`;
    expect(parseRelated(description)).toEqual([
      { title: 'One & only', url: LINK, source: 'The Hindu' },
      { title: 'Two', url: OTHER_LINK, source: 'BBC' },
    ]);
  });

  it('reads a single story with no list around it', () => {
    expect(
      parseRelated(`<a href="${LINK}">Only</a>&nbsp;<font color="#6f6f6f">BBC</font>`),
    ).toEqual([{ title: 'Only', url: LINK, source: 'BBC' }]);
  });

  it('keeps a story with no publisher', () => {
    expect(parseRelated(`<a href="${LINK}">Only</a>`)).toEqual([
      { title: 'Only', url: LINK, source: '' },
    ]);
  });

  it('drops a link that is not a web address', () => {
    const description = `${li('javascript:alert(1)', 'Evil', 'X')}${li(LINK, 'Good', 'BBC')}`;
    expect(parseRelated(description)).toEqual([{ title: 'Good', url: LINK, source: 'BBC' }]);
  });

  it('is empty for nothing to read', () => {
    expect(parseRelated(undefined)).toEqual([]);
    expect(parseRelated('')).toEqual([]);
    expect(parseRelated('just some text')).toEqual([]);
  });
});

describe('the News mapping', () => {
  it('maps a story: opaque link kept, no real address, Tamil preserved', async () => {
    const { source } = sourceAnswering({ body: feed(story({})) });
    const { items, attribution, failed } = await source.place(inTamil);

    expect(items).toEqual([
      {
        kind: 'news',
        source: { id: 'google-news', name: 'Hindu Tamil', url: 'https://www.hindutamil.in/' },
        title: 'சென்னையில் மழை',
        opaqueUrl: LINK,
        publishedAt: '2026-11-04T10:00:00.000Z',
        language: 'ta',
        related: [],
      },
    ]);
    expect(items[0].url).toBeUndefined();
    expect(items[0].summary).toBeUndefined();
    expect(attribution).toEqual({ name: 'Google News', url: 'https://news.google.com' });
    expect(failed).toBeUndefined();
  });

  it('leaves the story itself out of its own related list', async () => {
    const description = `<ol>${li(LINK, 'சென்னையில் மழை', 'Hindu Tamil')}${li(OTHER_LINK, 'Two', 'BBC')}</ol>`;
    const { source } = sourceAnswering({ body: feed(story({ description })) });
    const [item] = (await source.place(inTamil)).items;

    expect(item.related).toEqual([{ title: 'Two', url: OTHER_LINK, source: 'BBC' }]);
  });

  it('leaves out the same story under another link too', async () => {
    const description = li(OTHER_LINK, 'சென்னையில் மழை - Hindu Tamil', 'Hindu Tamil');
    const { source } = sourceAnswering({ body: feed(story({ description })) });
    expect((await source.place(inTamil)).items[0].related).toEqual([]);
  });

  it('keeps at most five related stories', async () => {
    const description = [1, 2, 3, 4, 5, 6, 7]
      .map((n) => li(`https://news.google.com/rss/articles/${n}`, `Story ${n}`, 'BBC'))
      .join('');
    const { source } = sourceAnswering({ body: feed(story({ description })) });
    expect((await source.place(inTamil)).items[0].related).toHaveLength(5);
  });

  it('strips HTML out of a title', async () => {
    const { source } = sourceAnswering({
      body: feed(story({ title: '&lt;b&gt;Bold&lt;/b&gt; move - Hindu Tamil' })),
    });
    expect((await source.place(inTamil)).items[0].title).toBe('Bold move');
  });

  it('skips a story with no title or no usable link', async () => {
    const { source } = sourceAnswering({
      body: feed(story({ title: '' }), story({ link: 'javascript:alert(1)' }), story({})),
    });
    expect((await source.place(inTamil)).items).toHaveLength(1);
  });

  it('credits Google News when a story names no publisher', async () => {
    const { source } = sourceAnswering({
      body: feed(`<item><title>Bare</title><link>${LINK}</link></item>`),
    });
    expect((await source.place(inTamil)).items[0].source).toEqual({
      id: 'google-news',
      name: 'Google News',
      url: undefined,
    });
  });

  it('does not pass on a publisher address that is not a web address', async () => {
    const { source } = sourceAnswering({
      body: feed(story({ sourceUrl: 'javascript:alert(1)' })),
    });
    expect((await source.place(inTamil)).items[0].source.url).toBeUndefined();
  });
});

describe('the three feeds', () => {
  const locale = editionFor('IN', 'ta');

  it('builds the addresses research verified', () => {
    expect(newsTopUrl(locale)).toBe('https://news.google.com/rss?hl=ta&gl=IN&ceid=IN:ta');
    expect(newsPlaceUrl('Chennai', editionFor('IN', 'en'))).toBe(
      'https://news.google.com/rss/headlines/section/geo/Chennai?hl=en-IN&gl=IN&ceid=IN:en',
    );
    expect(newsTopicUrl('TECHNOLOGY', editionFor('IN', 'en'))).toBe(
      'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en',
    );
  });

  it('encodes a city, so a name cannot steer the address', () => {
    expect(newsPlaceUrl('San Francisco', editionFor('US', 'en'))).toContain(
      '/geo/San%20Francisco?',
    );
    expect(newsPlaceUrl('../topic/WORLD?x=1#', locale)).toContain(
      '/geo/..%2Ftopic%2FWORLD%3Fx%3D1%23?',
    );
  });

  it('asks each feed in the edition the input names', async () => {
    const { fetchMock, source } = sourceAnswering({ body: feed() });

    await source.place(inTamil);
    await source.top(inTamil);
    await source.topic(inTamil, 'SPORTS');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      newsPlaceUrl('Chennai', locale),
      newsTopUrl(locale),
      newsTopicUrl('SPORTS', locale),
    ]);
  });

  it('asks nobody for a place feed without a city', async () => {
    const { fetchMock, source } = sourceAnswering({ body: feed() });
    const result = await source.place({ locality: { ...WORLDWIDE }, language: 'en' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });

  it('reads Worldwide from the US English edition', async () => {
    const { fetchMock, source } = sourceAnswering({ body: feed() });
    await source.topic({ locality: { ...WORLDWIDE }, language: 'en' }, 'WORLD');
    expect(fetchMock.mock.calls[0][0]).toContain('ceid=US:en');
  });

  it('is honest when the language asked for has no edition', async () => {
    const { source } = sourceAnswering({ body: feed(story({})) });
    const result = await source.top({ locality: chennai, language: 'kok' });

    expect(result.warnings[0]).toContain('kok');
    expect(result.items[0].language).toBe('en');
  });

  it('picks the narrowest feed through the shared interface', async () => {
    const { fetchMock, source } = sourceAnswering({ body: feed() });

    await source.fetch({ ...inTamil, topic: 'HEALTH' });
    await source.fetch(inTamil);
    await source.fetch({ locality: buildLocality({ countryCode: 'IN' }), language: 'ta' });
    await source.fetch({ ...inTamil, topic: 'NOT_A_TOPIC' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      newsTopicUrl('HEALTH', locale),
      newsPlaceUrl('Chennai', locale),
      newsTopUrl(locale),
      newsPlaceUrl('Chennai', locale),
    ]);
  });
});

describe('failures', () => {
  it('is empty with no failure for an empty feed', async () => {
    const { source } = sourceAnswering({ body: feed() });
    const result = await source.top(inTamil);
    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
  });

  it('reports trouble for a 429, a 5xx and a dropped connection, and never throws', async () => {
    for (const response of [{ status: 429 }, { status: 500 }, new Error('socket hang up')]) {
      const result = await sourceAnswering(response).source.top(inTamil);
      expect(result).toMatchObject({ items: [], failed: 'upstream' });
    }
  });

  it('reports not found for a place Google does not know', async () => {
    const result = await sourceAnswering({ status: 404 }).source.place(inTamil);
    expect(result).toMatchObject({ items: [], failed: 'not_found' });
  });
});

describe('topics', () => {
  it('knows the eight topics, and nothing else', () => {
    expect(NEWS_TOPICS).toHaveLength(8);
    expect(isNewsTopic('WORLD')).toBe(true);
    expect(isNewsTopic('world')).toBe(false);
    expect(isNewsTopic('../geo/Chennai')).toBe(false);
  });
});
