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
export { countryOf, isCountryCode, isRegionCode, trendsGeo } from './geo/iso3166';
export { resolveLanguages } from './geo/languages';
export { CLDR_VERSION, COUNTRY_LANGUAGES } from './geo/languages.generated';
export {
  buildLocality,
  type LocalityFields,
  localityFromTimeZone,
  WORLDWIDE,
} from './geo/locality';
export { REGION_LANGUAGES, REGION_NAMES } from './geo/region-languages';
export {
  countryFromTimeZone,
  countryName,
  defaultTimeZone,
  isKnownCountry,
} from './geo/timezone';
export { createFixtureFetch, FIXTURE_FEEDS, type FixtureFeed } from './simulation';
export { BRIEF_MAX_CHARS, buildBrief, placeLabel } from './sources/brief';
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
  createGoogleNewsSource,
  type GoogleNewsSource,
  isNewsTopic,
  NEWS_TOPICS,
  type NewsTopic,
  newsPlaceUrl,
  newsTopicUrl,
  newsTopUrl,
  parseRelated,
  stripPublisher,
} from './sources/google-news';
export { createGoogleTrendsSource, parseTraffic, trendsFeedUrl } from './sources/google-trends';
export { cleanText, decodeEntities, safeHttpUrl, stripControlChars } from './sources/html-text';
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
