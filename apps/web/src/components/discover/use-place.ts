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
 *
 * ## Module 10
 *
 * - **It follows the person** (backlog #6): each of their own choices (Use My
 *   Location, a search, Worldwide, a language or a topic on one of those) is
 *   also kept for them in this workspace (`PUT /discover/my-place`), and
 *   following the workspace's place clears it. A browser with no choice of
 *   its own asks for it before guessing, so a second laptop opens on the
 *   same city. The browser's own choice still wins in that browser. Every
 *   one of these calls is best effort: a failure changes nothing on screen.
 * - **A better first guess** (backlog #13): when the time zone says nothing
 *   (UTC, a server-style zone), the API guesses a country from the address
 *   the request came from, when it is set up to. Still a guess, still never
 *   written down.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  clearMyPlace,
  getMyPlace,
  getPickedLocality,
  guessLocalityFromAddress,
  localityFromPosition,
  localityFromTimeZone,
  saveMyPlace,
} from '@/lib/discover-api';
import type { DiscoverSettings, Locality, MyPlace, NewsTopic } from '@/types/discover';
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
  /** Module 10: the guess on screen came from the network address (DB-IP), which asks for a credit. */
  guessedFromAddress: boolean;
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

/** A call that may throw before it returns a promise (a test's partial mock) still only rejects. */
function safely<T>(call: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(call);
}

/** The choices that are the person's own, and so follow them to another browser. */
const OWN_SOURCES: ReadonlySet<PlaceSource> = new Set(['browser', 'search', 'worldwide']);

/** What `PUT /discover/my-place` keeps for a choice. */
export function myPlaceOf(
  place: Locality,
  source: PlaceSource,
  language: string,
  topic: TopicChoice | null,
): Omit<MyPlace, 'updatedAt'> {
  return {
    countryCode: place.countryCode,
    regionCode: place.countryCode ? place.regionCode : null,
    regionName: place.countryCode ? place.regionName : null,
    city: place.countryCode ? place.city : null,
    timeZone: place.timeZone,
    language,
    topic,
    locationSource: source === 'browser' ? 'BROWSER' : 'SEARCH',
  };
}

/** How a kept choice reads on the chip again. */
function sourceOfMine(mine: MyPlace): PlaceSource {
  if (!mine.countryCode) return 'worldwide';
  return mine.locationSource === 'BROWSER' ? 'browser' : 'search';
}

/**
 * The whole place a kept choice names. The API rebuilds the country's
 * languages and editions; the city and the region's name come back as they
 * were kept. Null when the country is not one the API knows any more.
 */
async function localityOfMine(mine: MyPlace): Promise<Locality | null> {
  if (!mine.countryCode) return WORLDWIDE_PLACE;
  let base: Locality;
  try {
    base = await getPickedLocality(mine.countryCode, mine.regionCode);
  } catch {
    if (!mine.regionCode) return null;
    try {
      // A region the lists do not carry: the country is still worth having.
      base = await getPickedLocality(mine.countryCode, null);
    } catch {
      return null;
    }
  }
  return {
    ...base,
    regionCode: mine.regionCode ?? base.regionCode,
    regionName: mine.regionName ?? base.regionName,
    city: mine.city ?? base.city,
    timeZone: mine.timeZone ?? base.timeZone,
  };
}

/** The person's kept choice, whole, or null. Never rejects. */
function findMine(): Promise<{ mine: MyPlace; place: Locality } | null> {
  return safely(getMyPlace)
    .then(async (mine) => {
      if (!mine) return null;
      const place = await localityOfMine(mine);
      return place ? { mine, place } : null;
    })
    .catch(() => null);
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
  const [fromAddress, setFromAddress] = useState(false);
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
  // True while the place on screen is only a guess nobody chose. The
  // workspace's saved place may still replace it if it arrives late (below).
  const adoptable = useRef(false);
  // True once the person chose something on this visit: the choice they kept
  // on another browser, arriving late, must not undo it.
  const chose = useRef(false);

  const remember = useCallback(
    (
      next: Locality,
      nextSource: PlaceSource,
      nextLanguage: string,
      nextTopic: TopicChoice | null = chosenTopic,
    ) => {
      // A choice, or a save: from here on the place is the person's.
      adoptable.current = false;
      chose.current = true;
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
      // Module 10: the person's own choice follows them; following the
      // workspace forgets it. Best effort either way.
      if (OWN_SOURCES.has(nextSource)) {
        safely(() => saveMyPlace(myPlaceOf(next, nextSource, nextLanguage, nextTopic))).catch(
          () => undefined,
        );
      } else if (nextSource === 'workspace') {
        safely(clearMyPlace).catch(() => undefined);
      }
    },
    [orgId, chosenTopic],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    owner.current = orgId;
    chose.current = false;
    setStatus('idle');
    setMessage(null);
    setFailed(false);

    const remembered = readRememberedPlace(readStorage(placeStorageKey(orgId)));
    setChosenTopic(remembered?.topic ?? null);

    const start = placeStart(remembered, saved.current);
    adoptable.current = start.from === 'guess';
    if (start.from === 'remembered') {
      // Already in storage: this browser's own choice wins in this browser.
      setPlaceState(start.place);
      setSource(start.source);
      setLanguageState(start.language);
      return;
    }

    let cancelled = false;
    const stillAsking = () => !cancelled && owner.current === orgId;

    if (start.from === 'workspace') {
      // Not written to storage: a workspace start is read from the workspace every visit.
      setPlaceState(start.place);
      setSource('workspace');
      setLanguageState(start.language);
    } else {
      setPlaceState(null);
      setLanguageState(null);
      setSource('guess');
    }

    // The guess is asked first and side by side with the kept choice below,
    // and used only when there is none.
    const guessing =
      start.from === 'guess'
        ? safely(() => localityFromTimeZone(viewerTimeZone())).then(async (guess) => {
            if (guess.countryCode) return { guess, byAddress: false };
            // Module 10: a zone that names no country; the address may.
            const found = await safely(guessLocalityFromAddress).catch(() => null);
            return found ? { guess: found, byAddress: true } : { guess, byAddress: false };
          })
        : null;
    guessing?.catch(() => undefined);

    // Module 10: a choice the person kept on another browser beats both the
    // workspace's place and a guess. Once adopted it is written here too, so
    // the next visit in this browser starts on it without asking.
    const mine = findMine().then((found) => {
      if (!found || !stillAsking() || chose.current) return false;
      const source = sourceOfMine(found.mine);
      const language = languageFor(found.place, found.mine.language);
      const topic = found.mine.topic ?? null;
      adoptable.current = false;
      setFailed(false);
      setPlaceState(found.place);
      setSource(source);
      setLanguageState(language);
      if (topic) setChosenTopic(topic);
      writeStorage(
        placeStorageKey(orgId),
        serializeRememberedPlace({
          place: found.place,
          source,
          language,
          ...(topic ? { topic } : {}),
        }),
      );
      return true;
    });

    if (guessing) {
      mine
        .then(async (adopted) => {
          if (adopted) return;
          const { guess, byAddress } = await guessing;
          // The workspace's place got here first, or the person chose one: no guess needed.
          if (!stillAsking() || !adoptable.current) return;
          // Not written to storage: a guess is made again on the next visit,
          // so a laptop that travelled guesses its new country.
          setFromAddress(byAddress);
          setPlaceState(guess);
          setSource(guess.countryCode ? 'guess' : 'worldwide');
          setLanguageState(firstLanguage(guess, preferredLanguages()));
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);

  /**
   * The workspace's saved place can arrive after the first render: on the
   * first page after signing in the active-workspace cookie is not set yet, so
   * the server cannot read the settings until it has been (the layout's
   * `SyncActiveWorkspace` then re-runs the page). A visit that started on the
   * time zone guess moves to the workspace's place when that happens. A place
   * the person chose, on this visit or an earlier one, is never moved.
   */
  const savedPlaceKey = workspace?.place ? JSON.stringify(workspace.place) : null;
  useEffect(() => {
    if (!adoptable.current || savedPlaceKey === null || owner.current !== orgId) return;

    const remembered = readRememberedPlace(readStorage(placeStorageKey(orgId)));
    const start = placeStart(remembered, saved.current);
    if (start.from !== 'workspace') return;

    adoptable.current = false;
    setFailed(false);
    setPlaceState(start.place);
    setSource('workspace');
    setLanguageState(start.language);
  }, [savedPlaceKey, orgId]);

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
    // Only while that guess is what is on screen.
    guessedFromAddress: fromAddress && source === 'guess',
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
