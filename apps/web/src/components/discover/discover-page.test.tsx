/**
 * The page's island end to end (Module 05): Plan A Post on a festival opens
 * the Create Post sheet on that festival's brief and sends its date with the
 * draft (story DC-5.2), and Create Post on a Wikipedia row cites the article
 * the person saw.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, AiStatus } from '@/types/ai';
import type { Channel } from '@/types/channel';
import type { DiscoverGroup, DiscoverStatus, FeedResponse, Locality } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { placeStorageKey, serializeRememberedPlace } from './discover-model';
import { DiscoverPage } from './discover-page';

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
    wikipedia: true,
    videos: false,
    holidays: true,
    social: true,
  },
};

const DIWALI_BRIEF =
  'Festival in India: "Diwali/Deepavali" on Sunday 8 November 2026 (public holiday).';

const FESTIVALS: DiscoverGroup = {
  id: 'festivals',
  title: 'Festivals And Holidays In India',
  subtitle: 'Dates from public holiday calendars and date-holidays (CC BY-SA).',
  attribution: { name: 'Public holiday calendars and date-holidays' },
  stale: false,
  fetchedAt: '2026-11-08T02:00:00Z',
  items: [
    {
      id: 'f1',
      kind: 'festival',
      source: { id: 'holidays', name: 'Google Calendar' },
      title: 'Diwali/Deepavali',
      date: '2026-11-08',
      observance: false,
      brief: DIWALI_BRIEF,
    },
  ],
};

const WIKIPEDIA: DiscoverGroup = {
  id: 'wikipedia',
  title: 'What People Are Reading On Tamil Wikipedia',
  subtitle: "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
  attribution: { name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
  stale: false,
  fetchedAt: '2026-11-10T02:00:00Z',
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

function answer(feed: FeedResponse) {
  mockedApi.mockImplementation((path: string) => {
    if (path.startsWith('/discover/feed')) return Promise.resolve(feed);
    if (path === '/channels') return Promise.resolve({ channels: [CHANNEL] });
    if (path === '/channels/providers') return Promise.resolve({ providers: [] });
    if (path === '/ai/status') return Promise.resolve({ status: AI_STATUS });
    if (path === '/ai/credits') return Promise.resolve({ credits: CREDITS });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPage(initialTab: 'trending' | 'festivals') {
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
  window.localStorage.clear();
  window.localStorage.setItem(
    placeStorageKey('org-a'),
    serializeRememberedPlace({ place: CHENNAI, source: 'browser', language: 'ta' }),
  );
  mockedApi.mockReset();
  mockedStream.mockReset();
  // A run that stays open: these tests look at what was asked, not at the draft.
  mockedStream.mockImplementation(() => new Promise<void>(() => undefined));
  window.history.replaceState(null, '', '/org-a/discover');
});

describe('DiscoverPage', () => {
  it('opens the sheet on the festival from Plan A Post, and drafts it for the evening before', async () => {
    answer({
      kind: 'festivals',
      language: 'ta',
      locality: CHENNAI,
      groups: [FESTIVALS],
      unavailable: [],
      today: '2026-11-10',
    });
    renderPage('festivals');

    fireEvent.click(await screen.findByRole('button', { name: 'Plan A Post' }));

    const sheet = await screen.findByTestId('create-post-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Create Post' })).toBeInTheDocument();
    expect(within(sheet).getByText(/Draft a post about this festival with AI\./)).toBeVisible();
    expect(await within(sheet).findByTestId('create-post-brief')).toHaveTextContent(DIWALI_BRIEF);

    const draft = await within(sheet).findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(draft);
    });

    expect(mockedStream).toHaveBeenCalledTimes(1);
    const [path, body] = mockedStream.mock.calls[0];
    expect(path).toBe('/ai/generate');
    // A festival has no page of its own to cite, so no sources go with it.
    expect(body).toEqual({
      topic: DIWALI_BRIEF,
      tone: 'personal',
      format: 'one_short',
      withImage: false,
      channelIds: ['ch_li'],
      language: 'ta',
      publishAt: '2026-11-07T18:00:00+05:30',
    });
  });

  it('cites the Wikipedia article a draft was started from, with no date', async () => {
    answer({
      kind: 'trending',
      language: 'ta',
      locality: CHENNAI,
      groups: [WIKIPEDIA],
      unavailable: [],
    });
    renderPage('trending');

    const row = await screen.findByTestId('discover-wiki-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Create Post' }));

    const sheet = await screen.findByTestId('create-post-sheet');
    expect(within(sheet).getByText(/Draft a post about this article with AI\./)).toBeVisible();

    const draft = await within(sheet).findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(draft);
    });

    expect(mockedStream.mock.calls[0][1]).toEqual({
      topic: WIKIPEDIA.items[0].brief,
      tone: 'personal',
      format: 'one_short',
      withImage: false,
      channelIds: ['ch_li'],
      language: 'ta',
      sources: [
        {
          title: 'திருக்குறள்',
          url: 'https://ta.wikipedia.org/wiki/Thirukkural',
          snippet: 'Wikipedia',
        },
      ],
    });
  });
});
