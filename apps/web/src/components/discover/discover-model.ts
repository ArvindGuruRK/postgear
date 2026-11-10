/**
 * Discover's display logic, kept pure so the words are tested on their own:
 * what the place chip says in each state, the line a search result reads as,
 * which language a new place starts in, what is remembered per workspace, and
 * how old the page's copy is.
 *
 * The words are the page's (place, trend, story, Worldwide), never the API's.
 */
import type { DiscoverGroup, DiscoverItem, DiscoverTab, Locality } from '@/types/discover';
import { DISCOVER_TABS } from '@/types/discover';
import { formatRelative } from '../seo/seo-view-model';

/** How the current place was chosen. `workspace` arrives with Module 06. */
export type PlaceSource = 'guess' | 'browser' | 'search' | 'worldwide' | 'workspace';

export const PLACE_SOURCES: readonly PlaceSource[] = [
  'guess',
  'browser',
  'search',
  'worldwide',
  'workspace',
];

/** The same as the API's Worldwide, so the page can pick it without asking. */
export const WORLDWIDE_PLACE: Locality = {
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: ['en'],
  newsLanguages: ['en'],
};

export function isWorldwide(place: Locality): boolean {
  return place.countryCode === null;
}

/** The most specific name, then the next one up: "Chennai, Tamil Nadu", "Tamil Nadu, India", "India". */
function namedParts(place: Locality): string[] {
  return [place.city, place.regionName, place.countryName].filter(
    (part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index,
  );
}

/** What the place chip says (blueprint section 3). The Guess badge is drawn beside it. */
export function placeChipText(place: Locality, source: PlaceSource): string {
  if (isWorldwide(place)) return 'Worldwide';
  if (source === 'guess') return `${place.countryName ?? place.countryCode}, from your time zone`;
  return namedParts(place).slice(0, 2).join(', ');
}

/** The chip on a phone: the one most specific name. */
export function placeShortText(place: Locality): string {
  if (isWorldwide(place)) return 'Worldwide';
  return namedParts(place)[0] ?? place.countryCode ?? 'Worldwide';
}

/** A search result: "Chennai, Tamil Nadu, India". */
export function placeResultText(place: Locality): string {
  if (isWorldwide(place)) return 'Worldwide';
  return namedParts(place).join(', ');
}

/** The place inside a sentence: "Nothing to show for Chennai right now." */
export function placeInSentence(place: Locality): string {
  return isWorldwide(place) ? 'the whole world' : placeShortText(place);
}

function primary(tag: string): string {
  return tag.toLowerCase().split('-')[0] ?? tag;
}

/**
 * The language a place starts in. A city or a region starts in its own first
 * language (Tamil for Chennai), which is the point of finding it. A country
 * guessed from the time zone or Worldwide starts in a language the browser
 * already prefers, when the place offers one: the country's most spoken
 * language (Hindi for India) is a poor guess for a reader in English.
 */
export function firstLanguage(place: Locality, preferred: readonly string[] = []): string {
  const offered = place.newsLanguages.length > 0 ? place.newsLanguages : ['en'];

  if (!place.regionCode) {
    for (const wanted of preferred) {
      const exact = offered.find((code) => code.toLowerCase() === wanted.toLowerCase());
      if (exact) return exact;
      const close = offered.find((code) => primary(code) === primary(wanted));
      if (close) return close;
    }
  }

  return offered[0] ?? 'en';
}

/** A language the place offers, or its first: a stored choice can outlive its place. */
export function languageFor(place: Locality, language: string | null | undefined): string {
  return language && place.newsLanguages.includes(language) ? language : firstLanguage(place);
}

/** Where the choice is remembered: per workspace, in this browser only. */
export function placeStorageKey(orgId: string): string {
  return `pg:discover:${orgId}`;
}

export interface RememberedPlace {
  place: Locality;
  source: PlaceSource;
  language: string;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function nameOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 120);
}

function languageList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 40 &&
    value.every((code) => typeof code === 'string' && LANGUAGE_TAG.test(code))
  );
}

function isLocality(value: unknown): value is Locality {
  if (typeof value !== 'object' || value === null) return false;
  const place = value as Record<string, unknown>;
  return (
    nameOrNull(place.countryCode) &&
    nameOrNull(place.countryName) &&
    nameOrNull(place.regionCode) &&
    nameOrNull(place.regionName) &&
    nameOrNull(place.city) &&
    nameOrNull(place.timeZone) &&
    languageList(place.languages) &&
    languageList(place.newsLanguages)
  );
}

/**
 * The remembered choice, or null for anything that is not one: nothing
 * stored, an older shape, or a value someone edited by hand. Only the fields
 * the page uses are kept, so nothing else stored under the key travels on.
 */
export function readRememberedPlace(raw: string | null): RememberedPlace | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || !isLocality(record.place)) return null;
  if (!PLACE_SOURCES.includes(record.source as PlaceSource)) return null;
  if (typeof record.language !== 'string' || !LANGUAGE_TAG.test(record.language)) return null;

  const place: Locality = {
    countryCode: record.place.countryCode,
    countryName: record.place.countryName,
    regionCode: record.place.regionCode,
    regionName: record.place.regionName,
    city: record.place.city,
    timeZone: record.place.timeZone,
    languages: record.place.languages,
    newsLanguages: record.place.newsLanguages,
  };

  return {
    place,
    source: record.source as PlaceSource,
    language: languageFor(place, record.language),
  };
}

export function serializeRememberedPlace(remembered: RememberedPlace): string {
  const { place } = remembered;
  return JSON.stringify({
    v: 1,
    place: {
      countryCode: place.countryCode,
      countryName: place.countryName,
      regionCode: place.regionCode,
      regionName: place.regionName,
      city: place.city,
      timeZone: place.timeZone,
      languages: place.languages,
      newsLanguages: place.newsLanguages,
    },
    source: remembered.source,
    language: remembered.language,
  });
}

/** The tab in `?tab=`, or Trending. */
export function tabFrom(value: string | string[] | undefined | null): DiscoverTab {
  return typeof value === 'string' && (DISCOVER_TABS as readonly string[]).includes(value)
    ? (value as DiscoverTab)
    : 'trending';
}

export const TAB_NAMES: Record<DiscoverTab, string> = {
  trending: 'Trending',
  news: 'News',
  videos: 'Videos',
  festivals: 'Festivals',
  competitors: 'Competitors',
};

/** The age of the oldest copy shown: one line, so a stale group is never hidden by a fresh one. */
export function updatedText(groups: readonly DiscoverGroup[], now: Date): string | null {
  const times = groups
    .map((group) => Date.parse(group.fetchedAt))
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;

  const oldest = new Date(Math.min(...times)).toISOString();
  return `Updated ${formatRelative(oldest, now)}`;
}

/** Where Open goes: the real address, then Google's redirect, then the first related story. */
export function openHref(item: DiscoverItem): string | null {
  return item.url ?? item.opaqueUrl ?? item.related?.[0]?.url ?? null;
}

/**
 * The quiet line under a card's title: "500+ searches, 2 hours ago" for a
 * trend, "The Hindu, 2 hours ago" for a story.
 */
export function itemMeta(item: DiscoverItem, now: Date): string {
  const lead = item.kind === 'news' ? item.source.name : item.signal?.label;
  const when = item.publishedAt ? formatRelative(item.publishedAt, now) : '';
  return [lead, when].filter(Boolean).join(', ');
}

/** Only addresses a link can safely carry; a feed is outside data. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
