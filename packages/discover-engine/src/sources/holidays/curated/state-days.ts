/**
 * The days Indian states mark their own formation, on the same date every year,
 * checked against Wikipedia's list of Indian state days
 * (https://en.wikipedia.org/wiki/List_of_Indian_state_days) on 2026-11-11.
 *
 * All are observances here. Several are days off in their own state, and
 * `date-holidays` says so for the ones it knows; the merge keeps the stronger
 * badge, so a day off is never lost, and a day this list cannot vouch for as one
 * is never called one. Where `date-holidays` already has the day, the name here
 * is its name ("Karnataka Formation Day" rather than "Karnataka Rajyotsava"), so
 * the two read as one row instead of two.
 *
 * The reason to keep them although the library has most: the states ISO renamed
 * in 2023 (Telangana `IN-TS`, Odisha `IN-OD`) reach the engine under either code,
 * the library knows only the old one, and Punjab's day is not in the library.
 *
 * Left out: Andhra Pradesh, whose day has been disputed since the state was
 * divided in 2014 (the list says 1 November; the state government has not kept
 * it every year since), and the states not named here, which can join once
 * their day is checked the same way. Tamil Nadu's are in `tamil-nadu.ts`.
 */
import type { CuratedDay } from './types';

const SOURCE = 'https://en.wikipedia.org/wiki/List_of_Indian_state_days';

const yearly = (monthDay: string, name: string, since: number): CuratedDay => ({
  monthDay,
  name,
  observance: true,
  since,
  source: SOURCE,
});

const TELANGANA = [yearly('06-02', 'Telangana Formation Day', 2014)];
const ODISHA = [yearly('04-01', 'Odisha Day', 1936)];

export const STATE_DAYS: Readonly<Record<string, readonly CuratedDay[]>> = {
  'IN-GJ': [yearly('05-01', 'Gujarat Day', 1960)],
  'IN-KA': [yearly('11-01', 'Karnataka Formation Day', 1956)],
  'IN-KL': [yearly('11-01', 'Kerala Formation Day', 1956)],
  'IN-MH': [yearly('05-01', 'Maharashtra Day', 1960)],
  'IN-OD': ODISHA,
  'IN-OR': ODISHA,
  'IN-PB': [yearly('11-01', 'Punjab Day', 1966)],
  'IN-TG': TELANGANA,
  'IN-TS': TELANGANA,
};
