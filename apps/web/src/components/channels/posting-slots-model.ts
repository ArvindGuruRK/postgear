/**
 * Manage Posting Time Slots and Shuffle Times (Sprint 13 Module 13): the
 * words and the small rules the two dialogs share. Pure, so it is tested
 * without a page.
 */
import {
  ISO_WEEKDAYS,
  isoWeekdayOf,
  MAX_POSTING_SLOTS,
  POSTING_WINDOWS,
  type PostingWindow,
} from '@postgear/automation';
import type { PostingTime } from '@/types/channel';

export { MAX_POSTING_SLOTS };

/** The window Select's choices, in order. */
export const WINDOW_OPTIONS: readonly { value: PostingWindow; label: string }[] = [
  { value: 0, label: 'Exact' },
  { value: 5, label: 'Within 5 Minutes' },
  { value: 15, label: 'Within 15 Minutes' },
  { value: 30, label: 'Within 30 Minutes' },
];

/** The weekday chips, Monday first, valued by ISO weekday as text. */
export const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday', short: 'Mon' },
  { value: '2', label: 'Tuesday', short: 'Tue' },
  { value: '3', label: 'Wednesday', short: 'Wed' },
  { value: '4', label: 'Thursday', short: 'Thu' },
  { value: '5', label: 'Friday', short: 'Fri' },
  { value: '6', label: 'Saturday', short: 'Sat' },
  { value: '7', label: 'Sunday', short: 'Sun' },
] as const;

export const SLOTS_HELP =
  'Each post goes out at a natural minute within the window you set, never exactly on the hour and never two at once, so your schedule never looks automated.';

/** "09:00" from minutes since midnight (the TimePicker's value). */
export function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Minutes since midnight from "HH:MM", or null. */
export function fromClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** "7:50 AM" in the viewer's own clock. */
export function slotLabel(minutes: number): string {
  const at = new Date(2026, 0, 5, Math.floor(minutes / 60), minutes % 60);
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "7:50 AM" or "around 7:50 AM" when the slot has a window. */
export function aroundLabel(slot: Pick<PostingTime, 'time' | 'windowMinutes'>): string {
  return slot.windowMinutes > 0 ? `around ${slotLabel(slot.time)}` : slotLabel(slot.time);
}

/** "Every day", "Weekdays", "Weekends" or "Tue, Wed, Thu". */
export function daysLabel(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join() === '6,7') return 'Weekends';
  return sorted
    .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === String(day))?.short ?? '')
    .filter(Boolean)
    .join(', ');
}

/** "21 a week". */
export function perWeekLabel(count: number): string {
  return `${count} a week`;
}

/** "21 posts a week" for the channel card. */
export function weeklyLabel(slots: readonly PostingTime[]): string {
  const count = slots.reduce((sum, slot) => sum + slot.days.length, 0);
  return `${count} ${count === 1 ? 'post' : 'posts'} a week`;
}

/** A new slot: an hour after the last one (or 9:00), every day, exact. */
export function nextNewSlot(slots: readonly PostingTime[]): PostingTime {
  const taken = new Set(slots.map((slot) => slot.time));
  let time = slots.length === 0 ? 9 * 60 : Math.max(...slots.map((slot) => slot.time)) + 60;
  time %= 24 * 60;
  while (taken.has(time)) time = (time + 15) % (24 * 60);
  return { time, windowMinutes: 0, days: [...ISO_WEEKDAYS] };
}

/** Turns a weekday on or off, keeping at least one on. */
export function toggleDay(days: readonly number[], day: number): number[] {
  if (days.includes(day)) {
    return days.length === 1 ? [...days] : days.filter((value) => value !== day);
  }
  return [...days, day].sort((a, b) => a - b);
}

/** The first problem with the slots, as a sentence, or null when they can be saved. */
export function slotsProblem(slots: readonly PostingTime[]): string | null {
  if (slots.length === 0) return 'Add at least one time before saving.';
  if (slots.length > MAX_POSTING_SLOTS) return `Keep it to ${MAX_POSTING_SLOTS} times or fewer.`;
  const times = slots.map((slot) => slot.time);
  if (new Set(times).size !== times.length) return 'Two slots have the same time. Change one.';
  if (slots.some((slot) => slot.days.length === 0)) return 'Each time needs at least one day.';
  if (slots.some((slot) => !(POSTING_WINDOWS as readonly number[]).includes(slot.windowMinutes))) {
    return 'Choose a window for each time.';
  }
  return null;
}

/** The slots as saved: sorted by time. */
export function slotsToSave(slots: readonly PostingTime[]): PostingTime[] {
  return [...slots]
    .map((slot) => ({ ...slot, days: [...slot.days].sort((a, b) => a - b) }))
    .sort((a, b) => a.time - b.time);
}

/** The slot times that run on this date's weekday (the calendar's day rows, a reschedule's suggestions). */
export function slotTimesOn(slots: readonly PostingTime[], date: Date): number[] {
  const weekday = isoWeekdayOf(date.getDay());
  return slots
    .filter((slot) => !Array.isArray(slot.days) || slot.days.includes(weekday))
    .map((slot) => slot.time);
}
