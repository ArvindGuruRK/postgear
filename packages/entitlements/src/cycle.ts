/**
 * The windows a meter counts in.
 *
 * ## The cycle follows the subscription's day of the month
 *
 * A calendar month would give a workspace that subscribes on the 28th three
 * days of allowance before a reset. Anchoring on the day the subscription
 * started (or, with no subscription, the day the workspace was created) gives
 * every workspace a full month, and matches how the subscription itself bills.
 * Day 31 clamps to the month's last day, so a January 31 anchor resets on
 * February 28 and then March 31, never skipping a month.
 *
 * `cycleFor` moved here from the API's `ai/credits/credits.policy.ts`
 * (Sprint 12), unchanged, so AI credits and the Clips meters reset on the
 * same date. The credits policy re-exports it.
 *
 * ## The day window
 *
 * Daily meters (`clips.downloads_per_day`) run midnight UTC to midnight UTC,
 * the same for every workspace, so "It resets at midnight UTC" is true for all.
 */

/** A window a meter counts in. */
export interface UsageWindow {
  /** Inclusive. */
  start: Date;
  /** Exclusive: the next reset. */
  end: Date;
}

/** Midnight UTC on `day` of the given month, or on its last day if it is shorter. */
function anchoredDate(year: number, month: number, day: number): Date {
  // `Date.UTC` normalises month -1 and 12 into the neighbouring year; day 0 of
  // the *following* month is this month's last day.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

/**
 * The cycle `now` falls in, for an anchor date.
 *
 * Boundaries fall at midnight UTC on the anchor's day of the month, clamped
 * to the length of each month. Midnight rather than the anchor's own time of
 * day, so a reset is a date a person can be told ("They come back on 1
 * December") rather than a timestamp.
 */
export function cycleFor(anchor: Date, now: Date): UsageWindow {
  const day = anchor.getUTCDate();
  let start = anchoredDate(now.getUTCFullYear(), now.getUTCMonth(), day);

  if (start.getTime() > now.getTime()) {
    start = anchoredDate(now.getUTCFullYear(), now.getUTCMonth() - 1, day);
  }

  const end = anchoredDate(start.getUTCFullYear(), start.getUTCMonth() + 1, day);

  return { start, end };
}

/** The UTC day `now` falls in: midnight UTC to the next midnight UTC. */
export function dayWindow(now: Date): UsageWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { start, end };
}

/**
 * The window for a meter's kind: the billing cycle from `anchor`, or the UTC
 * day. The anchor is `subscription.createdAt`, else `organization.createdAt`,
 * the same one AI credits use.
 */
export function meterWindow(window: 'cycle' | 'day', anchor: Date, now: Date): UsageWindow {
  return window === 'day' ? dayWindow(now) : cycleFor(anchor, now);
}
