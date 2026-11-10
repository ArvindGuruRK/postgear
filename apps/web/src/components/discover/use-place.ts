'use client';

/**
 * The place and language Discover shows, and how they were chosen.
 *
 * - **First visit**: a guess from the browser's time zone (`guess`), which
 *   needs no permission and no outside call, so the page is never empty and
 *   never opens on a prompt.
 * - **Use My Location**: only from a click. The permission is checked first
 *   where the browser can say, so a blocked one is explained instead of asked
 *   again; the position goes straight to `localityFromPosition`, which rounds
 *   it, and is never held in state.
 * - **Search** and **Worldwide**: picked in the popover.
 *
 * Every choice is remembered in this browser per workspace
 * (`pg:discover:<orgId>`), and a new place starts in its first language. The
 * storage is wrapped: a private window or blocked site data still gets a
 * working page, just one that forgets. Module 06 adds the workspace default
 * as the starting point before the guess.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { localityFromPosition, localityFromTimeZone } from '@/lib/discover-api';
import type { Locality } from '@/types/discover';
import { viewerTimeZone } from '../home/home-model';
import {
  firstLanguage,
  languageFor,
  type PlaceSource,
  placeStorageKey,
  readRememberedPlace,
  serializeRememberedPlace,
  WORLDWIDE_PLACE,
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
  locate: () => Promise<boolean>;
  pickPlace: (place: Locality) => void;
  pickWorldwide: () => void;
  setLanguage: (language: string) => void;
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

export function usePlace(orgId: string): PlaceHandle {
  const [place, setPlaceState] = useState<Locality | null>(null);
  const [language, setLanguageState] = useState<string | null>(null);
  const [source, setSource] = useState<PlaceSource>('guess');
  const [status, setStatus] = useState<PlaceStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Which workspace the current answers belong to: a guess or a position
  // that lands after a workspace switch must not be shown in the other one.
  const owner = useRef(orgId);

  const remember = useCallback(
    (next: Locality, nextSource: PlaceSource, nextLanguage: string) => {
      setPlaceState(next);
      setSource(nextSource);
      setLanguageState(nextLanguage);
      writeStorage(
        placeStorageKey(orgId),
        serializeRememberedPlace({ place: next, source: nextSource, language: nextLanguage }),
      );
    },
    [orgId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    owner.current = orgId;
    setStatus('idle');
    setMessage(null);
    setFailed(false);

    const remembered = readRememberedPlace(readStorage(placeStorageKey(orgId)));
    if (remembered) {
      setPlaceState(remembered.place);
      setSource(remembered.source);
      setLanguageState(remembered.language);
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

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      // Plain HTTP on a LAN address has no geolocation at all.
      setStatus('unavailable');
      setMessage(LOCATION_MESSAGES.unavailable);
      return false;
    }

    if (await permissionDenied()) {
      setStatus('denied');
      setMessage(LOCATION_MESSAGES.denied);
      return false;
    }

    setStatus('resolving');
    try {
      const position = await currentPosition();
      const found = await localityFromPosition(position.coords.latitude, position.coords.longitude);
      if (owner.current !== asking) return false;
      remember(found, 'browser', firstLanguage(found));
      setStatus('idle');
      return true;
    } catch (cause) {
      if (owner.current !== asking) return false;
      if (isPositionError(cause) && cause.code === 1) {
        setStatus('denied');
        setMessage(LOCATION_MESSAGES.denied);
      } else {
        setStatus('unavailable');
        // The API's sentence when it is the one that failed ("Try again in a
        // moment." for the throttle); the browser's otherwise.
        setMessage(cause instanceof ApiError ? cause.message : LOCATION_MESSAGES.unavailable);
      }
      return false;
    }
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

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    place,
    language,
    source,
    status,
    message,
    failed,
    locate,
    pickPlace,
    pickWorldwide,
    setLanguage,
    retry,
  };
}
