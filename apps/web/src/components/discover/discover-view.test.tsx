/**
 * The Discover page: groups and cards from the API's answer, the stale note,
 * groups with nothing hidden, the empty tab with Try Again, the error state,
 * Open as a real outside link, `dir="auto"` on what came from a feed, and the
 * Competitors tab (Module 07), which loads its own list, never the feed, and
 * answers the page's Refresh.
 *
 * Module 05: Trending's Wikipedia rows and social chips (and an updated line
 * that leaves Wikipedia out), the Videos tab with and without a YouTube key
 * (no request without one, and who is told to ask), and the Festivals tab,
 * whose Plan A Post hands the sheet a date.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import type {
  DiscoverGroup,
  DiscoverItem,
  DiscoverSourceId,
  DiscoverStatus,
  DiscoverTab,
  FeedKind,
  FeedResponse,
  Locality,
} from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { placeStorageKey, serializeRememberedPlace, WORLDWIDE_PLACE } from './discover-model';
import {
  DiscoverView,
  type DiscoverViewProps,
  FESTIVALS_NEED_PLACE,
  FESTIVALS_NEED_PLACE_HINT,
  LOAD_FAILED_TITLE,
  VIDEOS_ASK_ADMIN,
  VIDEOS_NEED_PLACE,
  VIDEOS_NOT_SET_UP,
  VIDEOS_RESTING,
} from './discover-view';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'Asia/Kolkata' }));

const mockedApi = api as jest.MockedFunction<typeof api>;

beforeAll(stubBrowserLayout);

// These suites render whole pages, and the Discover set runs side by side: on a
// busy machine the first render of a suite can take longer than Jest's 5 s.
jest.setTimeout(20_000);

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
    wikipedia: false,
    videos: false,
    holidays: false,
    social: false,
  },
};

const FETCHED = new Date(Date.now() - 25 * 60_000).toISOString();

const TRENDS: DiscoverGroup = {
  id: 'trends',
  title: 'Rising Searches In Tamil Nadu',
  subtitle: 'Via Google Trends. Showing what we had from 25 minutes ago.',
  attribution: { name: 'Google Trends', url: 'https://trends.google.com/trending' },
  stale: true,
  fetchedAt: FETCHED,
  items: [
    {
      id: 't1',
      kind: 'trend',
      source: { id: 'google-trends', name: 'Google Trends' },
      title: 'weather coimbatore',
      url: 'https://www.thehindu.com/rain',
      image: 'https://img.example/rain.jpg',
      signal: { label: '500+ searches', traffic: 500 },
      related: [
        {
          title: 'Heavy rain alert for Coimbatore',
          url: 'https://www.thehindu.com/rain',
          source: 'The Hindu',
        },
        { title: 'Bad link', url: 'javascript:alert(1)', source: 'Nobody' },
      ],
      brief: 'Rising search in Tamil Nadu: "weather coimbatore".',
    },
  ],
};

const STORIES: DiscoverGroup = {
  id: 'place',
  title: 'Chennai Stories',
  subtitle: 'Via Google News.',
  attribution: { name: 'Google News' },
  stale: false,
  fetchedAt: new Date().toISOString(),
  items: [
    {
      id: 'n1',
      kind: 'news',
      source: { id: 'google-news', name: 'Nakkheeran' },
      title: 'சென்னையில் கனமழை',
      opaqueUrl: 'https://news.google.com/rss/articles/abc',
      language: 'ta',
      brief: 'Story in Chennai.',
    },
  ],
};

function feed(
  kind: FeedKind,
  groups: DiscoverGroup[],
  unavailable: DiscoverSourceId[] = [],
): FeedResponse {
  return { kind, language: 'ta', locality: CHENNAI, groups, unavailable };
}

function remember(place: Locality = CHENNAI) {
  window.localStorage.setItem(
    placeStorageKey('org-a'),
    serializeRememberedPlace({
      place,
      source: place.countryCode ? 'browser' : 'worldwide',
      language: place.newsLanguages[0] ?? 'en',
    }),
  );
}

function renderView(
  status: DiscoverStatus | null = STATUS,
  initialTab: DiscoverTab = 'trending',
  props: Partial<DiscoverViewProps> = {},
) {
  return render(
    <TooltipProvider>
      <DiscoverView
        orgId="org-a"
        status={status}
        initialTab={initialTab}
        // As before Module 06: the workspace's settings could not be read.
        // `discover-workspace.test.tsx` covers the page with them.
        settings={null}
        isAdmin={false}
        {...props}
      />
    </TooltipProvider>,
  );
}

/** The feed requests made so far, as their query strings. */
function feedCalls(): string[] {
  return mockedApi.mock.calls
    .map(([path]) => path)
    .filter((path) => path.startsWith('/discover/feed'));
}

beforeEach(() => {
  window.localStorage.clear();
  mockedApi.mockReset();
  window.history.replaceState(null, '', '/org-a/discover');
});

describe('DiscoverView', () => {
  it('shows the chips, the credit, the Simulated sticker and the groups', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView();

    expect(
      await screen.findByRole('heading', { name: 'Rising Searches In Tamil Nadu' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('discover-place-chip')).toHaveTextContent('Chennai, Tamil Nadu');
    expect(screen.getByTestId('discover-language-chip')).toHaveTextContent('தமிழ் Tamil');
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeInTheDocument();
    expect(screen.getByTestId('discover-updated')).toHaveTextContent('Updated 25 min ago');
    expect(mockedApi).toHaveBeenCalledWith(
      expect.stringMatching(/^\/discover\/feed\?kind=trending&country=IN&region=IN-TN/),
    );
  });

  it('shows the stale note under a resting group', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView();

    expect(
      await screen.findByText('Via Google Trends. Showing what we had from 25 minutes ago.'),
    ).toBeInTheDocument();
  });

  it('draws a trend card: picture, meta, safe related links, Open out of the app', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView();

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    expect(within(card).getByText('500+ searches')).toBeInTheDocument();
    const image = card.querySelector('img');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('loading', 'lazy');

    expect(
      within(card).getByRole('link', { name: 'Heavy rain alert for Coimbatore' }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(card).queryByText('Bad link')).not.toBeInTheDocument();

    const open = within(card).getByRole('link', { name: /^Open/ });
    expect(open).toHaveAttribute('href', 'https://www.thehindu.com/rain');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');

    expect(within(card).getByRole('heading', { name: 'weather coimbatore' })).toHaveAttribute(
      'dir',
      'auto',
    );
  });

  it('hides a picture that fails to load', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView();

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    fireEvent.error(card.querySelector('img') as HTMLImageElement);
    expect(card.querySelector('img')).toBeNull();
  });

  it('shows Create Post only with a sheet to open', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView();

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    expect(within(card).queryByRole('button', { name: 'Create Post' })).not.toBeInTheDocument();
  });

  it('hands Create Post the item with the place and language it was read in', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    const onCreatePost = jest.fn();
    renderView(STATUS, 'trending', {
      onCreatePost,
      renderCardExtra: (item) => <span data-testid="card-extra">{item.id}</span>,
    });

    const card = await screen.findByRole('article', { name: 'weather coimbatore' });
    expect(within(card).getByTestId('card-extra')).toHaveTextContent('t1');
    fireEvent.click(within(card).getByRole('button', { name: 'Create Post' }));

    expect(onCreatePost).toHaveBeenCalledWith({
      item: TRENDS.items[0],
      place: CHENNAI,
      language: 'ta',
    });
  });

  it('shows News with its stories, Open going to the redirect when that is all there is', async () => {
    remember();
    mockedApi.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('kind=news') ? feed('news', [STORIES]) : feed('trending', [TRENDS]),
      ),
    );
    renderView(STATUS, 'news');

    const card = await screen.findByRole('article', { name: 'சென்னையில் கனமழை' });
    expect(within(card).getByText(/Nakkheeran/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /^Open/ })).toHaveAttribute(
      'href',
      'https://news.google.com/rss/articles/abc',
    );
    expect(window.location.search).toBe('?tab=news');
  });

  it('hides a group with nothing, and says so when the whole tab is empty', async () => {
    remember();
    mockedApi.mockResolvedValue({
      ...feed('trending', [{ ...TRENDS, items: [] }]),
      unavailable: ['google-trends'],
    });
    renderView();

    expect(await screen.findByText('Nothing to show for Chennai right now.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Rising Searches In Tamil Nadu' }),
    ).not.toBeInTheDocument();

    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(
      await screen.findByRole('heading', { name: 'Rising Searches In Tamil Nadu' }),
    ).toBeInTheDocument();
  });

  it('shows the error state when the API does not answer', async () => {
    remember();
    mockedApi.mockRejectedValue(new TypeError('Failed to fetch'));
    renderView(null);

    expect(await screen.findByText(LOAD_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Simulated')).not.toBeInTheDocument();
  });

  it('guesses from the time zone on a first visit', async () => {
    const india = {
      ...CHENNAI,
      regionCode: null,
      regionName: null,
      city: null,
      newsLanguages: ['hi', 'en'],
    };
    mockedApi.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/discover/locality') ? { locality: india } : feed('trending', [TRENDS]),
      ),
    );
    renderView();

    await waitFor(() =>
      expect(screen.getByTestId('discover-place-chip')).toHaveTextContent(
        'India, from your time zone',
      ),
    );
    expect(
      within(screen.getByTestId('discover-place-chip')).getByText('Guess'),
    ).toBeInTheDocument();
  });

  it('opens the Competitors tab on its own list, and asks the feed for nothing', async () => {
    remember();
    mockedApi.mockResolvedValue({ competitors: [], limit: 20 });
    renderView(STATUS, 'competitors');

    expect(await screen.findByText('No competitors yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Competitor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Competitors' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(mockedApi).toHaveBeenCalledWith('/discover/competitors');
    expect(feedCalls()).toEqual([]);
    expect(screen.queryByTestId('discover-updated')).not.toBeInTheDocument();
  });

  it('reloads the competitors and their items on Refresh', async () => {
    remember();
    const competitor = {
      id: 'c1',
      name: 'Acme',
      websiteUrl: null,
      feedUrls: [],
      youtubeChannelId: null,
      blueskyHandle: null,
      mastodonAcct: null,
      newsQuery: null,
      lastCheckedAt: null,
      lastError: null,
      createdAt: '2026-11-10T08:00:00.000Z',
      updatedAt: '2026-11-10T08:00:00.000Z',
    };
    mockedApi.mockImplementation(async (path: string) =>
      path === '/discover/competitors'
        ? { competitors: [competitor], limit: 20 }
        : { items: [], unavailable: [], notes: [], fetchedAt: FETCHED, stale: false, pending: false },
    );
    renderView(STATUS, 'competitors');

    expect(await screen.findByRole('heading', { name: 'Latest From Acme' })).toBeInTheDocument();
    const asked = (path: string) =>
      mockedApi.mock.calls.filter(([called]) => called === path).length;
    await waitFor(() => expect(asked('/discover/competitors/c1/items')).toBe(1));
    expect(asked('/discover/competitors')).toBe(1);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);

    await waitFor(() => expect(asked('/discover/competitors/c1/items')).toBe(2));
    expect(asked('/discover/competitors')).toBe(2);
    expect(feedCalls()).toEqual([]);
  });

  it("hands a competitor's row to Create Post with the place and language being read", async () => {
    remember();
    const onCreatePost = jest.fn();
    const post = {
      id: 'p1',
      kind: 'competitor',
      source: { id: 'rss', name: 'Acme Blog' },
      title: 'Five ways to cut churn',
      url: 'https://acme.example/blog/churn',
      brief: "Acme published: 'Five ways to cut churn'. Write our own take.",
    };
    mockedApi.mockImplementation(async (path: string) =>
      path === '/discover/competitors'
        ? {
            competitors: [
              {
                id: 'c1',
                name: 'Acme',
                websiteUrl: null,
                feedUrls: ['https://acme.example/feed'],
                youtubeChannelId: null,
                blueskyHandle: null,
                mastodonAcct: null,
                newsQuery: null,
                lastCheckedAt: null,
                lastError: null,
                createdAt: '2026-11-10T08:00:00.000Z',
                updatedAt: '2026-11-10T08:00:00.000Z',
              },
            ],
            limit: 20,
          }
        : { items: [post], unavailable: [], notes: [], fetchedAt: FETCHED, stale: false, pending: false },
    );
    renderView(STATUS, 'competitors', { onCreatePost });

    fireEvent.click(await screen.findByRole('button', { name: 'Create Post' }));

    expect(onCreatePost).toHaveBeenCalledWith({ item: post, place: CHENNAI, language: 'ta' });
  });
});

const WIKIPEDIA: DiscoverGroup = {
  id: 'wikipedia',
  title: 'What People Are Reading On Tamil Wikipedia',
  subtitle: "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
  attribution: { name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
  stale: false,
  // A whole day's reading, fetched hours ago: older than anything live on the page.
  fetchedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
  items: [
    {
      id: 'w1',
      kind: 'wiki',
      source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
      title: 'திருக்குறள்',
      url: 'https://ta.wikipedia.org/wiki/Thirukkural',
      language: 'ta',
      signal: { label: '1,627 reads', rank: 1, views: 1627 },
      brief: 'Widely read on Tamil Wikipedia: "திருக்குறள்" (1,627 reads).',
    },
  ],
};

const SOCIAL: DiscoverGroup = {
  id: 'social',
  title: 'Worldwide On Bluesky And Mastodon',
  subtitle: 'Not local: what the whole network is talking about.',
  attribution: { name: 'Bluesky and Mastodon' },
  stale: false,
  fetchedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  items: [
    {
      id: 's1',
      kind: 'social',
      source: { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app' },
      title: 'House speaker picks',
      url: 'https://bsky.app/profile/did:plc:abc/feed/xyz',
      signal: { label: '4,625 posts', posts: 4625 },
      brief: 'Trending worldwide on Bluesky.',
    },
    {
      id: 's2',
      kind: 'social',
      source: { id: 'mastodon', name: 'Mastodon', url: 'https://mastodon.social' },
      title: '#MeerMittwoch',
      url: 'https://mastodon.social/tags/MeerMittwoch',
      signal: { label: '273 uses this week', posts: 273 },
      brief: 'Trending worldwide on Mastodon.',
    },
  ],
};

describe('Trending with more sources (Module 05)', () => {
  it('draws Wikipedia as rows and the social topics as chips, each under its own name', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS, WIKIPEDIA, SOCIAL]));
    renderView();

    const wikipedia = await screen.findByRole('region', {
      name: 'What People Are Reading On Tamil Wikipedia',
    });
    expect(
      within(wikipedia).getByText("Yesterday's most-read articles. Wikipedia, text CC BY-SA."),
    ).toBeInTheDocument();
    const row = within(wikipedia).getByTestId('discover-wiki-row');
    expect(within(row).getByRole('link', { name: 'திருக்குறள்' })).toHaveAttribute(
      'href',
      'https://ta.wikipedia.org/wiki/Thirukkural',
    );
    expect(within(row).getByText('1,627 reads')).toBeInTheDocument();
    expect(within(wikipedia).queryByRole('article')).not.toBeInTheDocument();

    const social = screen.getByRole('region', { name: 'Worldwide On Bluesky And Mastodon' });
    expect(
      within(social).getByText('Not local: what the whole network is talking about.'),
    ).toBeInTheDocument();
    expect(
      within(social).getByRole('link', {
        name: 'House speaker picks on Bluesky, 4,625 posts, opens in a new tab',
      }),
    ).toHaveAttribute('href', 'https://bsky.app/profile/did:plc:abc/feed/xyz');
    expect(
      within(social).getByRole('link', {
        name: '#MeerMittwoch on Mastodon, 273 uses this week, opens in a new tab',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    // A chip is a link and nothing else.
    expect(within(social).queryByRole('button')).not.toBeInTheDocument();
  });

  it('leaves Wikipedia out of the updated line', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS, WIKIPEDIA, SOCIAL]));
    renderView();

    // Trends were fetched 25 minutes ago, Wikipedia 20 hours ago.
    expect(await screen.findByTestId('discover-updated')).toHaveTextContent('Updated 25 min ago');
  });

  it('shows no updated line when Wikipedia is all there is', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [WIKIPEDIA]));
    renderView();

    await screen.findByTestId('discover-wiki-row');
    expect(screen.queryByTestId('discover-updated')).not.toBeInTheDocument();
  });

  it('hands Create Post a Wikipedia article with the place and language', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [WIKIPEDIA]));
    const onCreatePost = jest.fn();
    renderView(STATUS, 'trending', { onCreatePost });

    const row = await screen.findByTestId('discover-wiki-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Create Post' }));

    expect(onCreatePost).toHaveBeenCalledWith({
      item: WIKIPEDIA.items[0],
      place: CHENNAI,
      language: 'ta',
    });
  });
});

const WITH_VIDEOS: DiscoverStatus = { ...STATUS, sources: { ...STATUS.sources, videos: true } };

const VIDEO: DiscoverItem = {
  id: 'v1',
  kind: 'video',
  source: { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
  title: 'சென்னை மழை: இன்றைய நிலவரம்',
  summary: 'Chennai Live',
  url: 'https://www.youtube.com/watch?v=abc123DEF_-',
  image: 'https://i.ytimg.com/vi/abc123DEF_-/mqdefault.jpg',
  publishedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  signal: { label: '1.2M views', views: 1_200_000 },
  brief: 'Trending video in India.',
};

const VIDEOS: DiscoverGroup = {
  id: 'videos',
  title: 'Trending On YouTube In India',
  subtitle: 'Via YouTube.',
  attribution: { name: 'YouTube', url: 'https://www.youtube.com' },
  stale: false,
  fetchedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  items: [VIDEO],
};

describe('Videos (Module 05)', () => {
  it('says videos are not set up without a key, and makes no request', async () => {
    remember();
    renderView(STATUS, 'videos');

    expect(await screen.findByText(VIDEOS_NOT_SET_UP)).toBeInTheDocument();
    // A member can do nothing about it: one sentence, nothing to press.
    expect(screen.queryByText(VIDEOS_ASK_ADMIN)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('discover-place-chip')).toHaveTextContent('Chennai, Tamil Nadu'),
    );
    expect(mockedApi).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('tells a workspace admin who to ask, and nobody else', async () => {
    remember();
    renderView(STATUS, 'videos', { isAdmin: true });

    expect(await screen.findByText(VIDEOS_NOT_SET_UP)).toBeInTheDocument();
    expect(screen.getByText(VIDEOS_ASK_ADMIN)).toBeInTheDocument();
    expect(feedCalls()).toEqual([]);
  });

  it('believes the answer when the status could not be asked', async () => {
    remember();
    mockedApi.mockResolvedValue({ ...feed('videos', []), reason: 'not_set_up' });
    renderView(null, 'videos', { isAdmin: true });

    expect(await screen.findByText(VIDEOS_NOT_SET_UP)).toBeInTheDocument();
    expect(screen.getByText(VIDEOS_ASK_ADMIN)).toBeInTheDocument();
    expect(feedCalls()).toHaveLength(1);
  });

  it('draws a video card: thumbnail, channel, views and time, Open to YouTube', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('videos', [VIDEOS]));
    const onCreatePost = jest.fn();
    renderView(WITH_VIDEOS, 'videos', { onCreatePost });

    const card = await screen.findByRole('article', { name: VIDEO.title });
    expect(card).toHaveAttribute('data-kind', 'video');
    expect(within(card).getByRole('heading', { name: VIDEO.title })).toHaveAttribute('dir', 'auto');
    expect(within(card).getByText('Chennai Live')).toBeInTheDocument();
    expect(within(card).getByText('1.2M views, 3 hours ago')).toBeInTheDocument();

    const image = card.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://i.ytimg.com/vi/abc123DEF_-/mqdefault.jpg');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('loading', 'lazy');
    fireEvent.error(image as HTMLImageElement);
    expect(card.querySelector('img')).toBeNull();

    const open = within(card).getByRole('link', {
      name: `Open ${VIDEO.title} on YouTube in a new tab`,
    });
    expect(open).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123DEF_-');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(within(card).getByRole('button', { name: 'Create Post' }));
    expect(onCreatePost).toHaveBeenCalledWith({ item: VIDEO, place: CHENNAI, language: 'ta' });

    expect(feedCalls()).toEqual([
      expect.stringMatching(/^\/discover\/feed\?kind=videos&country=IN/),
    ]);
    expect(window.location.search).toBe('?tab=videos');
    expect(screen.getByTestId('discover-updated')).toHaveTextContent('Updated 12 min ago');
  });

  it('says YouTube is resting when the day is spent and nothing was kept', async () => {
    remember();
    mockedApi.mockResolvedValue({ ...feed('videos', [], ['youtube']), reason: 'resting' });
    renderView(WITH_VIDEOS, 'videos');

    expect(await screen.findByText(VIDEOS_RESTING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });

  it('shows the kept copy with the note the API wrote when YouTube rests', async () => {
    remember();
    const resting = 'YouTube is resting until tomorrow. Showing what we had.';
    mockedApi.mockResolvedValue(
      feed('videos', [{ ...VIDEOS, stale: true, subtitle: resting }], ['youtube']),
    );
    renderView(WITH_VIDEOS, 'videos');

    expect(await screen.findByText(resting)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: VIDEO.title })).toBeInTheDocument();
  });

  it('asks for a place before asking for Worldwide videos', async () => {
    remember(WORLDWIDE_PLACE);
    renderView(WITH_VIDEOS, 'videos');

    expect(await screen.findByText(VIDEOS_NEED_PLACE)).toBeInTheDocument();
    expect(feedCalls()).toEqual([]);
  });
});

function festival(date: string, title: string, observance: boolean): DiscoverItem {
  return {
    id: `${date}|${title}`,
    kind: 'festival',
    source: { id: 'holidays', name: 'Google Calendar' },
    title,
    date,
    observance,
    brief: `Festival in India: "${title}".`,
  };
}

const DIWALI = festival('2026-11-08', 'Diwali/Deepavali', false);
const BHAI_DUJ = festival('2026-11-11', 'Bhai Duj', true);
const GURU_NANAK = festival('2026-11-24', 'Guru Nanak Jayanti', false);

const FESTIVALS: DiscoverGroup = {
  id: 'festivals',
  title: 'Festivals And Holidays In India',
  subtitle: 'Dates from public holiday calendars and date-holidays (CC BY-SA).',
  attribution: { name: 'Public holiday calendars and date-holidays' },
  stale: false,
  fetchedAt: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
  items: [DIWALI, BHAI_DUJ, GURU_NANAK],
};

/** The answer for India on 10 November 2026, whatever day the tests run on. */
function festivals(groups: DiscoverGroup[], unavailable: DiscoverSourceId[] = []): FeedResponse {
  return { ...feed('festivals', groups, unavailable), today: '2026-11-10' };
}

describe('Festivals (Module 05)', () => {
  it('lists the festivals by week under the line the API wrote, with no updated line', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([FESTIVALS]));
    renderView(STATUS, 'festivals');

    const group = await screen.findByRole('region', { name: 'Festivals And Holidays In India' });
    expect(
      within(group).getByText('Dates from public holiday calendars and date-holidays (CC BY-SA).'),
    ).toBeInTheDocument();
    expect(
      within(group)
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(['This Week', 'Later This Month', 'Just Happened']);

    const thisWeek = within(group).getByRole('region', { name: 'This Week' });
    expect(within(thisWeek).getByText('Bhai Duj')).toBeInTheDocument();
    expect(within(thisWeek).getByText('Observance')).toBeInTheDocument();
    expect(within(thisWeek).getByText('tomorrow')).toBeInTheDocument();

    const past = within(group).getByRole('region', { name: 'Just Happened' });
    expect(within(past).getByText('Public Holiday')).toBeInTheDocument();
    expect(within(past).getByText('2 days ago')).toBeInTheDocument();

    expect(feedCalls()).toEqual([
      expect.stringMatching(/^\/discover\/feed\?kind=festivals&country=IN.*&tz=Asia%2FKolkata$/),
    ]);
    expect(screen.queryByTestId('discover-updated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('hands Plan A Post the festival with its date: the evening before a public holiday', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([FESTIVALS]));
    const onCreatePost = jest.fn();
    renderView(STATUS, 'festivals', { onCreatePost });

    const upcoming = await screen.findByRole('region', { name: 'Later This Month' });
    fireEvent.click(within(upcoming).getByRole('button', { name: 'Plan A Post' }));

    expect(onCreatePost).toHaveBeenLastCalledWith({
      item: GURU_NANAK,
      place: CHENNAI,
      language: 'ta',
      publishAt: '2026-11-23T18:00:00+05:30',
    });
  });

  it('dates an observance for its own morning, and a past festival all the same', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([FESTIVALS]));
    const onCreatePost = jest.fn();
    renderView(STATUS, 'festivals', { onCreatePost });

    const thisWeek = await screen.findByRole('region', { name: 'This Week' });
    fireEvent.click(within(thisWeek).getByRole('button', { name: 'Plan A Post' }));
    expect(onCreatePost).toHaveBeenLastCalledWith({
      item: BHAI_DUJ,
      place: CHENNAI,
      language: 'ta',
      publishAt: '2026-11-11T10:00:00+05:30',
    });

    const past = screen.getByRole('region', { name: 'Just Happened' });
    fireEvent.click(within(past).getByRole('button', { name: 'Plan A Post' }));
    expect(onCreatePost).toHaveBeenLastCalledWith({
      item: DIWALI,
      place: CHENNAI,
      language: 'ta',
      publishAt: '2026-11-07T18:00:00+05:30',
    });
  });

  it('shows no Plan A Post without a sheet to open', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([FESTIVALS]));
    renderView(STATUS, 'festivals');

    await screen.findByRole('region', { name: 'This Week' });
    expect(screen.queryByRole('button', { name: 'Plan A Post' })).not.toBeInTheDocument();
  });

  it('says a quiet month plainly', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([{ ...FESTIVALS, items: [] }]));
    renderView(STATUS, 'festivals');

    expect(
      await screen.findByText('No festivals found for Chennai in the next 30 days.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });

  it('offers Try Again when the calendars had nothing to give', async () => {
    remember();
    mockedApi.mockResolvedValue(festivals([], ['holidays']));
    renderView(STATUS, 'festivals');

    expect(
      await screen.findByText('No festivals found for Chennai in the next 30 days.'),
    ).toBeInTheDocument();

    mockedApi.mockResolvedValue(festivals([FESTIVALS]));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(await screen.findByRole('region', { name: 'This Week' })).toBeInTheDocument();
    expect(feedCalls()).toHaveLength(2);
  });

  it('asks for a place for Worldwide, without a request', async () => {
    remember(WORLDWIDE_PLACE);
    renderView(STATUS, 'festivals');

    expect(await screen.findByText(FESTIVALS_NEED_PLACE)).toBeInTheDocument();
    expect(screen.getByText(FESTIVALS_NEED_PLACE_HINT)).toBeInTheDocument();
    expect(mockedApi).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
