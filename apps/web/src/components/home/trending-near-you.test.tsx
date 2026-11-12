/**
 * Trending Near You on Home: rows from the place's rising searches, Create
 * Post handing Discover's sheet the row's item with the place and language,
 * one feed request for a place this browser remembers choosing (no settings
 * read, no guess), and a failure that stays inside the card with Try Again.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { getDiscoverSettings, getFeed, localityFromTimeZone } from '@/lib/discover-api';
import type { DiscoverGroup, FeedResponse, Locality } from '@/types/discover';
import type { CreatePostTarget } from '../discover/create-post-sheet';
import { placeStorageKey, serializeRememberedPlace } from '../discover/discover-model';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { risingLine, TRENDING_FAILED, TrendingNearYou } from './trending-near-you';

jest.mock('@/lib/discover-api', () => ({
  getFeed: jest.fn(),
  getDiscoverSettings: jest.fn(),
  localityFromTimeZone: jest.fn(),
}));

// One scope for the whole file, as the provider keeps one in state.
jest.mock('@/components/navigation/workspace-provider', () => {
  const scope = { status: () => 'ready', subscribe: () => () => undefined };
  return { useWorkspaceScope: () => ({ orgId: 'org-1', scope, status: 'ready' }) };
});

// The sheet is Discover's and tested there; here it only shows what it was handed.
jest.mock('../discover/create-post-sheet', () => ({
  CreatePostSheet: ({ target }: { target: CreatePostTarget | null }) =>
    target ? (
      <div data-testid="sheet">
        {target.item.title} in {target.place.city} ({target.language})
      </div>
    ) : null,
}));

const mockedFeed = getFeed as jest.MockedFunction<typeof getFeed>;

// The animated buttons ask `matchMedia` about reduced motion.
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

const TRENDS: DiscoverGroup = {
  id: 'trends',
  title: 'Rising Searches In Tamil Nadu',
  subtitle: 'Via Google Trends.',
  attribution: { name: 'Google Trends' },
  stale: false,
  fetchedAt: '2026-11-12T08:00:00Z',
  items: Array.from({ length: 7 }, (_, index) => ({
    id: `t${index + 1}`,
    kind: 'trend' as const,
    source: { id: 'google-trends' as const, name: 'Google Trends' },
    title: index === 0 ? 'weather coimbatore' : `trend ${index + 1}`,
    signal: { label: `${(7 - index) * 100}+ searches`, traffic: (7 - index) * 100 },
    brief: `Brief ${index + 1}`,
  })),
};

const FEED: FeedResponse = {
  kind: 'trending',
  language: 'ta',
  locality: CHENNAI,
  groups: [TRENDS],
  unavailable: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem(
    placeStorageKey('org-1'),
    serializeRememberedPlace({ place: CHENNAI, source: 'search', language: 'ta' }),
  );
});

afterEach(() => window.localStorage.clear());

describe('TrendingNearYou', () => {
  it('shows five rising searches and opens Create Post on one', async () => {
    mockedFeed.mockResolvedValue(FEED);
    render(<TrendingNearYou orgId="org-1" />);

    const rows = await screen.findAllByTestId('home-trending-row');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText('weather coimbatore')).toBeInTheDocument();
    expect(within(rows[0]).getByText('700+ searches')).toBeInTheDocument();
    expect(screen.getByText(risingLine(CHENNAI))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See More/ })).toHaveAttribute(
      'href',
      '/org-1/discover',
    );

    // A remembered choice decides the place: one request, the feed's.
    expect(mockedFeed).toHaveBeenCalledTimes(1);
    expect(mockedFeed).toHaveBeenCalledWith(
      'trending',
      CHENNAI,
      'ta',
      undefined,
      expect.anything(),
    );
    expect(getDiscoverSettings).not.toHaveBeenCalled();
    expect(localityFromTimeZone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create Post for weather coimbatore' }));
    expect(screen.getByTestId('sheet')).toHaveTextContent('weather coimbatore in Chennai (ta)');
  });

  it('says so quietly when the feed fails, and Try Again asks once more', async () => {
    mockedFeed.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(FEED);
    render(<TrendingNearYou orgId="org-1" />);

    expect(await screen.findByText(TRENDING_FAILED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findAllByTestId('home-trending-row')).toHaveLength(5);
    expect(mockedFeed).toHaveBeenCalledTimes(2);
  });
});
