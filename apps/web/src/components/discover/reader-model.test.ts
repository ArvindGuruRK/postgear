/**
 * The reader's rules and words (Module 08): which address Read reads, which
 * competitor rows are pages worth reading, the line over an article (never a
 * middle dot), its paragraphs, and what Create Post From This hands the
 * Create Post sheet: the brief, the language, the item and what the draft
 * cites.
 */
import type { DiscoverItem, Locality, ReaderArticle } from '@/types/discover';
import {
  articleDay,
  competitorRowReads,
  DRAFT_TOPIC_MAX,
  draftSources,
  draftTopic,
  OUR_OWN_TAKE,
  READER_BRIEF_MAX,
  readerBrief,
  readerLanguage,
  readerMeta,
  readerParagraphs,
  readerPostTarget,
  readHref,
  readResolvesLink,
} from './discover-model';

const MIDDLE_DOT = String.fromCodePoint(0xb7);
const EM_DASH = String.fromCodePoint(0x2014);

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

function article(patch: Partial<ReaderArticle> = {}): ReaderArticle {
  return {
    url: 'https://news.google.com/rss/articles/abc',
    finalUrl: 'https://reader.example/articles/harbour-market',
    title: 'Harbour market reopens after two years of repairs',
    byline: 'A. Reporter',
    siteName: 'The Sample Courier',
    language: 'en-GB',
    excerpt: 'The old harbour market opened its gates again on Wednesday morning.',
    text: 'The old harbour market opened its gates again.\n\nSixty stalls have returned.',
    image: 'https://reader.example/images/harbour-market.jpg',
    publishedAt: '2026-11-04T06:30:00.000Z',
    wordCount: 424,
    readMinutes: 2,
    ...patch,
  };
}

const STORY: DiscoverItem = {
  id: 'n1',
  kind: 'news',
  source: { id: 'google-news', name: 'Nakkheeran' },
  title: 'Harbour market reopens',
  opaqueUrl: 'https://news.google.com/rss/articles/abc',
  language: 'ta',
  brief: 'News story in Chennai: "Harbour market reopens" (Nakkheeran).',
};

const TREND: DiscoverItem = {
  id: 't1',
  kind: 'trend',
  source: { id: 'google-trends', name: 'Google Trends' },
  title: 'harbour market',
  url: 'https://www.thehindu.example/harbour',
  related: [
    {
      title: 'Harbour market reopens',
      url: 'https://www.thehindu.example/harbour',
      source: 'The Hindu',
    },
    { title: 'Stalls return', url: 'https://other.example/stalls', source: 'Other' },
  ],
  brief: 'Rising search in Tamil Nadu: "harbour market".',
};

const BLOG_POST: DiscoverItem = {
  id: 'c1',
  kind: 'competitor',
  source: { id: 'rss', name: 'Acme Analytics Blog' },
  title: 'Five ways to cut churn',
  url: 'https://acme.example/blog/five-ways-to-cut-churn',
  brief: "Acme published: 'Five ways to cut churn'. Write our own take.",
};

describe('the address Read reads', () => {
  it("is the item's own, else Google's redirect, and never the first related story", () => {
    expect(readHref({ url: 'https://a.example/x', opaqueUrl: 'https://news.google.com/y' })).toBe(
      'https://a.example/x',
    );
    expect(readHref({ opaqueUrl: 'https://news.google.com/rss/articles/abc' })).toBe(
      'https://news.google.com/rss/articles/abc',
    );
    expect(readHref({})).toBeNull();
  });

  it('is never an address that is not the web', () => {
    expect(readHref({ url: 'javascript:alert(1)' })).toBeNull();
    expect(readHref({ url: 'data:text/html,x', opaqueUrl: 'ftp://files.example/a' })).toBeNull();
    // A bad address of its own does not hide a good redirect.
    expect(readHref({ url: 'javascript:alert(1)', opaqueUrl: 'https://news.google.com/z' })).toBe(
      'https://news.google.com/z',
    );
  });

  it('knows when a Google News link has to be opened first', () => {
    expect(readResolvesLink({ opaqueUrl: 'https://news.google.com/rss/articles/abc' })).toBe(true);
    expect(readResolvesLink({ url: 'https://a.example/x' })).toBe(false);
    expect(
      readResolvesLink({ url: 'https://a.example/x', opaqueUrl: 'https://news.google.com/y' }),
    ).toBe(false);
    expect(readResolvesLink({})).toBe(false);
  });
});

describe("a competitor's row that reads", () => {
  const row = (id: DiscoverItem['source']['id'], patch: Partial<DiscoverItem> = {}) => ({
    ...BLOG_POST,
    source: { id, name: 'A Source' },
    ...patch,
  });

  it('is a blog post or a story about them, with an address', () => {
    expect(competitorRowReads(row('rss'))).toBe(true);
    expect(
      competitorRowReads(
        row('google-news', { url: undefined, opaqueUrl: 'https://news.google.com/rss/articles/x' }),
      ),
    ).toBe(true);
  });

  it('is never a video or a social post, which are not articles', () => {
    for (const id of ['youtube', 'bluesky', 'mastodon'] as const) {
      expect(competitorRowReads(row(id))).toBe(false);
    }
  });

  it('is not a row with no web address', () => {
    expect(competitorRowReads(row('rss', { url: undefined }))).toBe(false);
    expect(competitorRowReads(row('rss', { url: 'javascript:alert(1)' }))).toBe(false);
  });
});

describe('the line over an article', () => {
  it('names the site, the writer, the day and the reading time, joined with commas', () => {
    expect(readerMeta(article(), 'UTC')).toBe(
      'The Sample Courier, by A. Reporter, 4 Nov 2026, 2 min read',
    );
  });

  it('never holds a middle dot or an em dash', () => {
    const line = readerMeta(article(), 'UTC');
    expect(line).not.toContain(MIDDLE_DOT);
    expect(line).not.toContain(EM_DASH);
  });

  it('leaves out what the page did not say', () => {
    expect(readerMeta(article({ byline: null, publishedAt: null }), 'UTC')).toBe(
      'The Sample Courier, 2 min read',
    );
    expect(readerMeta(article({ siteName: null, byline: '  ' }), 'UTC')).toBe(
      '4 Nov 2026, 2 min read',
    );
    expect(
      readerMeta(
        { siteName: null, byline: null, publishedAt: 'not a date', readMinutes: 0 },
        'UTC',
      ),
    ).toBe('');
  });

  it("reads the day in the viewer's own zone", () => {
    // 20:00 UTC on the 4th is already the 5th in Chennai.
    expect(articleDay('2026-11-04T20:00:00Z', 'Asia/Kolkata')).toBe('5 Nov 2026');
    expect(articleDay('2026-11-04T20:00:00Z', 'UTC')).toBe('4 Nov 2026');
  });

  it('falls back to the browser for a zone it does not know, and is empty for no date', () => {
    expect(articleDay('2026-11-04T12:00:00Z', 'Not/AZone')).toMatch(/Nov 2026$/);
    expect(articleDay(null)).toBe('');
    expect(articleDay('')).toBe('');
  });
});

describe("an article's paragraphs", () => {
  it('are split on blank lines, each on one line', () => {
    expect(readerParagraphs('One.\n\nTwo\nstill two.\n\n\n\nThree.')).toEqual([
      'One.',
      'Two still two.',
      'Three.',
    ]);
  });

  it('are none for an empty text', () => {
    expect(readerParagraphs('')).toEqual([]);
    expect(readerParagraphs(' \n\n \n')).toEqual([]);
  });

  it('take Windows line endings', () => {
    expect(readerParagraphs('One.\r\n\r\nTwo.')).toEqual(['One.', 'Two.']);
  });
});

describe('the brief built from an article', () => {
  it('is the title, the site in brackets, then the excerpt', () => {
    expect(readerBrief(article())).toBe(
      'Harbour market reopens after two years of repairs (The Sample Courier). The old harbour market opened its gates again on Wednesday morning.',
    );
  });

  it('has no bracket without a site name', () => {
    expect(readerBrief(article({ siteName: null }))).toBe(
      'Harbour market reopens after two years of repairs. The old harbour market opened its gates again on Wednesday morning.',
    );
    expect(readerBrief(article({ siteName: '   ' }))).not.toContain('(');
  });

  it('is on one line, whatever the page put in it', () => {
    const brief = readerBrief(article({ title: 'A\ntitle', excerpt: 'Line one.\n\nLine  two.' }));
    expect(brief).toBe('A title (The Sample Courier). Line one. Line two.');
  });

  it('is the excerpt alone when the page has no title', () => {
    expect(readerBrief(article({ title: ' ', siteName: null }))).toBe(
      'The old harbour market opened its gates again on Wednesday morning.',
    );
  });

  it(`is cut at ${READER_BRIEF_MAX} characters, by code point`, () => {
    const tamil = String.fromCodePoint(0x0ba4, 0x0bae, 0x0bbf, 0x0bb4, 0x0bcd);
    const brief = readerBrief(
      article({ siteName: null, title: 'T', excerpt: tamil.repeat(1_000) }),
    );

    expect(Array.from(brief)).toHaveLength(READER_BRIEF_MAX);
    expect(brief.startsWith(`T. ${tamil}`)).toBe(true);
    // The route takes it whole.
    expect(draftTopic({ ...STORY, brief })).toBe(brief);
  });

  it('never leaves half an emoji, and never more than the route counts as 2,000', () => {
    // An emoji is one code point and two of what the route counts.
    const emoji = String.fromCodePoint(0x1f327);
    const brief = readerBrief(
      article({ siteName: null, title: 'T', excerpt: emoji.repeat(3_000) }),
    );

    expect(brief.length).toBeLessThanOrEqual(DRAFT_TOPIC_MAX);
    expect(Array.from(brief).length).toBeLessThanOrEqual(READER_BRIEF_MAX);
    expect(Array.from(brief).every((point) => point === emoji || 'T. '.includes(point))).toBe(true);
    // `draftTopic` cuts by that second count: it has nothing left to cut, so no emoji is halved.
    expect(draftTopic({ ...STORY, brief })).toBe(brief);
  });

  it('leaves a short brief exactly as it is', () => {
    expect(readerBrief(article({ excerpt: 'Short.  ' }))).toBe(
      'Harbour market reopens after two years of repairs (The Sample Courier). Short.',
    );
  });
});

describe('the language a draft from an article starts in', () => {
  it("is the article's own when the place speaks it, in the place's spelling", () => {
    expect(readerLanguage(article({ language: 'en-GB' }), CHENNAI, 'ta')).toBe('en');
    expect(readerLanguage(article({ language: 'TA' }), CHENNAI, 'en')).toBe('ta');
    expect(readerLanguage(article({ language: 'es' }), { languages: ['es-419', 'en'] }, 'en')).toBe(
      'es-419',
    );
  });

  it("is the chip's when the place does not speak it, or the page does not say", () => {
    expect(readerLanguage(article({ language: 'fr' }), CHENNAI, 'ta')).toBe('ta');
    expect(readerLanguage(article({ language: null }), CHENNAI, 'ta')).toBe('ta');
  });
});

describe('what Create Post From This hands over', () => {
  it("keeps a story the story, with the article's brief and the publisher's address", () => {
    const post = readerPostTarget(article(), STORY, CHENNAI, 'ta');

    expect(post.place).toBe(CHENNAI);
    // The article is English, and Chennai speaks English.
    expect(post.language).toBe('en');
    expect(post.item).toEqual({
      ...STORY,
      url: 'https://reader.example/articles/harbour-market',
      brief: readerBrief(article()),
    });
    // The draft cites the publisher, not Google's redirect.
    expect(draftSources(post.item)).toEqual([
      {
        title: 'Harbour market reopens',
        url: 'https://reader.example/articles/harbour-market',
        snippet: 'Nakkheeran',
      },
    ]);
  });

  it('keeps an address the item already had', () => {
    const own = { ...STORY, url: 'https://nakkheeran.example/story', opaqueUrl: undefined };
    const post = readerPostTarget(article(), own, CHENNAI, 'ta');

    expect(post.item.url).toBe('https://nakkheeran.example/story');
  });

  it('leaves a trend as it is when its related headlines already hold the article', () => {
    const read = article({ finalUrl: 'https://www.thehindu.example/harbour' });
    const post = readerPostTarget(read, TREND, CHENNAI, 'ta');

    expect(post.item.related).toEqual(TREND.related);
    expect(draftSources(post.item).map((source) => source.url)).toEqual([
      'https://www.thehindu.example/harbour',
      'https://other.example/stalls',
    ]);
  });

  it("puts the article first among a competitor post's sources, which had none", () => {
    const read = article({
      finalUrl: 'https://acme.example/blog/five-ways-to-cut-churn/',
      title: 'Five ways to cut churn',
      siteName: 'Acme Analytics',
    });
    expect(draftSources(BLOG_POST)).toEqual([]);

    const post = readerPostTarget(read, BLOG_POST, CHENNAI, 'ta');

    expect(post.item.kind).toBe('competitor');
    expect(post.item.url).toBe(BLOG_POST.url);
    expect(draftSources(post.item)).toEqual([
      {
        title: 'Five ways to cut churn',
        url: 'https://acme.example/blog/five-ways-to-cut-churn/',
        snippet: 'Acme Analytics',
      },
    ]);
  });

  it("still asks for our own take when the article is a competitor's, in front where no cut reaches it", () => {
    const read = article({
      title: 'Five ways to cut churn',
      siteName: 'Acme Analytics',
      excerpt: 'Churn is rarely one big reason.',
    });

    const post = readerPostTarget(read, BLOG_POST, CHENNAI, 'ta');

    expect(post.item.brief).toBe(
      `${OUR_OWN_TAKE} Five ways to cut churn (Acme Analytics). Churn is rarely one big reason.`,
    );

    // The longest article there can be: the sentence is whole and the topic fits the route.
    const long = readerPostTarget(
      article({ title: 'T', siteName: null, excerpt: String.fromCodePoint(0x1f600).repeat(3_000) }),
      BLOG_POST,
      CHENNAI,
      'ta',
    );
    expect(long.item.brief.startsWith(`${OUR_OWN_TAKE} T. `)).toBe(true);
    expect(long.item.brief.length).toBeLessThanOrEqual(DRAFT_TOPIC_MAX);
    expect(Array.from(long.item.brief).length).toBeLessThanOrEqual(READER_BRIEF_MAX);
    expect(draftTopic(long.item)).toBe(long.item.brief);

    // A trend's or a story's brief carries no such sentence.
    expect(readerPostTarget(read, TREND, CHENNAI, 'ta').item.brief).not.toContain(OUR_OWN_TAKE);
  });

  it('makes a story of a pasted page, named after the site', () => {
    const read = article({ url: 'https://reader.example/a', language: 'fr' });
    const post = readerPostTarget(read, null, CHENNAI, 'ta');

    expect(post.language).toBe('ta');
    expect(post.item).toEqual({
      id: 'read:https://reader.example/articles/harbour-market',
      kind: 'news',
      source: {
        id: 'rss',
        name: 'The Sample Courier',
        url: 'https://reader.example/articles/harbour-market',
      },
      title: 'Harbour market reopens after two years of repairs',
      url: 'https://reader.example/articles/harbour-market',
      summary: 'The old harbour market opened its gates again on Wednesday morning.',
      publishedAt: '2026-11-04T06:30:00.000Z',
      language: 'fr',
      brief: readerBrief(read),
    });
    expect(draftSources(post.item)).toEqual([
      {
        title: 'Harbour market reopens after two years of repairs',
        url: 'https://reader.example/articles/harbour-market',
        snippet: 'The Sample Courier',
      },
    ]);
  });

  it('names a pasted page after its host when the page names no site', () => {
    const read = article({
      siteName: null,
      publishedAt: null,
      language: null,
      finalUrl: 'https://www.reader.example/articles/x',
    });
    const { item } = readerPostTarget(read, null, CHENNAI, 'ta');

    expect(item.source.name).toBe('reader.example');
    expect(item).not.toHaveProperty('publishedAt');
    expect(item).not.toHaveProperty('language');
  });
});
