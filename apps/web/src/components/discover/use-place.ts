'use client';

/**
 * The place and language Discover shows, and how they were chosen.
 *
 * - **First visit**: the workspace's saved place when an admin saved one
 *   (`workspace`, Module 06), in the workspace's first language. Otherwise a
 *   guess from the browser's time zone (`guess`), which needs no permission
 *   and no outside call. Either way the page is never empty and never opens
 *   on a prompt.
 * - **Use My Location**: only from a click. The permission is checked first
 *   where the browser can say, so a blocked one is explained instead of asked
 *   again; the position goes straight to `localityFromPosition`, which rounds
 *   it, and is never held in state.
 * - **Search** and **Worldwide**: picked in the popover.
 *
 * Every choice is remembered in this browser per workspace
 * (`pg:discover:<orgId>`), and a new place starts in its first language. The
 * storage is wrapped: a private window or blocked site data still gets a
 * working page, just one that forgets.
 *
 * A workspace start, like a guess, is not written to storage: a default the
 * admin changes later reaches everyone who never chose a place for
 * themselves. `placeStart` in `discover-model.ts` holds the whole rule.
 *
 * The News topic is remembered in the same record. Until the person picks
 * one it follows the workspace's first topic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { localityFromPosition, localityFromTimeZone } from '@/lib/discover-api';
import type { DiscoverSettings, Locality, NewsTopic } from '@/types/discover';
import { viewerTimeZone } from '../home/home-model';
import {
  firstLanguage,
  languageFor,
  type PlaceSource,
  placeStart,
  placeStorageKey,
  readRememberedPlace,
  serializeRememberedPlace,
  type TopicChoice,
  WORLDWIDE_PLACE,
  workspaceTopic,
} from './discover-model';

export type PlaceStatus = 'idle' | 'resolving' | 'denied' | 'unavailable';

export const LOCATION_MESSAGES = {
  denied: 'Location is blocked in your browser. Search for your city instead.',
  unavailable: 'We could not find your location. Search for your city instead.',
} as const;

/** The browser's own options (research 03, section 2): a city needs no street-level fix. */
export const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 600_000,
};

export interface PlaceHandle {
  /** Null until the first place is known (the guess is one request away). */
  place: Locality | null;
  language: string | null;
  source: PlaceSource;
  status: PlaceStatus;
  /** The sentence for `denied` or `unavailable`: the browser's, or the API's own. */
  message: string | null;
  /** The guess could not be made (the API did not answer). */
  failed: boolean;
  /** The News topic: the person's own once they picked, else the workspace's first. Null is All. */
  topic: NewsTopic | null;
  locate: () => Promise<boolean>;
  pickPlace: (place: Locality) => void;
  pickWorldwide: () => void;
  setLanguage: (language: string) => void;
  /** Null picks All. Remembered with the place. */
  setTopic: (topic: NewsTopic | null) => void;
  /**
   * The current place was just saved as the workspace's: it reads as the
   * workspace place from now on (the chip's badge) and follows the default.
   */
  followWorkspace: () => void;
  /** Try the guess again after `failed`. */
  retry: () => void;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private window or blocked site data: the choice holds until a reload.
  }
}

function preferredLanguages(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
}

/** Whether the browser has already said no, without asking. Unknown is not a no. */
async function permissionDenied(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'denied';
  } catch {
    return false;
  }
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS);
  });
}

function isPositionError(cause: unknown): cause is GeolocationPositionError {
  return typeof cause === 'object' && cause !== null && 'code' in cause && !('status' in cause);
}

/** What asking the browser for its place came to. */
export type BrowserPlace =
  | { found: true; place: Locality }
  | { found: false; status: 'denied' | 'unavailable'; message: string };

/**
 * The browser's place, for Use My Location on the page and in Settings. Only
 * ever called from a click. A permission the browser already refused is
 * explained without asking again; `onAsking` runs when the browser is really
 * asked, so the caller can show it is busy. The position is rounded by
 * `localityFromPosition` and kept nowhere.
 */
export async function findBrowserPlace(onAsking?: () => void): Promise<BrowserPlace> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    // Plain HTTP on a LAN address has no geolocation at all.
    return { found: false, status: 'unavailable', message: LOCATION_MESSAGES.unavailable };
  }

  if (await permissionDenied()) {
    return { found: false, status: 'denied', message: LOCATION_MESSAGES.denied };
  }

  onAsking?.();
  try {
    const position = await currentPosition();
    const place = await localityFromPosition(position.coords.latitude, position.coords.longitude);
    return { found: true, place };
  } catch (cause) {
    if (isPositionError(cause) && cause.code === 1) {
      return { found: false, status: 'denied', message: LOCATION_MESSAGES.denied };
    }
    return {
      found: false,
      status: 'unavailable',
      // The API's sentence when it is the one that failed ("Try again in a
      // moment." for the throttle); the browser's otherwise.
      message: cause instanceof ApiError ? cause.message : LOCATION_MESSAGES.unavailable,
    };
  }
}

/**
 * @param workspace What the workspace saved, as the server page read it. Null
 *   when it could not be read; the page then behaves as it did before Module 06.
 */
export function usePlace(orgId: string, workspace: DiscoverSettings | null = null): PlaceHandle {
  const [place, setPlaceState] = useState<Locality | null>(null);
  const [language, setLanguageState] = useState<string | null>(null);
  const [source, setSource] = useState<PlaceSource>('guess');
  const [status, setStatus] = useState<PlaceStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The person's own topic; null until they pick one.
  const [chosenTopic, setChosenTopic] = useState<TopicChoice | null>(null);
  // Which workspace the current answers belong to: a guess or a position
  // that lands after a workspace switch must not be shown in the other one.
  const owner = useRef(orgId);
  // Where a visit starts is decided once per workspace. Saving a new default
  // from this page must not move the place the person is already reading.
  const saved = useRef(workspace);
  saved.current = workspace;

  const remember = useCallback(
    (
      next: Locality,
      nextSource: PlaceSource,
      nextLanguage: string,
      nextTopic: TopicChoice | null = chosenTopic,
    ) => {
      setPlaceState(next);
      setSource(nextSource);
      setLanguageState(nextLanguage);
      writeStorage(
        placeStorageKey(orgId),
        serializeRememberedPlace({
          place: next,
          source: nextSource,
          language: nextLanguage,
          ...(nextTopic ? { topic: nextTopic } : {}),
        }),
      );
    },
    [orgId, chosenTopic],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    owner.current = orgId;
    setStatus('idle');
    setMessage(null);
    setFailed(false);

    const remembered = readRememberedPlace(readStorage(placeStorageKey(orgId)));
    setChosenTopic(remembered?.topic ?? null);

    const start = placeStart(remembered, saved.current);
    if (start.from !== 'guess') {
      // Neither is written to storage here: a remembered choice is already
      // there, and a workspace start is read from the workspace every visit.
      setPlaceState(start.place);
      setSource(start.from === 'workspace' ? 'workspace' : start.source);
      setLanguageState(start.language);
      return;
    }

    setPlaceState(null);
    setLanguageState(null);
    setSource('guess');
    let cancelled = false;

    localityFromTimeZone(viewerTimeZone())
      .then((guess) => {
        if (cancelled || owner.current !== orgId) return;
        // Not written to storage: a guess is made again on the next visit,
        // so a laptop that travelled guesses its new country.
        setPlaceState(guess);
        setSource(guess.countryCode ? 'guess' : 'worldwide');
        setLanguageState(firstLanguage(guess, preferredLanguages()));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);

  const locate = useCallback(async (): Promise<boolean> => {
    const asking = orgId;
    setMessage(null);

    const answer = await findBrowserPlace(() => setStatus('resolving'));
    if (owner.current !== asking) return false;

    if (!answer.found) {
      setStatus(answer.status);
      setMessage(answer.message);
      return false;
    }
    remember(answer.place, 'browser', firstLanguage(answer.place));
    setStatus('idle');
    return true;
  }, [orgId, remember]);

  const pickPlace = useCallback(
    (next: Locality) => {
      setStatus('idle');
      setMessage(null);
      setFailed(false);
      remember(next, 'search', firstLanguage(next));
    },
    [remember],
  );

  const pickWorldwide = useCallback(() => {
    setStatus('idle');
    setMessage(null);
    setFailed(false);
    remember(WORLDWIDE_PLACE, 'worldwide', 'en');
  }, [remember]);

  const setLanguage = useCallback(
    (next: string) => {
      if (!place) return;
      remember(place, source, languageFor(place, next));
    },
    [place, source, remember],
  );

  const setTopic = useCallback(
    (next: NewsTopic | null) => {
      const choice: TopicChoice = next ?? 'ALL';
      setChosenTopic(choice);
      if (place && language) remember(place, source, language, choice);
    },
    [place, source, language, remember],
  );

  const followWorkspace = useCallback(() => {
    if (place && language) remember(place, 'workspace', language);
  }, [place, language, remember]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // All is a choice too: it beats the workspace's topic once it is picked.
  const ownTopic = chosenTopic === 'ALL' ? null : chosenTopic;
  const topic = chosenTopic === null ? workspaceTopic(workspace) : ownTopic;

  return {
    place,
    language,
    source,
    status,
    message,
    failed,
    topic,
    locate,
    pickPlace,
    pickWorldwide,
    setLanguage,
    setTopic,
    followWorkspace,
    retry,
  };
}
