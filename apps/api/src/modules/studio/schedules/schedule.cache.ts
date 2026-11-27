/**
 * The Schedule Maker's cache (Sprint 13, Module 14 section C3), over Redis,
 * one entry per login and week: `clipsched:twitch:<login>:<weekStart>`, the
 * week's Monday read in UTC (the fetch covers a day either side, so one
 * entry serves every zone).
 *
 * - **Fresh for 10 minutes**: answered as it is.
 * - **Stale up to 24 hours**: older than that and Twitch fails, the old copy
 *   is answered instead of an error. Never older: Twitch's developer
 *   agreement allows caching its data for 24 hours, so the key expires then
 *   and a copy past it is never served, even if Redis still had it.
 * - **One call in flight per key**: in this process, callers that ask while
 *   a fetch runs wait for it; across processes a Redis lock (the
 *   `DiscoverCache` pattern) lets one fetch, and the others answer the stale
 *   copy or wait a moment for the holder's. The lock is left to expire, never
 *   released, so a failing Twitch gets one attempt per lock window per key.
 *
 * What it stores is what Twitch said (`ScheduleOutcome`): streams, a break,
 * no schedule or no such user, so an unknown name does not cost a call per
 * keystroke either. Nothing in it is logged.
 */
import { Logger } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import type { ScheduleOutcome } from './schedule-source';

export const FRESH_MS = 10 * 60 * 1000;
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const KEEP_SECONDS = STALE_LIMIT_MS / 1000;
export const LOCK_SECONDS = 20;
const WAIT_FOR_HOLDER_MS = 3_000;
const WAIT_POLL_MS = 250;

export interface ScheduleEntry {
  /** ISO 8601, when Twitch was asked. */
  fetchedAt: string;
  outcome: ScheduleOutcome;
}

export type ScheduleLoadState = 'fresh' | 'stale';

export interface LoadedSchedule {
  entry: ScheduleEntry;
  state: ScheduleLoadState;
}

/** Thrown when another process holds the fetch and nothing usable is cached. */
export class ScheduleBusyError extends Error {
  constructor() {
    super('schedule fetch busy');
    this.name = 'ScheduleBusyError';
  }
}

export function scheduleCacheKey(login: string, weekStart: string): string {
  return `clipsched:twitch:${login}:${weekStart}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScheduleCache {
  private readonly logger = new Logger('ScheduleCache');
  private readonly flights = new Map<string, Promise<LoadedSchedule>>();

  constructor(
    private readonly redis: Pick<RedisService, 'get' | 'set' | 'setIfAbsent'>,
    private readonly now: () => number = Date.now,
  ) {}

  async load(key: string, fetch: () => Promise<ScheduleOutcome>): Promise<LoadedSchedule> {
    const cached = await this.read(key);
    if (cached && this.age(cached) < FRESH_MS) return { entry: cached, state: 'fresh' };

    const running = this.flights.get(key);
    if (running) return running;

    const flight = this.refresh(key, cached, fetch).finally(() => {
      this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }

  private async refresh(
    key: string,
    cached: ScheduleEntry | null,
    fetch: () => Promise<ScheduleOutcome>,
  ): Promise<LoadedSchedule> {
    const usable = cached && this.age(cached) < STALE_LIMIT_MS ? cached : null;

    if (!(await this.redis.setIfAbsent(`${key}:lock`, '1', LOCK_SECONDS))) {
      if (usable) return { entry: usable, state: 'stale' };
      const arrived = await this.waitForHolder(key);
      if (arrived) return { entry: arrived, state: 'fresh' };
      throw new ScheduleBusyError();
    }

    try {
      const entry: ScheduleEntry = {
        fetchedAt: new Date(this.now()).toISOString(),
        outcome: await fetch(),
      };
      await this.redis.set(key, JSON.stringify(entry), KEEP_SECONDS);
      return { entry, state: 'fresh' };
    } catch (error) {
      if (!usable) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'studio.schedule.served_stale',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return { entry: usable, state: 'stale' };
    }
  }

  private async waitForHolder(key: string): Promise<ScheduleEntry | null> {
    // Real time, not `now`: this is how long a person waits, whatever clock the entries use.
    const deadline = Date.now() + WAIT_FOR_HOLDER_MS;
    while (Date.now() < deadline) {
      await sleep(WAIT_POLL_MS);
      const entry = await this.read(key);
      if (entry && this.age(entry) < FRESH_MS) return entry;
    }
    return null;
  }

  private age(entry: ScheduleEntry): number {
    return this.now() - Date.parse(entry.fetchedAt);
  }

  /** A copy that cannot be read, or is past 24 hours, is the same as no copy. */
  private async read(key: string): Promise<ScheduleEntry | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      const entry = JSON.parse(raw) as ScheduleEntry;
      const at = Date.parse(entry.fetchedAt);
      if (Number.isNaN(at) || !entry.outcome || typeof entry.outcome.kind !== 'string') return null;
      return this.now() - at < STALE_LIMIT_MS ? entry : null;
    } catch {
      return null;
    }
  }
}
