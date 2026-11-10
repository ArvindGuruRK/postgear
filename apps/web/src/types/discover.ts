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

export type DiscoverGroupId = 'trends' | 'place' | 'top' | 'world' | 'topic';

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

/** The kinds the feed answers today. Videos and festivals answer 501 until Module 05. */
export type FeedKind = 'trending' | 'news';

export interface FeedResponse {
  kind: FeedKind;
  /** The language the answer is in, which is the edition's for News. */
  language: string;
  locality: Locality;
  groups: DiscoverGroup[];
  /** Sources that had nothing to give (hidden groups), resting or not. */
  unavailable: DiscoverSourceId[];
}

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
