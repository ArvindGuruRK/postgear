/**
 * The place popover: the city search asks only on Enter or the Search button,
 * never while typing; a refusal from the browser shows its sentence and puts
 * the focus in the field; results are picked by click or by keyboard.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { searchPlaces } from '@/lib/discover-api';
import type { Locality } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import {
  CONSENT_SENTENCE,
  GEOCODER_OFF,
  PlacePopover,
  type PlacePopoverProps,
  SEARCH_TOO_SHORT,
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
});
