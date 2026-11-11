/**
 * Settings, Discover: each card saves on its own with exactly its own body in
 * one request, shows the change at once and puts it back when the save is
 * refused (with the API's sentence and Try Again), and a member reads the same
 * page with every control disabled and never sends a save.
 */
import '@testing-library/jest-dom';
import { TooltipProvider, toast } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type { DiscoverSettings, Locality } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { DiscoverSettingsForm, type DiscoverSettingsFormProps } from './discover-settings';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

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
  languages: ['ta', 'en', 'te'],
  newsLanguages: ['ta', 'en', 'te'],
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

const WORLD: Locality = {
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: ['en'],
  newsLanguages: ['en'],
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

const getCurrentPosition = jest.fn();

/**
 * The API for these tests. A save answers `afterSave(body)` (by default the
 * settings it was given, with the body laid over them), or is refused.
 */
function answer(
  current: DiscoverSettings,
  afterSave: (body: Partial<DiscoverSettings>) => DiscoverSettings | Promise<DiscoverSettings> = (
    body,
  ) => ({ ...current, ...body }),
) {
  mockedApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    if (path === '/discover/settings' && options?.method === 'PATCH') {
      return Promise.resolve()
        .then(() => afterSave(options.body as Partial<DiscoverSettings>))
        .then((settings) => ({ settings }));
    }
    if (path === '/discover/settings') return Promise.resolve({ settings: current });
    if (path.startsWith('/discover/locality/search')) {
      return Promise.resolve({ localities: [PARIS] });
    }
    if (path.startsWith('/discover/locality?lat=')) return Promise.resolve({ locality: PARIS });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderForm(props: Partial<DiscoverSettingsFormProps> = {}) {
  return render(
    <TooltipProvider>
      <DiscoverSettingsForm initial={saved()} isAdmin geocoder="nominatim" {...props} />
    </TooltipProvider>,
  );
}

/** Every save sent so far, as its body. */
function saves(): unknown[] {
  return mockedApi.mock.calls
    .filter(([path, options]) => path === '/discover/settings' && options?.method === 'PATCH')
    .map(([, options]) => options?.body);
}

function languageRows(): string[] {
  return screen
    .queryAllByTestId('discover-settings-language')
    .map((row) => row.textContent?.replace(/^\d+/, '') ?? '');
}

function placeText(): HTMLElement {
  return screen.getByTestId('discover-settings-place-text');
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function searchFor(text: string) {
  const field = screen.getByPlaceholderText('Enter your city');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.submit(field.closest('form') as HTMLFormElement);
  });
}

beforeEach(() => {
  mockedApi.mockReset();
  mockedToast.mockReset();
  answer(saved());
  getCurrentPosition.mockReset();
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  Object.defineProperty(window.navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockResolvedValue({ state: 'prompt' }) },
  });
});

describe('what the page shows', () => {
  it('shows the four cards with what is saved, and asks for nothing', () => {
    renderForm({ initial: saved({ sources: { social: false } }) });

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Workspace Place', 'Languages', 'News Topics', 'Sources']);
    expect(placeText()).toHaveTextContent('Chennai, Tamil Nadu, India');
    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English']);
    expect(screen.getByRole('checkbox', { name: 'Business' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sports' })).not.toBeChecked();
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(screen.getByRole('switch', { name: 'Worldwide Social' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Rising Searches' })).toBeChecked();
    expect(screen.getAllByRole('switch')).toHaveLength(5);
    expect(screen.queryByTestId('discover-settings-read-only')).not.toBeInTheDocument();
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('says when nothing is saved yet', () => {
    renderForm({ initial: NOTHING_SAVED });

    expect(placeText()).toHaveTextContent('No workspace default yet.');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(
      screen.getByText('No languages yet. Discover opens in the first language of the place.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Save a workspace place to add its languages.')).toBeInTheDocument();
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeChecked();
  });

  it('loads for itself when the server could not, and offers Try Again when that fails too', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('Try again in a moment.', 503));
    renderForm({ initial: null });

    const alert = await screen.findByTestId('discover-settings-error');
    expect(alert).toHaveTextContent('Try again in a moment.');
    expect(screen.queryByTestId('discover-settings-place-text')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);

    await click(within(alert).getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByTestId('discover-settings-place-text')).toHaveTextContent(
      'Chennai, Tamil Nadu, India',
    );
    expect(screen.queryByTestId('discover-settings-error')).not.toBeInTheDocument();
    expect(mockedApi.mock.calls.map(([path]) => path)).toEqual([
      '/discover/settings',
      '/discover/settings',
    ]);
    expect(saves()).toEqual([]);
  });

  it('takes the settings the server reads a moment later, over a read of its own that failed', async () => {
    // The first page after signing in: no workspace cookie yet, so the server hands down null.
    mockedApi.mockRejectedValueOnce(new ApiError('Try again in a moment.', 503));
    const { rerender } = renderForm({ initial: null });
    expect(await screen.findByTestId('discover-settings-error')).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <DiscoverSettingsForm initial={saved()} isAdmin geocoder="nominatim" />
      </TooltipProvider>,
    );

    expect(await screen.findByTestId('discover-settings-place-text')).toHaveTextContent(
      'Chennai, Tamil Nadu, India',
    );
    expect(screen.queryByTestId('discover-settings-error')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
    expect(saves()).toEqual([]);
  });
});

describe('Workspace Place', () => {
  it('saves a searched place whole, with its languages, in one request', async () => {
    answer(saved(), (body) => saved({ ...body, place: PARIS }));
    renderForm();
    await searchFor('paris');

    await click(screen.getByRole('button', { name: 'Paris, Ile-de-France, France' }));

    expect(placeText()).toHaveTextContent('Paris, Ile-de-France, France');
    expect(languageRows()).toEqual(['Français French']);
    expect(saves()).toEqual([
      {
        countryCode: 'FR',
        regionCode: 'FR-IDF',
        regionName: 'Ile-de-France',
        city: 'Paris',
        timeZone: 'Europe/Paris',
        languages: ['fr'],
        locationSource: 'SEARCH',
      },
    ]);
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Paris, Ile-de-France, France is now the workspace default.',
    });
    // The search is done with: no list left, the field empty.
    expect(screen.queryByRole('list', { name: 'Places found' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your city')).toHaveValue('');
  });

  it('shows the picked place and its languages before the API answers', async () => {
    let finish: (settings: DiscoverSettings) => void = () => undefined;
    answer(saved(), () => new Promise<DiscoverSettings>((resolve) => (finish = resolve)));
    renderForm();
    await searchFor('paris');

    await click(screen.getByRole('button', { name: 'Paris, Ile-de-France, France' }));

    expect(placeText()).toHaveTextContent('Paris, Ile-de-France, France');
    expect(languageRows()).toEqual(['Français French']);
    expect(screen.getByTestId('discover-settings-place')).toHaveAttribute('aria-busy', 'true');
    // One change at a time: everything waits for the answer.
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Videos' })).toBeDisabled();
    expect(mockedToast).not.toHaveBeenCalled();

    await act(async () => {
      finish(saved({ countryCode: 'FR', city: 'Paris', languages: ['fr'], place: PARIS }));
    });
    expect(screen.getByRole('switch', { name: 'Videos' })).toBeEnabled();
    expect(mockedToast).toHaveBeenCalledTimes(1);
  });

  it("saves the browser's place as found by the browser", async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 48.856_613, longitude: 2.352_222 } } as GeolocationPosition),
    );
    answer(saved(), (body) => saved({ ...body, place: PARIS }));
    renderForm();

    await click(screen.getByRole('button', { name: 'Use My Location' }));

    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(mockedApi).toHaveBeenCalledWith('/discover/locality?lat=48.86&lng=2.35');
    expect(saves()[0]).toEqual({
      countryCode: 'FR',
      regionCode: 'FR-IDF',
      regionName: 'Ile-de-France',
      city: 'Paris',
      timeZone: 'Europe/Paris',
      languages: ['fr'],
      locationSource: 'BROWSER',
    });
    expect(placeText()).toHaveTextContent('Paris, Ile-de-France, France');
  });

  it('explains a blocked location and saves nothing', async () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1, message: 'denied' } as GeolocationPositionError),
    );
    renderForm();

    await click(screen.getByRole('button', { name: 'Use My Location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Location is blocked in your browser. Search for your city instead.',
    );
    expect(saves()).toEqual([]);
    expect(placeText()).toHaveTextContent('Chennai, Tamil Nadu, India');
  });

  it('saves Worldwide as a place of its own: nulls, with a source', async () => {
    answer(saved(), (body) => saved({ ...body, place: WORLD }));
    renderForm();

    await click(screen.getByRole('button', { name: 'Worldwide' }));

    expect(saves()).toEqual([
      {
        countryCode: null,
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: null,
        languages: ['en'],
        locationSource: 'SEARCH',
      },
    ]);
    expect(placeText()).toHaveTextContent('Worldwide');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('clears the place with no red button and no confirm, leaving the languages alone', async () => {
    answer(saved(), (body) => saved({ ...body, place: null }));
    renderForm();

    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear.className).not.toContain('bg-actionDanger');
    await click(clear);

    expect(saves()).toEqual([
      {
        countryCode: null,
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: null,
        locationSource: 'NONE',
      },
    ]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(placeText()).toHaveTextContent('No workspace default yet.');
    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English']);
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'This workspace has no default place now.',
    });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('offers only Worldwide when this PostGear cannot look a city up', () => {
    renderForm({ geocoder: 'off' });

    expect(screen.getByText('Finding places is turned off on this PostGear.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use My Location' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your city')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Worldwide' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });
});

describe('Languages', () => {
  it('moves a language down and up, sending the whole list each time', async () => {
    renderForm();

    expect(screen.getByRole('button', { name: 'Move Tamil up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move English down' })).toBeDisabled();

    await click(screen.getByRole('button', { name: 'Move Tamil down' }));
    expect(saves()).toEqual([{ languages: ['en', 'ta'] }]);
    expect(languageRows()).toEqual(['English', 'தமிழ் Tamil']);

    await click(screen.getByRole('button', { name: 'Move Tamil up' }));
    expect(saves()).toEqual([{ languages: ['en', 'ta'] }, { languages: ['ta', 'en'] }]);
    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English']);
    expect(mockedToast).toHaveBeenLastCalledWith({
      title: 'Saved',
      description: 'Languages updated for this workspace.',
    });
  });

  it('removes a language', async () => {
    renderForm();

    await click(screen.getByRole('button', { name: 'Remove Tamil' }));

    expect(saves()).toEqual([{ languages: ['en'] }]);
    expect(languageRows()).toEqual(['English']);
  });

  it("adds one of the place's languages at the end", async () => {
    renderForm();
    const add = screen.getByTestId('discover-settings-add-language');
    expect(add).toHaveTextContent('Choose a language');

    fireEvent.keyDown(add, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    // Tamil and English are listed already; Telugu is the place's third.
    expect(options.map((option) => option.textContent)).toEqual(['తెలుగు Telugu']);
    await act(async () => {
      fireEvent.keyDown(options[0] as HTMLElement, { key: 'Enter' });
    });

    expect(saves()).toEqual([{ languages: ['ta', 'en', 'te'] }]);
    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English', 'తెలుగు Telugu']);
    // Nothing is left to add, and the page says so.
    expect(screen.getByTestId('discover-settings-add-language')).toBeDisabled();
    expect(screen.getByText('Every language of this place is in the list.')).toBeInTheDocument();
  });

  it('offers English alone without a saved place', async () => {
    renderForm({ initial: NOTHING_SAVED });

    const add = screen.getByTestId('discover-settings-add-language');
    fireEvent.keyDown(add, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['English']);
  });

  it('stops at six languages', () => {
    const many = { ...CHENNAI, newsLanguages: ['ta', 'en', 'te', 'hi', 'ml', 'kn', 'mr', 'bn'] };
    renderForm({
      initial: saved({ place: many, languages: ['ta', 'en', 'te', 'hi', 'ml', 'kn'] }),
    });

    expect(languageRows()).toHaveLength(6);
    expect(screen.getByTestId('discover-settings-add-language')).toBeDisabled();
    expect(
      screen.getByText('You can keep up to 6 languages. Remove one to add another.'),
    ).toBeInTheDocument();
    expect(saves()).toEqual([]);
  });
});

describe('News Topics', () => {
  it("saves ticked topics in the list's order, top to bottom", async () => {
    renderForm();

    await click(screen.getByRole('checkbox', { name: 'Sports' }));
    expect(saves()).toEqual([{ topics: ['BUSINESS', 'SPORTS'] }]);

    // World is ticked last, and still saved first: it is higher in the list.
    await click(screen.getByRole('checkbox', { name: 'World' }));
    expect(saves()[1]).toEqual({ topics: ['WORLD', 'BUSINESS', 'SPORTS'] });
    expect(screen.getByRole('checkbox', { name: 'World' })).toBeChecked();
    expect(mockedToast).toHaveBeenLastCalledWith({
      title: 'Saved',
      description: 'News topics updated for this workspace.',
    });
  });

  it('clears the last topic down to none', async () => {
    renderForm();

    await click(screen.getByRole('checkbox', { name: 'Business' }));

    expect(saves()).toEqual([{ topics: [] }]);
    expect(screen.getByRole('checkbox', { name: 'Business' })).not.toBeChecked();
  });
});

describe('Sources', () => {
  it('sends all five switches when one is turned off', async () => {
    renderForm();

    await click(screen.getByRole('switch', { name: 'Worldwide Social' }));

    expect(saves()).toEqual([
      {
        sources: { trends: true, wikipedia: true, social: false, videos: true, festivals: true },
      },
    ]);
    expect(screen.getByRole('switch', { name: 'Worldwide Social' })).not.toBeChecked();
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Worldwide Social turned off for this workspace.',
    });
  });

  it('keeps the other switches as they were, and turns one back on', async () => {
    renderForm({ initial: saved({ sources: { social: false, videos: false } }) });

    await click(screen.getByRole('switch', { name: 'Videos' }));

    expect(saves()).toEqual([
      {
        sources: { trends: true, wikipedia: true, social: false, videos: true, festivals: true },
      },
    ]);
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Videos turned on for this workspace.',
    });
  });

  it('gives every switch a sentence of help', () => {
    renderForm();

    expect(
      screen.getByText('What Bluesky and Mastodon are talking about. Not local to your place.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Festivals and public holidays of the next 30 days, on the Festivals tab.'),
    ).toBeInTheDocument();
  });
});

describe('a save that is refused', () => {
  it("puts the switch back, shows the API's sentence, and Try Again repeats the same save", async () => {
    answer(saved(), () => {
      throw new ApiError('Discover settings could not be saved.', 500);
    });
    renderForm();

    await click(screen.getByRole('switch', { name: 'Videos' }));

    expect(screen.getByRole('switch', { name: 'Videos' })).toBeChecked();
    const alert = screen.getByTestId('discover-settings-error');
    expect(alert).toHaveTextContent('Discover settings could not be saved.');
    expect(mockedToast).not.toHaveBeenCalled();

    answer(saved());
    await click(within(alert).getByRole('button', { name: 'Try Again' }));

    expect(saves()).toHaveLength(2);
    expect(saves()[1]).toEqual(saves()[0]);
    expect(screen.getByRole('switch', { name: 'Videos' })).not.toBeChecked();
    expect(screen.queryByTestId('discover-settings-error')).not.toBeInTheDocument();
    expect(mockedToast).toHaveBeenCalledTimes(1);
  });

  it('puts the language order back', async () => {
    answer(saved(), () => {
      throw new ApiError('Discover settings could not be saved.', 500);
    });
    renderForm();

    await click(screen.getByRole('button', { name: 'Move Tamil down' }));

    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English']);
    expect(screen.getByTestId('discover-settings-error')).toBeInTheDocument();
  });

  it('puts the topics and the place back', async () => {
    answer(saved(), () => {
      throw new ApiError('Discover settings could not be saved.', 500);
    });
    renderForm();

    await click(screen.getByRole('checkbox', { name: 'Sports' }));
    expect(screen.getByRole('checkbox', { name: 'Sports' })).not.toBeChecked();

    await click(screen.getByRole('button', { name: 'Clear' }));
    expect(placeText()).toHaveTextContent('Chennai, Tamil Nadu, India');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('says a plain sentence when the API did not answer at all', async () => {
    answer(saved(), () => {
      throw new TypeError('Failed to fetch');
    });
    renderForm();

    await click(screen.getByRole('switch', { name: 'Videos' }));

    expect(screen.getByTestId('discover-settings-error')).toHaveTextContent(
      "Couldn't save that change.",
    );
  });
});

describe('a member', () => {
  it('reads the same page with one line saying why nothing can be changed', () => {
    renderForm({ isAdmin: false });

    const notice = screen.getByTestId('discover-settings-read-only');
    expect(notice).toHaveTextContent('Only workspace admins can change these settings.');
    expect(notice).toHaveAttribute('role', 'alert');
    // The info alert of the design system (blue), not the danger one.
    expect(notice.className).toContain('bg-actionPrimary');
    expect(notice.className).not.toContain('bg-actionDanger');
    expect(placeText()).toHaveTextContent('Chennai, Tamil Nadu, India');
    expect(languageRows()).toEqual(['தமிழ் Tamil', 'English']);
  });

  it('finds every control disabled', () => {
    renderForm({ isAdmin: false });

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
    expect(screen.getByPlaceholderText('Enter your city')).toBeDisabled();
    expect(screen.getByTestId('discover-settings-add-language')).toBeDisabled();
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.getAllByRole('switch')).toHaveLength(5);
  });

  it('never sends a save, whatever is pressed', async () => {
    renderForm({ isAdmin: false });

    await click(screen.getByRole('button', { name: 'Clear' }));
    await click(screen.getByRole('button', { name: 'Worldwide' }));
    await click(screen.getByRole('button', { name: 'Use My Location' }));
    await click(screen.getByRole('button', { name: 'Move Tamil down' }));
    await click(screen.getByRole('button', { name: 'Remove English' }));
    await click(screen.getByRole('checkbox', { name: 'Sports' }));
    await click(screen.getByRole('switch', { name: 'Videos' }));
    await searchFor('paris');

    expect(mockedApi).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(mockedToast).not.toHaveBeenCalled();
  });

  it('still loads the settings for itself when the server could not', async () => {
    renderForm({ isAdmin: false, initial: null });

    expect(await screen.findByTestId('discover-settings-place-text')).toHaveTextContent(
      'Chennai, Tamil Nadu, India',
    );
    expect(mockedApi.mock.calls).toEqual([['/discover/settings']]);
  });
});
