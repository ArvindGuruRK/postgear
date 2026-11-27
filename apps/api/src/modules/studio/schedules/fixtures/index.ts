/**
 * The Schedule Maker's simulation fixtures (Sprint 13, Module 14 section
 * C3), by login. A login with no fixture reads as `simstreamer`'s week under
 * that name, so any name works in simulation; `simnouser` is the one way to
 * see the not-found sentence.
 */
import type { ScheduleFixture } from './fixture.types';
import { SIMNOSCHEDULE } from './simnoschedule';
import { SIMNOUSER } from './simnouser';
import { SIMSTREAMER } from './simstreamer';
import { SIMVACATION } from './simvacation';

export type { FixtureSegment, ScheduleFixture } from './fixture.types';
export { SIMNOSCHEDULE, SIMNOUSER, SIMSTREAMER, SIMVACATION };

export const SCHEDULE_FIXTURES: ReadonlyMap<string, ScheduleFixture> = new Map(
  [SIMSTREAMER, SIMVACATION, SIMNOSCHEDULE, SIMNOUSER].map((fixture) => [fixture.login, fixture]),
);
