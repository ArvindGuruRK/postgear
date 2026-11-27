/**
 * The Schedule Maker in simulation (Sprint 13, Module 14 section C3): with
 * `CLIPS_SIMULATION=true`, or with no Twitch keys outside production, a
 * schedule is read from the hand-written fixtures in `fixtures/`. Nothing is
 * fetched from anywhere.
 *
 * A fixture's times are a wall clock in its home zone on a day of the asked
 * week, turned here into the UTC instants Twitch would send, so the sample
 * is always this week and a zone change in the editor moves the times as a
 * real schedule's would.
 */
import {
  addDays,
  localMidnightToUtc,
  type ScheduleSegment,
  type ScheduleVacation,
} from '@postgear/design-engine';
import { SCHEDULE_FIXTURES, type ScheduleFixture, SIMSTREAMER } from './fixtures';
import type { ScheduleOutcome, ScheduleRequest, ScheduleSource } from './schedule-source';

const MINUTE_MS = 60_000;

export class SimulatedScheduleSource implements ScheduleSource {
  readonly mode = 'simulation' as const;

  async fetch(request: ScheduleRequest): Promise<ScheduleOutcome> {
    return outcomeOf(fixtureFor(request.login), request.weekStart);
  }
}

/** The fixture for a login; any other name reads as `simstreamer`'s week under that name. */
export function fixtureFor(login: string): ScheduleFixture {
  const known = SCHEDULE_FIXTURES.get(login);
  if (known) return known;
  return { ...SIMSTREAMER, login, displayName: login } as ScheduleFixture;
}

/** A fixture as Twitch would answer it for the week starting `weekStart`. */
export function outcomeOf(fixture: ScheduleFixture, weekStart: string): ScheduleOutcome {
  if (fixture.kind === 'no_user') return { kind: 'no_user' };
  const broadcaster = { login: fixture.login, displayName: fixture.displayName };
  if (fixture.kind === 'no_schedule') return { kind: 'no_schedule', broadcaster };

  const dayStart = (day: number) => localMidnightToUtc(addDays(weekStart, day), fixture.homeZone);

  const segments = fixture.segments.map((segment): ScheduleSegment => {
    const [hour, minute] = segment.at.split(':').map(Number);
    const start = new Date(dayStart(segment.day).getTime() + (hour * 60 + minute) * MINUTE_MS);
    const end = new Date(start.getTime() + segment.minutes * MINUTE_MS);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      title: segment.title,
      category: segment.category,
      canceledUntil: segment.cancelled ? end.toISOString() : null,
      recurring: segment.recurring,
    };
  });

  const vacation: ScheduleVacation | null = fixture.vacation
    ? {
        start: dayStart(fixture.vacation.fromDay).toISOString(),
        end: dayStart(fixture.vacation.untilDay).toISOString(),
      }
    : null;

  return { kind: 'found', broadcaster, segments, vacation };
}
