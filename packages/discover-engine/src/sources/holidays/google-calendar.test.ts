import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countryName } from '../../geo/timezone';
import type { DiscoverFetch, DiscoverFetchResponse } from '../../types';
import {
  festivalsFromCalendar,
  HOLIDAY_CALENDAR_IDS,
  holidayCalendarId,
  holidayCalendarPageUrl,
  holidayCalendarUrl,
  isObservance,
  readHolidayCalendar,
} from './google-calendar';
import { calendarName, parseIcs } from './ics';

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures');
const recording = (file: string) => readFileSync(join(FIXTURES, file), 'utf8');

const RECORDED: Record<string, string> = {
  IN: recording('chennai/holidays-IN.2026-11-10.ics'),
  US: recording('san-francisco/holidays-US.2026-11-10.ics'),
  FR: recording('paris/holidays-FR.2026-11-10.ics'),
};

const HIDE_NOTE = 'To hide observances, go to Google Calendar Settings > Holidays in India';

function calendar(...events: string[][]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
}

function event(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

function fetchAnswering(response: Partial<DiscoverFetchResponse> | Error) {
  return jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
}

describe('the id table', () => {
  it.each(['IN', 'US', 'FR'])(
    'holds the calendar that calls itself by the name of %s',
    (country) => {
      expect(calendarName(RECORDED[country])).toBe(`Holidays in ${countryName(country)}`);
    },
  );

  it('names the calendars research verified for the three demo countries', () => {
    expect(HOLIDAY_CALENDAR_IDS.IN).toBe('en.indian');
    expect(HOLIDAY_CALENDAR_IDS.US).toBe('en.usa');
    expect(HOLIDAY_CALENDAR_IDS.FR).toBe('en.french');
  });

  it('holds the eleven countries research names, and no guesses', () => {
    expect(Object.keys(HOLIDAY_CALENDAR_IDS).sort()).toEqual(
      ['AE', 'AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'JP', 'SG', 'US'].sort(),
    );
    for (const id of Object.values(HOLIDAY_CALENDAR_IDS)) {
      expect(id).toMatch(/^en\.[a-z]+$/);
    }
  });

  it('builds the address the recordings were made from', () => {
    expect(holidayCalendarUrl('en.indian')).toBe(
      'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics',
    );
  });

  it('builds the page a person can open', () => {
    expect(holidayCalendarPageUrl('en.indian')).toBe(
      'https://calendar.google.com/calendar/embed?src=en.indian%23holiday%40group.v.calendar.google.com',
    );
  });

  it('cannot be steered by what it is given', () => {
    expect(holidayCalendarUrl('x/../../y?z=1')).toBe(
      'https://calendar.google.com/calendar/ical/x%2F..%2F..%2Fy%3Fz%3D1%23holiday%40group.v.calendar.google.com/public/basic.ics',
    );
    expect(holidayCalendarPageUrl('a&b=c')).toBe(
      'https://calendar.google.com/calendar/embed?src=a%26b%3Dc%23holiday%40group.v.calendar.google.com',
    );
  });
});

describe('holidayCalendarId', () => {
  it('finds a country in the table', () => {
    expect(holidayCalendarId('IN')).toBe('en.indian');
    expect(holidayCalendarId('FR')).toBe('en.french');
  });

  it.each(['NL', 'ZZ', 'in', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'has nothing for %j',
    (country) => {
      expect(holidayCalendarId(country)).toBeNull();
    },
  );
});

describe('isObservance', () => {
  it.each([
    ['Public holiday', false],
    ['Public holiday\nDate is tentative and may change.', false],
    [`Observance\n${HIDE_NOTE}`, true],
    [`Observance\n${HIDE_NOTE}\nDate is tentative and may change.`, true],
    ['Observance', true],
    ['Public holiday in District of Columbia, Maryland, Virginia', true],
  ])('reads %j as observance %s', (description, expected) => {
    expect(isObservance(description)).toBe(expected);
  });

  it.each([
    '',
    'public holiday',
    'Public holidays',
    'Not a Public holiday',
    'Bank holiday',
    'Something new\nPublic holiday',
  ])('does not call %j a public holiday', (description) => {
    expect(isObservance(description)).toBe(true);
  });

  it('does not mind space around the line', () => {
    expect(isObservance('  Public holiday \nmore')).toBe(false);
  });
});

describe('festivalsFromCalendar, on the recorded calendars', () => {
  const india = festivalsFromCalendar(parseIcs(RECORDED.IN));
  const unitedStates = festivalsFromCalendar(parseIcs(RECORDED.US));
  const france = festivalsFromCalendar(parseIcs(RECORDED.FR));
  const on = (rows: typeof india, date: string) => rows.filter((item) => item.date === date);

  it('makes a row of every event', () => {
    expect(india).toHaveLength(565);
    expect(unitedStates).toHaveLength(317);
    expect(france).toHaveLength(209);
  });

  it('gives every row the same shape, and no link', () => {
    for (const item of [...india, ...unitedStates, ...france]) {
      expect(Object.keys(item).sort()).toEqual(['date', 'kind', 'observance', 'source', 'title']);
      expect(item.kind).toBe('festival');
      expect(item.source).toEqual({ id: 'holidays', name: 'Google Calendar' });
      expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof item.observance).toBe('boolean');
      expect(item.title).not.toBe('');
    }
  });

  it('reads Diwali/Deepavali as a public holiday and Naraka Chaturdasi as an observance', () => {
    expect(on(india, '2026-11-08')).toEqual([
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
      },
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Naraka Chaturdasi',
        date: '2026-11-08',
        observance: true,
      },
    ]);
  });

  it('reads the days around the recording as research found them', () => {
    const badge = (rows: typeof india, date: string) =>
      on(rows, date).map((item) => [item.title, item.observance ? 'observance' : 'holiday']);

    expect(badge(india, '2026-11-09')).toEqual([['Govardhan Puja', 'observance']]);
    expect(badge(india, '2026-11-11')).toEqual([['Bhai Duj', 'observance']]);
    expect(badge(india, '2026-11-15')).toEqual([
      ['Chhat Puja (Pratihar Sashthi/Surya Sashthi)', 'observance'],
    ]);
    expect(badge(india, '2026-11-24').sort()).toEqual([
      ['Guru Nanak Jayanti', 'holiday'],
      ["Guru Tegh Bahadur's Martyrdom Day", 'observance'],
    ]);
    expect(badge(india, '2027-01-15').sort()).toEqual([
      ['Guru Govind Singh Jayanti', 'observance'],
      ['Pongal', 'observance'],
    ]);

    expect(badge(unitedStates, '2026-11-03')).toEqual([['Election Day', 'observance']]);
    expect(badge(unitedStates, '2026-11-11')).toEqual([['Veterans Day', 'holiday']]);
    expect(badge(unitedStates, '2026-11-26')).toEqual([['Thanksgiving Day', 'holiday']]);
    expect(badge(unitedStates, '2026-11-27')).toEqual([['Black Friday', 'observance']]);

    expect(badge(france, '2026-11-11')).toEqual([['Armistice Day', 'holiday']]);
  });

  it('keeps a tentative name as it is, with the badge of its first line', () => {
    expect(on(india, '2027-03-10')).toContainEqual(
      expect.objectContaining({ title: 'Ramzan Id (tentative)', observance: false }),
    );
    expect(on(india, '2027-02-09')).toContainEqual(
      expect.objectContaining({ title: 'Ramadan Start (tentative)', observance: true }),
    );
  });

  it('reads the regional United States holiday as an observance', () => {
    const inauguration = unitedStates.filter((item) => item.title.startsWith('Inauguration Day'));

    expect(inauguration.map((item) => item.date).sort()).toEqual([
      '2021-01-20',
      '2025-01-20',
      '2029-01-20',
    ]);
    for (const item of inauguration) {
      expect(item.title).toBe('Inauguration Day (regional holiday)');
      expect(item.observance).toBe(true);
    }
  });
});

describe('festivalsFromCalendar, on hand-made events', () => {
  const rowsOf = (...events: string[][]) => festivalsFromCalendar(parseIcs(calendar(...events)));

  it('puts an event that runs several days on its first day, once', () => {
    const rows = rowsOf(
      event(
        'DTSTART;VALUE=DATE:20261224',
        'DTEND;VALUE=DATE:20261227',
        'SUMMARY:Christmas Break',
        'DESCRIPTION:Public holiday',
      ),
    );

    expect(rows).toEqual([
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Christmas Break',
        date: '2026-12-24',
        observance: false,
      },
    ]);
  });

  it('calls an event with no description an observance', () => {
    expect(rowsOf(event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Diwali'))).toMatchObject([
      { title: 'Diwali', observance: true },
    ]);
  });

  it('leaves out an event with no name', () => {
    const rows = rowsOf(
      event('DTSTART;VALUE=DATE:20261108', 'DESCRIPTION:Public holiday'),
      event('DTSTART;VALUE=DATE:20261109', 'SUMMARY:   ', 'DESCRIPTION:Public holiday'),
      event('DTSTART;VALUE=DATE:20261110', 'SUMMARY:---', 'DESCRIPTION:Public holiday'),
      event('DTSTART;VALUE=DATE:20261111', 'SUMMARY:Bhai Duj', 'DESCRIPTION:Observance'),
    );
    expect(rows.map((item) => item.title)).toEqual(['Bhai Duj']);
  });

  it('makes a name plain text: a calendar is a stranger too', () => {
    const rows = rowsOf(
      event(
        'DTSTART;VALUE=DATE:20261108',
        'SUMMARY:<img src=x onerror=alert(1)>Diwali <b>Night</b>',
        'DESCRIPTION:Public holiday',
      ),
    );
    expect(rows.map((item) => item.title)).toEqual(['Diwali Night']);
  });
});

describe('readHolidayCalendar', () => {
  it('asks for the calendar, as a calendar, with a size limit and a deadline', async () => {
    const fetchMock = fetchAnswering({ body: RECORDED.FR });
    await readHolidayCalendar(fetchMock, 'en.french');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(holidayCalendarUrl('en.french'));
    expect(init.accept).toBe('text/calendar, text/plain;q=0.9');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it('uses the caller deadline when there is one', async () => {
    const fetchMock = fetchAnswering({ body: RECORDED.FR });
    const controller = new AbortController();
    await readHolidayCalendar(fetchMock, 'en.french', controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('reads the recorded calendar into rows', async () => {
    const read = await readHolidayCalendar(fetchAnswering({ body: RECORDED.FR }), 'en.french');

    expect(read.ok).toBe(true);
    expect(read.ok && read.items).toHaveLength(209);
  });

  it('is fine with a calendar that has no events', async () => {
    const read = await readHolidayCalendar(fetchAnswering({ body: calendar() }), 'en.french');
    expect(read).toEqual({ ok: true, items: [] });
  });

  it.each([429, 500, 502, 503])('reports trouble after HTTP %d', async (status) => {
    const read = await readHolidayCalendar(fetchAnswering({ status }), 'en.french');
    expect(read).toEqual({ ok: false, failure: 'upstream' });
  });

  it.each([404, 400, 403, 410])('reports not found after HTTP %d', async (status) => {
    const read = await readHolidayCalendar(fetchAnswering({ status }), 'en.french');
    expect(read).toEqual({ ok: false, failure: 'not_found' });
  });

  it('reports trouble, and does not throw, after a dropped connection', async () => {
    const read = await readHolidayCalendar(
      fetchAnswering(new Error('socket hang up')),
      'en.french',
    );
    expect(read).toEqual({ ok: false, failure: 'upstream' });
  });

  it.each([
    ['a sign-in page', '<!doctype html><html><body>Sign in to continue</body></html>'],
    ['an empty body', ''],
    ['JSON', '{"error":"rate"}'],
    ['events with no calendar around them', 'BEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT'],
  ])('reports trouble when a 200 holds %s', async (_what, body) => {
    const read = await readHolidayCalendar(fetchAnswering({ body }), 'en.french');
    expect(read).toEqual({ ok: false, failure: 'upstream' });
  });

  it('reads a calendar that starts with a byte order mark or a blank line', async () => {
    const withMark = String.fromCodePoint(0xfeff) + RECORDED.FR;
    const read = await readHolidayCalendar(fetchAnswering({ body: withMark }), 'en.french');
    expect(read.ok && read.items).toHaveLength(209);

    const afterBlank = await readHolidayCalendar(
      fetchAnswering({ body: `\r\n${RECORDED.FR}` }),
      'en.french',
    );
    expect(afterBlank.ok).toBe(true);
  });
});
