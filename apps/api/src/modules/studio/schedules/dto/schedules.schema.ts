/**
 * What a browser may send to the Schedule Maker's fetch (Sprint 13, Module
 * 14 section C3). `.strict()`, like every body in the API.
 *
 * - `login`: a Twitch name, an `@name` or a `twitch.tv/<name>` link, reduced
 *   to the lower-case login and matched to `^[a-z0-9_]{4,25}$`
 *   (`twitchLogin`, which the page runs first, so a typo costs no call).
 * - `timeZone`: a zone `Intl` knows. The brief says "in
 *   `Intl.supportedValuesOf('timeZone')`", but that list is ICU's canonical
 *   names: in Node 26 it has `Asia/Calcutta` and not `Asia/Kolkata`, which is
 *   what a browser in India reports, and it leaves out `UTC`. So the check is
 *   that `Intl` accepts the name (decision log, 2026-11-28).
 * - `weekStart`: a calendar date. The service moves it to its Monday and
 *   checks it is this week or up to eight weeks ahead, in the asked zone.
 */
import {
  isTimeZone,
  MAX_TIME_ZONE_LENGTH,
  MAX_TWITCH_INPUT_LENGTH,
  parseIsoDate,
  twitchLogin,
} from '@postgear/design-engine';
import { z } from 'zod';

export const fetchScheduleSchema = z
  .object({
    login: z
      .string()
      .max(MAX_TWITCH_INPUT_LENGTH)
      .transform((value, context) => {
        const login = twitchLogin(value);
        if (login === null) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a Twitch login.' });
          return z.NEVER;
        }
        return login;
      }),
    timeZone: z
      .string()
      .min(1)
      .max(MAX_TIME_ZONE_LENGTH)
      .regex(/^[A-Za-z0-9_+\-/]+$/)
      .refine(isTimeZone, 'Not a time zone.'),
    weekStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => parseIsoDate(value) !== null, 'Not a date.'),
  })
  .strict();

export type FetchScheduleInput = z.infer<typeof fetchScheduleSchema>;
