'use client';

/**
 * What the place chip opens (blueprint section 3): Use My Location with the
 * sentence that says what happens to the position, a city search, Worldwide,
 * the workspace's saved place with Save For This Workspace (Module 06), and
 * the OpenStreetMap credit.
 *
 * It is three parts, so Settings can use the first without copying it:
 * `PlaceFinder` (the three ways to choose a place), `WorkspaceDefault` (the
 * saved place and the button) and `PlacePopover`, which stacks them.
 *
 * The search asks only on Enter or the Search button, never as someone types:
 * OpenStreetMap's place service forbids lookups per keystroke, and the API
 * holds everyone to one a second. So this is a form, not a combobox, and its
 * results are a plain list of buttons: arrow keys walk them from the field,
 * Enter picks the one in focus.
 *
 * Module 10: a PostGear running its own place finder (or the stand-in) says
 * so in its status (`typeahead`), and only then does the field suggest
 * places as someone types: after a pause, from two letters, with the
 * question before it cancelled. A PostGear with no place finder at all gets
 * the country and region lists instead (`place-picker.tsx`).
 *
 * When the browser says no, or cannot find a position, the sentence becomes a
 * warning and the field takes the focus, since typing the city is the way on.
 *
 * Only a workspace admin can save the place for everyone. A member sees the
 * same button disabled, with the reason in a tooltip, so the page never sends
 * a save the API would refuse.
 */
import { GlobeIcon } from '@animateicons/react/lucide/globe-icon';
import { MapPinIcon } from '@animateicons/react/lucide/map-pin-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { Alert, Button, cn, Input, List, ListItem, MotionIcon, TooltipHint } from '@postgear/ui';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { searchPlaces } from '@/lib/discover-api';
import type { DiscoverSettings, Locality } from '@/types/discover';
import { ADMINS_ONLY_PLACE, placeResultText, workspaceDefaultText } from './discover-model';
import { PlacesCredit } from './discover-ui';
import { PlacePicker } from './place-picker';
import type { PlaceStatus } from './use-place';

export const CONSENT_SENTENCE =
  'We use your location once to find your city. We keep the city, not your position.';
export const SEARCH_TOO_SHORT = 'Enter at least two letters of the city.';
export const SEARCH_FAILED = 'Places are not available right now. Try again in a few minutes.';
export const GEOCODER_OFF = 'Finding places is turned off on this PostGear.';
export const PICK_FROM_LIST = 'Choose a country, and a region if you like.';

/** How long the field waits after the last key before suggesting places. */
const TYPEAHEAD_PAUSE_MS = 350;

/** The API returns up to eight; the story says no more are shown. */
const MAX_RESULTS = 8;

export interface PlaceFinderProps {
  status: PlaceStatus;
  /** The sentence for `denied` or `unavailable`. */
  message: string | null;
  /** `off` hides the two ways that need the place service. */
  geocoder: 'nominatim' | 'off';
  onLocate: () => void;
  onPick: (place: Locality) => void;
  onWorldwide: () => void;
  /** Every control off: a member reading Settings, or a save on its way. */
  disabled?: boolean;
  /** Module 10: suggest places as someone types. Only with the operator's own place finder. */
  typeahead?: boolean;
}

/**
 * The three ways to choose a place: Use My Location, the city search and
 * Worldwide. The popover and the Workspace Place card in Settings both draw
 * this; what a chosen place does is the caller's.
 */
export function PlaceFinder({
  status,
  message,
  geocoder,
  onLocate,
  onPick,
  onWorldwide,
  disabled = false,
  typeahead = false,
}: PlaceFinderProps) {
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

  // Module 10: suggestions as someone types, only where the place finder is
  // the operator's own. A pause first, and a newer question cancels the last.
  const typed = text.replace(/\s+/g, ' ').trim();
  useEffect(() => {
    if (!typeahead || disabled || typed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchPlaces(typed, controller.signal)
        .then((answer) => {
          setProblem(null);
          setResults(answer.localities.slice(0, MAX_RESULTS));
          setNote(answer.message ?? null);
        })
        .catch(() => {
          // A suggestion that failed is not worth a warning: Search still works.
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, TYPEAHEAD_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [typeahead, disabled, typed]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
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

  function pick(place: Locality) {
    // In the popover a pick closes it; inline in Settings the search is done
    // with, so the list and the typed city go.
    setResults(null);
    setNote(null);
    setText('');
    onPick(place);
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
        <div className="flex flex-col gap-1">
          <p className="m-0 font-sans text-sm text-ink">{GEOCODER_OFF}</p>
          <p className="m-0 font-sans text-xs text-ink type-muted">{PICK_FROM_LIST}</p>
        </div>
        <PlacePicker onPick={onPick} disabled={disabled} />
        <Button
          variant="secondary"
          onClick={onWorldwide}
          disabled={disabled}
          className="self-start"
        >
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
          disabled={resolving || disabled}
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
            autoComplete={typeahead ? 'off' : 'address-level2'}
            maxLength={80}
            disabled={disabled}
            className="h-10 min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-10 shrink-0"
            disabled={searching || disabled}
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
                      onClick={() => pick(result)}
                      disabled={disabled}
                      className={cn(
                        'w-full px-3 py-2.5 text-start font-sans text-sm text-ink',
                        'outline-none hover:bg-primary focus-visible:bg-actionPrimary focus-visible:text-onActionPrimary',
                        'disabled:cursor-not-allowed disabled:opacity-60',
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

      <Button variant="secondary" onClick={onWorldwide} disabled={disabled} className="self-start">
        <MotionIcon icon={GlobeIcon} className="h-4 w-4" />
        Worldwide
      </Button>
    </div>
  );
}

export interface WorkspaceDefaultProps {
  /** What the workspace saved. Null when it could not be read: the line is left out, the button stays. */
  settings: DiscoverSettings | null;
  /** Presentation only: a member gets the button disabled with the reason. The API's guard is the real check. */
  isAdmin: boolean;
  saving: boolean;
  /** The API's sentence when the last save failed. */
  error: string | null;
  /** Saves the place and language being read as the workspace's. Try Again calls it too. */
  onSave: () => void;
  /**
   * The place and language being read already are the workspace's, so a save
   * would change nothing: the line above says so and the button is left out.
   */
  upToDate?: boolean;
}

/**
 * The popover's last part: what the workspace starts from, and the button
 * that makes the place being read the start for everyone.
 */
export function WorkspaceDefault({
  settings,
  isAdmin,
  saving,
  error,
  onSave,
  upToDate = false,
}: WorkspaceDefaultProps) {
  const offerSave = !upToDate || saving || error !== null;
  return (
    <div className="flex flex-col gap-2 border-t-2 border-outline pt-4">
      {settings ? (
        <p className="m-0 font-sans text-sm text-ink" data-testid="discover-workspace-default">
          {workspaceDefaultText(settings)}
        </p>
      ) : null}
      {error ? (
        <Alert variant="danger" className="items-center px-3 py-2 text-xs">
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={onSave} disabled={saving}>
            Try Again
          </Button>
        </Alert>
      ) : null}
      {offerSave ? (
        <TooltipHint
          label={ADMINS_ONLY_PLACE}
          disabled={!isAdmin}
          hidden={isAdmin}
          triggerClassName="self-start"
        >
          <Button
            variant="secondary"
            onClick={onSave}
            disabled={!isAdmin || saving}
            aria-busy={saving}
            className="self-start"
          >
            {saving ? 'Saving…' : 'Save For This Workspace'}
          </Button>
        </TooltipHint>
      ) : null}
    </div>
  );
}

export interface PlacePopoverProps extends Omit<PlaceFinderProps, 'disabled'> {
  /** The workspace's saved place and its button. Left out, that part is not drawn. */
  workspace?: WorkspaceDefaultProps;
}

export function PlacePopover({ workspace, ...finder }: PlacePopoverProps) {
  return (
    <div className="flex flex-col gap-4">
      <PlaceFinder {...finder} />
      {workspace ? <WorkspaceDefault {...workspace} /> : null}
      {finder.geocoder === 'off' ? null : <PlacesCredit />}
    </div>
  );
}
