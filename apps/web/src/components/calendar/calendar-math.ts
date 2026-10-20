/**
 * Dates for the calendar, in the viewer's local time, with no library.
 *
 * Everything the views need is a handful of day arithmetic functions, and a
 * date library would be the largest dependency on the page for the sake of
 * `startOfWeek`. All arithmetic goes through the local `Date` API, so a daylight
 * saving change is handled by the browser rather than by adding 86,400,000.
 *
 * Weeks start on Monday, as the reference's `isoWeek` did.
 */
import type { PostSummary } from '@/types/post';

export type CalendarView = 'month' | 'week' | 'day';

export const CALENDAR_VIEWS: CalendarView[] = ['month', 'week', 'day'];

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function isCalendarView(value: unknown): value is CalendarView {
  return value === 'month' || value === 'week' || value === 'day';
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  // Anchor to the first so "31 Oct + 1 month" does not overflow into December.
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  return next;
}

/** The Monday on or before `date`, at midnight. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(date: Date): Date {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The days a view shows, in order. The month view always shows six full weeks. */
export function visibleDays(view: CalendarView, anchor: Date): Date[] {
  switch (view) {
    case 'day':
      return [startOfDay(anchor)];
    case 'week': {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    case 'month': {
      const start = startOfWeek(startOfMonth(anchor));
      return Array.from({ length: 42 }, (_, index) => addDays(start, index));
    }
  }
}

/** The month grid as six rows of seven days. */
export function monthWeeks(anchor: Date): Date[][] {
  const days = visibleDays('month', anchor);
  return Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}

/** The instant range a view covers, as the API wants it: inclusive `from`, inclusive `to`. */
export function visibleRange(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  const days = visibleDays(view, anchor);
  const from = days[0];
  const to = new Date(addDays(days[days.length - 1], 1).getTime() - 1);
  return { from, to };
}

/** The anchor after stepping one view forwards or back. */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
      return addDays(anchor, 7 * direction);
    case 'month':
      return addMonths(anchor, direction);
  }
}

/** `2026-10-11`, in local time: the key posts are bucketed by, and the URL form of a date. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The reverse of `dayKey`. Anything else is null, never an Invalid Date. */
export function parseDayKey(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

/** `2026-10-11T14`: one hour of one day, for the week and day views. */
export function hourKey(date: Date): string {
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, '0')}`;
}

export function slotStart(day: Date, hour: number, minute = 0): Date {
  const next = startOfDay(day);
  next.setHours(hour, minute);
  return next;
}

/**
 * A calendar drop or click target: a whole day (month view), an hour of a day
 * (week view), or an exact time of a day (the day view's posting-time rows).
 */
export interface SlotTime {
  day: Date;
  hour?: number;
  /** Only with `hour`: the day view's rows sit on exact minutes. */
  minute?: number;
}

/** Minutes since local midnight. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The day view's rows, as minutes since midnight: every channel posting time
 * plus every time a post on that day actually sits at, once each, in order.
 *
 * The reference's day view: a day is the list of moments something goes out,
 * not 24 empty hours. Posting times are stored as minutes since local
 * midnight (see channels.schema.ts), which is the unit here too.
 */
export function dayRows(
  dayPosts: Pick<PostSummary, 'publishDate'>[],
  postingTimes: number[],
): number[] {
  const minutes = new Set<number>(postingTimes.filter((time) => time >= 0 && time < 24 * 60));

  for (const post of dayPosts) {
    minutes.add(minuteOfDay(new Date(post.publishDate)));
  }

  return [...minutes].sort((a, b) => a - b);
}

/** Posts grouped by the slot they fall in. */
export function bucketPosts(
  posts: PostSummary[],
  keyOf: (date: Date) => string,
): Map<string, PostSummary[]> {
  const buckets = new Map<string, PostSummary[]>();

  for (const post of [...posts].sort(
    (a, b) => new Date(a.publishDate).getTime() - new Date(b.publishDate).getTime(),
  )) {
    const key = keyOf(new Date(post.publishDate));
    buckets.set(key, [...(buckets.get(key) ?? []), post]);
  }

  return buckets;
}

/**
 * Where a dragged post lands.
 *
 * A drop on a day keeps the post's time of day; a drop on an hour keeps its
 * minutes; a drop on an exact time takes that time. Dragging to "Tuesday"
 * should not also mean "and at midnight".
 */
export function droppedAt(current: Date, target: SlotTime): Date {
  const next = startOfDay(target.day);
  next.setHours(
    target.hour ?? current.getHours(),
    target.hour !== undefined && target.minute !== undefined ? target.minute : current.getMinutes(),
    0,
    0,
  );
  return next;
}

/**
 * True when nothing can be scheduled into the slot any more: a day or an hour
 * once all of it is behind us, an exact time once it has arrived.
 */
export function isPastSlot(slot: SlotTime, now: Date): boolean {
  if (slot.hour !== undefined && slot.minute !== undefined) {
    return slotStart(slot.day, slot.hour, slot.minute).getTime() <= now.getTime();
  }
  const end =
    slot.hour === undefined ? addDays(startOfDay(slot.day), 1) : slotStart(slot.day, slot.hour + 1);
  return end.getTime() <= now.getTime();
}

/**
 * The time a new post starts at when a slot is clicked.
 *
 * A clicked hour is that hour, a clicked posting time is that time, and a
 * clicked day is 9:00. The first of the schema's default posting times is two
 * hours in, but nine is what people mean by "the morning". Today's past hours
 * roll forward to the next whole hour, so a click on today never opens the
 * composer at a time in the past.
 */
export function composerTimeFor(slot: SlotTime, now: Date): Date {
  const requested =
    slot.hour === undefined
      ? slotStart(slot.day, 9)
      : slotStart(slot.day, slot.hour, slot.minute ?? 0);

  if (requested.getTime() > now.getTime()) {
    return requested;
  }

  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return nextHour;
}

/** "October 2026", "6 – 12 Oct 2026" or "Saturday, 11 October 2026". */
export function rangeLabel(view: CalendarView, anchor: Date): string {
  switch (view) {
    case 'month':
      return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    case 'day':
      return anchor.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    case 'week': {
      const [start] = visibleDays('week', anchor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const startLabel = start.toLocaleDateString(undefined, {
        day: 'numeric',
        ...(sameMonth ? {} : { month: 'short' }),
      });
      const endLabel = end.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${startLabel} – ${endLabel}`;
    }
  }
}

/** "9:20 AM" / "09:20": a day-view row label, in the viewer's clock convention. */
export function minuteLabel(minutes: number): string {
  return slotStart(new Date(2026, 0, 1), Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(
    undefined,
    { hour: 'numeric', minute: '2-digit' },
  );
}

/** "9 AM" / "09:00": the hour gutter label, in the viewer's clock convention. */
export function hourLabel(hour: number): string {
  return slotStart(new Date(2026, 0, 1), hour).toLocaleTimeString(undefined, {
    hour: 'numeric',
    ...(uses12HourClock() ? {} : { minute: '2-digit' }),
  });
}

function uses12HourClock(): boolean {
  return /[ap]m/i.test(new Date(2026, 0, 1, 15).toLocaleTimeString(undefined, { hour: 'numeric' }));
}
