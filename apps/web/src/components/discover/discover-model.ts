/**
 * Discover's display logic, kept pure so the words are tested on their own:
 * what the place chip says in each state, the line a search result reads as,
 * which language a new place starts in, what is remembered per workspace, how
 * old the page's copy is, and (Module 05) which week a festival falls in, how
 * far off it is, and when a post about it should go out. Module 06 adds what
 * a workspace saved: where a visit starts, what Save For This Workspace
 * sends, and the News topic. Module 07 adds a competitor's rows: which of the
 * five kinds one is, and where its group says it reads from.
 *
 * The words are the page's (place, trend, story, festival, Worldwide), never
 * the API's.
 */
import type { ResearchSource } from '@/types/ai';
import type {
  Competitor,
  CompetitorKind,
  DiscoverGroup,
  DiscoverGroupId,
  DiscoverItem,
  DiscoverLocationSource,
  DiscoverSettings,
  DiscoverSettingsPatch,
  DiscoverSourceSwitch,
  DiscoverTab,
  Locality,
  NewsTopic,
} from '@/types/discover';
import { DISCOVER_TABS, NEWS_TOPICS } from '@/types/discover';
import { viewerTimeZone } from '../home/home-model';
import { formatRelative } from '../seo/seo-view-model';

/** How the current place was chosen. `workspace` is the workspace's saved place (Module 06). */
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

/** What the News tab's Topic select holds: one of Google's topics, or All (no topic group). */
export type TopicChoice = NewsTopic | 'ALL';

/** The select's options: All, then Google's order. */
export const TOPIC_CHOICES: readonly TopicChoice[] = ['ALL', ...NEWS_TOPICS];

export const TOPIC_NAMES: Record<TopicChoice, string> = {
  ALL: 'All',
  WORLD: 'World',
  NATION: 'Nation',
  BUSINESS: 'Business',
  TECHNOLOGY: 'Technology',
  ENTERTAINMENT: 'Entertainment',
  SPORTS: 'Sports',
  SCIENCE: 'Science',
  HEALTH: 'Health',
};

export function isNewsTopic(value: unknown): value is NewsTopic {
  return typeof value === 'string' && (NEWS_TOPICS as readonly string[]).includes(value);
}

export interface RememberedPlace {
  place: Locality;
  source: PlaceSource;
  language: string;
  /** The News topic, once the person picked one (Module 06). Left out until then. */
  topic?: TopicChoice;
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

  // Added in Module 06 without a new version: a record from before it has no
  // topic and is still a choice. Anything that is not a topic is dropped.
  const topic = record.topic === 'ALL' || isNewsTopic(record.topic) ? record.topic : undefined;

  return {
    place,
    source: record.source as PlaceSource,
    language: languageFor(place, record.language),
    ...(topic ? { topic } : {}),
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
    ...(remembered.topic ? { topic: remembered.topic } : {}),
  });
}

/*
 * The workspace's saved place (Module 06). An admin saves a place, languages
 * and topics for everyone; a person's own choice still wins on their device.
 */

export const NO_WORKSPACE_DEFAULT = 'No workspace default yet.';

/** The API's own refusal, word for word, so the tooltip and a 403 read the same. */
export const ADMINS_ONLY_PLACE = 'Only workspace admins can change the workspace place.';

/** How many languages a workspace keeps. */
export const MAX_WORKSPACE_LANGUAGES = 6;

/** The popover's line: "Workspace default: Chennai, Tamil Nadu", or that there is none yet. */
export function workspaceDefaultText(settings: DiscoverSettings): string {
  if (!settings.place) return NO_WORKSPACE_DEFAULT;
  return `Workspace default: ${placeChipText(settings.place, 'workspace')}`;
}

/** Where a visit to Discover starts. */
export type PlaceStart =
  | { from: 'remembered'; place: Locality; source: PlaceSource; language: string }
  | { from: 'workspace'; place: Locality; language: string }
  | { from: 'guess' };

/** Places the person picked themselves: found by the browser, searched, or Worldwide. */
const OWN_CHOICES: ReadonlySet<PlaceSource> = new Set(['browser', 'search', 'worldwide']);

/**
 * Where a visit starts, from what this browser remembers and what the
 * workspace saved (null when the settings could not be read).
 *
 * A place the person chose wins on this device. Without one, the workspace's
 * saved place is the start, in the workspace's first language when the place
 * offers it; without that either, the time zone guess.
 *
 * A remembered guess or workspace place is not a choice of place: it is only
 * stored because the person switched the language or the topic on it. So it
 * gives way to the workspace's place as it is saved now (a changed default
 * reaches everyone who never chose a place), and the language they switched
 * to is kept when the place still offers it. A remembered workspace place
 * whose default was cleared since is nobody's any more, and the guess is made
 * again.
 */
export function placeStart(
  remembered: RememberedPlace | null,
  settings: DiscoverSettings | null,
): PlaceStart {
  const saved = settings?.place ?? null;

  if (remembered && (OWN_CHOICES.has(remembered.source) || !saved)) {
    const cleared = remembered.source === 'workspace' && settings !== null;
    if (!cleared) {
      return {
        from: 'remembered',
        place: remembered.place,
        source: remembered.source,
        language: remembered.language,
      };
    }
  }
  if (!saved) return { from: 'guess' };

  const switched = remembered?.language;
  const wanted =
    switched && saved.newsLanguages.includes(switched) ? switched : settings?.languages[0];
  return { from: 'workspace', place: saved, language: languageFor(saved, wanted) };
}

/** The News tab's default topic: the workspace's first, or null for All. */
export function workspaceTopic(settings: DiscoverSettings | null): NewsTopic | null {
  const first = settings?.topics[0];
  return isNewsTopic(first) ? first : null;
}

/** Whether the workspace switched a group off. A missing key, or no settings, means on. */
export function switchedOff(
  settings: DiscoverSettings | null,
  group: DiscoverSourceSwitch,
): boolean {
  return settings?.sources?.[group] === false;
}

/**
 * How a saved place says it was found: the browser's position, the time zone
 * guess, or picked (a search, Worldwide, or the workspace's own place saved
 * again).
 */
export function locationSourceFor(source: PlaceSource): DiscoverLocationSource {
  if (source === 'browser') return 'BROWSER';
  if (source === 'guess') return 'TIMEZONE';
  return 'SEARCH';
}

/**
 * The languages saved with a place: the one being read first, then the
 * place's others that News has an edition in, each once, six at most.
 */
export function workspaceLanguages(place: Locality, language?: string | null): string[] {
  const lead = language ? [language] : [];
  return [...new Set([...lead, ...place.newsLanguages])].slice(0, MAX_WORKSPACE_LANGUAGES);
}

/** The five place fields and how the place was found, as one save carries them. */
export type PlacePatch = Required<
  Pick<
    DiscoverSettingsPatch,
    'countryCode' | 'regionCode' | 'regionName' | 'city' | 'timeZone' | 'locationSource'
  >
>;

/**
 * A place as `PATCH /discover/settings` takes it: whole, so a new city never
 * keeps the old region. Worldwide is every field null with a source that is
 * not `NONE`; `NONE` with every field null clears the saved place.
 */
export function placePatch(
  place: Locality | null,
  locationSource: DiscoverLocationSource,
): PlacePatch {
  const named = place && !isWorldwide(place) ? place : null;
  return {
    countryCode: named?.countryCode ?? null,
    regionCode: named?.regionCode ?? null,
    regionName: named?.regionName ?? null,
    city: named?.city ?? null,
    timeZone: named?.timeZone ?? null,
    locationSource,
  };
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

/**
 * Groups dated by something other than when they were fetched, so they stay
 * out of "Updated 5 min ago": Wikipedia's is a whole day's reading (its own
 * line says which day), and a festival's date does not age.
 */
const DATED_GROUPS: ReadonlySet<DiscoverGroupId> = new Set(['wikipedia', 'festivals']);

/**
 * The age of the oldest live copy shown: one line, so a stale group is never
 * hidden by a fresh one. Null when nothing shown is live (the Festivals tab).
 */
export function updatedText(groups: readonly DiscoverGroup[], now: Date): string | null {
  const times = groups
    .filter((group) => !DATED_GROUPS.has(group.id))
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
 * trend, "The Hindu, 2 hours ago" for a story, "1.2M views, 3 days ago" for a
 * video.
 */
export function itemMeta(item: DiscoverItem, now: Date): string {
  const lead = item.kind === 'news' ? item.source.name : item.signal?.label;
  const when = item.publishedAt ? formatRelative(item.publishedAt, now) : '';
  return [lead, when].filter(Boolean).join(', ');
}

/**
 * What a screen reader says for a social chip. The two networks look alike on
 * the page, so the name tells them apart and says the link leaves:
 * "House speaker on Bluesky, 4,625 posts, opens in a new tab".
 */
export function socialChipLabel(item: DiscoverItem): string {
  return [`${item.title} on ${item.source.name}`, item.signal?.label, 'opens in a new tab']
    .filter(Boolean)
    .join(', ');
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

/** What `POST /ai/generate` accepts for a topic and for its sources (`ai.schema.ts`). */
export const DRAFT_TOPIC_MAX = 2_000;
export const DRAFT_SOURCES_MAX = 6;
const SOURCE_TITLE_MAX = 300;
const SOURCE_SNIPPET_MAX = 500;
const SOURCE_URL_MAX = 2_048;

/** The brief a draft is written from: the API's own, bounded to what the route takes. */
export function draftTopic(item: DiscoverItem): string {
  const brief = item.brief.replace(/\s+/g, ' ').trim();
  const topic = brief.length >= 3 ? brief : item.title.trim();
  return topic.slice(0, DRAFT_TOPIC_MAX);
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Kinds whose title is a page of its own: a story, a Wikipedia article, a video. */
const OWN_SOURCE_KINDS: ReadonlySet<DiscoverItem['kind']> = new Set(['news', 'wiki', 'video']);

/**
 * The research a draft is backed by: what the card showed. A story, a
 * Wikipedia article and a video are each their own first source (the title,
 * its address, the source's name as the snippet); then the related coverage,
 * publisher as the snippet. Only web addresses, each once, at most six. A
 * trend's title is a search term, not an article, so a trend starts at its
 * related headlines; a festival and a social topic have no page of their own.
 */
export function draftSources(item: DiscoverItem): ResearchSource[] {
  const candidates: { title: string; url: string | null | undefined; snippet: string }[] = [];
  if (OWN_SOURCE_KINDS.has(item.kind)) {
    candidates.push({ title: item.title, url: openHref(item), snippet: item.source.name });
  }
  for (const headline of item.related ?? []) {
    candidates.push({ title: headline.title, url: headline.url, snippet: headline.source ?? '' });
  }

  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const candidate of candidates) {
    const url = safeHref(candidate.url);
    const title = oneLine(candidate.title, SOURCE_TITLE_MAX);
    if (!url || url.length > SOURCE_URL_MAX || title.length === 0 || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title, url, snippet: oneLine(candidate.snippet, SOURCE_SNIPPET_MAX) });
    if (sources.length === DRAFT_SOURCES_MAX) break;
  }
  return sources;
}

/**
 * The languages a draft can be written in: the place's own, then English,
 * each once. The chip's language leads when the place does not list it (a
 * news edition such as `es-419` where the place lists `es`).
 */
export function draftLanguages(place: Locality, chosen: string): string[] {
  const lead = place.languages.includes(chosen) ? [] : [chosen];
  return [...new Set([...lead, ...place.languages, 'en'])];
}

/** The AI page with the brief already in its topic (DC-4.5). */
export function copilotHref(orgId: string, item: DiscoverItem): string {
  return `/${orgId}/ai-copilot?topic=${encodeURIComponent(draftTopic(item))}`;
}

/*
 * Festivals (Module 05). Everything below reads a date as a plain calendar
 * date (`YYYY-MM-DD`) and counts from the answer's own `today`, which the API
 * works out in the place's time zone. The browser's clock and zone are never
 * asked, so Chennai's "tomorrow" reads the same to a colleague in Paris.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date as a count of days, or null for anything that is not one. No clock, no zone. */
function dayNumber(date: string | null | undefined): number | null {
  const match = date ? CALENDAR_DATE.exec(date) : null;
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  // The 30th of February is not a date; `Date.UTC` would roll it into March.
  const real =
    back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return real ? time / DAY_MS : null;
}

/** Whole days from `today` to `date`: negative for the past, null when either is not a date. */
export function daysUntil(
  date: string | null | undefined,
  today: string | null | undefined,
): number | null {
  const [day, from] = [dayNumber(date), dayNumber(today)];
  return day === null || from === null ? null : day - from;
}

/** "today", "tomorrow", "in 5 days", "yesterday", "2 days ago". Empty when it cannot be said. */
export function festivalWhen(
  date: string | null | undefined,
  today: string | null | undefined,
): string {
  const days = daysUntil(date, today);
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A festival's date as the row writes it: "8 Nov" and "Sunday". From tables,
 * not `Intl`, so the server and every browser write the same words.
 */
export function festivalDay(
  date: string | null | undefined,
): { day: string; weekday: string } | null {
  const number = dayNumber(date);
  if (number === null) return null;

  const at = new Date(number * DAY_MS);
  return {
    day: `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`,
    weekday: WEEKDAYS[at.getUTCDay()] ?? '',
  };
}

export type FestivalSectionId =
  | 'this-week'
  | 'next-week'
  | 'later-this-month'
  | 'next-month'
  | 'just-happened';

/** The list's sections in the order they are shown: what is coming first, what passed last. */
export const FESTIVAL_SECTIONS: readonly { id: FestivalSectionId; title: string }[] = [
  { id: 'this-week', title: 'This Week' },
  { id: 'next-week', title: 'Next Week' },
  { id: 'later-this-month', title: 'Later This Month' },
  { id: 'next-month', title: 'Next Month' },
  { id: 'just-happened', title: 'Just Happened' },
];

export interface FestivalSection {
  /** `all` only when the answer had no usable `today`: one list in date order, with no name. */
  id: FestivalSectionId | 'all';
  title: string | null;
  items: DiscoverItem[];
}

/**
 * Which section a day falls in. Weeks run Monday to Sunday for every place:
 * one rule everywhere beats a per-country one, which would put the same
 * festival under two headings for two colleagues reading the same list.
 * This Week is today to the coming Sunday (a Sunday is the last day of its
 * own week), Next Week the seven days after, and what is left is Later This
 * Month while it is still today's calendar month, Next Month after that.
 */
function sectionOf(day: number, date: string, today: number, todayDate: string): FestivalSectionId {
  if (day < today) return 'just-happened';

  // Day 0 (1 January 1970) was a Thursday, so 0 here is a Sunday.
  const weekday = (((today + 4) % 7) + 7) % 7;
  const sunday = today + ((7 - weekday) % 7);
  if (day <= sunday) return 'this-week';
  if (day <= sunday + 7) return 'next-week';
  return date.slice(0, 7) === todayDate.slice(0, 7) ? 'later-this-month' : 'next-month';
}

/**
 * The festivals in their sections, empty sections left out. Coming dates read
 * soonest first, what just happened most recent first, and festivals that
 * share a date keep the order the API gave them. A festival without a real
 * date is dropped; without a real `today` nothing can be placed, so the list
 * is one unnamed section in date order.
 */
export function festivalSections(
  items: readonly DiscoverItem[],
  today: string | null | undefined,
): FestivalSection[] {
  const dated = items
    .map((item) => ({ item, date: item.date ?? '', day: dayNumber(item.date) }))
    .filter((entry): entry is { item: DiscoverItem; date: string; day: number } => {
      return entry.day !== null;
    })
    // `sort` is stable, so one date's festivals stay in the API's order.
    .sort((a, b) => a.day - b.day);
  if (dated.length === 0) return [];

  const todayNumber = dayNumber(today);
  if (todayNumber === null || !today) {
    return [{ id: 'all', title: null, items: dated.map((entry) => entry.item) }];
  }

  return FESTIVAL_SECTIONS.flatMap(({ id, title }) => {
    const found = dated.filter(
      (entry) => sectionOf(entry.day, entry.date, todayNumber, today) === id,
    );
    if (found.length === 0) return [];
    if (id === 'just-happened') found.sort((a, b) => b.day - a.day);
    return [{ id, title, items: found.map((entry) => entry.item) }];
  });
}

export interface FestivalBadge {
  label: 'Public Holiday' | 'Observance';
  variant: 'success' | 'secondary';
}

/** A day off is the green tag. Only a festival the API marks as not an observance is one. */
export function festivalBadge(item: Pick<DiscoverItem, 'observance'>): FestivalBadge {
  return item.observance === false
    ? { label: 'Public Holiday', variant: 'success' }
    : { label: 'Observance', variant: 'secondary' };
}

/** A post about a public holiday goes out the evening before: people post ahead of a day off. */
export const HOLIDAY_POST_HOUR = 18;
/** A post about an observance goes out that morning. */
export const OBSERVANCE_POST_HOUR = 10;

/**
 * How far a zone's clock is ahead of UTC at an instant, in minutes (India is
 * 330, Los Angeles -480 in winter), or null for a zone the browser does not
 * know. Read from `Intl`, which knows every clock change.
 */
function zoneOffsetMinutes(timeZone: string, instant: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const local = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    return Number.isFinite(local) ? Math.round((local - instant) / MINUTE_MS) : null;
  } catch {
    return null;
  }
}

/**
 * The zone's offset at a wall-clock hour of a calendar day. The first guess
 * reads the offset as if the wall time were UTC, which is the wrong side of a
 * clock change for a few hours a year; asking again at the instant that guess
 * gives settles it. (10:00 and 18:00 are never inside the hour a change skips
 * or repeats, so there is one right answer.)
 */
function wallClockOffset(day: number, hour: number, timeZone: string): number | null {
  const wall = day * DAY_MS + hour * HOUR_MS;
  const guess = zoneOffsetMinutes(timeZone, wall);
  if (guess === null) return null;
  return zoneOffsetMinutes(timeZone, wall - guess * MINUTE_MS) ?? guess;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * When Plan A Post dates the draft: the evening before a public holiday
 * (18:00), the morning of an observance (10:00), on the place's own clock.
 * An ISO 8601 instant with its offset (`2026-11-07T18:00:00+05:30`), as
 * `POST /ai/generate` takes it, right on either side of a clock change.
 *
 * A place without a time zone (or with one this browser does not know) is
 * read on the viewer's clock, then on UTC. Null only when the festival has no
 * real date. A moment already past is still returned: the sheet falls back to
 * the next full hour for it (`draftDate`).
 */
export function festivalPublishAt(
  item: Pick<DiscoverItem, 'date' | 'observance'>,
  timeZone: string | null | undefined,
  viewerZone: string = viewerTimeZone(),
): string | null {
  const festival = dayNumber(item.date);
  if (festival === null) return null;

  const holiday = item.observance === false;
  const day = holiday ? festival - 1 : festival;
  const hour = holiday ? HOLIDAY_POST_HOUR : OBSERVANCE_POST_HOUR;

  for (const zone of [timeZone, viewerZone, 'UTC']) {
    const offset = zone ? wallClockOffset(day, hour, zone) : null;
    if (offset === null) continue;

    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    const ahead = Math.abs(offset);
    const sign = offset < 0 ? '-' : '+';
    return `${date}T${twoDigits(hour)}:00:00${sign}${twoDigits(Math.floor(ahead / 60))}:${twoDigits(ahead % 60)}`;
  }
  return null;
}

/** A competitor's row by where it was read: its own feeds are its blog, and a story that names it is news. */
const COMPETITOR_KINDS: Partial<Record<DiscoverItem['source']['id'], CompetitorKind>> = {
  rss: 'blog',
  youtube: 'youtube',
  bluesky: 'bluesky',
  mastodon: 'mastodon',
  'google-news': 'news',
};

export const COMPETITOR_KIND_NAMES: Record<CompetitorKind, string> = {
  blog: 'Blog',
  youtube: 'YouTube',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  news: 'News',
};

/** Which of the five rows a competitor's item is. A source nobody expected reads as its blog. */
export function competitorKind(item: Pick<DiscoverItem, 'source'>): CompetitorKind {
  return COMPETITOR_KINDS[item.source.id] ?? 'blog';
}

/** The row's badge: Blog, YouTube, Bluesky, Mastodon or News. */
export function competitorKindLabel(item: Pick<DiscoverItem, 'source'>): string {
  return COMPETITOR_KIND_NAMES[competitorKind(item)];
}

/** "2 hours ago" for a competitor's row, or nothing when the item has no date. */
export function competitorWhen(item: Pick<DiscoverItem, 'publishedAt'>, now: Date): string {
  return item.publishedAt ? formatRelative(item.publishedAt, now) : '';
}

/** A group's name: "Latest From Acme Analytics", the name as the workspace typed it. */
export function competitorGroupTitle(name: string): string {
  return `Latest From ${name}`;
}

/**
 * The line under a competitor's name, saying where its rows come from: "From
 * their feeds, YouTube, Bluesky and Google News." The news search always runs
 * (it falls back to the name), so Google News is always in it.
 */
export function competitorSources(
  competitor: Pick<Competitor, 'feedUrls' | 'youtubeChannelId' | 'blueskyHandle' | 'mastodonAcct'>,
): string {
  const places = [
    competitor.feedUrls.length > 0 ? 'their feeds' : null,
    competitor.youtubeChannelId ? 'YouTube' : null,
    competitor.blueskyHandle ? 'Bluesky' : null,
    competitor.mastodonAcct ? 'Mastodon' : null,
    'Google News',
  ].filter((place): place is string => place !== null);

  const last = places.pop();
  return places.length > 0 ? `From ${places.join(', ')} and ${last}.` : `From ${last}.`;
}
