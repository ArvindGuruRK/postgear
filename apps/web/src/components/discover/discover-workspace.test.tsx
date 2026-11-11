/**
 * The Discover page with what the workspace saved (Module 06): a first visit
 * starts on the workspace's place with its badge and no guess; Save For This
 * Workspace sends the place whole in one request, then the line and the badge
 * follow; a member can read the default but never sends a save; the News tab
 * has a Topic select whose default is the workspace's; and a tab the
 * workspace switched off says so without asking the API for anything.
 */
import '@testing-library/jest-dom';
import { TooltipProvider, toast } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type {
  DiscoverGroup,
  DiscoverSettings,
  DiscoverStatus,
  DiscoverTab,
  FeedKind,
  FeedResponse,
  Locality,
} from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { placeStorageKey, serializeRememberedPlace } from './discover-model';
import {
  DiscoverView,
  type DiscoverViewProps,
  FESTIVALS_TURNED_OFF,
  TURN_BACK_ON,
  VIDEOS_NOT_SET_UP,
  VIDEOS_TURNED_OFF,
  WORKSPACE_SAVE_FAILED,
} from './discover-view';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'Asia/Kolkata' }));

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedToast = toast as jest.MockedFunction<typeof toast>;

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

const KOCHI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-KL',
  regionName: 'Kerala',
  city: 'Kochi',
  timeZone: 'Asia/Kolkata',
  languages: ['ml', 'en'],
  newsLanguages: ['ml', 'en'],
};

const INDIA: Locality = {
  ...CHENNAI,
  regionCode: null,
  regionName: null,
  city: null,
  languages: ['hi', 'en'],
  newsLanguages: ['hi', 'en'],
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

function saved(patch: Partial<DiscoverSettings> = {}): DiscoverSettings {
  return {
    countryCode: 'IN',
    regionCode: 'IN-TN',
    regionName: 'Tamil Nadu',
    city: 'Chennai',
    timeZone: 'Asia/Kolkata',
    languages: ['ta', 'en'],
    topics: ['BUSINESS'],
    sources: null,
    locationSource: 'SEARCH',
    place: CHENNAI,
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...patch,
  };
}

const NOTHING_SAVED = saved({
  countryCode: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: [],
  topics: [],
  locationSource: 'NONE',
  place: null,
  updatedAt: null,
});

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
      source: { id: 'google-news', name: 'The Hindu' },
      title: 'Metro line opens',
      url: 'https://www.thehindu.com/metro',
      brief: 'Story in Chennai.',
    },
  ],
};

function feed(kind: FeedKind, groups: DiscoverGroup[] = []): FeedResponse {
  return { kind, language: 'ta', locality: CHENNAI, groups, unavailable: [], hidden: [] };
}

/** Answers every feed call, and a save with `afterSave` (or refuses it). */
function answer(afterSave?: DiscoverSettings | Error) {
  mockedApi.mockImplementation((path: string, options?: { method?: string }) => {
    if (path.startsWith('/discover/feed')) {
      const kind = new URLSearchParams(path.split('?')[1]).get('kind') as FeedKind;
      return Promise.resolve(feed(kind, kind === 'news' ? [STORIES] : []));
    }
    if (path.startsWith('/discover/locality')) return Promise.resolve({ locality: INDIA });
    if (path === '/discover/settings' && options?.method === 'PATCH') {
      if (afterSave instanceof Error) return Promise.reject(afterSave);
      if (afterSave) return Promise.resolve({ settings: afterSave });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function remember(place: Locality, source: 'browser' | 'search', language: string) {
  window.localStorage.setItem(
    placeStorageKey('org-a'),
    serializeRememberedPlace({ place, source, language }),
  );
}

function renderView(
  settings: DiscoverSettings | null,
  props: Partial<DiscoverViewProps> = {},
  initialTab: DiscoverTab = 'trending',
) {
  return render(
    <TooltipProvider>
      <DiscoverView
        orgId="org-a"
        status={STATUS}
        initialTab={initialTab}
        settings={settings}
        isAdmin={false}
        {...props}
      />
    </TooltipProvider>,
  );
}

function calls(prefix: string): string[] {
  return mockedApi.mock.calls.map(([path]) => path).filter((path) => path.startsWith(prefix));
}

/** Every save sent so far, as its body. */
function saves(): unknown[] {
  return mockedApi.mock.calls
    .filter(([path, options]) => path === '/discover/settings' && options?.method === 'PATCH')
    .map(([, options]) => options?.body);
}

function topicsAsked(): (string | null)[] {
  return calls('/discover/feed')
    .map((path) => new URLSearchParams(path.split('?')[1]))
    .filter((query) => query.get('kind') === 'news')
    .map((query) => query.get('topic'));
}

async function openPopover() {
  const chip = await screen.findByTestId('discover-place-chip');
  fireEvent.click(chip);
  return screen.findByRole('button', { name: /Save For This Workspace|Saving…/ });
}

/** Picks an option of a design-system `Select` with the keyboard, as jsdom has no layout to click in. */
async function choose(trigger: HTMLElement, name: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name });
  await act(async () => {
    fireEvent.keyDown(option, { key: 'Enter' });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockedApi.mockReset();
  mockedToast.mockReset();
  answer();
  window.history.replaceState(null, '', '/org-a/discover');
});

describe('a first visit to a workspace with a saved place', () => {
  it('opens on the workspace place with its badge, and makes no guess', async () => {
    renderView(saved());

    const chip = await screen.findByTestId('discover-place-chip');
    expect(chip).toHaveTextContent('Chennai, Tamil Nadu');
    expect(within(chip).getByText('Workspace')).toBeInTheDocument();
    expect(within(chip).queryByText('Guess')).not.toBeInTheDocument();
    expect(screen.getByTestId('discover-language-chip')).toHaveTextContent('தமிழ் Tamil');

    await waitFor(() => expect(calls('/discover/feed')).toHaveLength(1));
    expect(calls('/discover/locality')).toEqual([]);
    expect(window.localStorage.getItem(placeStorageKey('org-a'))).toBeNull();
  });

  it('asks the feed to leave out what the workspace switched off', async () => {
    renderView(saved());

    await waitFor(() => expect(calls('/discover/feed')).toHaveLength(1));
    expect(calls('/discover/feed')[0]).toContain('useWorkspaceSources=1');
  });

  it("keeps a person's own place, with no badge", async () => {
    remember(KOCHI, 'search', 'ml');
    renderView(saved());

    const chip = await screen.findByTestId('discover-place-chip');
    expect(chip).toHaveTextContent('Kochi, Kerala');
    expect(within(chip).queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('guesses, with the Guess badge, when the workspace saved nothing', async () => {
    renderView(NOTHING_SAVED);

    const chip = await screen.findByTestId('discover-place-chip');
    await waitFor(() => expect(chip).toHaveTextContent('India, from your time zone'));
    expect(within(chip).getByText('Guess')).toBeInTheDocument();
    expect(calls('/discover/locality')).toHaveLength(1);
  });
});

describe('Save For This Workspace', () => {
  it('saves the place whole in one request, then shows the line, the badge and a toast', async () => {
    remember(KOCHI, 'search', 'ml');
    const after = saved({
      regionCode: 'IN-KL',
      regionName: 'Kerala',
      city: 'Kochi',
      languages: ['ml', 'en'],
      place: KOCHI,
    });
    answer(after);
    renderView(saved(), { isAdmin: true });

    const save = await openPopover();
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
    await act(async () => {
      fireEvent.click(save);
    });

    expect(saves()).toEqual([
      {
        countryCode: 'IN',
        regionCode: 'IN-KL',
        regionName: 'Kerala',
        city: 'Kochi',
        timeZone: 'Asia/Kolkata',
        languages: ['ml', 'en'],
        locationSource: 'SEARCH',
      },
    ]);
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Kochi, Kerala',
    );
    const chip = screen.getByTestId('discover-place-chip');
    expect(chip).toHaveTextContent('Kochi, Kerala');
    expect(within(chip).getByText('Workspace')).toBeInTheDocument();
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Kochi, Kerala is now the workspace default.',
    });
    // The person stays where they were: nothing new was asked of the feed.
    expect(calls('/discover/feed')).toHaveLength(1);
  });

  it("sends the chip's language first, and how the place was found", async () => {
    remember(CHENNAI, 'browser', 'en');
    answer(saved({ languages: ['en', 'ta'], locationSource: 'BROWSER' }));
    renderView(NOTHING_SAVED, { isAdmin: true });

    const save = await openPopover();
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'No workspace default yet.',
    );
    await act(async () => {
      fireEvent.click(save);
    });

    expect(saves()).toEqual([
      {
        countryCode: 'IN',
        regionCode: 'IN-TN',
        regionName: 'Tamil Nadu',
        city: 'Chennai',
        timeZone: 'Asia/Kolkata',
        languages: ['en', 'ta'],
        locationSource: 'BROWSER',
      },
    ]);
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
  });

  it('saves a guess as found by the time zone, with nulls for what a country has not got', async () => {
    answer(saved({ regionCode: null, regionName: null, city: null, place: INDIA }));
    renderView(NOTHING_SAVED, { isAdmin: true });

    const save = await openPopover();
    await act(async () => {
      fireEvent.click(save);
    });

    expect(saves()).toEqual([
      {
        countryCode: 'IN',
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: 'Asia/Kolkata',
        languages: ['en', 'hi'],
        locationSource: 'TIMEZONE',
      },
    ]);
    const chip = screen.getByTestId('discover-place-chip');
    expect(within(chip).getByText('Workspace')).toBeInTheDocument();
    expect(within(chip).queryByText('Guess')).not.toBeInTheDocument();
  });

  it("shows the API's sentence in the popover when the save is refused, and tries again", async () => {
    remember(KOCHI, 'search', 'ml');
    answer(new ApiError('Choose a real country for the workspace place.', 400));
    renderView(saved(), { isAdmin: true });

    const save = await openPopover();
    await act(async () => {
      fireEvent.click(save);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Choose a real country for the workspace place.');
    // Nothing moved: the default, the chip and the toast are as they were.
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
    expect(
      within(screen.getByTestId('discover-place-chip')).queryByText('Workspace'),
    ).not.toBeInTheDocument();
    expect(mockedToast).not.toHaveBeenCalled();

    answer(saved({ regionCode: 'IN-KL', regionName: 'Kerala', city: 'Kochi', place: KOCHI }));
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    });

    expect(saves()).toHaveLength(2);
    expect(saves()[1]).toEqual(saves()[0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Kochi, Kerala',
    );
  });

  it('says a plain sentence when the API did not answer at all', async () => {
    remember(KOCHI, 'search', 'ml');
    answer(new TypeError('Failed to fetch'));
    renderView(saved(), { isAdmin: true });

    const save = await openPopover();
    await act(async () => {
      fireEvent.click(save);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(WORKSPACE_SAVE_FAILED);
  });

  it('never sends a save for a member, who sees the button disabled with the reason', async () => {
    remember(KOCHI, 'search', 'ml');
    renderView(saved(), { isAdmin: false });

    const save = await openPopover();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await act(async () => {
      fireEvent.focus(save.parentElement as HTMLElement);
    });

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Only workspace admins can change the workspace place.',
    );
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
    expect(saves()).toEqual([]);
  });
});

describe('the News topic', () => {
  it("opens on the workspace's first topic and sends it as the feed's topic", async () => {
    renderView(saved({ topics: ['BUSINESS', 'SPORTS'] }), {}, 'news');

    const select = await screen.findByTestId('discover-topic-select');
    expect(select).toHaveTextContent('Business');
    expect(screen.getByLabelText('Topic')).toBe(select);
    await screen.findByRole('article', { name: 'Metro line opens' });
    expect(topicsAsked()).toEqual(['BUSINESS']);
  });

  it('opens on All, with no topic sent, when the workspace saved none', async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(NOTHING_SAVED, {}, 'news');

    expect(await screen.findByTestId('discover-topic-select')).toHaveTextContent('All');
    await screen.findByRole('article', { name: 'Metro line opens' });
    expect(topicsAsked()).toEqual([null]);
  });

  it('offers All and the eight topics, asks again with the one picked, and remembers it', async () => {
    remember(CHENNAI, 'browser', 'ta');
    const { unmount } = renderView(saved(), {}, 'news');
    const select = await screen.findByTestId('discover-topic-select');
    await screen.findByRole('article', { name: 'Metro line opens' });

    fireEvent.keyDown(select, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'All',
      'World',
      'Nation',
      'Business',
      'Technology',
      'Entertainment',
      'Sports',
      'Science',
      'Health',
    ]);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('option', { name: 'Sports' }), { key: 'Enter' });
    });

    await waitFor(() => expect(topicsAsked()).toEqual(['BUSINESS', 'SPORTS']));
    expect(screen.getByTestId('discover-topic-select')).toHaveTextContent('Sports');
    const stored = JSON.parse(window.localStorage.getItem(placeStorageKey('org-a')) ?? '{}');
    expect(stored).toMatchObject({ v: 1, source: 'browser', language: 'ta', topic: 'SPORTS' });
    unmount();

    // The next visit opens on the person's topic, not the workspace's.
    mockedApi.mockClear();
    renderView(saved(), {}, 'news');
    expect(await screen.findByTestId('discover-topic-select')).toHaveTextContent('Sports');
    await waitFor(() => expect(topicsAsked()).toEqual(['SPORTS']));
  });

  it("remembers All over the workspace's topic", async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(saved(), {}, 'news');
    const select = await screen.findByTestId('discover-topic-select');
    await screen.findByRole('article', { name: 'Metro line opens' });

    await choose(select, 'All');

    await waitFor(() => expect(topicsAsked()).toEqual(['BUSINESS', null]));
    expect(JSON.parse(window.localStorage.getItem(placeStorageKey('org-a')) ?? '{}')).toMatchObject(
      { topic: 'ALL' },
    );
  });

  it('still reads a place stored before topics existed', async () => {
    window.localStorage.setItem(
      placeStorageKey('org-a'),
      JSON.stringify({ v: 1, place: KOCHI, source: 'search', language: 'ml' }),
    );
    renderView(saved(), {}, 'news');

    expect(await screen.findByTestId('discover-place-chip')).toHaveTextContent('Kochi, Kerala');
    expect(screen.getByTestId('discover-topic-select')).toHaveTextContent('Business');
    await waitFor(() => expect(topicsAsked()).toEqual(['BUSINESS']));
  });

  it('shows the select on News only, and sends no topic with another tab', async () => {
    renderView(saved());

    await waitFor(() => expect(calls('/discover/feed')).toHaveLength(1));
    expect(screen.queryByTestId('discover-topic-select')).not.toBeInTheDocument();
    expect(calls('/discover/feed')[0]).not.toContain('topic=');
  });
});

describe('a tab the workspace switched off', () => {
  it('says Videos are turned off, and asks the API for nothing', async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(saved({ sources: { videos: false } }), {}, 'videos');

    expect(await screen.findByText(VIDEOS_TURNED_OFF)).toBeInTheDocument();
    expect(VIDEOS_TURNED_OFF).toBe('Videos are turned off for this workspace.');
    // A member can do nothing about it: one sentence, nothing to press.
    expect(screen.queryByText(TURN_BACK_ON)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('discover-place-chip')).toHaveTextContent('Chennai, Tamil Nadu'),
    );
    expect(mockedApi).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('says Festivals are turned off, and asks the API for nothing', async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(saved({ sources: { festivals: false } }), {}, 'festivals');

    expect(await screen.findByText(FESTIVALS_TURNED_OFF)).toBeInTheDocument();
    expect(FESTIVALS_TURNED_OFF).toBe('Festivals are turned off for this workspace.');
    await waitFor(() =>
      expect(screen.getByTestId('discover-place-chip')).toHaveTextContent('Chennai, Tamil Nadu'),
    );
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('tells an admin where to turn it back on', async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(saved({ sources: { videos: false } }), { isAdmin: true }, 'videos');

    expect(await screen.findByText(VIDEOS_TURNED_OFF)).toBeInTheDocument();
    expect(screen.getByText('Turn them back on in Settings, Discover.')).toBeInTheDocument();
  });

  it('beats the not-set-up state when there is no YouTube key either', async () => {
    remember(CHENNAI, 'browser', 'ta');
    const noKey = { ...STATUS, sources: { ...STATUS.sources, videos: false } };
    renderView(saved({ sources: { videos: false } }), { status: noKey, isAdmin: true }, 'videos');

    expect(await screen.findByText(VIDEOS_TURNED_OFF)).toBeInTheDocument();
    expect(screen.queryByText(VIDEOS_NOT_SET_UP)).not.toBeInTheDocument();
  });

  it('believes the answer when the settings could not be read', async () => {
    remember(CHENNAI, 'browser', 'ta');
    mockedApi.mockImplementation((path: string) => {
      const kind = new URLSearchParams(path.split('?')[1]).get('kind') as FeedKind;
      return Promise.resolve({ ...feed(kind), hidden: [kind] });
    });
    const { unmount } = renderView(null, {}, 'videos');

    expect(await screen.findByText(VIDEOS_TURNED_OFF)).toBeInTheDocument();
    expect(calls('/discover/feed')).toHaveLength(1);
    unmount();

    renderView(null, { isAdmin: true }, 'festivals');
    expect(await screen.findByText(FESTIVALS_TURNED_OFF)).toBeInTheDocument();
    expect(screen.getByText(TURN_BACK_ON)).toBeInTheDocument();
  });

  it('leaves the other tabs alone', async () => {
    remember(CHENNAI, 'browser', 'ta');
    renderView(saved({ sources: { videos: false, festivals: false, trends: false } }), {}, 'news');

    expect(await screen.findByRole('article', { name: 'Metro line opens' })).toBeInTheDocument();
    expect(screen.queryByText(VIDEOS_TURNED_OFF)).not.toBeInTheDocument();
  });
});

/**
 * The first page after signing in (Module 09): the server could not read the
 * settings yet, so the page starts without them and is handed them a moment
 * later, when the layout has set the workspace cookie and the page ran again.
 */
describe('settings that arrive after the first paint', () => {
  function page(settings: DiscoverSettings | null, isAdmin = false) {
    return (
      <TooltipProvider>
        <DiscoverView
          orgId="org-a"
          status={STATUS}
          initialTab="trending"
          settings={settings}
          isAdmin={isAdmin}
        />
      </TooltipProvider>
    );
  }

  it('moves from the guess to the workspace place, with its badge, and asks the feed for it', async () => {
    const { rerender } = render(page(null));
    const chip = await screen.findByTestId('discover-place-chip');
    await waitFor(() => expect(chip).toHaveTextContent('India, from your time zone'));

    rerender(page(saved()));

    await waitFor(() =>
      expect(screen.getByTestId('discover-place-chip')).toHaveTextContent('Chennai, Tamil Nadu'),
    );
    const moved = screen.getByTestId('discover-place-chip');
    expect(within(moved).getByText('Workspace')).toBeInTheDocument();
    expect(within(moved).queryByText('Guess')).not.toBeInTheDocument();
    expect(screen.getByTestId('discover-language-chip')).toHaveTextContent('தமிழ் Tamil');
    await waitFor(() =>
      expect(calls('/discover/feed').some((path) => path.includes('region=IN-TN'))).toBe(true),
    );
  });

  it("keeps the person's own place when the settings arrive", async () => {
    remember(KOCHI, 'search', 'ml');
    const { rerender } = render(page(null));
    expect(await screen.findByTestId('discover-place-chip')).toHaveTextContent('Kochi, Kerala');

    rerender(page(saved()));

    await waitFor(() => expect(calls('/discover/feed').length).toBeGreaterThan(0));
    const chip = screen.getByTestId('discover-place-chip');
    expect(chip).toHaveTextContent('Kochi, Kerala');
    expect(within(chip).queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('lets an admin save from the popover once the settings are there', async () => {
    remember(KOCHI, 'search', 'ml');
    const { rerender } = render(page(null, true));
    await screen.findByTestId('discover-place-chip');

    rerender(page(saved(), true));

    await openPopover();
    // The line under Worldwide names what the workspace starts from: it is drawn only with settings.
    expect(screen.getByText(/Chennai, Tamil Nadu/)).toBeInTheDocument();
  });
});
