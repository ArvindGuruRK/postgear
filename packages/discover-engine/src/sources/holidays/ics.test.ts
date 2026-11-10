import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays } from './dates';
import { calendarName, parseIcs } from './ics';

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures');
const recording = (file: string) => readFileSync(join(FIXTURES, file), 'utf8');

const INDIA = recording('chennai/holidays-IN.2026-11-10.ics');
const UNITED_STATES = recording('san-francisco/holidays-US.2026-11-10.ics');
const FRANCE = recording('paris/holidays-FR.2026-11-10.ics');

const CRLF = '\r\n';
const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);
const BOM = String.fromCodePoint(0xfeff);

/** A calendar from its lines, ended the way the standard says unless told otherwise. */
function calendar(lines: string[], lineEnd = CRLF): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join(lineEnd);
}

function event(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

const DIWALI = event(
  'DTSTART;VALUE=DATE:20261108',
  'DTEND;VALUE=DATE:20261109',
  'UID:diwali@example.test',
  'DESCRIPTION:Public holiday',
  'SUMMARY:Diwali/Deepavali',
);

describe('the recorded calendars', () => {
  it.each([
    ['India', INDIA, 565],
    ['the United States', UNITED_STATES, 317],
    ['France', FRANCE, 209],
  ])('reads every event of %s', (_country, body, count) => {
    const events = parseIcs(body);

    expect(events).toHaveLength(count);
    for (const entry of events) {
      expect(entry.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.summary).not.toBe('');
      expect(entry.description).not.toBe('');
      expect(entry.uid).toMatch(/@google\.com$/);
      // Every one is a single all-day event, so it ends the day after it starts.
      expect(entry.end).toBe(addDays(entry.start, 1));
    }
  });

  it('really are CRLF calendars with folded lines, which is what is being tested', () => {
    expect(INDIA).toContain(`Google Calendar Setting${CRLF} s > Holidays in India`);
    expect(INDIA.split(CRLF).length).toBeGreaterThan(5_000);
    expect(INDIA.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('reads `DTSTART;VALUE=DATE` as a plain date', () => {
    const diwali = parseIcs(INDIA).filter((entry) => entry.start === '2026-11-08');

    expect(diwali).toEqual([
      {
        uid: '20261108_o3aevviv105saebf47ptcda14o@google.com',
        start: '2026-11-08',
        end: '2026-11-09',
        summary: 'Diwali/Deepavali',
        description: 'Public holiday',
      },
      {
        uid: '20261108_sj6r4c25h02j6iuvqms4907fmo@google.com',
        start: '2026-11-08',
        end: '2026-11-09',
        summary: 'Naraka Chaturdasi',
        description:
          'Observance\nTo hide observances, go to Google Calendar Settings > Holidays in India',
      },
    ]);
  });

  it('puts every folded description back together', () => {
    const observances = parseIcs(INDIA).filter((entry) =>
      entry.description.startsWith('Observance'),
    );

    expect(observances).toHaveLength(382);
    for (const entry of observances) {
      expect(entry.description.split('\n')[1]).toBe(
        'To hide observances, go to Google Calendar Settings > Holidays in India',
      );
    }
  });

  it('unescapes the commas of the regional description', () => {
    const inauguration = parseIcs(UNITED_STATES).filter((entry) =>
      entry.summary.startsWith('Inauguration Day'),
    );

    expect(inauguration.map((entry) => entry.start).sort()).toEqual([
      '2021-01-20',
      '2025-01-20',
      '2029-01-20',
    ]);
    for (const entry of inauguration) {
      expect(entry.summary).toBe('Inauguration Day (regional holiday)');
      expect(entry.description).toBe('Public holiday in District of Columbia, Maryland, Virginia');
    }
  });

  it('keeps the second line that says a date is tentative', () => {
    const ramzan = parseIcs(INDIA).find((entry) => entry.start === '2027-03-10');

    expect(ramzan?.summary).toBe('Ramzan Id (tentative)');
    expect(ramzan?.description).toBe('Public holiday\nDate is tentative and may change.');
  });

  it('keeps a curly apostrophe as it came', () => {
    const presidents = parseIcs(UNITED_STATES).find((entry) => entry.start === '2021-02-15');
    expect(presidents?.summary).toBe(`Presidents${CURLY_APOSTROPHE} Day`);
  });

  it('holds only the description forms the mapping was written for', () => {
    const firstLines = [INDIA, UNITED_STATES, FRANCE].flatMap((body) =>
      parseIcs(body).map((entry) => entry.description.split('\n')[0]),
    );

    expect([...new Set(firstLines)].sort()).toEqual([
      'Observance',
      'Public holiday',
      'Public holiday in District of Columbia, Maryland, Virginia',
    ]);
  });

  it('holds nothing but all-day dates, and no recurrence rule', () => {
    for (const body of [INDIA, UNITED_STATES, FRANCE]) {
      expect(body).not.toContain('RRULE');
      expect(body).not.toMatch(/DTSTART(?!;VALUE=DATE:\d{8}\r\n)/);
    }
  });
});

describe('folded lines', () => {
  it('joins a line continued by a space', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Festival Of Li', ' ghts', 'UID:1'),
    );
    expect(parseIcs(body)[0].summary).toBe('Festival Of Lights');
  });

  it('joins a line continued by a tab', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Festival Of Li', '\tghts'));
    expect(parseIcs(body)[0].summary).toBe('Festival Of Lights');
  });

  it('takes off only the one character that marks the fold', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Festival Of', '  Lights'));
    expect(parseIcs(body)[0].summary).toBe('Festival Of Lights');
  });

  it('joins a line folded several times', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261108', 'DESCRIPTION:One', ' Two', ' Three', ' Four'),
    );
    expect(parseIcs(body)[0].description).toBe('OneTwoThreeFour');
  });

  it('joins a fold inside a property name, a date and an escape', () => {
    const body = calendar(
      event(
        'DTSTART;VALUE=DATE:2026',
        ' 1108',
        'SUM',
        ' MARY:Diwali',
        'DESCRIPTION:One\\',
        ' nTwo',
      ),
    );

    expect(parseIcs(body)).toEqual([
      { start: '2026-11-08', summary: 'Diwali', description: 'One\nTwo' },
    ]);
  });
});

describe('odd line endings', () => {
  const expected = [
    {
      uid: 'diwali@example.test',
      start: '2026-11-08',
      end: '2026-11-09',
      summary: 'Diwali/Deepavali',
      description: 'Public holiday',
    },
  ];

  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
    ['a lone CR', '\r'],
  ])('reads a calendar ended by %s', (_name, lineEnd) => {
    expect(parseIcs(calendar(DIWALI, lineEnd))).toEqual(expected);
  });

  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
    ['a lone CR', '\r'],
  ])('unfolds across %s', (_name, lineEnd) => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Festival Of Li', ' ghts'),
      lineEnd,
    );
    expect(parseIcs(body)[0].summary).toBe('Festival Of Lights');
  });

  it('reads a calendar that mixes all three', () => {
    const body = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261108\rDTEND;VALUE=DATE:20261109\r\nUID:diwali@example.test\nDESCRIPTION:Public holiday\rSUMMARY:Diwali/Deepavali\r\nEND:VEVENT\nEND:VCALENDAR`;
    expect(parseIcs(body)).toEqual(expected);
  });

  it('does not need a line break at the end, and steps over blank lines', () => {
    const body = ['BEGIN:VCALENDAR', '', ...DIWALI, '', '', 'END:VCALENDAR'].join(CRLF);
    expect(parseIcs(body)).toEqual(expected);
  });

  it('steps over a byte order mark', () => {
    expect(parseIcs(BOM + calendar(DIWALI))).toEqual(expected);
    expect(calendarName(`${BOM}X-WR-CALNAME:Holidays in India${CRLF}`)).toBe('Holidays in India');
  });
});

describe('dates', () => {
  it('reads an event that runs several days: the end is the day after its last day', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227', 'SUMMARY:Christmas Break'),
    );

    expect(parseIcs(body)).toEqual([
      { start: '2026-12-24', end: '2026-12-27', summary: 'Christmas Break', description: '' },
    ]);
  });

  it('reads an event that runs across a year end', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261231', 'DTEND;VALUE=DATE:20270103', 'SUMMARY:New Year'),
    );
    expect(parseIcs(body)[0]).toMatchObject({ start: '2026-12-31', end: '2027-01-03' });
  });

  it('reads an event with no end', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Diwali'));
    expect(parseIcs(body)).toEqual([{ start: '2026-11-08', summary: 'Diwali', description: '' }]);
  });

  it.each([
    ['a UTC time', 'DTSTART:20261108T183000Z'],
    ['a floating time', 'DTSTART:20261108T000000'],
    ['a zone', 'DTSTART;TZID=Asia/Kolkata:20261108T000000'],
    ['a quoted zone that holds a colon', 'DTSTART;TZID="GMT+05:30":20261108T000000'],
    ['a bare date', 'DTSTART:20261108'],
  ])('reads the day a start with %s is written on', (_form, line) => {
    const body = calendar(event(line, 'SUMMARY:Diwali'));
    expect(parseIcs(body)[0].start).toBe('2026-11-08');
  });

  it.each([
    ['a day that does not exist', 'DTSTART;VALUE=DATE:20260231'],
    ['a month that does not exist', 'DTSTART;VALUE=DATE:20261308'],
    ['words', 'DTSTART;VALUE=DATE:next week'],
    ['half a date', 'DTSTART;VALUE=DATE:202611'],
    ['a date with something stuck to it', 'DTSTART;VALUE=DATE:202611089'],
    ['nothing', 'DTSTART;VALUE=DATE:'],
  ])('leaves out an event whose start is %s', (_what, line) => {
    const body = calendar([...event(line, 'SUMMARY:Broken'), ...DIWALI]);
    expect(parseIcs(body).map((entry) => entry.summary)).toEqual(['Diwali/Deepavali']);
  });

  it('leaves out an event with no start at all', () => {
    const body = calendar([...event('SUMMARY:Undated'), ...DIWALI]);
    expect(parseIcs(body).map((entry) => entry.summary)).toEqual(['Diwali/Deepavali']);
  });

  it('drops an end it cannot read, and keeps the event', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261108', 'DTEND;VALUE=DATE:soon', 'SUMMARY:Diwali'),
    );
    expect(parseIcs(body)).toEqual([{ start: '2026-11-08', summary: 'Diwali', description: '' }]);
  });
});

describe('text', () => {
  const summaryOf = (line: string) =>
    parseIcs(calendar(event('DTSTART;VALUE=DATE:20261108', line)))[0].summary;

  it('unescapes a comma, a semicolon and a backslash', () => {
    expect(summaryOf('SUMMARY:Mother\\, Father\\; and \\\\ Child')).toBe(
      'Mother, Father; and \\ Child',
    );
  });

  it('turns both spellings of an escaped line break into a real one', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108', 'DESCRIPTION:One\\nTwo\\NThree'));
    expect(parseIcs(body)[0].description).toBe('One\nTwo\nThree');
  });

  it('keeps an escaped backslash before an n as a backslash and an n', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108', 'DESCRIPTION:C:\\\\new'));
    expect(parseIcs(body)[0].description).toBe('C:\\new');
  });

  it('leaves an escape the standard does not know as it is', () => {
    expect(summaryOf('SUMMARY:50\\% Off')).toBe('50\\% Off');
  });

  it('keeps a colon and a semicolon that are part of the value', () => {
    expect(summaryOf('SUMMARY:Diwali: Festival; Of Lights')).toBe('Diwali: Festival; Of Lights');
  });

  it('reads a property that carries parameters', () => {
    expect(summaryOf('SUMMARY;LANGUAGE=en;ALTREP="cid:part1":Diwali')).toBe('Diwali');
  });

  it('trims the ends of a value and keeps what is inside', () => {
    expect(summaryOf('SUMMARY:   Bhai   Duj  ')).toBe('Bhai   Duj');
  });

  it('keeps text in any script', () => {
    expect(summaryOf('SUMMARY:தீபாவளி')).toBe('தீபாவளி');
  });

  it('reads property and component names in any case', () => {
    const body = [
      'begin:vcalendar',
      'begin:vevent',
      'dtstart;value=date:20261108',
      'Summary:Lower Case',
      'end:vevent',
      'end:vcalendar',
    ].join(CRLF);

    expect(parseIcs(body)).toEqual([
      { start: '2026-11-08', summary: 'Lower Case', description: '' },
    ]);
  });

  it('gives an event with no summary or description empty ones', () => {
    const body = calendar(event('DTSTART;VALUE=DATE:20261108'));
    expect(parseIcs(body)).toEqual([{ start: '2026-11-08', summary: '', description: '' }]);
  });

  it('keeps the first when a property is written twice', () => {
    const body = calendar(
      event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:First', 'SUMMARY:Second', 'UID:a', 'UID:b'),
    );
    expect(parseIcs(body)[0]).toMatchObject({ summary: 'First', uid: 'a' });
  });

  it('does not let an alarm inside the event replace its text or its date', () => {
    const body = calendar(
      event(
        'DTSTART;VALUE=DATE:20261108',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'SUMMARY:Alarm',
        'DTSTART;VALUE=DATE:19990101',
        'END:VALARM',
        'SUMMARY:Diwali',
        'DESCRIPTION:Public holiday',
      ),
    );

    expect(parseIcs(body)).toEqual([
      { start: '2026-11-08', summary: 'Diwali', description: 'Public holiday' },
    ]);
  });

  it('reads nothing from outside an event', () => {
    const body = [
      'BEGIN:VCALENDAR',
      'SUMMARY:Not an event',
      'DTSTART;VALUE=DATE:20200101',
      'BEGIN:VTIMEZONE',
      'DTSTART:19700101T000000',
      'END:VTIMEZONE',
      ...DIWALI,
      'END:VCALENDAR',
    ].join(CRLF);

    expect(parseIcs(body).map((entry) => entry.summary)).toEqual(['Diwali/Deepavali']);
  });

  it('keeps the order the calendar lists its events in', () => {
    const body = calendar([
      ...event('DTSTART;VALUE=DATE:20270115', 'SUMMARY:Pongal'),
      ...event('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Diwali'),
    ]);
    expect(parseIcs(body).map((entry) => entry.summary)).toEqual(['Pongal', 'Diwali']);
  });
});

describe('what cannot be read', () => {
  it.each([
    ['an empty body', ''],
    ['a web page', '<!doctype html><html><body>Sign in</body></html>'],
    ['JSON', '{"error":{"code":404}}'],
    ['a calendar with no events', calendar([])],
    ['lines with no colon', 'BEGIN VEVENT\nSUMMARY Diwali\nEND VEVENT'],
  ])('gives nothing for %s', (_what, body) => {
    expect(parseIcs(body)).toEqual([]);
  });

  it('leaves out the event a cut-off body ends in the middle of', () => {
    const whole = calendar([...DIWALI, ...event('DTSTART;VALUE=DATE:20270115', 'SUMMARY:Pongal')]);
    const cut = whole.slice(0, whole.indexOf('SUMMARY:Pongal') + 'SUMMARY:Pon'.length);

    expect(parseIcs(cut).map((entry) => entry.summary)).toEqual(['Diwali/Deepavali']);
  });

  it('starts again when an event begins inside one that never ended', () => {
    const body = calendar([
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260101',
      'SUMMARY:Never Ended',
      ...DIWALI,
    ]);
    expect(parseIcs(body).map((entry) => entry.summary)).toEqual(['Diwali/Deepavali']);
  });

  it('ignores an end with no beginning', () => {
    const body = calendar(['END:VEVENT', 'END:VALARM', ...DIWALI]);
    expect(parseIcs(body)).toHaveLength(1);
  });

  it('never throws, whatever it is handed', () => {
    const odd = [
      ':',
      ':::',
      '"',
      'BEGIN:',
      'BEGIN:VEVENT',
      'END:VEVENT',
      'DTSTART;TZID="unclosed:20261108',
      `${'A'.repeat(50_000)}:${'B'.repeat(50_000)}`,
      '\r\r\r\n\n\n \t \r\n',
      String.fromCodePoint(0, 1, 2, 0xfffd, 0x1f600),
    ];
    for (const body of odd) {
      expect(() => parseIcs(body)).not.toThrow();
      expect(() => calendarName(body)).not.toThrow();
    }
    expect(() => parseIcs(undefined as unknown as string)).not.toThrow();
    expect(parseIcs(null as unknown as string)).toEqual([]);
    expect(calendarName(42 as unknown as string)).toBeNull();
  });

  it('reads the recorded calendar when it arrives cut in half', () => {
    const half = parseIcs(INDIA.slice(0, Math.floor(INDIA.length / 2)));
    expect(half.length).toBeGreaterThan(200);
    expect(half.length).toBeLessThan(565);
  });
});

describe('calendarName', () => {
  it.each([
    ['India', INDIA, 'Holidays in India'],
    ['the United States', UNITED_STATES, 'Holidays in United States'],
    ['France', FRANCE, 'Holidays in France'],
  ])('reads the name of the recorded calendar of %s', (_country, body, name) => {
    expect(calendarName(body)).toBe(name);
  });

  it('unfolds and unescapes it', () => {
    const body = calendar(['X-WR-CALNAME:Holidays in Trinidad\\, Toba', ' go']);
    expect(calendarName(body)).toBe('Holidays in Trinidad, Tobago');
  });

  it('reads it with parameters and in lower case', () => {
    expect(calendarName('x-wr-calname;value=text:Holidays in India')).toBe('Holidays in India');
  });

  it.each([
    ['a calendar without one', calendar(DIWALI)],
    ['an empty one', calendar(['X-WR-CALNAME:   '])],
    ['an empty body', ''],
    ['a web page', '<html><title>X-WR-CALNAME</title></html>'],
  ])('is null for %s', (_what, body) => {
    expect(calendarName(body)).toBeNull();
  });
});
