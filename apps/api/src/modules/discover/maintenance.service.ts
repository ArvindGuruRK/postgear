/**
 * Discover's background jobs (Sprint 11 Module 10), run by the worker's
 * maintenance workflow through `internal/discover/*`:
 *
 * - **Pre-warm** (backlog #1): the places someone opened Trending or News for
 *   in the last day get their shared copies fetched again in that place's
 *   early morning (05:00 to 09:00 in its own zone), so the morning's first
 *   look is instant. Only copies older than three hours are fetched, so a
 *   place is warmed once or twice a morning; 40 places at most a run, one
 *   after the other through the same gate, breakers and budgets as a
 *   person's request. The rest of the day a person's look keeps them fresh.
 * - **Competitor refresh** (backlog #2): competitors nobody has looked at for
 *   20 hours are read again, 25 at most, so "3 New" is waiting in the morning.
 * - **Digest** (backlog #15): `DiscoverDigestService.sendDue`.
 *
 * Each job holds a Redis lock for its run, so two workers (or a retried
 * activity) never do the same work twice, and stops at its deadline, well
 * inside the worker activity's timeout. A job that finds nothing to do is
 * cheap: one sorted-set read or one indexed query.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildLocality, type Locality, WORLDWIDE } from '@postgear/discover-engine';
import { RedisService } from '../redis/redis.service';
import { CompetitorsService } from './competitors.service';
import { DiscoverDigestService, localClock } from './digest.service';
import { DISCOVER_ENGINE, type DiscoverEngine } from './discover.engine';
import { discoverKeys } from './discover.keys';
import { type ActivePlace, DiscoverService } from './discover.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PREWARM_PLACES = 40;
const PREWARM_OLDER_THAN_MS = 3 * 60 * 60 * 1000;
const MORNING_FROM_HOUR = 5;
const MORNING_UNTIL_HOUR = 9;
const REFRESH_COMPETITORS = 25;
/** A run stops starting new work after this, so the activity never times out half way. */
const JOB_BUDGET_MS = 4 * 60 * 1000;
/** The lock outlives the budget a little, and is left to expire like the cache's. */
const LOCK_SECONDS = 5 * 60;

export interface JobAnswer {
  ran: boolean;
  /** What the job went through: places, competitors or workspaces. */
  checked: number;
  /** What it actually fetched or sent. */
  done: number;
}

function localityOf(place: ActivePlace): Locality {
  if (!place.country) return { ...WORLDWIDE };
  return buildLocality({
    countryCode: place.country,
    regionCode: place.region,
    regionName: place.regionName,
    city: place.city,
    timeZone: place.tz,
  });
}

@Injectable()
export class DiscoverMaintenanceService {
  private readonly logger = new Logger(DiscoverMaintenanceService.name);
  private readonly keys: ReturnType<typeof discoverKeys>;

  constructor(
    private readonly discover: DiscoverService,
    private readonly competitors: CompetitorsService,
    private readonly digest: DiscoverDigestService,
    private readonly redis: RedisService,
    @Inject(DISCOVER_ENGINE) engine: DiscoverEngine,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  async prewarm(now = Date.now()): Promise<JobAnswer> {
    if (!(await this.redis.setIfAbsent(this.keys.maintenanceLock('prewarm'), '1', LOCK_SECONDS))) {
      return { ran: false, checked: 0, done: 0 };
    }
    const deadline = now + JOB_BUDGET_MS;
    const morning = (place: ActivePlace) => {
      const { hour } = localClock(new Date(now), place.tz);
      return hour >= MORNING_FROM_HOUR && hour < MORNING_UNTIL_HOUR;
    };
    // Read more than a run warms: the list is newest first, and not every place is in its morning.
    const places = (await this.discover.activePlaces(now - DAY_MS, PREWARM_PLACES * 5))
      .filter(morning)
      .slice(0, PREWARM_PLACES);

    let checked = 0;
    let done = 0;
    for (const place of places) {
      if (Date.now() > deadline) break;
      checked += 1;
      const locality = localityOf(place);
      for (const kind of ['trending', 'news'] as const) {
        try {
          done += await this.discover.warm(
            { kind, locality, language: place.lang },
            PREWARM_OLDER_THAN_MS,
          );
        } catch (error) {
          // One place's trouble is logged and skipped; the next place still gets warmed.
          this.logger.warn(
            JSON.stringify({
              event: 'discover.prewarm.place_failed',
              kind,
              reason: error instanceof Error ? error.name : 'unknown',
            }),
          );
        }
      }
    }
    this.logger.log(JSON.stringify({ event: 'discover.prewarm.done', places: checked, fetched: done }));
    return { ran: true, checked, done };
  }

  async refreshCompetitors(): Promise<JobAnswer> {
    const lock = this.keys.maintenanceLock('competitors');
    if (!(await this.redis.setIfAbsent(lock, '1', LOCK_SECONDS))) {
      return { ran: false, checked: 0, done: 0 };
    }
    const done = await this.competitors.refreshDue(REFRESH_COMPETITORS, Date.now() + JOB_BUDGET_MS);
    this.logger.log(JSON.stringify({ event: 'discover.competitors.refreshed', read: done }));
    return { ran: true, checked: REFRESH_COMPETITORS, done };
  }

  async sendDigests(): Promise<JobAnswer> {
    const { sent, checked } = await this.digest.sendDue(new Date());
    return { ran: true, checked, done: sent };
  }
}
