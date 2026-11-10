/**
 * Turning a position, a time zone or a typed city into a place.
 *
 * OpenStreetMap's Nominatim is free and has rules, and this is where they are kept,
 * for the whole deployment, because only the API can count across every workspace:
 * one request a second, an identifying User-Agent (the engine factory), and answers
 * kept for 30 days. Autocomplete is forbidden, which is why search only ever runs
 * when a person presses Enter: the web has no other path to this route.
 *
 * The throttle comes before the cache on purpose. It counts a person asking, not an
 * upstream call: a script walking a grid of positions should stop the same way
 * whether or not those positions happen to be cached.
 *
 * Neither a position nor a typed query is ever logged or stored. They are held only
 * for this call, and the keys hold their hashes (`discover.keys.ts`).
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type Geocoder,
  GeocoderError,
  type Locality,
  localityFromTimeZone,
  newsLanguagesFor,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { DISCOVER_ENGINE, type DiscoverEngine } from './discover.engine';
import { type DiscoverKeys, discoverKeys, workspaceKeys } from './discover.keys';
import { DISCOVER_MESSAGES } from './discover.messages';

export const LOCALITY_LIMIT_PER_MINUTE = 5;
const LOCALITY_WINDOW_SECONDS = 60;
export const GEO_CACHE_SECONDS = 30 * 24 * 60 * 60;

const BUDGET_SECONDS = 1;
const BUDGET_WAIT_MS = 2_000;
const BUDGET_POLL_MS = 100;

/** A place as the API answers it: with the languages the News chip can offer. */
export type LocalityAnswer = Locality & { newsLanguages: string[] };

export function withNewsLanguages(locality: Locality): LocalityAnswer {
  return {
    ...locality,
    newsLanguages: newsLanguagesFor(locality.countryCode, locality.languages),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class LocalityService {
  private readonly logger = new Logger(LocalityService.name);
  private readonly keys: DiscoverKeys;

  constructor(
    @Inject(DISCOVER_ENGINE) private readonly engine: DiscoverEngine,
    private readonly redis: RedisService,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  /** No outside call and no limit: this is what fills the page before anyone asks for anything. */
  fromTimeZone(timeZone: string): Locality {
    return localityFromTimeZone(timeZone);
  }

  async reverse(orgId: string, lat: number, lng: number): Promise<Locality> {
    const geocoder = this.requireGeocoder();
    await this.throttle(orgId);

    return this.throughCache(
      orgId,
      this.keys.geoReverse(lat, lng),
      () => geocoder.reverse(lat, lng),
      DISCOVER_MESSAGES.localityUnavailable,
    );
  }

  async search(orgId: string, query: string): Promise<Locality[]> {
    const geocoder = this.requireGeocoder();
    await this.throttle(orgId);

    return this.throughCache(
      orgId,
      this.keys.geoSearch(query.normalize('NFKC').toLowerCase()),
      () => geocoder.search(query),
      DISCOVER_MESSAGES.searchUnavailable,
    );
  }

  private requireGeocoder(): Geocoder {
    if (this.engine.geocoder) return this.engine.geocoder;
    throw new ServiceUnavailableException({
      message: DISCOVER_MESSAGES.geocoderOff,
      code: 'geocoder_off',
    });
  }

  private async throttle(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      workspaceKeys.localityThrottle(orgId),
      LOCALITY_WINDOW_SECONDS,
    );
    if (count > LOCALITY_LIMIT_PER_MINUTE) throw this.throttled(orgId);
  }

  private throttled(orgId: string): HttpException {
    securityLogger.warn('discover.locality_throttled', { orgId });
    return new HttpException(
      { message: DISCOVER_MESSAGES.localityThrottled, code: 'locality_throttled' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async throughCache<T>(
    orgId: string,
    key: string,
    lookup: () => Promise<T>,
    unavailableMessage: string,
  ): Promise<T> {
    const cached = await this.readCached<T>(key);
    if (cached !== null) return cached;

    if (await this.waitForBudget(orgId)) {
      // Whoever had the slot may have been asking the same thing.
      const arrived = await this.readCached<T>(key);
      if (arrived !== null) return arrived;
    }

    const answer = await lookup().catch((error: unknown) => {
      throw this.lookupFailure(orgId, error, unavailableMessage);
    });
    await this.redis.set(key, JSON.stringify(answer), GEO_CACHE_SECONDS);
    return answer;
  }

  /**
   * One request a second across the deployment. A key that lives for a second gives
   * a real gap between two calls, which a counter per clock second would not: two
   * calls either side of the tick would be milliseconds apart.
   *
   * Says whether it had to wait, and refuses when the wait runs out.
   */
  private async waitForBudget(orgId: string): Promise<boolean> {
    const deadline = Date.now() + BUDGET_WAIT_MS;
    let waited = false;

    while (!(await this.redis.setIfAbsent(this.keys.nominatimBudget, '1', BUDGET_SECONDS))) {
      if (Date.now() + BUDGET_POLL_MS > deadline) throw this.throttled(orgId);
      waited = true;
      await sleep(BUDGET_POLL_MS);
    }
    return waited;
  }

  private lookupFailure(orgId: string, error: unknown, unavailableMessage: string): Error {
    if (!(error instanceof GeocoderError)) return error as Error;

    this.logger.warn(JSON.stringify({ event: 'discover.locality_failed', kind: error.kind }));
    if (error.kind === 'rate_limited') return this.throttled(orgId);

    return new ServiceUnavailableException({
      message: unavailableMessage,
      code: 'locality_unavailable',
    });
  }

  private async readCached<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
