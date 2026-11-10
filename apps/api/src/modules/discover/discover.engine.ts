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
 */
import {
  createFixtureFetch,
  createGoogleNewsSource,
  createGoogleTrendsSource,
  createNominatimGeocoder,
  createSimulatedGeocoder,
  type DiscoverFetch,
  type DiscoverSource,
  type Geocoder,
  type GoogleNewsSource,
} from '@postgear/discover-engine';
import { fetchUrlSafely } from '@postgear/seo-engine';
import type { Env } from '../../config/env';

export const DISCOVER_ENGINE = Symbol('DISCOVER_ENGINE');

const REQUEST_TIMEOUT_MS = 8_000;

export interface DiscoverEngine {
  simulation: boolean;
  userAgent: string;
  /** Null when finding places is turned off. */
  geocoder: Geocoder | null;
  trends: DiscoverSource;
  news: GoogleNewsSource;
}

export type DiscoverEnv = Pick<
  Env,
  'DISCOVER_SIMULATION' | 'DISCOVER_GEOCODER' | 'DISCOVER_GEOCODER_USER_AGENT'
>;

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
      requireHtml: false,
      rejectBadStatus: false,
      verifyCertificate: true,
    });
    return { status: response.statusCode, body: response.body, finalUrl: response.finalUrl };
  };
}

export function createDiscoverEngine(env: DiscoverEnv): DiscoverEngine {
  const simulation = env.DISCOVER_SIMULATION === 'true';
  const userAgent = env.DISCOVER_GEOCODER_USER_AGENT;
  const feedFetch = simulation ? createFixtureFetch() : createSafeDiscoverFetch(userAgent);

  let geocoder: Geocoder | null = null;
  if (env.DISCOVER_GEOCODER !== 'off') {
    geocoder = simulation
      ? createSimulatedGeocoder()
      : // English always: the cached answer is shared by everyone in that place, and
        // Google's place feed reads English place names best.
        createNominatimGeocoder({ fetch: feedFetch, userAgent, acceptLanguage: 'en' });
  }

  return {
    simulation,
    userAgent,
    geocoder,
    trends: createGoogleTrendsSource({ fetch: feedFetch }),
    news: createGoogleNewsSource({ fetch: feedFetch }),
  };
}
