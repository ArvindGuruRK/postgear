/**
 * The place popover: the city search asks only on Enter or the Search button,
 * never while typing; a refusal from the browser shows its sentence and puts
 * the focus in the field; results are picked by click or by keyboard.
 *
 * Module 06: the workspace's saved place under Worldwide, Save For This
 * Workspace for an admin, the same button disabled with its reason for a
 * member, and the finder on its own as Settings draws it.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { searchPlaces } from '@/lib/discover-api';
import type { DiscoverSettings, Locality } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import {
  CONSENT_SENTENCE,
  GEOCODER_OFF,
  PlaceFinder,
  type PlaceFinderProps,
  PlacePopover,
  type PlacePopoverProps,
  SEARCH_TOO_SHORT,
  WorkspaceDefault,
  type WorkspaceDefaultProps,
} from './place-popover';
import { LOCATION_MESSAGES } from './use-place';

jest.mock('@/lib/discover-api', () => ({ searchPlaces: jest.fn() }));

const mockedSearch = searchPlaces as jest.MockedFunction<typeof searchPlaces>;

beforeAll(stubBrowserLayout);

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

const PARIS_TEXAS: Locality = {
  ...PARIS,
  countryCode: 'US',
  countryName: 'United States',
  regionCode: 'US-TX',
  regionName: 'Texas',
  timeZone: 'America/Chicago',
  languages: ['en', 'es'],
  newsLanguages: ['en', 'es-419'],
};

function renderPopover(props: Partial<PlacePopoverProps> = {}) {
  const handlers = {
    onLocate: jest.fn(),
    onPick: jest.fn(),
    onWorldwide: jest.fn(),
  };
  render(
    <TooltipProvider>
      <PlacePopover status="idle" message={null} geocoder="nominatim" {...handlers} {...props} />
    </TooltipProvider>,
  );
  return handlers;
}

function field(): HTMLInputElement {
  return screen.getByPlaceholderText('Enter your city') as HTMLInputElement;
}

beforeEach(() => {
  mockedSearch.mockReset();
  mockedSearch.mockResolvedValue({ localities: [PARIS, PARIS_TEXAS] });
});

describe('PlacePopover', () => {
  it('says what happens to the position before it is asked for', () => {
    const handlers = renderPopover();
    expect(screen.getByText(CONSENT_SENTENCE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use My Location' }));
    expect(handlers.onLocate).toHaveBeenCalledTimes(1);
  });

  it('never searches while typing', () => {
    renderPopover();
    fireEvent.change(field(), { target: { value: 'p' } });
    fireEvent.change(field(), { target: { value: 'pa' } });
    fireEvent.change(field(), { target: { value: 'paris' } });

    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('searches once on Enter and lists the places', async () => {
    renderPopover();
    fireEvent.change(field(), { target: { value: '  paris  ' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearch).toHaveBeenCalledWith('paris');
    expect(
      screen.getByRole('button', { name: 'Paris, Ile-de-France, France' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paris, Texas, United States' })).toBeInTheDocument();
  });

  it('searches with the Search button too', async () => {
    renderPopover();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    });
    expect(mockedSearch).toHaveBeenCalledWith('paris');
  });

  it('asks for two letters before searching', async () => {
    renderPopover();
    fireEvent.change(field(), { target: { value: ' p ' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    expect(mockedSearch).not.toHaveBeenCalled();
    expect(screen.getByText(SEARCH_TOO_SHORT)).toBeInTheDocument();
  });

  it('picks a place by click', async () => {
    const handlers = renderPopover();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Paris, Texas, United States' }));
    expect(handlers.onPick).toHaveBeenCalledWith(PARIS_TEXAS);
  });

  it('walks the results with the arrow keys from the field', async () => {
    renderPopover();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const first = screen.getByRole('button', { name: 'Paris, Ile-de-France, France' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Paris, Texas, United States' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(field()).toHaveFocus();
  });

  it("shows the API's sentence when nothing is found", async () => {
    mockedSearch.mockResolvedValue({
      localities: [],
      message: "No places found for 'nowhere'. Try the city's English name.",
    });
    renderPopover();
    fireEvent.change(field(), { target: { value: 'nowhere' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    expect(
      screen.getByText("No places found for 'nowhere'. Try the city's English name."),
    ).toBeInTheDocument();
  });

  it('shows the throttle sentence as a warning', async () => {
    mockedSearch.mockRejectedValue(
      new ApiError('Try again in a moment.', 429, 'locality_throttled'),
    );
    renderPopover();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Try again in a moment.');
  });

  it('says places are not available when the search never reached the API, and lists nothing', async () => {
    mockedSearch.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPopover();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Places are not available right now. Try again in a few minutes.',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // Worldwide still works with the place finder down.
    expect(screen.getByRole('button', { name: 'Worldwide' })).toBeEnabled();
  });

  it('replaces the consent sentence with the warning and focuses the field when blocked', () => {
    renderPopover({ status: 'denied', message: LOCATION_MESSAGES.denied });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Location is blocked in your browser. Search for your city instead.',
    );
    expect(screen.queryByText(CONSENT_SENTENCE)).not.toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('says when the position could not be found', () => {
    renderPopover({ status: 'unavailable', message: LOCATION_MESSAGES.unavailable });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not find your location. Search for your city instead.',
    );
    expect(field()).toHaveFocus();
  });

  it('is busy while the browser looks', () => {
    renderPopover({ status: 'resolving' });
    expect(screen.getByRole('button', { name: 'Finding Your City…' })).toBeDisabled();
  });

  it('offers Worldwide', () => {
    const handlers = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Worldwide' }));
    expect(handlers.onWorldwide).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('offers only Worldwide when finding places is turned off', () => {
    renderPopover({ geocoder: 'off' });
    expect(screen.getByText(GEOCODER_OFF)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use My Location' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your city')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Worldwide' })).toBeInTheDocument();
  });

  it('draws nothing about the workspace unless it is handed in', () => {
    renderPopover();
    expect(screen.queryByTestId('discover-workspace-default')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save For This Workspace' }),
    ).not.toBeInTheDocument();
  });
});

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

const SAVED: DiscoverSettings = {
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
};

const NOTHING_SAVED: DiscoverSettings = {
  ...SAVED,
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
};

function workspace(patch: Partial<WorkspaceDefaultProps> = {}): WorkspaceDefaultProps {
  return {
    settings: SAVED,
    isAdmin: true,
    saving: false,
    error: null,
    onSave: jest.fn(),
    ...patch,
  };
}

describe('the workspace place in the popover (Module 06)', () => {
  it('says what the workspace starts from, under Worldwide', () => {
    renderPopover({ workspace: workspace() });

    const line = screen.getByTestId('discover-workspace-default');
    expect(line).toHaveTextContent('Workspace default: Chennai, Tamil Nadu');
    const worldwide = screen.getByRole('button', { name: 'Worldwide' });
    expect(worldwide.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says when there is no workspace place yet, and names a saved Worldwide', () => {
    const { unmount } = render(
      <TooltipProvider>
        <WorkspaceDefault {...workspace({ settings: NOTHING_SAVED })} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'No workspace default yet.',
    );
    unmount();

    const world = { ...PARIS, countryCode: null, countryName: null, regionCode: null };
    render(
      <TooltipProvider>
        <WorkspaceDefault
          {...workspace({ settings: { ...NOTHING_SAVED, locationSource: 'SEARCH', place: world } })}
        />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Worldwide',
    );
  });

  it('lets an admin save, with no tooltip in the way', () => {
    const props = workspace();
    renderPopover({ workspace: props });

    const save = screen.getByRole('button', { name: 'Save For This Workspace' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('shows a member the button disabled, with the reason in a tooltip', async () => {
    const props = workspace({ isAdmin: false });
    renderPopover({ workspace: props });

    const save = screen.getByRole('button', { name: 'Save For This Workspace' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(props.onSave).not.toHaveBeenCalled();

    // A disabled button takes no focus, so the wrapper around it does.
    const reach = save.parentElement as HTMLElement;
    expect(reach).toHaveAttribute('tabindex', '0');
    await act(async () => {
      fireEvent.focus(reach);
    });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Only workspace admins can change the workspace place.',
    );
    // The member still reads what the workspace starts from.
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
  });

  it('is busy while the save is on its way', () => {
    renderPopover({ workspace: workspace({ saving: true }) });

    const save = screen.getByRole('button', { name: 'Saving…' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
  });

  it("shows the API's sentence when a save is refused, with Try Again", () => {
    const props = workspace({ error: 'Choose a real country for the workspace place.' });
    renderPopover({ workspace: props });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Choose a real country for the workspace place.');
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the button but drops the line when the settings could not be read', () => {
    renderPopover({ workspace: workspace({ settings: null }) });

    expect(screen.queryByTestId('discover-workspace-default')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save For This Workspace' })).toBeEnabled();
  });

  it('still shows the line and the button with the place finder off', () => {
    renderPopover({ geocoder: 'off', workspace: workspace() });

    expect(screen.getByText(GEOCODER_OFF)).toBeInTheDocument();
    expect(screen.getByTestId('discover-workspace-default')).toHaveTextContent(
      'Workspace default: Chennai, Tamil Nadu',
    );
    expect(screen.getByRole('button', { name: 'Save For This Workspace' })).toBeEnabled();
  });
});

describe('PlaceFinder on its own (the Settings card draws it)', () => {
  function renderFinder(props: Partial<PlaceFinderProps> = {}) {
    const handlers = { onLocate: jest.fn(), onPick: jest.fn(), onWorldwide: jest.fn() };
    render(
      <TooltipProvider>
        <PlaceFinder status="idle" message={null} geocoder="nominatim" {...handlers} {...props} />
      </TooltipProvider>,
    );
    return handlers;
  }

  it('has no workspace line, no save button and no credit of its own', () => {
    renderFinder();

    expect(screen.getByRole('button', { name: 'Use My Location' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Worldwide' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Save For This Workspace' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'OpenStreetMap contributors' }),
    ).not.toBeInTheDocument();
  });

  it('clears the search once a place is picked', async () => {
    const handlers = renderFinder();
    fireEvent.change(field(), { target: { value: 'paris' } });
    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Paris, Ile-de-France, France' }));

    expect(handlers.onPick).toHaveBeenCalledWith(PARIS);
    expect(screen.queryByRole('list', { name: 'Places found' })).not.toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('turns every control off when disabled, and never searches', async () => {
    const handlers = renderFinder({ disabled: true });

    expect(screen.getByRole('button', { name: 'Use My Location' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Worldwide' })).toBeDisabled();
    expect(field()).toBeDisabled();

    await act(async () => {
      fireEvent.submit(field().closest('form') as HTMLFormElement);
    });
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(handlers.onLocate).not.toHaveBeenCalled();
  });
});
