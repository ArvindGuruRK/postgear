/**
 * The Create tab's Coming Up panel (Module 17 section 6, CL-11.3), its rules
 * kept pure so they are tested without a browser. Times are the viewer's own
 * clock, as the composer and the calendar show them ("Your local time").
 */
import { dayKey } from '@/components/calendar/calendar-math';

export const COMING_UP_TITLE = 'Coming Up';
export const COMING_UP_SUB = 'Posts with your clips in the next 14 days.';
export const COMING_UP_EMPTY = 'Nothing scheduled yet.';
export const COMING_UP_FAILED = 'Coming Up did not load. Check your connection and try again.';

/** "Fri 20 Nov, 6:00 pm": when a waiting post goes out; empty for a bad date. */
export function comingUpWhen(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? '';
  const dayPeriod = part('dayPeriod').toLowerCase().replace(/\./g, '');
  return `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')} ${dayPeriod}`;
}

/** "and 3 more" when the panel holds back rows; null when it shows them all. */
export function moreLine(total: number, shown: number): string | null {
  const rest = total - shown;
  return rest > 0 ? `and ${rest.toLocaleString('en-GB')} more` : null;
}

/** The calendar's week view on the day of `iso` (local), as its own URL reads it. */
export function calendarWeekHref(orgId: string, iso: string): string {
  const at = new Date(iso);
  const day = Number.isNaN(at.getTime()) ? dayKey(new Date()) : dayKey(at);
  return `/${encodeURIComponent(orgId)}/calendar?view=week&date=${day}`;
}
