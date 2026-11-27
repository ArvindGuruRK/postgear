/**
 * The Schedule Maker's fetch, as the API answers it (Sprint 13, Module 14
 * section C3): `POST /studio/schedules/fetch` with `{ login, timeZone,
 * weekStart }`. Mirrors `ScheduleAnswer` in
 * `apps/api/src/modules/studio/schedules/schedules.service.ts`. Every time is
 * UTC; the browser turns them into rows in the person's zone.
 */
import type { ScheduleSegment, ScheduleVacation } from '@postgear/design-engine';

export interface ScheduleFetchBody {
  login: string;
  timeZone: string;
  weekStart: string;
}

export interface ScheduleAnswer {
  broadcaster: { login: string; displayName: string };
  segments: ScheduleSegment[];
  vacation: ScheduleVacation | null;
  /** When Twitch was asked (ISO). */
  fetchedAt: string;
  /** The week's Monday the answer is for. */
  weekStart: string;
  /** Twitch's 404: no schedule, or no streams in it. */
  noSchedule?: true;
}
