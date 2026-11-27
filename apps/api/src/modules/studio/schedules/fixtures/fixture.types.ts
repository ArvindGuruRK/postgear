/**
 * The shape of a hand-written schedule fixture (Sprint 13, Module 14 section
 * C3). Times are written as a wall clock in the fixture's home zone, on a
 * day of the asked week (0 is Monday), so a fixture is always "this week"
 * whenever it is read, and the simulated source turns them into the UTC
 * instants Twitch would send.
 */
export interface FixtureSegment {
  /** 0 is Monday, 6 is Sunday. */
  day: number;
  /** `HH:MM`, 24 hour, in the home zone. */
  at: string;
  minutes: number;
  title: string;
  category: string | null;
  /** Cancelled for this week: Twitch sends `canceled_until` at its end. */
  cancelled?: boolean;
  recurring: boolean;
}

export type ScheduleFixture =
  | {
      kind: 'found';
      login: string;
      displayName: string;
      /** Where the broadcaster's clock is. Asia/Kolkata has no clock change. */
      homeZone: string;
      segments: FixtureSegment[];
      /** A break, from the start of one day to the start of another, in the home zone. */
      vacation?: { fromDay: number; untilDay: number };
    }
  | { kind: 'no_schedule'; login: string; displayName: string }
  | { kind: 'no_user'; login: string };
