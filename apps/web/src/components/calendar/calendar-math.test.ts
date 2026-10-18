import type { PostSummary } from '@/types/post';
import {
  bucketPosts,
  composerTimeFor,
  dayKey,
  dayRows,
  droppedAt,
  hourKey,
  isPastSlot,
  monthWeeks,
  parseDayKey,
  shiftAnchor,
  startOfWeek,
  visibleDays,
  visibleRange,
} from './calendar-math';

// A Saturday. Local-time constructors throughout, as the calendar itself uses.
const saturday = new Date(2026, 9, 11, 14, 30);

describe('weeks and months', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek(saturday)).toEqual(new Date(2026, 9, 5));
    expect(startOfWeek(new Date(2026, 9, 5, 23))).toEqual(new Date(2026, 9, 5));
    expect(startOfWeek(new Date(2026, 9, 4))).toEqual(new Date(2026, 8, 28));
  });

  it('shows six full weeks for a month, padded from the surrounding months', () => {
    const weeks = monthWeeks(saturday);

    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toEqual(new Date(2026, 8, 28));
    expect(weeks[5][6]).toEqual(new Date(2026, 10, 8));
    expect(visibleDays('week', saturday)).toHaveLength(7);
    expect(visibleDays('day', saturday)).toEqual([new Date(2026, 9, 11)]);
  });

  it('covers the visible days inclusively', () => {
    const { from, to } = visibleRange('week', saturday);

    expect(from).toEqual(new Date(2026, 9, 5));
    expect(to).toEqual(new Date(new Date(2026, 9, 12).getTime() - 1));
  });

  it('steps by the view, without month overflow', () => {
    expect(shiftAnchor('day', saturday, 1)).toEqual(new Date(2026, 9, 12, 14, 30));
    expect(shiftAnchor('week', saturday, -1)).toEqual(new Date(2026, 9, 4, 14, 30));
    expect(shiftAnchor('month', new Date(2026, 0, 31), 1).getMonth()).toBe(1);
  });
});

describe('keys', () => {
  it('round-trips a day key and rejects nonsense', () => {
    expect(dayKey(saturday)).toBe('2026-10-11');
    expect(parseDayKey('2026-10-11')).toEqual(new Date(2026, 9, 11));
    expect(parseDayKey('2026-02-30')).toBeNull();
    expect(parseDayKey('nope')).toBeNull();
    expect(parseDayKey(null)).toBeNull();
    expect(hourKey(saturday)).toBe('2026-10-11T14');
  });

  it('buckets posts by slot in time order', () => {
    const post = (iso: string) => ({ group: iso, publishDate: iso }) as PostSummary;
    const buckets = bucketPosts(
      [
        post(new Date(2026, 9, 11, 15).toISOString()),
        post(new Date(2026, 9, 11, 14).toISOString()),
      ],
      (date) => dayKey(date),
    );

    expect([...buckets.keys()]).toEqual(['2026-10-11']);
    expect(
      buckets.get('2026-10-11')?.map((entry) => new Date(entry.publishDate).getHours()),
    ).toEqual([14, 15]);
  });
});

describe('dropping and clicking', () => {
  it('keeps the time of day on a day drop and the minutes on an hour drop', () => {
    expect(droppedAt(saturday, { day: new Date(2026, 9, 13) })).toEqual(
      new Date(2026, 9, 13, 14, 30),
    );
    expect(droppedAt(saturday, { day: new Date(2026, 9, 13), hour: 9 })).toEqual(
      new Date(2026, 9, 13, 9, 30),
    );
  });

  it('knows which slots are behind us', () => {
    expect(isPastSlot({ day: new Date(2026, 9, 11), hour: 13 }, saturday)).toBe(true);
    expect(isPastSlot({ day: new Date(2026, 9, 11), hour: 14 }, saturday)).toBe(false);
    expect(isPastSlot({ day: new Date(2026, 9, 10) }, saturday)).toBe(true);
    expect(isPastSlot({ day: new Date(2026, 9, 11) }, saturday)).toBe(false);
  });

  it('opens the composer at the clicked hour, or the next whole hour when that has passed', () => {
    expect(composerTimeFor({ day: new Date(2026, 9, 13), hour: 16 }, saturday)).toEqual(
      new Date(2026, 9, 13, 16),
    );
    expect(composerTimeFor({ day: new Date(2026, 9, 13) }, saturday)).toEqual(
      new Date(2026, 9, 13, 9),
    );
    expect(composerTimeFor({ day: new Date(2026, 9, 11), hour: 9 }, saturday)).toEqual(
      new Date(2026, 9, 11, 15),
    );
  });

  it('takes an exact time from a day-view row, for drops, clicks and the past check', () => {
    const monday = new Date(2026, 9, 13);

    expect(droppedAt(saturday, { day: monday, hour: 9, minute: 20 })).toEqual(
      new Date(2026, 9, 13, 9, 20),
    );
    expect(composerTimeFor({ day: monday, hour: 19, minute: 5 }, saturday)).toEqual(
      new Date(2026, 9, 13, 19, 5),
    );
    // 14:20 has arrived at 14:30; 14:40 has not. An hour slot would call both open.
    expect(isPastSlot({ day: new Date(2026, 9, 11), hour: 14, minute: 20 }, saturday)).toBe(true);
    expect(isPastSlot({ day: new Date(2026, 9, 11), hour: 14, minute: 40 }, saturday)).toBe(false);
    // A minute without an hour means nothing: a day drop still keeps the time of day.
    expect(droppedAt(saturday, { day: monday, minute: 5 })).toEqual(new Date(2026, 9, 13, 14, 30));
  });
});

describe('day view rows', () => {
  it('merges posting times with the times posts sit at, once each, in order', () => {
    const posts = [
      { publishDate: new Date(2026, 9, 11, 14, 10).toISOString() },
      { publishDate: new Date(2026, 9, 11, 9, 0).toISOString() },
    ];

    expect(dayRows(posts, [1140, 540, 560, 540])).toEqual([540, 560, 850, 1140]);
  });

  it('drops posting times outside a day and is empty with nothing to show', () => {
    expect(dayRows([], [-5, 1440, 60])).toEqual([60]);
    expect(dayRows([], [])).toEqual([]);
  });
});
