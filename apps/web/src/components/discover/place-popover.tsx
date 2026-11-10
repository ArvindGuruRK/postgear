'use client';

/**
 * What the place chip opens (blueprint section 3): Use My Location with the
 * sentence that says what happens to the position, a city search, Worldwide
 * and the OpenStreetMap credit.
 *
 * The search asks only on Enter or the Search button, never as someone types:
 * OpenStreetMap's place service forbids lookups per keystroke, and the API
 * holds everyone to one a second. So this is a form, not a combobox, and its
 * results are a plain list of buttons: arrow keys walk them from the field,
 * Enter picks the one in focus.
 *
 * When the browser says no, or cannot find a position, the sentence becomes a
 * warning and the field takes the focus, since typing the city is the way on.
 */
import { GlobeIcon } from '@animateicons/react/lucide/globe-icon';
import { MapPinIcon } from '@animateicons/react/lucide/map-pin-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { Alert, Button, cn, Input, List, ListItem, MotionIcon } from '@postgear/ui';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { searchPlaces } from '@/lib/discover-api';
import type { Locality } from '@/types/discover';
import { placeResultText } from './discover-model';
import { PlacesCredit } from './discover-ui';
import type { PlaceStatus } from './use-place';

export const CONSENT_SENTENCE =
  'We use your location once to find your city. We keep the city, not your position.';
export const SEARCH_TOO_SHORT = 'Enter at least two letters of the city.';
export const SEARCH_FAILED = 'Places are not available right now. Try again in a few minutes.';
export const GEOCODER_OFF = 'Finding places is turned off on this PostGear.';

/** The API returns up to eight; the story says no more are shown. */
const MAX_RESULTS = 8;

export interface PlacePopoverProps {
  status: PlaceStatus;
  /** The sentence for `denied` or `unavailable`. */
  message: string | null;
  /** `off` hides the two ways that need the place service. */
  geocoder: 'nominatim' | 'off';
  onLocate: () => void;
  onPick: (place: Locality) => void;
  onWorldwide: () => void;
}

export function PlacePopover({
  status,
  message,
  geocoder,
  onLocate,
  onPick,
  onWorldwide,
}: PlacePopoverProps) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState('');
  const [results, setResults] = useState<Locality[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const resolving = status === 'resolving';
  const blocked = status === 'denied' || status === 'unavailable';

  // The way on after a refusal is the field, so it takes the focus.
  useEffect(() => {
    if (blocked) inputRef.current?.focus();
  }, [blocked]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = text.replace(/\s+/g, ' ').trim();
    setNote(null);
    setProblem(null);

    if (query.length < 2) {
      setResults(null);
      setProblem(SEARCH_TOO_SHORT);
      inputRef.current?.focus();
      return;
    }

    setSearching(true);
    try {
      const answer = await searchPlaces(query);
      setResults(answer.localities.slice(0, MAX_RESULTS));
      setNote(answer.message ?? null);
    } catch (cause) {
      setResults(null);
      setProblem(cause instanceof ApiError && cause.status !== 0 ? cause.message : SEARCH_FAILED);
    } finally {
      setSearching(false);
    }
  }

  function resultButtons(): HTMLButtonElement[] {
    return Array.from(listRef.current?.querySelectorAll('button') ?? []);
  }

  function fieldKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      const first = resultButtons()[0];
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function listKeys(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = resultButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();

    if (event.key === 'ArrowUp' && at === 0) {
      inputRef.current?.focus();
      return;
    }
    const next = event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : at - 1;
    buttons[next]?.focus();
  }

  if (geocoder === 'off') {
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 font-sans text-sm text-ink">{GEOCODER_OFF}</p>
        <Button variant="secondary" onClick={onWorldwide} className="self-start">
          <MotionIcon icon={GlobeIcon} className="h-4 w-4" />
          Worldwide
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={onLocate}
          disabled={resolving}
          aria-busy={resolving}
          className="self-start"
        >
          <MotionIcon icon={MapPinIcon} className="h-4 w-4" />
          {resolving ? 'Finding Your City…' : 'Use My Location'}
        </Button>
        {blocked && message ? (
          <Alert variant="warning" className="px-3 py-2 text-xs">
            {message}
          </Alert>
        ) : (
          <p className="m-0 font-sans text-xs text-ink type-muted">{CONSENT_SENTENCE}</p>
        )}
      </div>

      <form onSubmit={search} className="flex flex-col gap-2" noValidate>
        <label htmlFor={fieldId} className="font-sans text-sm font-bold text-ink">
          Search for a city
        </label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id={fieldId}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={fieldKeys}
            placeholder="Enter your city"
            autoComplete="address-level2"
            maxLength={80}
            className="h-10 min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-10 shrink-0"
            disabled={searching}
            aria-busy={searching}
          >
            <MotionIcon icon={SearchIcon} className="h-4 w-4" />
            Search
          </Button>
        </div>

        <div aria-live="polite" className="flex flex-col gap-2">
          {problem ? (
            <Alert variant="warning" className="px-3 py-2 text-xs">
              {problem}
            </Alert>
          ) : null}
          {note ? <p className="m-0 font-sans text-xs text-ink">{note}</p> : null}
          {results && results.length > 0 ? (
            <List
              ref={listRef}
              aria-label="Places found"
              onKeyDown={listKeys}
              className="max-h-64 overflow-y-auto bg-inset pg-scrollbar"
            >
              {results.map((result) => {
                const label = placeResultText(result);
                return (
                  <ListItem
                    key={`${result.countryCode}|${result.regionCode}|${label}`}
                    className="p-0"
                  >
                    <button
                      type="button"
                      onClick={() => onPick(result)}
                      className={cn(
                        'w-full px-3 py-2.5 text-start font-sans text-sm text-ink',
                        'outline-none hover:bg-primary focus-visible:bg-actionPrimary focus-visible:text-onActionPrimary',
                      )}
                    >
                      {label}
                    </button>
                  </ListItem>
                );
              })}
            </List>
          ) : null}
        </div>
      </form>

      <Button variant="secondary" onClick={onWorldwide} className="self-start">
        <MotionIcon icon={GlobeIcon} className="h-4 w-4" />
        Worldwide
      </Button>

      <PlacesCredit />
    </div>
  );
}
