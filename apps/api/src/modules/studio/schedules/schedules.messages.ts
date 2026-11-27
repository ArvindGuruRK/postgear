/**
 * Every sentence the Schedule Maker's fetch shows a person (Sprint 13,
 * Module 14 section C3). Sentence case, one or two short sentences, each
 * saying what to do next. The raw Twitch error never reaches anyone: every
 * failure that is not "no such channel" is `schedule_fetch_failed`.
 */
export const SCHEDULE_MESSAGES = {
  /** Twitch has no user by that login. Code `twitch_user_not_found`. */
  TWITCH_USER_NOT_FOUND: 'We could not find that Twitch channel.',
  /** Anything else that went wrong reading Twitch. Code `schedule_fetch_failed`. */
  FETCH_FAILED:
    'We could not read that Twitch schedule right now. Try again in a minute, or fill it in by hand.',
  /** Production without Twitch keys. Also `schedule_fetch_failed`. */
  UNCONFIGURED: 'Twitch schedules are not set up here yet. Fill it in by hand.',
  /** The page shows this when Twitch answers 404 (no schedule, or no streams in it). */
  NO_SCHEDULE: 'This channel has no Twitch schedule. Fill it in by hand.',
  WEEK_INVALID: 'Choose a week from this week to eight weeks ahead.',
  RATE_LIMITED: 'That is a lot of schedules in a minute. Wait a moment and try again.',
  /** `POST /studio/designs` with a schedule, on a template that has none. */
  TEMPLATE_HAS_NO_SCHEDULE: 'That template has no schedule to fill in.',
} as const;
