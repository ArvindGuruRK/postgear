/**
 * The place hook: a guess from the time zone on a first visit, no prompt on
 * load, the browser asked only after a click (and not at all when it has
 * already said no), a position that is rounded before it leaves, and a choice
 * remembered per workspace.
 *
 * Module 06: a saved workspace place is where a first visit starts (no guess
 * request, nothing written to storage), a person's own choice still wins on
 * their device, and the News topic is remembered beside the place.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import type { DiscoverSettings, Locality } from '@/types/discover';
import { placeStorageKey, serializeRememberedPlace, WORLDWIDE_PLACE } from './discover-model';
import { LOCATION_MESSAGES, POSITION_OPTIONS, usePlace } from './use-place';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'Asia/Kolkata' }));

const mockedApi = api as jest.MockedFunction<typeof api>;

const INDIA: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: 'Asia/Kolkata',
  languages: ['hi', 'en'],
  newsLanguages: ['hi', 'en'],
};

const CHENNAI: Locality = {
  ...INDIA,
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const PARIS: Locality = {
  countryCode: 'FR',
  countryName: 'France',
  regionCode: 'FR-IDF',
  regionName: 'Ile-de-France',
  city: 'Paris',
  timeZone: 'Europe/Paris',
  languages: ['fr', 'en'],
  newsLanguages: ['fr'],
};

const getCurrentPosition = jest.fn();
const permissionsQuery = jest.fn();

function answerApi() {
  mockedApi.mockImplementation((path: string) => {
    if (path.startsWith('/discover/locality?tz=')) return Promise.resolve({ locality: INDIA });
    if (path.startsWith('/discover/locality?lat=')) return Promise.resolve({ locality: CHENNAI });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockedApi.mockReset();
  answerApi();
  getCurrentPosition.mockReset();
  permissionsQuery.mockReset();
  permissionsQuery.mockResolvedValue({ state: 'prompt' });
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  Object.defineProperty(window.navigator, 'permissions', {
    configurable: true,
    value: { query: permissionsQuery },
  });
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: ['en-US', 'en'],
  });
});

describe('usePlace', () => {
  it('guesses the country from the time zone on a first visit, without a prompt', async () => {
    const { result } = renderHook(() => usePlace('org-a'));

    await waitFor(() => expect(result.current.place).toEqual(INDIA));
    expect(result.current.source).toBe('guess');
    // The browser prefers English and India offers it.
    expect(result.current.language).toBe('en');
    expect(mockedApi).toHaveBeenCalledWith('/discover/locality?tz=Asia%2FKolkata');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(permissionsQuery).not.toHaveBeenCalled();
    // A guess is made again next time, not remembered.
    expect(window.localStorage.getItem(placeStorageKey('org-a'))).toBeNull();
  });

  it('starts from the remembered choice and asks nothing', () => {
    window.localStorage.setItem(
      placeStorageKey('org-a'),
      serializeRememberedPlace({ place: PARIS, source: 'search', language: 'fr' }),
    );
    const { result } = renderHook(() => usePlace('org-a'));

    expect(result.current.place).toEqual(PARIS);
    expect(result.current.source).toBe('search');
    expect(result.current.language).toBe('fr');
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('keeps each workspace its own choice', async () => {
    window.localStorage.setItem(
      placeStorageKey('org-b'),
      serializeRememberedPlace({ place: PARIS, source: 'search', language: 'fr' }),
    );
    const { result, rerender } = renderHook(({ org }) => usePlace(org), {
      initialProps: { org: 'org-a' },
    });
    await waitFor(() => expect(result.current.place).toEqual(INDIA));

    rerender({ org: 'org-b' });
    expect(result.current.place).toEqual(PARIS);
  });

  it('remembers a picked place, in its first language, and a language switch', async () => {
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());

    act(() => result.current.pickPlace(CHENNAI));
    expect(result.current.language).toBe('ta');
    expect(result.current.source).toBe('search');

    act(() => result.current.setLanguage('en'));
    const stored = JSON.parse(window.localStorage.getItem(placeStorageKey('org-a')) ?? '{}');
    expect(stored).toMatchObject({ v: 1, source: 'search', language: 'en' });
    expect(stored.place.city).toBe('Chennai');
  });

  it('refuses a language the place does not offer', async () => {
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());
    act(() => result.current.pickPlace(PARIS));

    act(() => result.current.setLanguage('ta'));
    expect(result.current.language).toBe('fr');
  });

  it('remembers Worldwide', async () => {
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());

    act(() => result.current.pickWorldwide());
    expect(result.current.place).toEqual(WORLDWIDE_PLACE);
    expect(result.current.source).toBe('worldwide');
    const stored = JSON.parse(window.localStorage.getItem(placeStorageKey('org-a')) ?? '{}');
    expect(stored.source).toBe('worldwide');
  });

  it('finds the city from a position it rounds before sending', async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 13.082_712, longitude: 80.270_718 } } as GeolocationPosition),
    );
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());

    let found = false;
    await act(async () => {
      found = await result.current.locate();
    });

    expect(found).toBe(true);
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      POSITION_OPTIONS,
    );
    expect(mockedApi).toHaveBeenCalledWith('/discover/locality?lat=13.08&lng=80.27');
    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('browser');
    expect(result.current.language).toBe('ta');
    const raw = window.localStorage.getItem(placeStorageKey('org-a')) ?? '';
    expect(raw).toContain('Chennai');
    expect(raw).not.toContain('13.08');
    expect(raw).not.toContain('80.27');
  });

  it('explains a blocked permission without asking again', async () => {
    permissionsQuery.mockResolvedValue({ state: 'denied' });
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());

    await act(async () => {
      await result.current.locate();
    });

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.status).toBe('denied');
    expect(result.current.message).toBe(LOCATION_MESSAGES.denied);
  });

  it('says blocked when the prompt is refused, and not found when it times out', async () => {
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());

    getCurrentPosition.mockImplementationOnce(
      (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: 'denied' } as GeolocationPositionError),
    );
    await act(async () => {
      await result.current.locate();
    });
    expect(result.current.status).toBe('denied');
    expect(result.current.message).toBe(LOCATION_MESSAGES.denied);

    getCurrentPosition.mockImplementationOnce(
      (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 3, message: 'timeout' } as GeolocationPositionError),
    );
    await act(async () => {
      await result.current.locate();
    });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.message).toBe(LOCATION_MESSAGES.unavailable);
    // The guess is still the place.
    expect(result.current.place).toEqual(INDIA);
  });

  it("shows the API's sentence when the API is the one that refused", async () => {
    const { ApiError } = jest.requireActual('@/lib/api');
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 13.08, longitude: 80.27 } } as GeolocationPosition),
    );
    const { result } = renderHook(() => usePlace('org-a'));
    await waitFor(() => expect(result.current.place).not.toBeNull());
    mockedApi.mockRejectedValueOnce(
      new ApiError('Try again in a moment.', 429, 'locality_throttled'),
    );

    await act(async () => {
      await result.current.locate();
    });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.message).toBe('Try again in a moment.');
  });

  it('reports a failed guess so the page can offer Try Again', async () => {
    mockedApi.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => usePlace('org-a'));

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.place).toBeNull();

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.place).toEqual(INDIA));
    expect(result.current.failed).toBe(false);
  });

  it('works with storage blocked, just without remembering', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { result } = renderHook(() => usePlace('org-a'));
      await waitFor(() => expect(result.current.place).toEqual(INDIA));
      act(() => result.current.pickPlace(PARIS));
      expect(result.current.place).toEqual(PARIS);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

/** What the workspace saved: Paris, French then English, Business first. */
function saved(patch: Partial<DiscoverSettings> = {}): DiscoverSettings {
  return {
    countryCode: 'FR',
    regionCode: 'FR-IDF',
    regionName: 'Ile-de-France',
    city: 'Paris',
    timeZone: 'Europe/Paris',
    languages: ['fr', 'en'],
    topics: ['BUSINESS', 'SPORTS'],
    sources: null,
    locationSource: 'SEARCH',
    place: PARIS,
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

function stored(orgId = 'org-a'): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(placeStorageKey(orgId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe('usePlace with a workspace place (Module 06)', () => {
  it('starts from the workspace place with no guess request, and writes nothing', () => {
    const { result } = renderHook(() => usePlace('org-a', saved()));

    // Known on the first pass: no request, so no empty chip in between.
    expect(result.current.place).toEqual(PARIS);
    expect(result.current.source).toBe('workspace');
    expect(result.current.language).toBe('fr');
    expect(mockedApi).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // Like a guess, it is read again next visit, so a changed default arrives.
    expect(stored()).toBeNull();
  });

  it("starts in the workspace's first language only when the place offers it", () => {
    const chennai = saved({ place: CHENNAI, languages: ['en', 'ta'] });
    const english = renderHook(() => usePlace('org-a', chennai));
    expect(english.result.current.language).toBe('en');

    // Paris has no English edition: its own first language stands in.
    const paris = renderHook(() => usePlace('org-b', saved({ languages: ['en', 'fr'] })));
    expect(paris.result.current.language).toBe('fr');
  });

  it('guesses as before when the workspace saved no place', async () => {
    const { result } = renderHook(() => usePlace('org-a', NOTHING_SAVED));

    await waitFor(() => expect(result.current.place).toEqual(INDIA));
    expect(result.current.source).toBe('guess');
    expect(mockedApi).toHaveBeenCalledWith('/discover/locality?tz=Asia%2FKolkata');
  });

  it('lets a remembered choice win on this device', () => {
    window.localStorage.setItem(
      placeStorageKey('org-a'),
      serializeRememberedPlace({ place: CHENNAI, source: 'search', language: 'ta' }),
    );
    const { result } = renderHook(() => usePlace('org-a', saved()));

    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('search');
    expect(result.current.language).toBe('ta');
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("remembers the browser's place after Use My Location, and leaves the default alone", async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 13.082_712, longitude: 80.270_718 } } as GeolocationPosition),
    );
    const { result } = renderHook(() => usePlace('org-a', saved()));
    expect(result.current.source).toBe('workspace');

    await act(async () => {
      await result.current.locate();
    });

    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('browser');
    expect(stored()).toMatchObject({ source: 'browser', language: 'ta' });
    // One request, for the place. Nothing was sent to the workspace's settings.
    expect(mockedApi.mock.calls.map(([path]) => path)).toEqual([
      '/discover/locality?lat=13.08&lng=80.27',
    ]);
  });

  it('remembers a search and Worldwide over the workspace place too', () => {
    const { result } = renderHook(() => usePlace('org-a', saved()));

    act(() => result.current.pickPlace(CHENNAI));
    expect(result.current.source).toBe('search');
    expect(stored()).toMatchObject({ source: 'search' });

    act(() => result.current.pickWorldwide());
    expect(result.current.source).toBe('worldwide');
    expect(stored()).toMatchObject({ source: 'worldwide' });
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('keeps a language switched on the workspace place, and still follows a new default', () => {
    const first = renderHook(() => usePlace('org-a', saved({ place: CHENNAI, languages: ['ta'] })));
    act(() => first.result.current.setLanguage('en'));
    expect(first.result.current.source).toBe('workspace');
    expect(stored()).toMatchObject({ source: 'workspace', language: 'en' });
    first.unmount();

    // Next visit, same default: the person's English stays.
    const again = renderHook(() => usePlace('org-a', saved({ place: CHENNAI, languages: ['ta'] })));
    expect(again.result.current.place).toEqual(CHENNAI);
    expect(again.result.current.language).toBe('en');
    again.unmount();

    // The admin moved the workspace to Paris: it reaches them, they never chose a place.
    const moved = renderHook(() => usePlace('org-a', saved()));
    expect(moved.result.current.place).toEqual(PARIS);
    expect(moved.result.current.source).toBe('workspace');
    expect(moved.result.current.language).toBe('fr');
  });

  it('does not move the place being read when the default is saved from this page', () => {
    const { result, rerender } = renderHook(({ settings }) => usePlace('org-a', settings), {
      initialProps: { settings: saved() },
    });
    act(() => result.current.pickPlace(CHENNAI));

    rerender({ settings: saved({ place: INDIA, languages: ['hi'] }) });
    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('search');
  });

  it('reads the place as the workspace one once it is saved for the workspace', async () => {
    const { result } = renderHook(() => usePlace('org-a', NOTHING_SAVED));
    await waitFor(() => expect(result.current.place).toEqual(INDIA));
    act(() => result.current.pickPlace(CHENNAI));
    act(() => result.current.setLanguage('en'));

    act(() => result.current.followWorkspace());

    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('workspace');
    expect(result.current.language).toBe('en');
    expect(stored()).toMatchObject({ source: 'workspace', language: 'en' });
  });
});

describe('the News topic (Module 06)', () => {
  it("opens on the workspace's first topic, and on All without one", async () => {
    const business = renderHook(() => usePlace('org-a', saved()));
    expect(business.result.current.topic).toBe('BUSINESS');

    const all = renderHook(() => usePlace('org-b', saved({ topics: [] })));
    expect(all.result.current.topic).toBeNull();

    const none = renderHook(() => usePlace('org-c'));
    await waitFor(() => expect(none.result.current.place).not.toBeNull());
    expect(none.result.current.topic).toBeNull();
  });

  it('remembers a picked topic with the place', () => {
    const first = renderHook(() => usePlace('org-a', saved()));
    act(() => first.result.current.pickPlace(CHENNAI));
    act(() => first.result.current.setTopic('SPORTS'));

    expect(first.result.current.topic).toBe('SPORTS');
    expect(stored()).toMatchObject({ v: 1, source: 'search', language: 'ta', topic: 'SPORTS' });
    first.unmount();

    const again = renderHook(() => usePlace('org-a', saved()));
    expect(again.result.current.topic).toBe('SPORTS');
  });

  it("remembers All as a choice, over the workspace's topic", () => {
    const first = renderHook(() => usePlace('org-a', saved()));
    act(() => first.result.current.setTopic(null));

    expect(first.result.current.topic).toBeNull();
    expect(stored()).toMatchObject({ topic: 'ALL' });
    first.unmount();

    const again = renderHook(() => usePlace('org-a', saved()));
    expect(again.result.current.topic).toBeNull();
  });

  it('carries the topic through a change of place and of language', () => {
    const { result } = renderHook(() => usePlace('org-a', saved()));
    act(() => result.current.setTopic('HEALTH'));

    act(() => result.current.pickPlace(CHENNAI));
    expect(stored()).toMatchObject({ source: 'search', topic: 'HEALTH' });

    act(() => result.current.setLanguage('en'));
    expect(stored()).toMatchObject({ language: 'en', topic: 'HEALTH' });
    expect(result.current.topic).toBe('HEALTH');
  });

  it('reads a record stored before topics existed, and falls back to the workspace topic', () => {
    window.localStorage.setItem(
      placeStorageKey('org-a'),
      JSON.stringify({ v: 1, place: CHENNAI, source: 'browser', language: 'ta' }),
    );
    const { result } = renderHook(() => usePlace('org-a', saved()));

    expect(result.current.place).toEqual(CHENNAI);
    expect(result.current.source).toBe('browser');
    expect(result.current.topic).toBe('BUSINESS');
  });
});
