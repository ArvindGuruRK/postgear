import type { ScheduleFixture } from './fixture.types';

/** A login Twitch does not know: "We could not find that Twitch channel." */
export const SIMNOUSER: ScheduleFixture = { kind: 'no_user', login: 'simnouser' };
