/**
 * What the reader reads with (Module 08), built once at boot.
 *
 * Like the competitor engine, and for the same reason: the address is whatever a
 * person pressed Read on or pasted. So it has the private-network guard, which
 * every address passes before anything is fetched, and a fetch that outside
 * simulation is the guarded one (each redirect hop checked again, the checked
 * address pinned, the body capped).
 *
 * `linkDecode` is `DISCOVER_LINK_DECODE`: whether a Google News link is turned
 * into the publisher's address before it is read. That step leans on an
 * unofficial endpoint, so it can be switched off without a deploy, and Read then
 * says to open the story in a new tab.
 *
 * ## Simulation
 *
 * With `DISCOVER_SIMULATION` on, the fetch reads hand-written sample pages and
 * nothing else (`createReaderFixtureFetch`): two articles, a front page, a
 * Google News page and its batch answer. Any other address answers the sample
 * article, because a Trends card under simulation still points at a real
 * publisher, and simulation never fetches one. The guard is the simulated one:
 * it refuses private addresses and looks no name up.
 */
import { createReaderFixtureFetch, type DiscoverFetch } from '@postgear/discover-engine';
import type { Env } from '../../config/env';
import { createUrlGuard } from './competitors.engine';
import type { UrlGuard } from './discover.addresses';
import { createSafeDiscoverFetch } from './discover.engine';

export const READER_ENGINE = Symbol('READER_ENGINE');

/**
 * The gate the reader's fetches wait at: a `DiscoverGate` of its own. A page a
 * person named can accept a connection and then say nothing for seconds, and
 * that must not take slots from the place feeds or from the competitors.
 */
export const READER_GATE = Symbol('READER_GATE');

export interface ReaderEngine {
  simulation: boolean;
  guard: UrlGuard;
  /** Throws when the guard refuses a redirect hop. A bad status is an answer. */
  fetch: DiscoverFetch;
  /** False when `DISCOVER_LINK_DECODE` is off: a Google News link is then never resolved. */
  linkDecode: boolean;
  /**
   * Module 10: whether a page with no article in its HTML may be opened in the
   * shared headless browser and read again. Never under simulation, which
   * reaches no stranger's site.
   */
  render: boolean;
}

export type ReaderEnv = Pick<
  Env,
  'DISCOVER_SIMULATION' | 'DISCOVER_GEOCODER_USER_AGENT' | 'DISCOVER_LINK_DECODE'
> &
  Partial<Pick<Env, 'DISCOVER_READER_RENDER'>>;

export function createReaderEngine(env: ReaderEnv): ReaderEngine {
  const simulation = env.DISCOVER_SIMULATION === 'true';

  return {
    simulation,
    guard: createUrlGuard(simulation),
    fetch: simulation
      ? createReaderFixtureFetch()
      : createSafeDiscoverFetch(env.DISCOVER_GEOCODER_USER_AGENT),
    linkDecode: env.DISCOVER_LINK_DECODE === 'true',
    render: !simulation && env.DISCOVER_READER_RENDER !== 'false',
  };
}
