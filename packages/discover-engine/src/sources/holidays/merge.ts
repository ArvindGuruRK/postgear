/**
 * When two rows are the same festival.
 *
 * Festivals come from two readers, the country's Google calendar and
 * `date-holidays`, and both know Christmas. They do not spell it the same way:
 * one says "Christmas", the other "Christmas Day"; one writes "New Year's Day"
 * with a straight apostrophe, the other with a curly one; India's calendar says
 * "Diwali/Deepavali" where a library says "Deepavali". So two rows are one
 * festival when they fall on the same date and their names agree once all of
 * that is taken off.
 *
 * Only ever on the same date. India has several festivals a day, and they must
 * stay several rows, and the same festival a year later is a different row.
 *
 * ## The names must agree, not merely overlap
 *
 * A looser rule (one name's words are all in the other's) would also fold
 * "Gandhi Jayanti" into "Mahatma Gandhi Jayanti", which is right. Run over the
 * recorded calendars it folds "Christmas Eve" into "Christmas Day (substitute)"
 * and "New Year's Eve" into "New Year's Day (substitute)" as well, which is
 * wrong, so it is not used. A festival the two readers name differently shows
 * twice, and that is the smaller mistake.
 */
import type { SourceItem } from '../../types';
import { stripHtml } from '../html-text';
import { isCalendarDate } from './dates';

/** Which reader a row came from. It is the row's `source.name`. */
export type FestivalOrigin = 'Google Calendar' | 'date-holidays';

const HAS_LETTER = /\p{L}/u;

/**
 * A festival row as either reader hands it over, or null when there is nothing
 * to show: a name that is empty or has no letters in it (a placeholder such as
 * a bare rule), or a date that is not one.
 */
export function festivalItem(fields: {
  name: string;
  date: string;
  observance: boolean;
  origin: FestivalOrigin;
}): SourceItem | null {
  const title = stripHtml(fields.name);
  if (!HAS_LETTER.test(title) || !isCalendarDate(fields.date)) return null;

  return {
    kind: 'festival',
    source: { id: 'holidays', name: fields.origin },
    title,
    date: fields.date,
    observance: fields.observance,
  };
}

const BRACKETED = /\([^)]*\)|\[[^\]]*\]/g;
/** The accents NFKD splits off Latin letters. Narrow on purpose: Tamil vowels are marks too. */
const LATIN_ACCENTS = /[\u{300}-\u{36F}]/gu;
/** Straight, both curly ones, the modifier letter and the backtick. */
const APOSTROPHES = /['\u{2018}\u{2019}\u{2BC}`]/gu;

/**
 * One word, two spellings. The calendars write American English and the library
 * British, and this is the one word the recordings show them differ on: without
 * it the United States has two Labor Days and France two on 1 May.
 */
const SPELLINGS: Readonly<Record<string, string>> = { labour: 'labor' };

function nameKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(LATIN_ACCENTS, '')
    .replace(APOSTROPHES, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && word !== 'day')
    .map((word) => (Object.hasOwn(SPELLINGS, word) ? SPELLINGS[word] : word))
    .join(' ');
}

/**
 * What a name is compared by. Brackets go first ("Ramzan Id (tentative)",
 * "Christmas Day (substitute day)"), then a slash makes two names of one, so
 * "Diwali/Deepavali" answers to either. A name with nothing left (it was only
 * "Day", or only a bracket) is compared whole, so it can match nothing but itself.
 */
export function festivalNameKeys(name: string): string[] {
  const keys = name
    .replace(BRACKETED, ' ')
    .split('/')
    .map(nameKey)
    .filter((key) => key !== '');

  return keys.length > 0 ? [...new Set(keys)] : [name.normalize('NFKC').trim().toLowerCase()];
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** By date, then by name. Code order, not a locale's, so it is the same on every machine. */
export function byDateThenName(
  a: { date?: string; title: string },
  b: { date?: string; title: string },
): number {
  return (
    compare(a.date ?? '', b.date ?? '') ||
    compare(a.title.toLowerCase(), b.title.toLowerCase()) ||
    compare(a.title, b.title)
  );
}

const isObservance = (item: SourceItem) => item.observance ?? true;

/**
 * Whose name a merged row shows. Between the two readers it is the calendar's.
 * Within one reader (India's calendar lists "Janmashtami" and "Janmashtami
 * (Smarta)" on one date) it is the day off, and failing that the plainer name.
 */
function shownOf(first: SourceItem, second: SourceItem): SourceItem {
  if (first.source.name !== second.source.name) {
    return second.source.name === 'Google Calendar' ? second : first;
  }
  if (isObservance(first) !== isObservance(second)) return isObservance(first) ? second : first;
  return second.title.length < first.title.length ? second : first;
}

/**
 * One row per date and name, by date then name.
 *
 * When a calendar row and a library row turn out to be the same festival, the
 * calendar's name is the one shown and the row stays the calendar's. The badge
 * is the stronger of the two: a day off in either reading is a day off, so a
 * public holiday beats an observance.
 */
export function mergeFestivals(
  calendar: readonly SourceItem[],
  library: readonly SourceItem[],
): SourceItem[] {
  const byDate = new Map<string, { item: SourceItem; keys: Set<string> }[]>();

  for (const item of [...calendar, ...library]) {
    if (!isCalendarDate(item.date)) continue;

    const keys = festivalNameKeys(item.title);
    const rows = byDate.get(item.date) ?? [];
    const same = rows.find((row) => keys.some((key) => row.keys.has(key)));

    if (same) {
      const observance = isObservance(same.item) && isObservance(item);
      same.item = { ...shownOf(same.item, item), observance };
      for (const key of keys) same.keys.add(key);
    } else {
      rows.push({ item, keys: new Set(keys) });
      byDate.set(item.date, rows);
    }
  }

  return [...byDate.values()].flatMap((rows) => rows.map((row) => row.item)).sort(byDateThenName);
}
