/**
 * The Discover settings page's logic, kept pure so the lists and the words
 * are tested on their own: which languages can still be added, how a row
 * moves, the order ticked topics are saved in, what one switch sends, whether
 * an interest can be added, and the page's copy.
 *
 * Each helper answers exactly what one save sends. The page sends it and
 * shows it at once, then keeps the API's answer.
 */
import type { DiscoverSettings, DiscoverSourceSwitch, Locality, NewsTopic } from '@/types/discover';
import {
  DISCOVER_SOURCE_SWITCHES,
  INTEREST_MAX_LENGTH,
  MAX_INTERESTS,
  NEWS_TOPICS,
} from '@/types/discover';
import { MAX_WORKSPACE_LANGUAGES } from '../discover/discover-model';

export const READ_ONLY_NOTICE = 'Only workspace admins can change these settings.';
export const LOAD_FAILED = "Couldn't load the Discover settings.";
export const SAVE_FAILED = "Couldn't save that change.";

export const LANGUAGES_FULL = `You can keep up to ${MAX_WORKSPACE_LANGUAGES} languages. Remove one to add another.`;
export const LANGUAGES_ALL_ADDED = 'Every language of this place is in the list.';
export const LANGUAGES_NEED_PLACE = 'Save a workspace place to add its languages.';
export const LANGUAGES_EMPTY =
  'No languages yet. Discover opens in the first language of the place.';

export const INTERESTS_EMPTY =
  'No interests yet. News shows your place, your topics and the world.';
export const INTERESTS_HELP = `Up to ${MAX_INTERESTS} interests, each a few words. Press Enter or Add.`;
export const INTERESTS_FULL = `You can keep up to ${MAX_INTERESTS} interests. Remove one to add another.`;
export const INTEREST_TOO_SHORT = 'An interest needs at least 2 characters.';
export const INTEREST_TOO_LONG = `An interest can be at most ${INTEREST_MAX_LENGTH} characters.`;
export const INTEREST_CHARACTERS =
  "Use letters, numbers and spaces (and & ' + . # - if needed), starting with a letter or a number.";
export const INTEREST_REPEATED = 'That interest is already in the list.';

export const DIGEST_HELP =
  "Sent between 8 and 10 in the morning, your place's time, to members who keep the Discover digest on in their notification settings.";
export const DIGEST_WORLDWIDE = 'No place is saved, so the digest covers Worldwide until one is.';

/**
 * The switches, in the order the page shows their groups: Trending's three,
 * the world press on News, then Videos and Festivals. News itself has none.
 */
export const SOURCE_FIELDS: readonly {
  key: DiscoverSourceSwitch;
  label: string;
  help: string;
}[] = [
  {
    key: 'trends',
    label: 'Rising Searches',
    help: 'What people in your place are searching for on Google right now.',
  },
  {
    key: 'wikipedia',
    label: 'Wikipedia',
    help: 'The most-read Wikipedia articles in your language.',
  },
  {
    key: 'social',
    label: 'Worldwide Social',
    help: 'What Bluesky and Mastodon are talking about. Not local to your place.',
  },
  {
    key: 'gdelt',
    label: 'World Press',
    help: 'Coverage of your place from news outlets around the world, from GDELT, on the News tab.',
  },
  {
    key: 'videos',
    label: 'Videos',
    help: 'Popular YouTube videos in your country, on the Videos tab.',
  },
  {
    key: 'festivals',
    label: 'Festivals',
    help: 'Festivals and public holidays of the next 30 days, on the Festivals tab.',
  },
];

/** Whether a switch is on. A missing key, or nothing saved, means on. */
export function sourceOn(sources: DiscoverSettings['sources'], key: DiscoverSourceSwitch): boolean {
  return sources?.[key] !== false;
}

/**
 * Every switch as the API takes them after one is flipped. A save replaces
 * the whole value, so every switch is sent, never just the one.
 */
export function sourcesWith(
  sources: DiscoverSettings['sources'],
  key: DiscoverSourceSwitch,
  on: boolean,
): Record<DiscoverSourceSwitch, boolean> {
  const all = {} as Record<DiscoverSourceSwitch, boolean>;
  for (const each of DISCOVER_SOURCE_SWITCHES) {
    all[each] = each === key ? on : sourceOn(sources, each);
  }
  return all;
}

/**
 * The topics to save after one is ticked or cleared: always in Google's own
 * order, top to bottom as the page lists them, so the first ticked one is the
 * News tab's default.
 */
export function topicsWith(
  topics: readonly NewsTopic[],
  topic: NewsTopic,
  ticked: boolean,
): NewsTopic[] {
  return NEWS_TOPICS.filter((each) => (each === topic ? ticked : topics.includes(each)));
}

function listed(languages: readonly string[], code: string): boolean {
  return languages.some((each) => each.toLowerCase() === code.toLowerCase());
}

/**
 * The languages that can still be added: the saved place's (the ones News
 * has an edition in, as the language chip offers them), then English, less
 * what is already listed. Without a saved place that is English alone. None
 * once the list is full.
 */
export function addableLanguages(languages: readonly string[], place: Locality | null): string[] {
  if (languages.length >= MAX_WORKSPACE_LANGUAGES) return [];
  const offered = [...(place?.newsLanguages ?? []), 'en'];
  return offered.filter(
    (code, index) => !listed(languages, code) && !listed(offered.slice(0, index), code),
  );
}

/** Why nothing can be added, or the hint for an empty place. Null when there is nothing to say. */
export function addLanguageHelp(
  languages: readonly string[],
  place: Locality | null,
): string | null {
  if (languages.length >= MAX_WORKSPACE_LANGUAGES) return LANGUAGES_FULL;
  if (!place) return LANGUAGES_NEED_PLACE;
  return addableLanguages(languages, place).length === 0 ? LANGUAGES_ALL_ADDED : null;
}

/** The list with one more at the end. Unchanged when it is full or already there. */
export function languagesWith(languages: readonly string[], code: string): string[] {
  if (languages.length >= MAX_WORKSPACE_LANGUAGES || listed(languages, code)) {
    return [...languages];
  }
  return [...languages, code];
}

export function languagesWithout(languages: readonly string[], code: string): string[] {
  return languages.filter((each) => each !== code);
}

/**
 * The API's rule for one interest (`dto/settings.schema.ts`): a letter or a
 * number in any script first, then letters, numbers, marks, spaces and a
 * little punctuation.
 */
const INTEREST_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'+.#-]*$/u;

/** An interest as it is saved: trimmed, with any run of spaces made one. */
export function interestText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Why `raw` cannot be added to `interests`, as one sentence, or null when it
 * can. Mirrors the API's checks, so a refusal reads here before any save. The
 * same words twice are one interest, whatever their capitals.
 */
export function interestProblem(raw: string, interests: readonly string[]): string | null {
  const text = interestText(raw);
  if (interests.length >= MAX_INTERESTS) return INTERESTS_FULL;
  if (text.length < 2) return INTEREST_TOO_SHORT;
  if (text.length > INTEREST_MAX_LENGTH) return INTEREST_TOO_LONG;
  if (!INTEREST_PATTERN.test(text)) return INTEREST_CHARACTERS;
  if (interests.some((each) => each.toLowerCase() === text.toLowerCase())) {
    return INTEREST_REPEATED;
  }
  return null;
}

/** The list with one more at the end, as typed but tidied. Unchanged when it cannot be added. */
export function interestsWith(interests: readonly string[], raw: string): string[] {
  if (interestProblem(raw, interests)) return [...interests];
  return [...interests, interestText(raw)];
}

export function interestsWithout(interests: readonly string[], interest: string): string[] {
  return interests.filter((each) => each !== interest);
}

/** The list with one language a place up (`-1`) or down (`1`). Unchanged at either end. */
export function languagesMoved(languages: readonly string[], code: string, by: -1 | 1): string[] {
  const from = languages.indexOf(code);
  const to = from + by;
  if (from < 0 || to < 0 || to >= languages.length) return [...languages];

  const moved = [...languages];
  [moved[from], moved[to]] = [moved[to] as string, moved[from] as string];
  return moved;
}
