/**
 * Where Read is offered, and what it starts (Module 08): on a trend and a
 * story that have a page of their own, never on a video, a Wikipedia row or a
 * social chip, never for an address that is not the web; on a competitor's
 * blog post and on a story about them, not on their videos or social posts;
 * Read A Page on the News tab only. Then the page end to end: Read, the
 * article, Create Post From This, and the Create Post sheet on the article.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, AiStatus } from '@/types/ai';
import type { Channel } from '@/types/channel';
import type {
  Competitor,
  DiscoverGroup as Group,
  DiscoverItem,
  DiscoverStatus,
  DiscoverTab,
  FeedKind,
  FeedResponse,
  Locality,
  ReaderArticle,
} from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { StoryCard, TrendCard, VideoCard } from './discover-cards';
import { DiscoverGroup } from './discover-group';
import { placeStorageKey, serializeRememberedPlace } from './discover-model';
import { DiscoverPage } from './discover-page';
import { DiscoverView, type DiscoverViewProps } from './discover-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('@/lib/sse', () => ({ streamEvents: jest.fn() }));

jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'Asia/Kolkata' }));

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedStream = streamEvents as jest.MockedFunction<typeof streamEvents>;

beforeAll(stubBrowserLayout);
jest.setTimeout(20_000);

const NOW = new Date('2026-11-10T12:00:00Z');

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

const STATUS: DiscoverStatus = {
  simulation: true,
  geocoder: 'nominatim',
  sources: {
    trends: true,
    news: true,
    wikipedia: true,
    videos: true,
    holidays: true,
    social: true,
  },
};

const TREND: DiscoverItem = {
  id: 't1',
  kind: 'trend',
  source: { id: 'google-trends', name: 'Google Trends' },
  title: 'weather coimbatore',
  url: 'https://www.thehindu.example/rain',
  signal: { label: '500+ searches', traffic: 500 },
  related: [
    { title: 'Heavy rain alert', url: 'https://www.thehindu.example/rain', source: 'The Hindu' },
  ],
  brief: 'Rising search in Tamil Nadu: "weather coimbatore".',
};

const STORY: DiscoverItem = {
  id: 'n1',
  kind: 'news',
  source: { id: 'google-news', name: 'Nakkheeran' },
  title: 'A story behind a Google link',
  opaqueUrl: 'https://news.google.com/rss/articles/abc',
  language: 'ta',
  brief: 'News story in Chennai.',
};

const VIDEO: DiscoverItem = {
  id: 'v1',
  kind: 'video',
  source: { id: 'youtube', name: 'YouTube' },
  title: 'A popular video',
  summary: 'A Channel',
  url: 'https://www.youtube.com/watch?v=SAMPLE',
  brief: 'Trending video in India.',
};

const WIKI: DiscoverItem = {
  id: 'w1',
  kind: 'wiki',
  source: { id: 'wikipedia', name: 'Wikipedia' },
  title: 'Thirukkural',
  url: 'https://ta.wikipedia.org/wiki/Thirukkural',
  signal: { label: '1,627 reads', rank: 1, views: 1627 },
  brief: 'Widely read on Tamil Wikipedia.',
};

const CHIP: DiscoverItem = {
  id: 's1',
  kind: 'social',
  source: { id: 'bluesky', name: 'Bluesky' },
  title: 'House speaker picks',
  url: 'https://bsky.app/profile/trending/feed/1',
  brief: 'Trending worldwide on Bluesky.',
};

const ARTICLE: ReaderArticle = {
  url: 'https://www.thehindu.example/rain',
  finalUrl: 'https://www.thehindu.example/rain',
  title: 'Heavy rain alert for Coimbatore',
  byline: 'A. Reporter',
  siteName: 'The Sample Courier',
  language: 'ta',
  excerpt: 'Schools are closed for the day.',
  text: 'Schools are closed for the day.\n\nMore rain is expected.',
  image: null,
  publishedAt: '2026-11-04T06:30:00.000Z',
  wordCount: 420,
  readMinutes: 3,
};

function group(id: Group['id'], items: DiscoverItem[]): Group {
  return {
    id,
    title: 'A Group',
    subtitle: 'Via a source.',
    attribution: { name: 'A source' },
    stale: false,
    fetchedAt: NOW.toISOString(),
    items,
  };
}

function feed(kind: FeedKind, groups: Group[]): FeedResponse {
  return { kind, language: 'ta', locality: CHENNAI, groups, unavailable: [] };
}

/** The names of what a card offers, in the order it offers them. */
function actionsOf(card: HTMLElement): string[] {
  return [...card.querySelectorAll('button, a[target="_blank"]')]
    .map((element) => element.textContent?.trim() ?? '')
    .filter((name) => ['Create Post', 'Read', 'Open'].includes(name));
}

describe('Read on a card', () => {
  it('sits between Create Post and Open on a trend, and hands back the item', () => {
    const onRead = jest.fn();
    render(<TrendCard item={TREND} now={NOW} onCreatePost={jest.fn()} onRead={onRead} />);

    const card = screen.getByRole('article', { name: 'weather coimbatore' });
    expect(actionsOf(card)).toEqual(['Create Post', 'Read', 'Open']);

    fireEvent.click(within(card).getByRole('button', { name: 'Read' }));
    expect(onRead).toHaveBeenCalledWith(TREND);
  });

  it("is on a story that only has Google's link, which the API opens", () => {
    render(<StoryCard item={STORY} now={NOW} onRead={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument();
  });

  it('is not there without a reader to open', () => {
    render(<TrendCard item={TREND} now={NOW} onCreatePost={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });

  it('is not there for an item with no page of its own, though Open may still go somewhere', () => {
    render(<TrendCard item={{ ...TREND, url: undefined }} now={NOW} onRead={jest.fn()} />);

    // Open falls back to the first related story; Read does not read a different page.
    expect(screen.getByRole('link', { name: /^Open/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });

  it('is never there for an address that is not the web', () => {
    render(
      <StoryCard
        item={{ ...STORY, url: 'javascript:alert(1)', opaqueUrl: 'data:text/html,x' }}
        now={NOW}
        onRead={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });

  it('is never on a video, whose page is not an article', () => {
    render(<VideoCard item={VIDEO} now={NOW} onRead={jest.fn()} onCreatePost={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Create Post' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });

  it('is on the cards of a group, and never on its Wikipedia rows or social chips', () => {
    const onRead = jest.fn();
    const { rerender } = render(
      <DiscoverGroup group={group('trends', [TREND])} now={NOW} onRead={onRead} />,
    );
    expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument();

    rerender(<DiscoverGroup group={group('wikipedia', [WIKI])} now={NOW} onRead={onRead} />);
    expect(screen.getByTestId('discover-wiki-row')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();

    rerender(<DiscoverGroup group={group('social', [CHIP])} now={NOW} onRead={onRead} />);
    expect(screen.getByTestId('discover-social-chip')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();

    rerender(<DiscoverGroup group={group('videos', [VIDEO])} now={NOW} onRead={onRead} />);
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });
});

function remember() {
  window.localStorage.setItem(
    placeStorageKey('org-a'),
    serializeRememberedPlace({ place: CHENNAI, source: 'browser', language: 'ta' }),
  );
}

function renderView(initialTab: DiscoverTab, props: Partial<DiscoverViewProps> = {}) {
  return render(
    <TooltipProvider>
      <DiscoverView
        orgId="org-a"
        status={STATUS}
        initialTab={initialTab}
        settings={null}
        isAdmin={false}
        {...props}
      />
    </TooltipProvider>,
  );
}

const ACME: Competitor = {
  id: 'c1',
  name: 'Acme',
  websiteUrl: 'https://acme.example/',
  feedUrls: ['https://acme.example/blog/rss.xml'],
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  newsQuery: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
};

function competitorRow(
  id: string,
  source: DiscoverItem['source']['id'],
  title: string,
  patch: Partial<DiscoverItem> = {},
): DiscoverItem {
  return {
    id,
    kind: 'competitor',
    source: { id: source, name: 'A Source' },
    title,
    url: `https://rows.example/${id}`,
    publishedAt: '2026-11-09T09:00:00Z',
    brief: `Acme published: '${title}'.`,
    ...patch,
  };
}

const ROWS: DiscoverItem[] = [
  competitorRow('r1', 'rss', 'A blog post'),
  competitorRow('r2', 'youtube', 'A video'),
  competitorRow('r3', 'bluesky', 'A Bluesky post'),
  competitorRow('r4', 'mastodon', 'A Mastodon post'),
  competitorRow('r5', 'google-news', 'A story about them', {
    url: undefined,
    opaqueUrl: 'https://news.google.com/rss/articles/xyz',
  }),
];

describe('Read on the page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedApi.mockReset();
    window.history.replaceState(null, '', '/org-a/discover');
    remember();
  });

  it('hands a card over with the place and language it was read in', async () => {
    mockedApi.mockResolvedValue(feed('trending', [group('trends', [TREND])]));
    const onRead = jest.fn();
    renderView('trending', { onRead });

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    fireEvent.click(within(card).getByRole('button', { name: 'Read' }));

    expect(onRead).toHaveBeenCalledWith({
      target: { mode: 'item', item: TREND },
      place: CHENNAI,
      language: 'ta',
    });
  });

  it('offers no Read at all without a reader', async () => {
    mockedApi.mockResolvedValue(feed('news', [group('place', [STORY])]));
    renderView('news', { onCreatePost: jest.fn() });

    await screen.findByRole('article', { name: 'A story behind a Google link' });
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read A Page' })).not.toBeInTheDocument();
  });

  it('has Read A Page on the News tab, beside the topic, and it opens the address field', async () => {
    mockedApi.mockResolvedValue(feed('news', [group('place', [STORY])]));
    const onRead = jest.fn();
    renderView('news', { onRead });

    const button = await screen.findByRole('button', { name: 'Read A Page' });
    expect(screen.getByTestId('discover-topic-select')).toBeInTheDocument();
    fireEvent.click(button);

    expect(onRead).toHaveBeenCalledWith({
      target: { mode: 'page' },
      place: CHENNAI,
      language: 'ta',
    });
  });

  it.each(['trending', 'videos', 'festivals', 'competitors'] as const)(
    'has no Read A Page on the %s tab',
    async (tab) => {
      mockedApi.mockImplementation(async (path: string) =>
        path === '/discover/competitors'
          ? { competitors: [], limit: 20 }
          : feed(tab === 'competitors' ? 'trending' : tab, []),
      );
      renderView(tab, { onRead: jest.fn() });

      await waitFor(() => expect(mockedApi).toHaveBeenCalled());
      await act(async () => undefined);
      expect(screen.queryByRole('button', { name: 'Read A Page' })).not.toBeInTheDocument();
    },
  );

  it("offers Read on a competitor's blog post and on a story about them, and on nothing else of theirs", async () => {
    mockedApi.mockImplementation(async (path: string) =>
      path === '/discover/competitors'
        ? { competitors: [ACME], limit: 20 }
        : {
            items: ROWS,
            unavailable: [],
            notes: [],
            fetchedAt: NOW.toISOString(),
            stale: false,
            pending: false,
          },
    );
    const onRead = jest.fn();
    renderView('competitors', { onRead, onCreatePost: jest.fn() });

    await screen.findByText('A blog post');
    const rows = screen.getAllByTestId('discover-competitor-row');
    const reads = rows.map((row) => within(row).queryByRole('button', { name: 'Read' }) !== null);
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual([
      'blog',
      'youtube',
      'bluesky',
      'mastodon',
      'news',
    ]);
    expect(reads).toEqual([true, false, false, false, true]);

    fireEvent.click(within(rows[4]).getByRole('button', { name: 'Read' }));
    expect(onRead).toHaveBeenCalledWith({
      target: { mode: 'item', item: ROWS[4] },
      place: CHENNAI,
      language: 'ta',
    });
  });

  it("offers no Read on a competitor's rows without a reader", async () => {
    mockedApi.mockImplementation(async (path: string) =>
      path === '/discover/competitors'
        ? { competitors: [ACME], limit: 20 }
        : {
            items: ROWS,
            unavailable: [],
            notes: [],
            fetchedAt: NOW.toISOString(),
            stale: false,
            pending: false,
          },
    );
    renderView('competitors', { onCreatePost: jest.fn() });

    await screen.findByText('A blog post');
    expect(screen.queryByRole('button', { name: 'Read' })).not.toBeInTheDocument();
  });
});

const CHANNEL = {
  id: 'ch_li',
  name: 'Acme on LinkedIn',
  providerIdentifier: 'linkedin',
  providerName: 'LinkedIn',
  picture: null,
  health: 'connected',
  color: 0,
} as unknown as Channel;

const AI_STATUS: AiStatus = {
  configured: true,
  mode: 'simulation',
  model: 'simulation',
  research: true,
  images: true,
};

const CREDITS: AiCredits = {
  allowance: 50,
  used: 6,
  remaining: 44,
  resetsAt: '2026-12-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: {
    generate_post: 5,
    generate_image: 10,
    copilot_message: 1,
    seo_advice: 3,
    generate_snippet: 2,
  },
};

describe('DiscoverPage, from Read to a draft', () => {
  /** What was asked of `/discover/read`, as the bodies sent. */
  const reads: unknown[] = [];

  function answer(groups: Group[], kind: FeedKind, article: ReaderArticle | Error) {
    mockedApi.mockImplementation((path: string, options?: { body?: unknown }) => {
      if (path.startsWith('/discover/feed')) return Promise.resolve(feed(kind, groups));
      if (path === '/discover/read') {
        reads.push(options?.body);
        return article instanceof Error ? Promise.reject(article) : Promise.resolve({ article });
      }
      if (path === '/channels') return Promise.resolve({ channels: [CHANNEL] });
      if (path === '/channels/providers') return Promise.resolve({ providers: [] });
      if (path === '/ai/status') return Promise.resolve({ status: AI_STATUS });
      if (path === '/ai/credits') return Promise.resolve({ credits: CREDITS });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  }

  function renderPage(initialTab: DiscoverTab) {
    return render(
      <TooltipProvider>
        <DiscoverPage
          orgId="org-a"
          status={STATUS}
          initialTab={initialTab}
          settings={null}
          isAdmin={false}
        />
      </TooltipProvider>,
    );
  }

  beforeEach(() => {
    reads.length = 0;
    window.localStorage.clear();
    remember();
    mockedApi.mockReset();
    mockedStream.mockReset();
    // A run that stays open: these tests look at what was asked, not at the draft.
    mockedStream.mockImplementation(() => new Promise<void>(() => undefined));
    window.history.replaceState(null, '', '/org-a/discover');
  });

  it('reads a trend, then drafts from the article with the article as its source', async () => {
    answer([group('trends', [TREND])], 'trending', ARTICLE);
    renderPage('trending');

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    fireEvent.click(within(card).getByRole('button', { name: 'Read' }));

    const reader = await screen.findByTestId('reader-sheet');
    expect(await within(reader).findByTestId('reader-text')).toHaveTextContent(
      'Schools are closed for the day.',
    );
    expect(reads).toEqual([{ url: 'https://www.thehindu.example/rain' }]);

    fireEvent.click(within(reader).getByRole('button', { name: 'Create Post From This' }));

    // One sheet at a time: the reader is gone, and Create Post is on the article.
    const sheet = await screen.findByTestId('create-post-sheet');
    await waitFor(() => expect(screen.queryByTestId('reader-sheet')).not.toBeInTheDocument());
    const brief =
      'Heavy rain alert for Coimbatore (The Sample Courier). Schools are closed for the day.';
    expect(await within(sheet).findByTestId('create-post-brief')).toHaveTextContent(brief);

    const draft = await within(sheet).findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(draft);
    });

    expect(mockedStream.mock.calls[0][1]).toEqual({
      topic: brief,
      tone: 'personal',
      format: 'one_short',
      withImage: false,
      channelIds: ['ch_li'],
      // The article is Tamil, and so is the chip.
      language: 'ta',
      sources: [
        {
          title: 'Heavy rain alert',
          url: 'https://www.thehindu.example/rain',
          snippet: 'The Hindu',
        },
      ],
    });
  });

  it('reads a pasted address from Read A Page, and drafts from it', async () => {
    answer([group('place', [STORY])], 'news', {
      ...ARTICLE,
      url: 'https://reader.example/a',
      finalUrl: 'https://reader.example/a',
      language: 'en',
    });
    renderPage('news');

    fireEvent.click(await screen.findByRole('button', { name: 'Read A Page' }));
    const reader = await screen.findByTestId('reader-sheet');
    fireEvent.change(within(reader).getByLabelText('Page address'), {
      target: { value: 'reader.example/a' },
    });
    fireEvent.submit(within(reader).getByRole('form', { name: 'Read a page' }));

    await within(reader).findByTestId('reader-text');
    expect(reads).toEqual([{ url: 'https://reader.example/a' }]);
    fireEvent.click(within(reader).getByRole('button', { name: 'Create Post From This' }));

    const sheet = await screen.findByTestId('create-post-sheet');
    expect(within(sheet).getByText(/Draft a post about this story with AI\./)).toBeVisible();
    const draft = await within(sheet).findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(draft);
    });

    expect(mockedStream.mock.calls[0][1]).toMatchObject({
      // English is one of Chennai's languages, so the draft starts in the article's.
      language: 'en',
      sources: [
        {
          title: 'Heavy rain alert for Coimbatore',
          url: 'https://reader.example/a',
          snippet: 'The Sample Courier',
        },
      ],
    });
  });

  it('closes the reader without opening anything else', async () => {
    answer([group('trends', [TREND])], 'trending', ARTICLE);
    renderPage('trending');

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    fireEvent.click(within(card).getByRole('button', { name: 'Read' }));
    const reader = await screen.findByTestId('reader-sheet');
    await within(reader).findByTestId('reader-text');

    fireEvent.click(within(reader).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByTestId('reader-sheet')).not.toBeInTheDocument());
    expect(screen.queryByTestId('create-post-sheet')).not.toBeInTheDocument();
  });
});
