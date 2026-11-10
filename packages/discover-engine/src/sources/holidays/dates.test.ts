import { addDays, dayNumber, daysUntil, isCalendarDate, todayIn } from './dates';

/** The clock every festival test runs on, so none of them rots. */
const NOW = new Date('2026-11-10T08:00:00Z');

describe('isCalendarDate', () => {
  it.each(['2026-11-10', '2028-02-29', '2026-12-31', '2027-01-01'])('knows %s', (date) => {
    expect(isCalendarDate(date)).toBe(true);
  });

  it.each([
    '2026-02-31',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-1',
    '20261110',
    '2026-11-10T08:00:00Z',
    ' 2026-11-10',
    'tomorrow',
    '',
    undefined,
    null,
    20261110,
  ])('refuses %j', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe('addDays', () => {
  it('moves forward and back', () => {
    expect(addDays('2026-11-10', 1)).toBe('2026-11-11');
    expect(addDays('2026-11-10', -7)).toBe('2026-11-03');
    expect(addDays('2026-11-10', 0)).toBe('2026-11-10');
  });

  it('crosses a month, a year and a leap day', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('gives the span the source hands over', () => {
    expect(addDays('2026-11-10', -45)).toBe('2026-09-26');
    expect(addDays('2026-11-10', 400)).toBe('2027-12-15');
  });

  it('is not moved by a clock change: every day is one day', () => {
    // The United States left daylight saving on 1 November 2026.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('answers an empty string for what is not a date', () => {
    expect(addDays('nonsense', 1)).toBe('');
    expect(addDays('2026-02-31', 1)).toBe('');
    expect(addDays('2026-11-10', Number.NaN)).toBe('');
    expect(addDays('2026-11-10', Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('daysUntil', () => {
  it('counts whole days ahead', () => {
    expect(daysUntil('2026-11-11', '2026-11-10')).toBe(1);
    expect(daysUntil('2026-11-26', '2026-11-10')).toBe(16);
  });

  it('is zero today and negative for the past', () => {
    expect(daysUntil('2026-11-10', '2026-11-10')).toBe(0);
    expect(daysUntil('2026-11-08', '2026-11-10')).toBe(-2);
  });

  it('crosses a year end', () => {
    expect(daysUntil('2027-01-15', '2026-12-20')).toBe(26);
    expect(daysUntil('2026-12-25', '2027-01-01')).toBe(-7);
  });

  it('counts a leap day', () => {
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysUntil('2027-03-01', '2027-02-28')).toBe(1);
  });

  it('is a whole number across a clock change', () => {
    expect(daysUntil('2027-03-29', '2027-03-27')).toBe(2);
    expect(daysUntil('2026-11-02', '2026-10-31')).toBe(2);
  });

  it('is not a number when either side is not a date', () => {
    expect(daysUntil('soon', '2026-11-10')).toBeNaN();
    expect(daysUntil('2026-11-10', '')).toBeNaN();
    expect(daysUntil('2026-02-30', '2026-11-10')).toBeNaN();
  });
});

describe('dayNumber', () => {
  it('puts dates in order and a day apart', () => {
    expect(dayNumber('2026-11-11') - dayNumber('2026-11-10')).toBe(1);
    expect(dayNumber('1970-01-01')).toBe(0);
  });

  it('never compares true for what is not a date', () => {
    const nonsense = dayNumber('nonsense');
    expect(nonsense >= 0).toBe(false);
    expect(nonsense <= 0).toBe(false);
  });
});

describe('todayIn', () => {
  it('is the date in the place, not on the server', () => {
    expect(todayIn('Asia/Kolkata', NOW)).toBe('2026-11-10');
    expect(todayIn('America/Los_Angeles', NOW)).toBe('2026-11-10');
    expect(todayIn('Europe/Paris', NOW)).toBe('2026-11-10');
  });

  it('is a day ahead of UTC in Chennai just after midnight there', () => {
    // 00:05 on 11 November in India is 18:35 on the 10th in UTC.
    const justAfterMidnight = new Date('2026-11-10T18:35:00Z');
    expect(todayIn('Asia/Kolkata', justAfterMidnight)).toBe('2026-11-11');
    expect(todayIn('UTC', justAfterMidnight)).toBe('2026-11-10');
    expect(todayIn(null, justAfterMidnight)).toBe('2026-11-10');
  });

  it('is a day behind UTC in San Francisco in the small hours of UTC', () => {
    const earlyUtc = new Date('2026-11-11T03:00:00Z');
    expect(todayIn('America/Los_Angeles', earlyUtc)).toBe('2026-11-10');
    expect(todayIn('Asia/Kolkata', earlyUtc)).toBe('2026-11-11');
  });

  it('follows the place across a year end', () => {
    const newYearInAuckland = new Date('2026-12-31T11:30:00Z');
    expect(todayIn('Pacific/Auckland', newYearInAuckland)).toBe('2027-01-01');
    expect(todayIn('America/Los_Angeles', newYearInAuckland)).toBe('2026-12-31');
  });

  it.each([
    'Mars/Olympus_Mons',
    'not a zone',
    '../../etc/passwd',
    'Asia/Kolkata; DROP TABLE',
    '<script>',
    '   ',
  ])('reads UTC for the nonsense zone %j, and does not throw', (zone) => {
    expect(() => todayIn(zone, NOW)).not.toThrow();
    expect(todayIn(zone, NOW)).toBe('2026-11-10');
  });

  it.each([null, undefined, ''])('reads UTC for a missing zone (%j)', (zone) => {
    expect(todayIn(zone, NOW)).toBe('2026-11-10');
  });

  it('does not throw for a clock that is not a date', () => {
    expect(() => todayIn('Asia/Kolkata', new Date(Number.NaN))).not.toThrow();
    expect(isCalendarDate(todayIn('Asia/Kolkata', new Date(Number.NaN)))).toBe(true);
    expect(isCalendarDate(todayIn(null, new Date(Number.NaN)))).toBe(true);
  });

  it('uses the real clock when none is passed', () => {
    expect(isCalendarDate(todayIn('Asia/Kolkata'))).toBe(true);
  });
});
