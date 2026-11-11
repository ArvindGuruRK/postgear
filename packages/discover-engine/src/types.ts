/**
 * The shapes the engine and the API agree on, and the ones the web app mirrors
 * by hand in `apps/web/src/types/discover.ts` (it never imports the engine).
 *
 * The one rule behind the fetch types: nothing in this package reaches the
 * network on its own. Every source and the geocoder take a {@link DiscoverFetch},
 * which the API binds to the SSRF-guarded fetch, simulation binds to recorded
 * files, and a test binds to whatever it wants to prove.
 */

export type SourceId =
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
 * A place: what the UI calls it, and everything the sources select by. Coordinates
 * are deliberately not a field: they are used once to find this and then dropped.
 */
export interface Locality {
  /** ISO 3166-1 alpha-2. Null means Worldwide. */
  countryCode: string | null;
  countryName: string | null;
  /** ISO 3166-2, such as `IN-TN`. */
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  /** IANA. Decides where "today" begins for this place, never the server's clock. */
  timeZone: string | null;
  /** BCP-47, the default first. Never empty: English is always in the list. */
  languages: string[];
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
  /** Stable hash of the source and the item's address or title. */
  id: string;
  kind: DiscoverItemKind;
  source: { id: SourceId; name: string; url?: string };
  /** Plain text, HTML stripped. */
  title: string;
  summary?: string;
  /** Where Open goes, when we have a real address. */
  url?: string;
  /** The Google News redirect, when that is all we have. */
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
  /** Festivals: true for an observance rather than a public holiday. */
  observance?: boolean;
  /** What Create Post sends as the topic. Built on the way out, never stored. */
  brief: string;
}

/** An item as a source hands it over: `composeFeed` gives it an id. */
export type SourceItem = Omit<DiscoverItem, 'id' | 'brief'>;

/** An item after `composeFeed`: what the shared cache holds. The brief is per request. */
export type ComposedItem = Omit<DiscoverItem, 'brief'>;

export interface SourceAttribution {
  name: string;
  url?: string;
}

/**
 * Why a source came back with nothing to show, when that is not simply an empty
 * feed. The two are kept apart because only one of them says the service is in
 * trouble: `upstream` (a 429, a 5xx, a dropped connection, a page that is not a
 * feed) counts towards the source's breaker, and `not_found` (it answered, but
 * has nothing for this place) does not, so a place Google does not cover cannot
 * switch the source off for every other workspace.
 */
export type SourceFailure = 'upstream' | 'not_found';

export interface SourceResult {
  items: SourceItem[];
  attribution: SourceAttribution;
  warnings: string[];
  failed?: SourceFailure;
  /** Google Trends: which geo really answered, so a header can say so after a fallback. */
  answeredGeo?: string;
  /**
   * Wikipedia: the UTC day (`YYYY-MM-DD`) the numbers are for. Yesterday's are
   * published some hours into today, so the day before can be what answered, and
   * a header must not call that "yesterday".
   */
  answeredDay?: string;
  /**
   * YouTube: quota units the outside calls behind this answer cost, whether or
   * not they succeeded. The API keeps the day's budget from it.
   */
  unitsUsed?: number;
  /**
   * Festivals: the items are real but not the whole picture, because one of the
   * two things this source reads (the country's calendar) did not answer and the
   * other (the offline holiday rules) did. Not a failure, so it never counts
   * towards a breaker; the API shows the items and asks again sooner.
   */
  partial?: boolean;
  /**
   * Competitors: the address answered, but not with what was asked for (a page
   * where a feed should be, a body over the size cap, another shape). Set only
   * with `failed: 'not_found'`, because the host itself is fine. The page says
   * "could not be read" for it, and "could not be reached" for any other failure.
   */
  unreadable?: boolean;
}

export interface SourceInput {
  locality: Locality;
  language: string;
  topic?: string;
  /** The caller's deadline. Without one, the source applies its own. */
  signal?: AbortSignal;
}

/** Never throws: a failure comes back as an empty {@link SourceResult} with `failed` set. */
export interface DiscoverSource {
  readonly id: SourceId;
  readonly name: string;
  readonly fetch: (input: SourceInput) => Promise<SourceResult>;
}

export interface DiscoverFetchInit {
  accept: string;
  signal: AbortSignal;
  maxBytes: number;
  /** Overrides the binding's default. Nominatim's policy asks for an identifying one. */
  userAgent?: string;
  /**
   * A form to send with a POST instead of asking with a GET. One caller needs
   * it: resolving a Google News link (Module 08). Everything else only reads.
   */
  post?: { body: string; contentType: string };
  /** Refuse an answer that is not an HTML page. The reader sets it; feeds and JSON never do. */
  requireHtml?: boolean;
}

export interface DiscoverFetchResponse {
  status: number;
  body: string;
  finalUrl: string;
  /**
   * The answer's `Content-Type`, when the binding knows it. The reader looks at
   * its charset: the body was decoded as UTF-8, and a page in another encoding
   * would otherwise be shown, and kept, as garbage.
   */
  contentType?: string | null;
}

/** A non-200 is an answer, not a throw. A throw means the request never completed. */
export type DiscoverFetch = (
  url: string,
  init: DiscoverFetchInit,
) => Promise<DiscoverFetchResponse>;

/**
 * Coordinates or a typed city into a place. Throws a `GeocoderError` when the
 * service could not answer; a position it knows nothing about is Worldwide.
 */
export interface Geocoder {
  readonly reverse: (lat: number, lng: number, language?: string) => Promise<Locality>;
  readonly search: (query: string, language?: string) => Promise<Locality[]>;
  readonly fromTimeZone: (timeZone: string) => Locality;
}
