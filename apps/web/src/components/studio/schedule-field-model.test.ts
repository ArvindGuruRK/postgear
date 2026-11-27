import {
  applySchedule,
  documentFromPreset,
  emptyWeek,
  type ScheduleRow,
  type ScheduleSource,
  scheduleRowsOf,
} from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { ScheduleAnswer } from '@/types/studio-schedules';
import {
  crowdedDays,
  crowdedWarning,
  fetchFailureMessage,
  fullWeek,
  manualSource,
  refreshWeek,
  rowsFromAnswer,
  sameRows,
  sourceOf,
  twitchSource,
  weekOptions,
  withHour12,
  withRowField,
  withRowOff,
  withSchedule,
  withZone,
  zoneOptions,
} from './schedule-field-model';

const WEEK: ScheduleRow[] = [
  { day: 'Mon', time: '7 PM', title: 'Minecraft' },
  { day: 'Tue', time: '', title: '', off: true },
  { day: 'Wed', time: '8 PM', title: 'Just Chatting' },
  { day: 'Thu', time: '', title: '', off: true },
  { day: 'Fri', time: '7 PM', title: 'Minecraft, 10 PM Chat' },
  { day: 'Sat', time: '3 PM', title: 'Variety' },
  { day: 'Sun', time: '', title: '', off: true },
];

const SOURCE: ScheduleSource = {
  source: 'twitch',
  login: 'simstreamer',
  timeZone: 'Asia/Kolkata',
  weekStart: '2026-11-23',
  fetchedAt: '2026-11-26T10:00:00.000Z',
  hour12: true,
};

function design() {
  return applySchedule(documentFromPreset({ presetId: 'schedule-week-cool', format: 'portrait' }), {
    source: SOURCE,
    rows: WEEK,
  });
}

const ANSWER: ScheduleAnswer = {
  broadcaster: { login: 'simstreamer', displayName: 'SimStreamer' },
  segments: [
    {
      start: '2026-11-23T13:30:00.000Z',
      end: null,
      title: 'Minecraft',
      category: 'Minecraft',
      canceledUntil: null,
      recurring: true,
    },
  ],
  vacation: { start: '2026-11-20T00:00:00.000Z', end: '2026-11-25T00:00:00.000Z' },
  fetchedAt: '2026-11-26T10:00:00.000Z',
  weekStart: '2026-11-23',
};

describe('rows', () => {
  it('always edits seven days', () => {
    expect(fullWeek(null)).toEqual(emptyWeek());
    expect(fullWeek(WEEK.slice(0, 2))).toHaveLength(7);
    expect(fullWeek([...WEEK, ...WEEK])).toHaveLength(7);
  });

  it('types one field of one row', () => {
    const next = withRowField(WEEK, 2, 'title', 'Viewer Games');
    expect(next[2]).toEqual({ day: 'Wed', time: '8 PM', title: 'Viewer Games' });
    expect(next[0]).toBe(WEEK[0]);
  });

  it('turns a day off keeping its words, and on again with them', () => {
    const off = withRowOff(WEEK, 0, true);
    expect(off[0]).toEqual({ day: 'Mon', time: '7 PM', title: 'Minecraft', off: true });
    expect(withRowOff(off, 0, false)[0]).toEqual(WEEK[0]);
  });

  it('gives a day turned on with nothing in it a title to start from', () => {
    expect(withRowOff(WEEK, 1, false)[1]).toEqual({ day: 'Tue', time: '', title: 'Live' });
  });

  it('compares weeks by what they say', () => {
    expect(
      sameRows(
        WEEK,
        WEEK.map((row) => ({ ...row })),
      ),
    ).toBe(true);
    expect(sameRows(WEEK, withRowField(WEEK, 0, 'title', 'Other'))).toBe(false);
    // An Off day's kept words do not count.
    expect(sameRows(WEEK, withRowField(WEEK, 1, 'title', 'Hidden'))).toBe(true);
  });

  it('warns about a day with more streams than fit', () => {
    const crowded = withRowField(WEEK, 5, 'title', 'Coffee, 5 PM Speedruns +1 more');
    expect(crowdedDays(crowded)).toEqual(['Sat']);
    expect(crowdedWarning(crowded)).toMatch(/^Sat has more streams than fit/);
    expect(crowdedWarning(WEEK)).toBeNull();
    const two = withRowField(crowded, 0, 'title', 'A, 9 PM B +2 more');
    expect(crowdedWarning(two)).toMatch(/^Mon and Sat have/);
  });
});

describe('the design', () => {
  it('reads the source, or makes a by-hand one in a zone', () => {
    expect(sourceOf(design())).toEqual(SOURCE);
    const gallery = documentFromPreset({ presetId: 'schedule-week-red', format: 'portrait' });
    expect(sourceOf(gallery).source).toBe('manual');
    expect(manualSource(new Date('2026-11-26T12:00:00Z'), 'UTC')).toEqual({
      source: 'manual',
      login: null,
      timeZone: 'UTC',
      weekStart: '2026-11-23',
      fetchedAt: null,
      hour12: true,
    });
  });

  it('switches the clock over the rows already written', () => {
    const next = withHour12(design(), false);
    expect(next.schedule?.hour12).toBe(false);
    expect(scheduleRowsOf(next)?.[0]).toEqual({ day: 'Mon', time: '19:00', title: 'Minecraft' });
    expect(scheduleRowsOf(next)?.[4].title).toBe('Minecraft, 22:00 Chat');
  });

  it('changes only the zone line for a week typed by hand', () => {
    const next = withZone(design(), 'Europe/Paris');
    expect(next.schedule?.timeZone).toBe('Europe/Paris');
    expect(scheduleRowsOf(next)).toEqual(WEEK);
  });

  it('writes rows and source together', () => {
    const next = withSchedule(design(), emptyWeek(), { ...SOURCE, source: 'manual', login: null });
    expect(scheduleRowsOf(next)).toEqual(emptyWeek());
    expect(next.schedule?.source).toBe('manual');
  });

  it('refreshes the design week, or this week once it is past', () => {
    expect(refreshWeek(SOURCE, new Date('2026-11-26T12:00:00Z'))).toBe('2026-11-23');
    expect(refreshWeek(SOURCE, new Date('2026-12-10T12:00:00Z'))).toBe('2026-12-07');
  });
});

describe('a fetched week', () => {
  it('becomes rows in the zone, with its break', () => {
    const week = rowsFromAnswer(ANSWER, { timeZone: 'Asia/Kolkata', hour12: true });
    expect(week.rows[0]).toEqual({ day: 'Mon', time: '7 PM', title: 'Minecraft' });
    expect(week.vacationUntil).toBe('2026-11-25T00:00:00.000Z');
    expect(
      twitchSource(ANSWER, {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        vacationUntil: week.vacationUntil,
      }),
    ).toEqual({
      ...SOURCE,
      vacationUntil: '2026-11-25T00:00:00.000Z',
    });
  });

  it('becomes seven Off rows when Twitch has no schedule', () => {
    const week = rowsFromAnswer(
      { ...ANSWER, segments: [], vacation: null, noSchedule: true },
      { timeZone: 'UTC', hour12: true },
    );
    expect(week.rows).toEqual(emptyWeek());
  });
});

describe('choices and words', () => {
  it('offers every zone, with the current one and UTC added when missing', () => {
    const options = zoneOptions('Asia/Kolkata', () => ['Asia/Calcutta', 'America/New_York']);
    expect(options.map((option) => option.value)).toEqual([
      'America/New_York',
      'Asia/Calcutta',
      'Asia/Kolkata',
      'UTC',
    ]);
    expect(options[0].label).toBe('America/New York');
  });

  it('offers this week and the eight after it', () => {
    const weeks = weekOptions(new Date('2026-11-26T12:00:00Z'), 'UTC');
    expect(weeks).toHaveLength(9);
    expect(weeks.slice(0, 3)).toEqual([
      { value: '2026-11-23', label: 'This Week' },
      { value: '2026-11-30', label: 'Next Week' },
      { value: '2026-12-07', label: 'Week Of 7 Dec' },
    ]);
  });

  it("says the API's sentence, or a plain one", () => {
    expect(fetchFailureMessage(new ApiError('We could not find that Twitch channel.', 404))).toBe(
      'We could not find that Twitch channel.',
    );
    expect(fetchFailureMessage(new ApiError('', 0))).toMatch(/could not be reached/);
    expect(fetchFailureMessage(new Error('boom'))).toMatch(/^We could not read/);
  });
});
