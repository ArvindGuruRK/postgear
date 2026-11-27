/**
 * The Schedule Maker's pure half (Sprint 13, Module 14 section C2): the
 * calendar in a chosen zone, Twitch's segments as seven rows, the clock
 * switch, the zone line and the edits that put a week on a design.
 *
 * Every instant is written in UTC, as Twitch sends it, and every expectation
 * is the wall clock a person in that zone would read.
 */
import { documentFromPreset } from '../document';
import { designDocumentSchema } from '../schema';
import type { ScheduleRow, ScheduleSource } from '../types';
import { convertClockText, withClock } from './clock';
import { applySchedule, scheduleRowsOf, setScheduleRows, setScheduleSource } from './document';
import { twitchLogin } from './login';
import {
  convertWeek,
  emptyWeek,
  type ScheduleSegment,
  segmentsToRows,
  UNTITLED_STREAM,
  vacationInWeek,
} from './rows';
import {
  addDays,
  currentWeekStart,
  formatClock,
  formatShortDate,
  isTimeZone,
  localDate,
  localMidnightToUtc,
  mondayOf,
  weekRange,
} from './time';
import { scheduleZoneLine, zoneLabel } from './zone-line';

function segment(start: string, title: string, extra: Partial<ScheduleSegment> = {}) {
  return {
    start,
    end: null,
    title,
    category: null,
    canceledUntil: null,
    recurring: true,
    ...extra,
  } satisfies ScheduleSegment;
}

const KOLKATA = { timeZone: 'Asia/Kolkata', weekStart: '2026-11-23', hour12: true };

describe('the calendar in a zone', () => {
  it('finds local midnight as a UTC instant, in zones ahead of and behind UTC', () => {
    expect(localMidnightToUtc('2026-11-23', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-22T18:30:00.000Z',
    );
    expect(localMidnightToUtc('2026-11-23', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-23T08:00:00.000Z',
    );
    expect(localMidnightToUtc('2026-11-23', 'UTC').toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('makes a week that crosses the autumn clock change 169 hours long', () => {
    // New York leaves daylight saving on Sunday 1 November 2026, at 2 AM.
    const range = weekRange('2026-10-26', 'America/New_York');
    expect(range.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((range.end.getTime() - range.start.getTime()) / 3_600_000).toBe(169);
  });

  it('makes a week that crosses the spring clock change 167 hours long', () => {
    // London springs forward on Sunday 29 March 2026, at 1 AM.
    const range = weekRange('2026-03-23', 'Europe/London');
    expect(range.start.toISOString()).toBe('2026-03-23T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-29T23:00:00.000Z');
    expect((range.end.getTime() - range.start.getTime()) / 3_600_000).toBe(167);
  });

  it('finds the start of a day whose midnight the clock skips', () => {
    // Santiago springs forward at midnight: 6 September 2026 starts at 1 AM.
    const start = localMidnightToUtc('2026-09-06', 'America/Santiago');
    expect(localDate(start, 'America/Santiago')).toBe('2026-09-06');
    expect(localDate(new Date(start.getTime() - 60_000), 'America/Santiago')).toBe('2026-09-05');
  });

  it('counts days, finds the Monday, and this week in a zone', () => {
    expect(addDays('2026-11-23', 7)).toBe('2026-11-30');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    // Sunday night in Los Angeles is already Monday in Kolkata.
    const now = new Date('2026-11-30T03:00:00Z');
    expect(currentWeekStart(now, 'America/Los_Angeles')).toBe('2026-11-23');
    expect(currentWeekStart(now, 'Asia/Kolkata')).toBe('2026-11-30');
  });

  it('writes a time on either clock, and a short date', () => {
    const at = new Date('2026-11-23T13:30:00Z');
    expect(formatClock(at, 'Asia/Kolkata', true)).toBe('7 PM');
    expect(formatClock(at, 'Asia/Kolkata', false)).toBe('19:00');
    expect(formatClock(new Date('2026-11-23T13:45:00Z'), 'UTC', true)).toBe('1:45 PM');
    expect(formatClock(new Date('2026-11-23T00:05:00Z'), 'UTC', true)).toBe('12:05 AM');
    expect(formatClock(new Date('2026-11-23T00:05:00Z'), 'UTC', false)).toBe('00:05');
    expect(formatShortDate(new Date('2026-11-23T10:00:00Z'), 'Asia/Kolkata')).toBe('Mon 23 Nov');
  });

  it('knows the zones Intl knows, and no others', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('segmentsToRows', () => {
  it('reads each start in the zone, Monday to Sunday, always seven rows', () => {
    const rows = segmentsToRows(
      [
        segment('2026-11-23T13:30:00Z', 'Minecraft'),
        segment('2026-11-25T14:30:00Z', 'Just Chatting'),
      ],
      KOLKATA,
    );

    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(rows[0]).toEqual({ day: 'Mon', time: '7 PM', title: 'Minecraft' });
    expect(rows[2]).toEqual({ day: 'Wed', time: '8 PM', title: 'Just Chatting' });
    expect(rows[1]).toEqual({ day: 'Tue', time: '', title: '', off: true });
  });

  it('keeps a stream that runs past midnight on the day it starts', () => {
    // Friday 11:30 PM in Kolkata to Saturday 2 AM.
    const rows = segmentsToRows(
      [segment('2026-11-27T18:00:00Z', 'Late Night', { end: '2026-11-27T20:30:00Z' })],
      KOLKATA,
    );
    expect(rows[4]).toEqual({ day: 'Fri', time: '11:30 PM', title: 'Late Night' });
    expect(rows[5].off).toBe(true);
  });

  it('moves a stream to the day it starts on in the zone, not in UTC', () => {
    // Monday 11 PM in Los Angeles is Tuesday in UTC.
    const rows = segmentsToRows([segment('2026-11-24T07:00:00Z', 'Speedruns')], {
      ...KOLKATA,
      timeZone: 'America/Los_Angeles',
    });
    expect(rows[0]).toEqual({ day: 'Mon', time: '11 PM', title: 'Speedruns' });
  });

  it('drops a cancelled stream, and its day reads Off', () => {
    const rows = segmentsToRows(
      [
        segment('2026-11-24T13:30:00Z', 'Cancelled Stream', {
          canceledUntil: '2026-11-24T16:30:00Z',
        }),
      ],
      KOLKATA,
    );
    expect(rows[1]).toEqual({ day: 'Tue', time: '', title: '', off: true });
  });

  it('joins two streams on a day, and a third becomes +1 more', () => {
    const week = convertWeek(
      [
        segment('2026-11-27T13:30:00Z', 'Minecraft'),
        segment('2026-11-27T16:30:00Z', 'Chat'),
        segment('2026-11-28T08:30:00Z', 'Morning Coffee'),
        segment('2026-11-28T11:30:00Z', 'Speedruns'),
        segment('2026-11-28T14:30:00Z', 'Late Show'),
      ],
      KOLKATA,
    );
    expect(week.rows[4]).toEqual({ day: 'Fri', time: '7 PM', title: 'Minecraft, 10 PM Chat' });
    expect(week.rows[5]).toEqual({
      day: 'Sat',
      time: '2 PM',
      title: 'Morning Coffee, 5 PM Speedruns +1 more',
    });
    expect(week.crowded).toEqual([5]);
  });

  it('sorts a day by start, whatever order Twitch sent them in', () => {
    const rows = segmentsToRows(
      [segment('2026-11-27T16:30:00Z', 'Chat'), segment('2026-11-27T13:30:00Z', 'Minecraft')],
      KOLKATA,
    );
    expect(rows[4].title).toBe('Minecraft, 10 PM Chat');
  });

  it('names a stream with no title by its category, and with neither as Live', () => {
    const rows = segmentsToRows(
      [
        segment('2026-11-23T13:30:00Z', '   ', { category: 'Minecraft' }),
        segment('2026-11-24T13:30:00Z', '', { category: null }),
      ],
      KOLKATA,
    );
    expect(rows[0].title).toBe('Minecraft');
    expect(rows[1].title).toBe(UNTITLED_STREAM);
  });

  it('turns no schedule at all (a 404) into seven Off rows', () => {
    expect(segmentsToRows([], KOLKATA)).toEqual(emptyWeek());
    expect(emptyWeek().every((row) => row.off === true)).toBe(true);
  });

  it('leaves out streams from another week', () => {
    const rows = segmentsToRows(
      [segment('2026-11-22T13:30:00Z', 'Last Sunday'), segment('2026-11-30T13:30:00Z', 'Next')],
      KOLKATA,
    );
    expect(rows.every((row) => row.off)).toBe(true);
  });

  it('shows true local times through a week that crosses a clock change', () => {
    // 7 PM in New York every day: 23:00 UTC in daylight time, 00:00 UTC after it ends.
    const starts = [
      '2026-10-26T23:00:00Z',
      '2026-10-27T23:00:00Z',
      '2026-10-28T23:00:00Z',
      '2026-10-29T23:00:00Z',
      '2026-10-30T23:00:00Z',
      '2026-10-31T23:00:00Z',
      '2026-11-02T00:00:00Z',
    ];
    const rows = segmentsToRows(
      starts.map((start) => segment(start, 'Nightly')),
      { timeZone: 'America/New_York', weekStart: '2026-10-26', hour12: true },
    );
    expect(rows.map((row) => `${row.day} ${row.time}`)).toEqual([
      'Mon 7 PM',
      'Tue 7 PM',
      'Wed 7 PM',
      'Thu 7 PM',
      'Fri 7 PM',
      'Sat 7 PM',
      'Sun 7 PM',
    ]);
  });

  it('writes 24 hour times when asked', () => {
    const rows = segmentsToRows(
      [segment('2026-11-27T13:30:00Z', 'Minecraft'), segment('2026-11-27T16:30:00Z', 'Chat')],
      { ...KOLKATA, hour12: false },
    );
    expect(rows[4]).toEqual({ day: 'Fri', time: '19:00', title: 'Minecraft, 22:00 Chat' });
  });
});

describe('a break', () => {
  it('is reported when it overlaps the week, as the instant it ends', () => {
    const vacation = { start: '2026-11-20T00:00:00Z', end: '2026-11-25T00:00:00Z' };
    expect(vacationInWeek(vacation, KOLKATA)).toBe('2026-11-25T00:00:00.000Z');

    const week = convertWeek([segment('2026-11-27T13:30:00Z', 'Back')], {
      ...KOLKATA,
      vacation,
    });
    expect(week.vacationUntil).toBe('2026-11-25T00:00:00.000Z');
    // The rows are left as Twitch has them.
    expect(week.rows[4].title).toBe('Back');
  });

  it('is ignored when it misses the week, or makes no sense', () => {
    expect(
      vacationInWeek({ start: '2026-12-01T00:00:00Z', end: '2026-12-10T00:00:00Z' }, KOLKATA),
    ).toBeNull();
    expect(
      vacationInWeek({ start: '2026-11-25T00:00:00Z', end: '2026-11-24T00:00:00Z' }, KOLKATA),
    ).toBeNull();
    expect(vacationInWeek(null, KOLKATA)).toBeNull();
  });

  it('turns the zone line into the break, named in the zone', () => {
    expect(
      scheduleZoneLine({ timeZone: 'Asia/Kolkata', vacationUntil: '2026-11-23T02:00:00Z' }),
    ).toBe('On a break until Mon 23 Nov');
    expect(scheduleZoneLine({ timeZone: 'Asia/Kolkata', vacationUntil: null })).toBe(
      'All times Asia/Kolkata',
    );
    expect(scheduleZoneLine({ timeZone: 'America/New_York' })).toBe('All times America/New York');
    expect(zoneLabel('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos Aires');
  });
});

describe('the clock switch', () => {
  const rows: ScheduleRow[] = [
    { day: 'Mon', time: '7 PM', title: 'Minecraft' },
    { day: 'Fri', time: '7:30 PM', title: 'Minecraft, 10 PM Chat' },
    { day: 'Sat', time: '12 AM', title: 'Top 10:30 moments' },
    { day: 'Sun', time: '', title: '', off: true },
  ];

  it('turns 12 hour times into 24 hour ones, in the time and in a joined stream', () => {
    expect(withClock(rows, false)).toEqual([
      { day: 'Mon', time: '19:00', title: 'Minecraft' },
      { day: 'Fri', time: '19:30', title: 'Minecraft, 22:00 Chat' },
      { day: 'Sat', time: '00:00', title: 'Top 10:30 moments' },
      { day: 'Sun', time: '', title: '', off: true },
    ]);
  });

  it('goes back again, and leaves a number in a title alone', () => {
    expect(withClock(withClock(rows, false), true)).toEqual(rows);
  });

  it('reads the ways people type a time', () => {
    expect(convertClockText('7pm', false)).toBe('19:00');
    expect(convertClockText('7:15 a.m.', false)).toBe('07:15');
    expect(convertClockText('12 PM', false)).toBe('12:00');
    expect(convertClockText('09:05', true)).toBe('9:05 AM');
    expect(convertClockText('Soon', true)).toBe('Soon');
  });

  it('answers the same rows when nothing changed', () => {
    const plain: ScheduleRow[] = [{ day: 'Mon', time: '', title: 'Off day', off: true }];
    expect(withClock(plain, false)).toBe(plain);
  });
});

describe('a week on a design', () => {
  const source: ScheduleSource = {
    source: 'twitch',
    login: 'simstreamer',
    timeZone: 'Asia/Kolkata',
    weekStart: '2026-11-23',
    fetchedAt: '2026-11-28T10:00:00.000Z',
    hour12: true,
  };

  it('writes the rows and the source, and the schema accepts the result', () => {
    const design = documentFromPreset({ presetId: 'schedule-week-cool', format: 'landscape' });
    const rows = segmentsToRows([segment('2026-11-23T13:30:00Z', 'Minecraft')], KOLKATA);
    const next = applySchedule(design, { source, rows });

    expect(scheduleRowsOf(next)).toEqual(rows);
    expect(next.schedule).toEqual(source);
    expect(designDocumentSchema.safeParse(next).success).toBe(true);
    // The design it was given is unchanged.
    expect(design.schedule).toBeUndefined();
  });

  it('cuts a week to seven rows and a field to one line', () => {
    const design = documentFromPreset({ presetId: 'schedule-week-red', format: 'portrait' });
    const long = [...emptyWeek(), { day: 'Extra', time: '', title: '' }];
    long[0] = { day: 'Mon', time: '7 PM', title: 'Two\nLines' };

    const rows = scheduleRowsOf(setScheduleRows(design, long));
    expect(rows).toHaveLength(7);
    expect(rows?.[0].title).toBe('Two Lines');
  });

  it('answers the same design when nothing changed', () => {
    const design = applySchedule(
      documentFromPreset({ presetId: 'schedule-week-dark', format: 'portrait' }),
      { source, rows: emptyWeek() },
    );
    expect(setScheduleRows(design, emptyWeek())).toBe(design);
    expect(setScheduleSource(design, { ...source })).toBe(design);
  });

  it('finds no week on a design without a schedule slide', () => {
    const design = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    expect(scheduleRowsOf(design)).toBeNull();
    expect(setScheduleRows(design, emptyWeek())).toBe(design);
  });
});

describe('twitchLogin', () => {
  it('reads a name, an @ name and a channel link as the login', () => {
    expect(twitchLogin('simstreamer')).toBe('simstreamer');
    expect(twitchLogin('  @SimStreamer ')).toBe('simstreamer');
    expect(twitchLogin('https://www.twitch.tv/SimStreamer/videos?filter=all')).toBe('simstreamer');
    expect(twitchLogin('twitch.tv/sim_streamer')).toBe('sim_streamer');
    expect(twitchLogin('m.twitch.tv/simstreamer')).toBe('simstreamer');
  });

  it('refuses what cannot be a Twitch login', () => {
    for (const input of [
      'abc',
      'a'.repeat(26),
      'sim streamer',
      'sim-streamer',
      '',
      'https://kick.com/simstreamer',
      'x'.repeat(300),
    ]) {
      expect(twitchLogin(input)).toBeNull();
    }
  });
});
