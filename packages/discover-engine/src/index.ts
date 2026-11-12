/**
 * `@postgear/discover-engine`: what a place is, and what is happening there.
 *
 * Nothing in this package reaches the network on its own: every source and the
 * geocoder take an injected fetch. The API binds that to its SSRF-guarded fetch,
 * simulation to recorded feeds, and a test to whatever it wants to prove. It
 * imports no other workspace package, and the web app mirrors `types.ts` by hand.
 */

export {
  editionFor,
  languagesWithEdition,
  NEWS_EDITIONS,
  type NewsEdition,
  type NewsLocale,
  newsLanguagesFor,
} from './geo/editions';
export {
  createNominatimGeocoder,
  GeocoderError,
  type GeocoderErrorKind,
  type NominatimOptions,
  placeFromNominatim,
} from './geo/geocoder/nominatim';
export { CHENNAI, createSimulatedGeocoder, PARIS, SAN_FRANCISCO } from './geo/geocoder/simulated';
export { type IpCountryTable, lookupCountry, parseIpCountryCsv } from './geo/ip-country';
export { countryOf, isCountryCode, isRegionCode, trendsGeo } from './geo/iso3166';
export { resolveLanguages } from './geo/languages';
export { CLDR_VERSION, COUNTRY_LANGUAGES } from './geo/languages.generated';
export {
  buildLocality,
  type LocalityFields,
  localityFromTimeZone,
  WORLDWIDE,
} from './geo/locality';
export {
  buildLocalityFromPicker,
  listCountries,
  listRegions,
  type PlaceOption,
} from './geo/places-list';
export { REGION_LANGUAGES, REGION_NAMES } from './geo/region-languages';
export { COUNTRY_REGIONS } from './geo/regions.generated';
export {
  countryFromTimeZone,
  countryName,
  defaultTimeZone,
  isKnownCountry,
} from './geo/timezone';
export {
  COMMON_FEED_PATHS,
  type DiscoveredFeed,
  type DiscoverFeedsOptions,
  discoverFeeds,
  type FeedFormat,
  feedFormatOf,
  findFeedLinks,
  MAX_DISCOVERED_FEEDS,
} from './discover-feeds';
export {
  ARTICLE_EXCERPT_CHARS,
  ARTICLE_MIN_WORDS,
  ARTICLE_TEXT_MAX_CHARS,
  type Article,
  countWords,
  EXTRACT_ARTICLE_FILE,
  extractArticle,
  MAX_ELEMENT_ATTRIBUTES,
  MAX_PAGE_ATTRIBUTES,
  MAX_PAGE_COST,
  MAX_PAGE_DEPTH,
  MAX_PAGE_ELEMENTS,
  MAX_PAGE_LINKS,
  MAX_PAGE_TAGS,
  PageTooComplexError,
  paragraphsOf,
  readMinutesOf,
} from './reader/extract-article';
export {
  batchRequestBody,
  type DecodeOptions,
  decodeGoogleNewsLink,
  decodeLocally,
  GOOGLE_NEWS_BATCH_URL,
  googleNewsArticleId,
  googleNewsArticleUrl,
  isGoogleNewsLink,
  LinkUnresolvedError,
  type LinkUnresolvedReason,
  readBatchAnswer,
  readDecodingParams,
} from './reader/google-news-link';
export {
  COMPETITOR_FIXTURES,
  COMPETITOR_SAMPLE,
  createFixtureFetch,
  createReaderFixtureFetch,
  FIXTURE_FEEDS,
  type FixtureFeed,
  READER_FIXTURES,
  READER_SAMPLE,
} from './simulation';
export { BLUESKY_TRENDS_URL, createBlueskySource } from './sources/bluesky';
export {
  blueskyAuthorFeedUrl,
  blueskyHandle,
  createBlueskyAuthorSource,
} from './sources/bluesky-author';
export { BRIEF_MAX_CHARS, type BriefContext, buildBrief, placeLabel } from './sources/brief';
export {
  COMPETITOR_MAX_AGE_MS,
  COMPETITOR_MAX_ITEMS,
  COMPETITOR_TEXT_CHARS,
  type CompetitorSource,
  type CompetitorSourceOptions,
  isHostName,
} from './sources/competitor';
export {
  type ComposedGroup,
  type ComposeOptions,
  composeFeed,
  type FeedGroupInput,
  GROUP_CAPS,
  itemId,
  NEWS_MAX_AGE_MS,
} from './sources/compose';
export {
  type FeedItem,
  FeedParseError,
  type FeedRead,
  type ParsedFeed,
  parseFeed,
  readFeed,
  stripHtml,
} from './sources/feed-parser';
export {
  createGdeltSource,
  GDELT_DOC_URL,
  gdeltDocUrl,
  gdeltQuery,
  parseGdeltBody,
  seenDateIso,
  tidyGdeltTitle,
} from './sources/gdelt';
export {
  GDELT_LANGUAGE_NAMES,
  gdeltCountry,
  gdeltLanguage,
  ISO_TO_FIPS,
  languageTagOf,
} from './sources/gdelt-codes';
export {
  createGoogleNewsSource,
  type GoogleNewsSource,
  isNewsTopic,
  NEWS_TOPICS,
  type NewsTopic,
  newsPlaceUrl,
  newsSearchUrl,
  newsTopicUrl,
  newsTopUrl,
  parseRelated,
  searchPhrase,
  stripPublisher,
} from './sources/google-news';
export { createGoogleTrendsSource, parseTraffic, trendsFeedUrl } from './sources/google-trends';
// Only what the API cuts and labels festivals with. How the two readers are
// merged stays inside `sources/holidays`, and `date-holidays` itself is not
// loaded by importing this file: the source requires it on its first fetch.
export {
  createHolidaysSource,
  daysUntil,
  FESTIVAL_DAYS_AHEAD,
  FESTIVAL_DAYS_BACK,
  FESTIVAL_SPAN_DAYS_AHEAD,
  FESTIVAL_SPAN_DAYS_BACK,
  festivalsInWindow,
  todayIn,
} from './sources/holidays';
export {
  CURATED_DAYS,
  type CuratedDate,
  type CuratedDay,
  type CuratedYearlyDay,
  curatedFestivals,
  hasCuratedDays,
  NEAR_DAYS,
} from './sources/holidays/curated';
export { holidayRegion } from './sources/holidays/date-holidays';
export { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './sources/holidays/google-calendar';
export { calendarName, type IcsEvent, parseIcs } from './sources/holidays/ics';
export {
  businessDiscoveryFields,
  createInstagramBusinessSource,
  INSTAGRAM_GRAPH_VERSION,
  type InstagramBusinessReference,
  type InstagramBusinessSource,
  type InstagramBusinessSourceOptions,
  instagramBusinessPrefix,
  instagramBusinessUrl,
  instagramUsername,
  isInstagramUsername,
} from './sources/instagram-business';
export { cleanText, decodeEntities, safeHttpUrl, stripControlChars } from './sources/html-text';
export { createMastodonSource, MASTODON_INSTANCE, mastodonTrendsUrl } from './sources/mastodon';
export {
  createMastodonAccountSource,
  type MastodonAccount,
  mastodonAccount,
  mastodonLookupUrl,
  mastodonStatusesUrl,
} from './sources/mastodon-account';
export {
  createNewsDataSource,
  NEWSDATA_CATEGORIES,
  newsDataPrefix,
  newsDataUrl,
} from './sources/newsdata';
export { createRssSource, FEED_ACCEPT } from './sources/rss';
export {
  createSerpApiNewsSource,
  SERPAPI_TOPIC_TOKENS,
  serpApiNewsPrefix,
  serpApiNewsUrl,
} from './sources/serpapi-news';
export {
  createWikipediaSource,
  isWikipediaArticle,
  wikipediaProject,
  wikipediaTopPrefix,
  wikipediaTopUrl,
} from './sources/wikipedia';
export { createYoutubeSource, youtubePopularPrefix, youtubePopularUrl } from './sources/youtube';
export {
  createYoutubeChannelSource,
  isYoutubeChannelId,
  youtubeChannelFeedUrl,
} from './sources/youtube-channel';
export type {
  ComposedItem,
  DiscoverFetch,
  DiscoverFetchInit,
  DiscoverFetchResponse,
  DiscoverItem,
  DiscoverItemKind,
  DiscoverItemSignal,
  DiscoverSource,
  Geocoder,
  Locality,
  RelatedHeadline,
  SourceAttribution,
  SourceFailure,
  SourceId,
  SourceInput,
  SourceItem,
  SourceResult,
} from './types';
