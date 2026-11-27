/**
 * The Schedule Maker's fetch (Sprint 13, Module 14 section C3): a week of a
 * Twitch schedule as UTC segments, which the browser turns into seven rows
 * in the person's zone (`segmentsToRows`), so a zone change needs no second
 * call.
 *
 * - **Week**: moved to its Monday, and it must be this week or up to eight
 *   weeks ahead in the asked zone.
 * - **Throttle**: ten fetches a minute per workspace, counted in Redis like
 *   the API's other limits; a cached answer counts too, because a person
 *   flicking between weeks is what the limit is for.
 * - **Cache**: `ScheduleCache` (fresh 10 minutes, a stale copy up to 24
 *   hours when Twitch fails, one call in flight per key).
 * - **Answers**: a 404 from Twitch is `{ segments: [], noSchedule: true }`,
 *   not an error; an unknown login is `twitch_user_not_found` (404); any
 *   other failure is `schedule_fetch_failed` (502, or 503 with no keys) with
 *   a plain sentence.
 * - **Logs** carry an event name and a failure code only: never the token,
 *   the secret, a title, a category or the login.
 */
import {
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  addDays,
  currentWeekStart,
  daysBetween,
  mondayOf,
  type ScheduleSegment,
  type ScheduleVacation,
} from '@postgear/design-engine';
import type { RedisService } from '../../redis/redis.service';
import type { FetchScheduleInput } from './dto/schedules.schema';
import { ScheduleBusyError, ScheduleCache, scheduleCacheKey } from './schedule.cache';
import { ScheduleFetchFailure, type ScheduleSource, type ScheduleWindow } from './schedule-source';
import { SCHEDULE_MESSAGES } from './schedules.messages';

export const SCHEDULE_FETCHES_PER_MINUTE = 10;
const THROTTLE_WINDOW_SECONDS = 60;
/** This week and the eight after it. */
export const MAX_WEEKS_AHEAD = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleAnswer {
  broadcaster: { login: string; displayName: string };
  segments: ScheduleSegment[];
  vacation: ScheduleVacation | null;
  /** When Twitch was asked (ISO); older than ten minutes when a stale copy was served. */
  fetchedAt: string;
  /** The week's Monday the answer is for, after moving the asked date to its Monday. */
  weekStart: string;
  /** Twitch's 404: no schedule, or no streams in it. */
  noSchedule?: true;
}

export interface SchedulesServiceOptions {
  now?: () => number;
}

export class SchedulesService {
  private readonly logger = new Logger('StudioSchedules');
  private readonly cache: ScheduleCache;
  private readonly now: () => number;

  constructor(
    /** Null in production without Twitch keys: every fetch then says so. */
    private readonly source: ScheduleSource | null,
    private readonly redis: Pick<RedisService, 'get' | 'set' | 'setIfAbsent' | 'incrementWithTtl'>,
    options: SchedulesServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.cache = new ScheduleCache(redis, this.now);
  }

  async fetch(orgId: string, input: FetchScheduleInput): Promise<ScheduleAnswer> {
    const weekStart = this.checkedWeek(input.weekStart, input.timeZone);
    await this.throttle(orgId);

    const source = this.source;
    if (!source) {
      throw new ServiceUnavailableException({
        message: SCHEDULE_MESSAGES.UNCONFIGURED,
        code: 'schedule_fetch_failed',
      });
    }

    let loaded: Awaited<ReturnType<ScheduleCache['load']>>;
    try {
      loaded = await this.cache.load(scheduleCacheKey(input.login, weekStart), () =>
        source.fetch({ login: input.login, weekStart, window: fetchWindow(weekStart) }),
      );
    } catch (error) {
      throw this.failure(error);
    }

    const { outcome, fetchedAt } = loaded.entry;
    if (outcome.kind === 'no_user') {
      throw new NotFoundException({
        message: SCHEDULE_MESSAGES.TWITCH_USER_NOT_FOUND,
        code: 'twitch_user_not_found',
      });
    }
    if (outcome.kind === 'no_schedule') {
      return {
        broadcaster: outcome.broadcaster,
        segments: [],
        vacation: null,
        fetchedAt,
        weekStart,
        noSchedule: true,
      };
    }
    return {
      broadcaster: outcome.broadcaster,
      segments: outcome.segments,
      vacation: outcome.vacation,
      fetchedAt,
      weekStart,
    };
  }

  /** The asked week's Monday, if it is this week or up to eight weeks ahead in the zone. */
  private checkedWeek(asked: string, timeZone: string): string {
    const monday = mondayOf(asked);
    const current = currentWeekStart(new Date(this.now()), timeZone);
    const ahead = daysBetween(current, monday);
    if (ahead < 0 || ahead > MAX_WEEKS_AHEAD * 7) {
      throw new HttpException(
        { message: SCHEDULE_MESSAGES.WEEK_INVALID, code: 'schedule_week_invalid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return monday;
  }

  private async throttle(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      `studio:schedules:${orgId}`,
      THROTTLE_WINDOW_SECONDS,
    );
    if (count > SCHEDULE_FETCHES_PER_MINUTE) {
      throw new HttpException(
        { message: SCHEDULE_MESSAGES.RATE_LIMITED, code: 'schedule_rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Any failure as `schedule_fetch_failed`, logged by code only. */
  private failure(error: unknown): HttpException {
    const reason =
      error instanceof ScheduleFetchFailure
        ? error.code
        : error instanceof ScheduleBusyError
          ? 'busy'
          : 'unknown';
    this.logger.warn(JSON.stringify({ event: 'studio.schedule.fetch_failed', reason }));

    if (reason === 'unconfigured') {
      return new ServiceUnavailableException({
        message: SCHEDULE_MESSAGES.UNCONFIGURED,
        code: 'schedule_fetch_failed',
      });
    }
    return new HttpException(
      { message: SCHEDULE_MESSAGES.FETCH_FAILED, code: 'schedule_fetch_failed' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * The UTC instants asked of Twitch: the week's Monday read in UTC, widened
 * by a day on each side. Every zone's Monday to Sunday (UTC minus 12 to UTC
 * plus 14) falls inside it, so one answer serves a zone change in the
 * browser, and one cache entry serves everyone.
 */
export function fetchWindow(weekStart: string): ScheduleWindow {
  const monday = Date.parse(`${weekStart}T00:00:00.000Z`);
  return {
    start: new Date(monday - DAY_MS),
    end: new Date(Date.parse(`${addDays(weekStart, 7)}T00:00:00.000Z`) + DAY_MS),
  };
}
