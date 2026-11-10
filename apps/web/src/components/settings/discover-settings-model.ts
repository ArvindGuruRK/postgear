/**
 * The Discover settings page's logic, kept pure so the lists and the words
 * are tested on their own: which languages can still be added, how a row
 * moves, the order ticked topics are saved in, what one switch sends, and the
 * page's copy.
 *
 * Each helper answers exactly what one save sends. The page sends it and
 * shows it at once, then keeps the API's answer.
 */
import type { DiscoverSettings, DiscoverSourceSwitch, Locality, NewsTopic } from '@/types/discover';
import { DISCOVER_SOURCE_SWITCHES, NEWS_TOPICS } from '@/types/discover';
import { MAX_WORKSPACE_LANGUAGES } from '../discover/discover-model';

export const READ_ONLY_NOTICE = 'Only workspace admins can change these settings.';
export const LOAD_FAILED = "Couldn't load the Discover settings.";
export const SAVE_FAILED = "Couldn't save that change.";

export const LANGUAGES_FULL = `You can keep up to ${MAX_WORKSPACE_LANGUAGES} languages. Remove one to add another.`;
export const LANGUAGES_ALL_ADDED = 'Every language of this place is in the list.';
export const LANGUAGES_NEED_PLACE = 'Save a workspace place to add its languages.';
export const LANGUAGES_EMPTY =
  'No languages yet. Discover opens in the first language of the place.';

/** The five switches, in the order the page shows their groups. News has none. */
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
 * All five switches as the API takes them after one is flipped. A save
 * replaces the whole value, so every switch is sent, never just the one.
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

/** The list with one language a place up (`-1`) or down (`1`). Unchanged at either end. */
export function languagesMoved(languages: readonly string[], code: string, by: -1 | 1): string[] {
  const from = languages.indexOf(code);
  const to = from + by;
  if (from < 0 || to < 0 || to >= languages.length) return [...languages];

  const moved = [...languages];
  [moved[from], moved[to]] = [moved[to] as string, moved[from] as string];
  return moved;
}
