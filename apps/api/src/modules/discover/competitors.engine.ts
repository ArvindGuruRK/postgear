/**
 * What the competitor routes read with (Module 07), built once at boot, the way
 * `discover.engine.ts` builds the place sources.
 *
 * It is a token of its own because what it reads is different in kind. The place
 * sources ask a handful of well-known services. These ask whatever address a
 * person typed, so two things here exist for no other part of Discover:
 *
 * - `guard`, the private-network check every address passes before it is saved,
 *   shown or fetched. It is `assertSafeUrl` with nothing switched on: no extra
 *   ports and no private addresses, whatever `WEBHOOK_ALLOW_PRIVATE_URLS` says.
 *   That flag is for webhooks and has no way to reach this file.
 * - `fetch`, the raw fetch for reading a website and trying its feed addresses.
 *   Outside simulation it is the guarded one, which checks every redirect hop
 *   again and pins the address it checked.
 *
 * ## Simulation
 *
 * With `DISCOVER_SIMULATION` on, the fetch reads the hand-written samples of one
 * invented company (`COMPETITOR_SAMPLE`, on `acme.example`) and answers 404 for
 * anything else, so no stranger's site is ever asked. The guard still runs, and
 * still refuses an address literal on a private range and a local name, which is
 * what the hand check types. It does not look names up: `.example` has no DNS, and
 * a lookup is an outside call too. Every name counts as public, which is safe
 * only because nothing behind it can be fetched.
 */
import {
  type CompetitorSource,
  createBlueskyAuthorSource,
  createFixtureFetch,
  createGoogleNewsSource,
  createMastodonAccountSource,
  createRssSource,
  createYoutubeChannelSource,
  type DiscoverFetch,
  type GoogleNewsSource,
} from '@postgear/discover-engine';
import { assertSafeUrl, type UrlSafetyResult } from '@postgear/seo-engine';
import { createSafeDiscoverFetch, type DiscoverEnv } from './discover.engine';

export const COMPETITOR_ENGINE = Symbol('COMPETITOR_ENGINE');

/**
 * The gate competitor reads and Find Feeds wait at: a `DiscoverGate` of their own.
 * A host a person typed can accept a connection and then say nothing for seconds.
 * At the gate the place feeds use, four such feeds would hold every slot, and
 * Trending would come back empty for every workspace until they timed out.
 */
export const COMPETITOR_GATE = Symbol('COMPETITOR_GATE');

/** A public address that stands in for every name under simulation. Never connected to. */
const SIMULATED_ADDRESS = '93.184.216.34';

export type UrlGuard = (url: string) => Promise<UrlSafetyResult>;

export interface CompetitorEngine {
  simulation: boolean;
  guard: UrlGuard;
  /** For a website's page and its common feed addresses. Throws when the guard refuses a hop. */
  fetch: DiscoverFetch;
  feeds: CompetitorSource;
  youtube: CompetitorSource;
  bluesky: CompetitorSource;
  mastodon: CompetitorSource;
  news: GoogleNewsSource;
}

export type CompetitorEnv = Pick<
  DiscoverEnv,
  'DISCOVER_SIMULATION' | 'DISCOVER_GEOCODER_USER_AGENT'
>;

const realGuard: UrlGuard = (url) => assertSafeUrl(url);

const simulatedGuard: UrlGuard = (url) =>
  assertSafeUrl(url, { resolve: async () => [SIMULATED_ADDRESS] });

export function createCompetitorEngine(env: CompetitorEnv): CompetitorEngine {
  const simulation = env.DISCOVER_SIMULATION === 'true';
  const fetch = simulation
    ? createFixtureFetch()
    : createSafeDiscoverFetch(env.DISCOVER_GEOCODER_USER_AGENT);
  // Samples all pass 30 days a month after they are written, so simulation has no age limit.
  const options = { fetch, ...(simulation ? { maxAgeMs: null } : {}) };

  return {
    simulation,
    guard: simulation ? simulatedGuard : realGuard,
    fetch,
    feeds: createRssSource(options),
    youtube: createYoutubeChannelSource(options),
    bluesky: createBlueskyAuthorSource(options),
    mastodon: createMastodonAccountSource(options),
    news: createGoogleNewsSource({ fetch }),
  };
}
