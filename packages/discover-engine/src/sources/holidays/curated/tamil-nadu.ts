/**
 * Tamil Nadu's own days (`IN-TN`), checked on 2026-11-11.
 *
 * ## The public holidays
 *
 * From the state's yearly order under the Negotiable Instruments Act, only the
 * days that are Tamil Nadu's own or that it dates or names differently from the
 * national calendar. Days the national calendar already has on the same date
 * (Republic Day, Christmas and the like) are left to it.
 *
 * - 2026: G.O.(Ms.) No. 708, Public (Misc.) Department, 11 November 2025. Read in
 *   The News Minute's copy of the list, and the same 24 rows in Sakshi Post's
 *   (https://www.sakshipost.com/news/education/tamil-nadu-public-holiday-calendar-2026-released-24-holidays-declared-474238).
 * - 2027: G.O.(Ms.) No. 613, 6 October 2026. Read in LiveChennai's copy, and the
 *   same dates in GoodReturns'
 *   (https://www.goodreturns.in/news/tamil-nadu-holidays-2027-government-announces-24-public-holidays-check-full-list-and-long-weekends-1543037.html).
 *
 * Some names carry the national calendar's name after a slash ("Telugu New
 * Year/Ugadi") so that the two are read as one festival: the row then shows once,
 * as a day off, which is what the state's list says it is.
 *
 * Two dates differ from Google's India calendar, and the state's win in Tamil
 * Nadu: Pongal 2026 is 15 January (the calendar says the 14th), and Deepavali
 * 2027 is 28 October (Naraka Chaturdashi, the day Tamil Nadu keeps; the
 * calendar's Diwali is the 29th).
 *
 * Left out of the lists on purpose: Mahavir Jayanti, Krishna Jayanthi and
 * Vinayagar Chathurthi 2026, whose dates the two 2026 copies disagree on (the
 * national calendar carries them anyway), and the moon-sighted Muslim holidays,
 * which the national calendar also has.
 *
 * ## The observances
 *
 * Not days off, but days a Tamil brand posts for, each date checked on Drik
 * Panchang. Only 2026: the 2027 dates were not checked.
 *
 * ## Tamil Nadu Day
 *
 * 18 July since the 2022 order that marks the day in 1967 the Assembly resolved
 * to rename Madras State; the government elected in 2026 decided in July 2026 to
 * mark both 18 July and 1 November (the 1956 formation of the state) every year.
 */
import type { CuratedDay } from './types';

const LIST_2026 =
  'https://www.thenewsminute.com/tamil-nadu/tamil-nadu-govt-issues-2026-public-holiday-list-with-24-declared-holidays';
const LIST_2027 = 'https://www.livechennai.com/detailnews.asp?newsid=84019';
const KARTHIGAI_DEEPAM_2026 =
  'https://www.drikpanchang.com/festivals/karthigai-deepam/karthigai-deepam-date-time.html?year=2026';
const AADI_PERUKKU_2026 =
  'https://www.drikpanchang.com/tamil/festivals/aadi-perukku/aadi-perukku-date-time.html?year=2026';

const holiday = (date: string, name: string, source: string): CuratedDay => ({
  date,
  name,
  observance: false,
  source,
});

export const TAMIL_NADU_DAYS: readonly CuratedDay[] = [
  holiday('2026-01-15', 'Pongal', LIST_2026),
  holiday('2026-01-16', 'Thiruvalluvar Day', LIST_2026),
  holiday('2026-01-17', 'Uzhavar Thirunal', LIST_2026),
  holiday('2026-02-01', 'Thai Poosam', LIST_2026),
  holiday('2026-03-19', 'Telugu New Year/Ugadi', LIST_2026),
  holiday('2026-04-14', 'Tamil New Year (Puthandu)', LIST_2026),
  holiday('2026-10-19', 'Ayudha Pooja', LIST_2026),
  holiday('2026-10-20', 'Vijayadasami/Dussehra', LIST_2026),
  holiday('2026-11-08', 'Deepavali', LIST_2026),

  holiday('2027-01-15', 'Pongal', LIST_2027),
  holiday('2027-01-16', 'Thiruvalluvar Day', LIST_2027),
  holiday('2027-01-17', 'Uzhavar Thirunal', LIST_2027),
  holiday('2027-01-22', 'Thai Poosam', LIST_2027),
  holiday('2027-04-07', 'Telugu New Year/Ugadi', LIST_2027),
  holiday('2027-04-14', 'Tamil New Year (Puthandu)', LIST_2027),
  holiday('2027-10-08', 'Ayudha Pooja', LIST_2027),
  holiday('2027-10-09', 'Vijayadasami/Dussehra', LIST_2027),
  holiday('2027-10-28', 'Deepavali', LIST_2027),

  { date: '2026-08-03', name: 'Aadi Perukku', observance: true, source: AADI_PERUKKU_2026 },
  { date: '2026-11-24', name: 'Karthigai Deepam', observance: true, source: KARTHIGAI_DEEPAM_2026 },

  {
    monthDay: '07-18',
    name: 'Tamil Nadu Day',
    observance: true,
    since: 2022,
    source:
      'https://www.dtnext.in/news/tamilnadu/tamil-nadu-day-to-be-celebrated-on-july-18-not-nov-1-says-stalin',
  },
  {
    monthDay: '11-01',
    name: 'Tamil Nadu Day (State Formation)',
    observance: true,
    since: 2026,
    source: 'https://www.livechennai.com/detailnews.asp?newsid=84324',
  },
];
