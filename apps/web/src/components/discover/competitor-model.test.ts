/**
 * The competitor dialog's rules and words (Module 07): how a website's feeds
 * merge into the list, the cap of five ticked feeds, what a pasted address
 * becomes, which field is wrong before anything is sent, and the body a save
 * sends. Plus the display helpers a competitor's group reads.
 */
import type { Competitor, DiscoveredFeed } from '@/types/discover';
import {
  addPastedFeed,
  BLUESKY_HINT,
  type CompetitorForm,
  competitorInput,
  competitorPatch,
  FEED_NOT_AN_ADDRESS,
  FEED_REPEATED,
  FEEDS_FULL,
  type FeedChoice,
  feedAddress,
  feedChoiceLabel,
  feedChoiceShowsAddress,
  formFrom,
  formProblems,
  INSTAGRAM_SHAPE,
  instagramName,
  isNewSince,
  MASTODON_HINT,
  mergeFoundFeeds,
  NAME_NEEDED,
  NEWS_LENGTH,
  newCountText,
  newItemCount,
  newsPhrase,
  researchBasedOn,
  researchIdea,
  toggleFeed,
  WEBSITE_HINT,
  websiteAddress,
  YOUTUBE_HINT,
} from './competitor-model';
import {
  competitorGroupTitle,
  competitorKind,
  competitorKindLabel,
  competitorSources,
  competitorWhen,
} from './discover-model';

const BLOG: DiscoveredFeed = {
  url: 'https://acme.example/blog/rss.xml',
  title: 'Blog',
  kind: 'rss',
};
const CHANGELOG: DiscoveredFeed = {
  url: 'https://acme.example/changelog/atom.xml',
  title: 'Changelog',
  kind: 'atom',
};

const ACME: Competitor = {
  id: 'c1',
  name: 'Acme Analytics',
  websiteUrl: 'https://acme.example/',
  feedUrls: [BLOG.url],
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  newsQuery: null,
  instagramUsername: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
};

function form(patch: Partial<CompetitorForm> = {}): CompetitorForm {
  return { ...formFrom(null), name: 'Acme', ...patch };
}

function choice(index: number, checked = true): FeedChoice {
  return { url: `https://acme.example/feed-${index}.xml`, title: '', kind: null, checked };
}

describe('feed choices', () => {
  it('reads as the name and the kind, or the address when the feed has no name', () => {
    expect(feedChoiceLabel({ ...BLOG })).toBe('Blog, RSS');
    expect(feedChoiceLabel({ ...CHANGELOG })).toBe('Changelog, Atom');
    expect(feedChoiceLabel({ ...BLOG, title: ' ' })).toBe('https://acme.example/blog/rss.xml, RSS');
    expect(feedChoiceLabel({ url: BLOG.url, title: '', kind: null })).toBe(BLOG.url);
  });

  it('shows the address on a second line only when the first is not it', () => {
    expect(feedChoiceShowsAddress({ title: 'Blog' })).toBe(true);
    expect(feedChoiceShowsAddress({ title: '' })).toBe(false);
  });

  it('adds found feeds ticked, and names a saved feed the site names', () => {
    const saved = formFrom(ACME).feeds;
    const merged = mergeFoundFeeds(saved, [BLOG, CHANGELOG]);

    expect(merged).toEqual([
      { url: BLOG.url, title: 'Blog', kind: 'rss', checked: true },
      { url: CHANGELOG.url, title: 'Changelog', kind: 'atom', checked: true },
    ]);
    // The list handed in is not changed.
    expect(saved).toEqual([{ url: BLOG.url, title: '', kind: null, checked: true }]);
  });

  it('keeps an unticked feed unticked when it is found again', () => {
    const merged = mergeFoundFeeds([{ ...BLOG, checked: false }], [BLOG]);
    expect(merged).toEqual([{ ...BLOG, checked: false }]);
  });

  it('lists a sixth found feed without ticking it', () => {
    const five = [0, 1, 2, 3, 4].map((index) => choice(index));
    const merged = mergeFoundFeeds(five, [BLOG]);

    expect(merged).toHaveLength(6);
    expect(merged[5]).toEqual({ ...BLOG, checked: false });
  });

  it('refuses a sixth tick and allows an untick', () => {
    const six = [...[0, 1, 2, 3, 4].map((index) => choice(index)), choice(5, false)];

    expect(toggleFeed(six, choice(5).url, true)).toEqual({ ok: false, problem: FEEDS_FULL });

    const unticked = toggleFeed(six, choice(0).url, false);
    expect(unticked.ok && unticked.feeds[0].checked).toBe(false);
  });
});

describe('a pasted feed', () => {
  it('becomes a web address, with https put in front of a bare one', () => {
    expect(feedAddress(' https://acme.example/feed ')).toBe('https://acme.example/feed');
    expect(feedAddress('acme.example/rss.xml')).toBe('https://acme.example/rss.xml');
    expect(feedAddress('http://acme.example/rss.xml')).toBe('http://acme.example/rss.xml');
  });

  it.each(['', '   ', 'javascript:alert(1)', 'ftp://acme.example/feed', 'two words', 'nodots'])(
    'is not an address: %p',
    (text) => {
      expect(feedAddress(text)).toBeNull();
    },
  );

  it('is added ticked', () => {
    expect(addPastedFeed([], 'acme.example/rss.xml')).toEqual({
      ok: true,
      feeds: [{ url: 'https://acme.example/rss.xml', title: '', kind: null, checked: true }],
    });
  });

  it('is refused when it is not an address, is already there, or five are ticked', () => {
    expect(addPastedFeed([], 'not an address')).toEqual({
      ok: false,
      problem: FEED_NOT_AN_ADDRESS,
    });
    expect(addPastedFeed([{ ...BLOG, checked: false }], BLOG.url)).toEqual({
      ok: false,
      problem: FEED_REPEATED,
    });
    expect(
      addPastedFeed(
        [0, 1, 2, 3, 4].map((index) => choice(index)),
        'https://acme.example/sixth.xml',
      ),
    ).toEqual({ ok: false, problem: FEEDS_FULL });
  });
});

describe('the form', () => {
  it('starts blank for a new competitor', () => {
    expect(formFrom(null)).toEqual({
      name: '',
      website: '',
      feeds: [],
      youtube: '',
      instagram: '',
      bluesky: '',
      mastodon: '',
      news: '',
      newsEdited: false,
    });
  });

  it('starts from the saved values, its feeds ticked', () => {
    expect(formFrom(ACME)).toEqual({
      name: 'Acme Analytics',
      website: 'https://acme.example/',
      feeds: [{ url: BLOG.url, title: '', kind: null, checked: true }],
      youtube: 'UCacmeSampleChannel00000',
      instagram: '',
      bluesky: 'acme.example',
      mastodon: 'acme@mastodon.example',
      news: '',
      newsEdited: false,
    });
    expect(formFrom({ ...ACME, newsQuery: 'Acme funding' })).toMatchObject({
      news: 'Acme funding',
      newsEdited: true,
    });
  });

  it('shows the name as the search phrase until the person writes their own', () => {
    expect(newsPhrase(form({ name: 'Acme Analytics' }))).toBe('Acme Analytics');
    expect(newsPhrase(form({ news: 'Acme funding', newsEdited: true }))).toBe('Acme funding');
    expect(newsPhrase(form({ news: '', newsEdited: true }))).toBe('');
  });

  it('has nothing wrong with a name alone', () => {
    expect(formProblems(form())).toEqual({});
  });

  it('says which field is wrong', () => {
    expect(
      formProblems(
        form({
          name: '  ',
          youtube: 'acme',
          bluesky: 'acme',
          mastodon: 'acme',
          news: 'x',
          newsEdited: true,
        }),
      ),
    ).toEqual({
      name: NAME_NEEDED,
      youtube: YOUTUBE_HINT,
      bluesky: BLUESKY_HINT,
      mastodon: MASTODON_HINT,
      news: NEWS_LENGTH,
    });
  });

  it('takes handles pasted with their at sign', () => {
    expect(
      formProblems(
        form({
          youtube: 'UCacmeSampleChannel00000',
          bluesky: '@acme.bsky.social',
          mastodon: '@acme@mastodon.social',
        }),
      ),
    ).toEqual({});
  });

  it('sends every optional field as its value or null, and only the ticked feeds', () => {
    expect(
      competitorInput(
        form({
          name: ' Acme Analytics ',
          website: ' acme.example ',
          feeds: [
            { ...BLOG, checked: true },
            { ...CHANGELOG, checked: false },
          ],
          youtube: ' UCacmeSampleChannel00000 ',
          bluesky: '@Acme.Example',
          mastodon: '@acme@mastodon.example',
          news: 'Acme funding',
          newsEdited: true,
        }),
      ),
    ).toEqual({
      name: 'Acme Analytics',
      websiteUrl: 'acme.example',
      feedUrls: [BLOG.url],
      youtubeChannelId: 'UCacmeSampleChannel00000',
      blueskyHandle: 'acme.example',
      mastodonAcct: 'acme@mastodon.example',
      newsQuery: 'Acme funding',
      instagramUsername: null,
    });
  });

  it('sends nulls for what was left empty', () => {
    expect(competitorInput(form())).toEqual({
      name: 'Acme',
      websiteUrl: null,
      feedUrls: [],
      youtubeChannelId: null,
      blueskyHandle: null,
      mastodonAcct: null,
      newsQuery: null,
      instagramUsername: null,
    });
  });

  it('reads an Instagram username the way the API does, and sends the bare name', () => {
    for (const typed of ['@Acme.Sample', 'acme.sample', 'https://www.instagram.com/acme.sample/']) {
      expect(instagramName(typed)).toBe('acme.sample');
    }
    for (const typed of [
      'acme..sample',
      '.acme',
      'acme.',
      'a'.repeat(31),
      'acme sample',
      'https://www.instagram.com/p/ABC123/',
      'https://example.com/acme',
    ]) {
      expect(instagramName(typed)).toBeNull();
    }
    expect(formProblems(form({ instagram: 'acme..sample' }))).toEqual({
      instagram: INSTAGRAM_SHAPE,
    });
    expect(competitorInput(form({ instagram: ' @Acme_1 ' })).instagramUsername).toBe('acme_1');
    expect(
      competitorPatch(
        { ...formFrom(ACME), instagram: 'acme' },
        { ...ACME, instagramUsername: null },
      ),
    ).toEqual({ instagramUsername: 'acme' });
    expect(
      competitorPatch(formFrom({ ...ACME, instagramUsername: 'acme' }), {
        ...ACME,
        instagramUsername: 'acme',
      }),
    ).toEqual({});
  });

  it('sends no search phrase when it is the name, or was cleared', () => {
    expect(competitorInput(form({ news: 'Acme', newsEdited: true })).newsQuery).toBeNull();
    expect(competitorInput(form({ news: '  ', newsEdited: true })).newsQuery).toBeNull();
  });
});

describe("a competitor's group", () => {
  it('names its rows by where they were read', () => {
    const of = (id: string) => ({ source: { id, name: 'x' } }) as never;

    expect(
      ['rss', 'youtube', 'instagram', 'bluesky', 'mastodon', 'google-news'].map((id) =>
        competitorKindLabel(of(id)),
      ),
    ).toEqual(['Blog', 'YouTube', 'Instagram', 'Bluesky', 'Mastodon', 'News']);
    expect(competitorKind(of('google-news'))).toBe('news');
    // A source nobody expected still gets a tag.
    expect(competitorKindLabel(of('wikipedia'))).toBe('Blog');
  });

  it('is titled with the name as typed', () => {
    expect(competitorGroupTitle('acme analytics')).toBe('Latest From acme analytics');
  });

  it('says where its rows come from, Google News always among them', () => {
    expect(competitorSources(ACME)).toBe(
      'From their feeds, YouTube, Bluesky, Mastodon and Google News.',
    );
    expect(competitorSources({ ...ACME, instagramUsername: 'acme' })).toBe(
      'From their feeds, YouTube, Instagram, Bluesky, Mastodon and Google News.',
    );
    expect(
      competitorSources({
        ...ACME,
        youtubeChannelId: null,
        blueskyHandle: null,
        mastodonAcct: null,
      }),
    ).toBe('From their feeds and Google News.');
    expect(
      competitorSources({
        feedUrls: [],
        youtubeChannelId: null,
        blueskyHandle: null,
        mastodonAcct: null,
      }),
    ).toBe('From Google News.');
  });

  it('says when an item was published, or nothing without a date', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(competitorWhen({ publishedAt: '2026-11-10T10:00:00Z' }, now)).toBe('2 hours ago');
    expect(competitorWhen({}, now)).toBe('');
  });
});

describe('new since you last looked', () => {
  const SEEN = '2026-11-10T09:00:00.000Z';
  const rows = [
    { publishedAt: '2026-11-10T10:00:00Z' },
    { publishedAt: '2026-11-10T09:30:00Z' },
    { publishedAt: '2026-11-10T08:00:00Z' },
    {},
  ];

  it('marks only rows published after the last look, and none on the first look', () => {
    expect(rows.map((row) => isNewSince(row, SEEN))).toEqual([true, true, false, false]);
    expect(newItemCount(rows, SEEN)).toBe(2);
    expect(newItemCount(rows, null)).toBe(0);
    expect(newItemCount(rows, undefined)).toBe(0);
    expect(isNewSince({ publishedAt: 'not a date' }, SEEN)).toBe(false);
    expect(newCountText(3)).toBe('3 New');
  });
});

describe('research this competitor', () => {
  it('says what it read and when, and turns an opening into a Create Post target', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(researchBasedOn({ basedOn: 8, createdAt: '2026-11-10T10:00:00Z' }, now)).toBe(
      'Based on 8 posts, written 2 hours ago.',
    );
    expect(researchBasedOn({ basedOn: 1, createdAt: '2026-11-10T11:59:50Z' }, now)).toBe(
      'Based on 1 post, written just now.',
    );
    expect(researchIdea(ACME, 'Open on a churn number.', 2)).toEqual({
      id: 'research-c1-2',
      kind: 'competitor',
      source: { id: 'rss', name: 'Acme Analytics' },
      title: 'Open on a churn number.',
      brief: 'Idea from researching Acme Analytics: Open on a churn number.',
    });
  });
});

describe('the website field', () => {
  it('reads an address with or without a scheme, and a local one too', () => {
    expect(websiteAddress('acme.example')).toBe('https://acme.example/');
    expect(websiteAddress(' http://acme.example/about ')).toBe('http://acme.example/about');
    // Where it leads is the API's to judge, in its own sentence.
    expect(websiteAddress('localhost:3000')).toBe('https://localhost:3000/');
    expect(websiteAddress('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  });

  it('is not an address with a space in it, with another scheme, or empty', () => {
    for (const text of ['acme analytics.com', 'ftp://acme.example', '', '   ', 'http://']) {
      expect(websiteAddress(text)).toBeNull();
    }
  });

  it('is named when it is not an address, and left alone when empty', () => {
    expect(formProblems(form({ website: 'acme analytics.com' }))).toEqual({
      website: WEBSITE_HINT,
    });
    expect(formProblems(form({ website: '' }))).toEqual({});
    expect(formProblems(form({ website: 'acme.example' }))).toEqual({});
  });
});

describe('a handle the API would refuse', () => {
  it('is refused here first: a host name ends in letters', () => {
    for (const bluesky of [
      'acme.bsky.social1',
      'acme',
      '-acme.example',
      'acme..example',
      '10.0.0.5',
    ]) {
      expect(formProblems(form({ bluesky }))).toEqual({ bluesky: BLUESKY_HINT });
    }
    for (const mastodon of [
      'acme@mastodon.social1',
      'acme@localhost',
      'acme@10.0.0.5',
      'ac me@a.example',
    ]) {
      expect(formProblems(form({ mastodon }))).toEqual({ mastodon: MASTODON_HINT });
    }
  });

  it('passes the ones the API takes', () => {
    expect(
      formProblems(form({ bluesky: 'Acme.BSKY.social', mastodon: 'acme_1@social.acme.example' })),
    ).toEqual({});
  });
});

describe('what an edit sends', () => {
  it('is nothing when nothing changed', () => {
    expect(competitorPatch(formFrom(ACME), ACME)).toEqual({});
  });

  it('is only the fields that differ from what is saved', () => {
    const start = formFrom(ACME);

    expect(competitorPatch({ ...start, name: 'Acme Corp' }, ACME)).toEqual({ name: 'Acme Corp' });
    expect(competitorPatch({ ...start, bluesky: '' }, ACME)).toEqual({ blueskyHandle: null });
    expect(competitorPatch({ ...start, youtube: '' }, ACME)).toEqual({ youtubeChannelId: null });
    expect(competitorPatch({ ...start, mastodon: 'acme@other.example' }, ACME)).toEqual({
      mastodonAcct: 'acme@other.example',
    });
    expect(competitorPatch({ ...start, website: 'acme.example/about' }, ACME)).toEqual({
      websiteUrl: 'acme.example/about',
    });
  });

  it('sends the whole feed list when a feed is unticked or added, and not when it is the same', () => {
    const start = formFrom(ACME);
    const unticked = { ...start, feeds: start.feeds.map((feed) => ({ ...feed, checked: false })) };
    const added = { ...start, feeds: [...start.feeds, choice(9)] };

    expect(competitorPatch(unticked, ACME)).toEqual({ feedUrls: [] });
    expect(competitorPatch(added, ACME)).toEqual({ feedUrls: [BLOG.url, choice(9).url] });
  });

  it('sends a search phrase of their own, and null to follow the name again', () => {
    const start = formFrom(ACME);
    const own = { ...start, news: 'Acme funding', newsEdited: true };

    expect(competitorPatch(own, ACME)).toEqual({ newsQuery: 'Acme funding' });
    expect(competitorPatch({ ...own, news: '' }, { ...ACME, newsQuery: 'Acme funding' })).toEqual({
      newsQuery: null,
    });
    // Renamed while following the name: the phrase stays null, so it follows the new name.
    expect(competitorPatch({ ...start, name: 'Acme Corp' }, ACME)).not.toHaveProperty('newsQuery');
  });
});
