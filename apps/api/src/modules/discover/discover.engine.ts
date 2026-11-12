/**
 * Builds the sources and the place finder from the environment, once, at boot.
 *
 * Two worlds, and this is the only file that knows about both. With
 * `DISCOVER_SIMULATION` on, everything reads recorded feeds and a stand-in place
 * finder, and nothing can reach the network. Otherwise every outside call goes
 * through {@link createSafeDiscoverFetch}, so the engine, which takes its fetch from
 * outside, is held to the same SSRF guard, byte cap and timeout as the SEO crawler.
 *
 * `DISCOVER_GEOCODER=off` wins over both: the routes that find places answer 503 in
 * simulation too, so that state can be seen locally.
 *
 * ## The one key
 *
 * YouTube is the only source that needs a key, so it is the only one that can be
 * missing: without `YOUTUBE_API_KEY` there is no videos source at all, and the
 * Videos tab says it is not set up. The key lives inside that source and nowhere
 * else. Nothing here hands it on, the boot line says only whether there is one, and
 * simulation does not use the real one even when it is set.
 */
import {
  createBlueskySource,
  createFixtureFetch,
  createGdeltSource,
  createGoogleNewsSource,
  createGoogleTrendsSource,
  createHolidaysSource,
  createMastodonSource,
  createNewsDataSource,
  createNominatimGeocoder,
  createSerpApiNewsSource,
  createSimulatedGeocoder,
  createWikipediaSource,
  createYoutubeSource,
  type DiscoverFetch,
  type DiscoverSource,
  type Geocoder,
  type GoogleNewsSource,
} from '@postgear/discover-engine';
import { fetchUrlSafely } from '@postgear/seo-engine';
import { createOperatorFetch } from '../../common/http/operator-fetch';
import type { Env } from '../../config/env';

export const DISCOVER_ENGINE = Symbol('DISCOVER_ENGINE');

const REQUEST_TIMEOUT_MS = 8_000;

/** What simulation asks its recordings with. They answer whatever the key, so the real one stays at home. */
const SIMULATED_YOUTUBE_KEY = 'simulation';

export type NewsProvider = 'google' | 'serpapi' | 'newsdata';

export interface DiscoverEngine {
  simulation: boolean;
  userAgent: string;
  /** Null when finding places is turned off. */
  geocoder: Geocoder | null;
  /**
   * Module 10: the place finder is the operator's own Nominatim. Its policy is
   * theirs, so the one-a-second budget is lifted and the field may search as
   * someone types.
   */
  geocoderSelfHosted: boolean;
  trends: DiscoverSource;
  /** Google News, or a keyed stand-in with the same shape (Module 10, `DISCOVER_NEWS_PROVIDER`). */
  news: GoogleNewsSource;
  newsProvider: NewsProvider;
  /** Module 10: a place's coverage in the world's press, through GDELT. */
  gdelt: DiscoverSource | null;
  wikipedia: DiscoverSource;
  bluesky: DiscoverSource;
  mastodon: DiscoverSource;
  /** Null without `YOUTUBE_API_KEY`: the one source that needs a key. */
  videos: DiscoverSource | null;
  holidays: DiscoverSource;
}

export type DiscoverEnv = Pick<
  Env,
  'DISCOVER_SIMULATION' | 'DISCOVER_GEOCODER' | 'DISCOVER_GEOCODER_USER_AGENT' | 'YOUTUBE_API_KEY'
> &
  Partial<
    Pick<
      Env,
      'DISCOVER_GEOCODER_URL' | 'DISCOVER_NEWS_PROVIDER' | 'SERPAPI_API_KEY' | 'NEWSDATA_API_KEY'
    >
  >;

/**
 * The News tab's service. Simulation always reads Google's recordings: the keyed
 * services are never asked from a laptop by accident, and the env check refuses
 * a provider whose key is missing before this runs.
 */
function newsSource(
  env: DiscoverEnv,
  simulation: boolean,
  feedFetch: DiscoverFetch,
): { news: GoogleNewsSource; provider: NewsProvider } {
  const provider = env.DISCOVER_NEWS_PROVIDER ?? 'google';
  if (!simulation && provider === 'serpapi' && env.SERPAPI_API_KEY) {
    return {
      news: createSerpApiNewsSource({ fetch: feedFetch, apiKey: env.SERPAPI_API_KEY }),
      provider,
    };
  }
  if (!simulation && provider === 'newsdata' && env.NEWSDATA_API_KEY) {
    return {
      news: createNewsDataSource({ fetch: feedFetch, apiKey: env.NEWSDATA_API_KEY }),
      provider,
    };
  }
  return { news: createGoogleNewsSource({ fetch: feedFetch }), provider: 'google' };
}

/**
 * The engine's fetch over the guarded one.
 *
 * - A bad status comes back as an answer, because the sources tell a 429 from a
 *   404, and the geocoder needs to see a 429.
 * - The certificate is checked, unlike in the analyzer: the request can carry a
 *   person's rounded position or a typed city, and these are all well-known public
 *   services with nothing to report about their certificates.
 */
export function createSafeDiscoverFetch(userAgent: string): DiscoverFetch {
  return async (url, init) => {
    const response = await fetchUrlSafely(url, {
      signal: init.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: init.maxBytes,
      accept: init.accept,
      userAgent: init.userAgent ?? userAgent,
      // Only the reader asks for a page and nothing else (Module 08).
      requireHtml: init.requireHtml ?? false,
      rejectBadStatus: false,
      verifyCertificate: true,
      // Only resolving a Google News link sends anything (Module 08).
      ...(init.post ? { post: init.post } : {}),
    });
    return {
      status: response.statusCode,
      body: response.body,
      finalUrl: response.finalUrl,
      contentType: response.contentType,
    };
  };
}

export function createDiscoverEngine(env: DiscoverEnv): DiscoverEngine {
  const simulation = env.DISCOVER_SIMULATION === 'true';
  const userAgent = env.DISCOVER_GEOCODER_USER_AGENT;
  const feedFetch = simulation ? createFixtureFetch() : createSafeDiscoverFetch(userAgent);

  // Module 10: the operator's own Nominatim, reached through a fetch locked to
  // its one address (it usually sits on a private network the guard refuses).
  const ownGeocoder = !simulation && env.DISCOVER_GEOCODER_URL ? env.DISCOVER_GEOCODER_URL : null;

  let geocoder: Geocoder | null = null;
  if (env.DISCOVER_GEOCODER !== 'off') {
    geocoder = simulation
      ? createSimulatedGeocoder()
      : // English always: the cached answer is shared by everyone in that place, and
        // Google's place feed reads English place names best.
        createNominatimGeocoder({
          fetch: ownGeocoder ? createOperatorFetch(ownGeocoder, { userAgent }) : feedFetch,
          userAgent,
          acceptLanguage: 'en',
          ...(ownGeocoder ? { baseUrl: ownGeocoder } : {}),
        });
  }

  const { news, provider } = newsSource(env, simulation, feedFetch);

  return {
    simulation,
    userAgent,
    geocoder,
    geocoderSelfHosted: geocoder !== null && ownGeocoder !== null,
    trends: createGoogleTrendsSource({ fetch: feedFetch }),
    news,
    newsProvider: provider,
    gdelt: createGdeltSource({ fetch: feedFetch }),
    wikipedia: createWikipediaSource({ fetch: feedFetch }),
    bluesky: createBlueskySource({ fetch: feedFetch }),
    mastodon: createMastodonSource({ fetch: feedFetch }),
    videos: env.YOUTUBE_API_KEY
      ? createYoutubeSource({
          fetch: feedFetch,
          apiKey: simulation ? SIMULATED_YOUTUBE_KEY : env.YOUTUBE_API_KEY,
        })
      : null,
    holidays: createHolidaysSource({ fetch: feedFetch }),
  };
}

/**
 * What the boot log says about this process: which world it is in and who it says
 * it is. Videos is a yes or a no. The key itself is never in a log line.
 */
export function describeEngine(engine: DiscoverEngine) {
  return {
    event: 'discover.boot',
    simulation: engine.simulation,
    geocoder: engine.geocoder ? (engine.geocoderSelfHosted ? 'self-hosted' : 'nominatim') : 'off',
    userAgent: engine.userAgent,
    videos: engine.videos !== null,
    news: engine.newsProvider,
  };
}
