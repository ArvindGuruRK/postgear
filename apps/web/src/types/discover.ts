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

/**
 * What a competitor's row is, which is also its badge: Blog (their own feeds),
 * YouTube, Bluesky, Mastodon, or News (stories that name them).
 */
export type CompetitorKind = 'blog' | 'youtube' | 'bluesky' | 'mastodon' | 'news';

/** A competitor the workspace follows (Module 07). `GET /discover/competitors` lists them. */
export interface Competitor {
  id: string;
  name: string;
  websiteUrl: string | null;
  /** RSS or Atom addresses, found on the website or typed. At most 5. */
  feedUrls: string[];
  youtubeChannelId: string | null;
  blueskyHandle: string | null;
  /** `user@instance`. */
  mastodonAcct: string | null;
  /** What Google News is searched for. Null means the name. */
  newsQuery: string | null;
  /** ISO 8601, null until its items were first read. */
  lastCheckedAt: string | null;
  /** One sentence ("YouTube could not be reached."), null when the last read went well. */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorsResponse {
  competitors: Competitor[];
  /** How many a workspace may follow (20). */
  limit: number;
}

/**
 * What `POST /discover/competitors` takes, and any part of it for `PATCH`.
 * Null clears an optional field. The website may be typed without `https://`.
 */
export interface CompetitorInput {
  name: string;
  websiteUrl?: string | null;
  feedUrls?: string[];
  youtubeChannelId?: string | null;
  blueskyHandle?: string | null;
  mastodonAcct?: string | null;
  newsQuery?: string | null;
}

/** A feed found on a website: `POST /discover/competitors/discover-feeds` answers these. */
export interface DiscoveredFeed {
  url: string;
  /** The feed's name as the site gives it ("Blog"). Empty when it gives none. */
  title: string;
  kind: 'rss' | 'atom';
}

/** `GET /discover/competitors/:id/items`: the newest of everything one competitor published. */
export interface CompetitorItemsResponse {
  /**
   * Newest first, every one `kind: 'competitor'` with its `brief`. Its
   * `source.id` says which row it is: `rss` Blog, `youtube`, `bluesky`,
   * `mastodon`, `google-news` News.
   */
  items: DiscoverItem[];
  /** The kinds that could not be read this time. Their last copy, if any, is still in `items`. */
  unavailable: CompetitorKind[];
  /** One sentence for each of those: "YouTube could not be reached. Showing what we had from 2 hours ago." */
  notes: string[];
  /** ISO 8601. */
  fetchedAt: string;
  stale: boolean;
  /**
   * Nothing is known yet for at least one of its places: someone else is
   * reading them right now, or the API had no free slot. Ask again in a few
   * seconds, and never read an empty `items` as "nothing new" while this is true.
   */
  pending: boolean;
}

/**
 * A page as the reader shows it (Module 08): `POST /discover/read` answers
 * `{ article }`. Everything in it is plain text. Nothing here is markup, and
 * nothing here is ever rendered as markup.
 */
export interface ReaderArticle {
  /** The address that was asked for. */
  url: string;
  /**
   * Where the page really was: after redirects, or the publisher's own address
   * behind a Google News link. Open goes here.
   */
  finalUrl: string;
  title: string;
  byline: string | null;
  /** The site's name, or its host when it gives none. */
  siteName: string | null;
  /** BCP-47, as the page declares it. */
  language: string | null;
  /** The first 400 characters of the text. */
  excerpt: string;
  /** Plain paragraphs with a blank line between them, at most 20,000 characters. */
  text: string;
  image: string | null;
  /** ISO 8601. */
  publishedAt: string | null;
  wordCount: number;
  readMinutes: number;
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
