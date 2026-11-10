/**
 * What the Discover routes answer (Sprint 11). Hand-mirrored from
 * `packages/discover-engine/src/types.ts` and `apps/api/src/modules/discover`,
 * the way `types/ai.ts` mirrors the AI module: the web app never imports the
 * engine, which is server code.
 *
 * The words here are the API's. The page says place, trend and story.
 */

export type DiscoverSourceId =
  | 'google-trends'
  | 'google-news'
  | 'wikipedia'
  | 'youtube'
  | 'bluesky'
  | 'mastodon'
  | 'holidays'
  | 'rss';

export type DiscoverItemKind =
  | 'trend'
  | 'news'
  | 'wiki'
  | 'social'
  | 'video'
  | 'festival'
  | 'competitor';

/**
 * A place, as every Discover answer carries it. There is no position in it:
 * the browser's position is used once to find this and then dropped.
 */
export interface Locality {
  /** ISO 3166-1 alpha-2. Null means Worldwide. */
  countryCode: string | null;
  countryName: string | null;
  /** ISO 3166-2, such as `IN-TN`. */
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  /** IANA. */
  timeZone: string | null;
  /** Every language of the place, most used first. What the AI may write in. */
  languages: string[];
  /** The ones Google News has an edition for, in the edition's own spelling (`es-419`). */
  newsLanguages: string[];
}

export interface DiscoverItemSignal {
  /** Ready to show: "200+ searches". */
  label: string;
  rank?: number;
  traffic?: number;
  views?: number;
  posts?: number;
}

export interface RelatedHeadline {
  title: string;
  url: string;
  source: string;
}

export interface DiscoverItem {
  id: string;
  kind: DiscoverItemKind;
  source: { id: DiscoverSourceId; name: string; url?: string };
  title: string;
  summary?: string;
  /** Where Open goes, when there is a real address. */
  url?: string;
  /** The Google News redirect, when that is all there is. */
  opaqueUrl?: string;
  image?: string;
  /** ISO 8601. */
  publishedAt?: string;
  /** BCP-47. */
  language?: string;
  signal?: DiscoverItemSignal;
  related?: RelatedHeadline[];
  /** Festivals: YYYY-MM-DD in the place's calendar. */
  date?: string;
  observance?: boolean;
  /** What Create Post sends as the topic. */
  brief: string;
}

/**
 * Trending: `trends`, `wikipedia`, `social`. News: `topic`, `place`, `top`,
 * `world`. Videos: `videos`. Festivals: `festivals`.
 */
export type DiscoverGroupId =
  | 'trends'
  | 'wikipedia'
  | 'social'
  | 'place'
  | 'top'
  | 'world'
  | 'topic'
  | 'videos'
  | 'festivals';

export interface DiscoverGroup {
  id: DiscoverGroupId;
  /** Title Case: "Rising Searches In Tamil Nadu". */
  title: string;
  /** A sentence naming the source, with the stale note already on it when `stale`. */
  subtitle: string;
  attribution: { name: string; url?: string };
  items: DiscoverItem[];
  /** The source is resting and this is the last copy. */
  stale: boolean;
  /** ISO 8601: when this copy was fetched, so its real age. */
  fetchedAt: string;
}

/** The kinds the feed answers. Competitors has routes of its own (Module 07). */
export type FeedKind = 'trending' | 'news' | 'videos' | 'festivals';

/**
 * Why a tab has no groups, when that is worth a sentence of its own: the
 * source needs a key this PostGear does not have, or it has used up its day.
 */
export type FeedEmptyReason = 'not_set_up' | 'resting';

export interface FeedResponse {
  kind: FeedKind;
  /** The language the answer is in, which is the edition's for News. */
  language: string;
  locality: Locality;
  groups: DiscoverGroup[];
  /** Sources that had nothing to give (hidden groups), resting or not. */
  unavailable: DiscoverSourceId[];
  /** Festivals only: today (`YYYY-MM-DD`) in the place's own time zone, for "in 3 days". */
  today?: string;
  /** Videos only, and only with no groups. */
  reason?: FeedEmptyReason;
  /**
   * Only when the page asks with `useWorkspaceSources=1`: the groups of this
   * tab the workspace has switched off. Never fetched, never in `unavailable`.
   */
  hidden?: DiscoverSourceSwitch[];
}

/** The five groups a workspace can switch off (Module 06). News has no switch. */
export const DISCOVER_SOURCE_SWITCHES = [
  'trends',
  'wikipedia',
  'social',
  'videos',
  'festivals',
] as const;

export type DiscoverSourceSwitch = (typeof DISCOVER_SOURCE_SWITCHES)[number];

/** How the saved workspace place was found. `NONE` means no place was ever saved. */
export type DiscoverLocationSource = 'NONE' | 'BROWSER' | 'SEARCH' | 'TIMEZONE';

/** What a workspace saved for Discover: `GET` and `PATCH /discover/settings` answer it. */
export interface DiscoverSettings {
  /** Null with `locationSource: 'NONE'` means never saved; null with any other source means Worldwide was saved. */
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  timeZone: string | null;
  /** BCP-47, the workspace's order, first is the default. At most 6. */
  languages: string[];
  /** Google News topic ids, the first is the News tab's default. */
  topics: NewsTopic[];
  /** A missing key means on; null means every group is on. */
  sources: Partial<Record<DiscoverSourceSwitch, boolean>> | null;
  locationSource: DiscoverLocationSource;
  /** The saved place as every Discover answer carries one. Null when no place was ever saved. */
  place: Locality | null;
  /** ISO 8601, null when never saved. */
  updatedAt: string | null;
}

/**
 * What `PATCH /discover/settings` takes: any of these, never none. A place is
 * sent whole (all five place fields with `locationSource`), so a new city
 * never keeps the old region, and `sources` replaces the saved switches.
 */
export type DiscoverSettingsPatch = Partial<
  Pick<
    DiscoverSettings,
    | 'countryCode'
    | 'regionCode'
    | 'regionName'
    | 'city'
    | 'timeZone'
    | 'languages'
    | 'topics'
    | 'sources'
    | 'locationSource'
  >
>;

export interface DiscoverStatus {
  simulation: boolean;
  geocoder: 'nominatim' | 'off';
  sources: {
    trends: boolean;
    news: boolean;
    wikipedia: boolean;
    videos: boolean;
    holidays: boolean;
    social: boolean;
  };
}

export interface LocalityResponse {
  locality: Locality;
}

export interface LocalitySearchResponse {
  localities: Locality[];
  /** Only when nothing was found: "No places found for 'x'. Try the city's English name." */
  message?: string;
}

/** The page's tabs, in order. The open one lives in `?tab=`. */
export const DISCOVER_TABS = ['trending', 'news', 'videos', 'festivals', 'competitors'] as const;

export type DiscoverTab = (typeof DISCOVER_TABS)[number];

/** Google News topics, as the feed's `topic` takes them. */
export const NEWS_TOPICS = [
  'WORLD',
  'NATION',
  'BUSINESS',
  'TECHNOLOGY',
  'ENTERTAINMENT',
  'SPORTS',
  'SCIENCE',
  'HEALTH',
] as const;

export type NewsTopic = (typeof NEWS_TOPICS)[number];
