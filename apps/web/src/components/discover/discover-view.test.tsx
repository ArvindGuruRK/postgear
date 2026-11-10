/**
 * The Discover page: groups and cards from the API's answer, the stale note,
 * groups with nothing hidden, the empty tab with Try Again, the error state,
 * Open as a real outside link, `dir="auto"` on what came from a feed, and the
 * tabs that arrive later.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import type {
  DiscoverGroup,
  DiscoverSourceId,
  DiscoverStatus,
  DiscoverTab,
  FeedResponse,
  Locality,
} from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { placeStorageKey, serializeRememberedPlace } from './discover-model';
import { DiscoverView, LATER_STEP, LOAD_FAILED_TITLE } from './discover-view';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'Asia/Kolkata' }));

const mockedApi = api as jest.MockedFunction<typeof api>;

beforeAll(stubBrowserLayout);

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
  kind: 'trending' | 'news',
  groups: DiscoverGroup[],
  unavailable: DiscoverSourceId[] = [],
): FeedResponse {
  return { kind, language: 'ta', locality: CHENNAI, groups, unavailable };
}

function remember() {
  window.localStorage.setItem(
    placeStorageKey('org-a'),
    serializeRememberedPlace({ place: CHENNAI, source: 'browser', language: 'ta' }),
  );
}

function renderView(status: DiscoverStatus | null = STATUS, initialTab: DiscoverTab = 'trending') {
  return render(
    <TooltipProvider>
      <DiscoverView orgId="org-a" status={status} initialTab={initialTab} />
    </TooltipProvider>,
  );
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
    render(
      <TooltipProvider>
        <DiscoverView
          orgId="org-a"
          status={STATUS}
          initialTab="trending"
          onCreatePost={onCreatePost}
          renderCardExtra={(item) => <span data-testid="card-extra">{item.id}</span>}
        />
      </TooltipProvider>,
    );

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

  it('says the later tabs are coming', async () => {
    remember();
    mockedApi.mockResolvedValue(feed('trending', [TRENDS]));
    renderView(STATUS, 'festivals');

    expect(await screen.findByText(LATER_STEP)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Festivals' })).toHaveAttribute('data-state', 'active');
    expect(mockedApi).not.toHaveBeenCalled();
  });
});
