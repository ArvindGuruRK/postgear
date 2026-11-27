/**
 * The schedule's zone line (Sprint 13): what the `scheduleZone` binding
 * prints under the headline.
 *
 * "All times Asia/Kolkata", with the zone's underscores read as spaces so
 * "America/New_York" prints as a place, or "On a break until Mon 23 Nov"
 * while Twitch says the streamer is away this week. Nothing is guessed from
 * the broadcaster: the zone is the one the person chose.
 */
import type { ScheduleSource } from '../types';
import { formatShortDate, safeTimeZone } from './time';

/** "America/New_York" as the picture prints it. */
export function zoneLabel(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

export function scheduleZoneLine(
  schedule: Pick<ScheduleSource, 'timeZone' | 'vacationUntil'>,
): string {
  const zone = safeTimeZone(schedule.timeZone);
  const until = schedule.vacationUntil ? Date.parse(schedule.vacationUntil) : Number.NaN;

  if (Number.isFinite(until)) return `On a break until ${formatShortDate(new Date(until), zone)}`;
  return `All times ${zoneLabel(schedule.timeZone)}`;
}
