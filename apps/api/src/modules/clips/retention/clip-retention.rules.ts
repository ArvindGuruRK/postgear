/**
 * The retention clock (Sprint 12, Module 19 section 1), as pure rules so the
 * service, the sweep and their tests agree on every date.
 *
 * - A video is kept `retentionDays` (the plan's `clips.retention_days`, read
 *   through the resolver) after it was last used: its page opened, a clip
 *   made from it, one of its clips opened in the editor, or exported.
 * - "Last used" is written at most once a day per video (`touchVideo`), so
 *   an editor that reads a clip every few seconds costs no writes.
 * - Nothing already scheduled is ever moved below three days from now: a
 *   downgrade or a lower plan value never removes a video without its notice.
 * - The notice goes three days before the date, once per date.
 */

export const DAY_MS = 24 * 60 * 60_000;

/** "Last used" moves at most this often. */
export const TOUCH_EVERY_MS = DAY_MS;

/** The notice goes this long before a video is removed, and no date is ever moved closer than this. */
export const NOTICE_BEFORE_MS = 3 * DAY_MS;

/** Whole days, at least one: the plan value as the clock uses it. */
export function retentionDaysOf(value: unknown): number {
  const days = Math.floor(Number(value));
  return Number.isFinite(days) && days >= 1 ? days : 1;
}

/** `lastUsedAt` plus the plan's days. */
export function expiryFrom(lastUsedAt: Date, retentionDays: number): Date {
  return new Date(lastUsedAt.getTime() + retentionDaysOf(retentionDays) * DAY_MS);
}

/**
 * The date a video should carry from now on, given what it carries today
 * (`current`, null for none) and what the plan says (`wanted`). Later is
 * always taken; earlier is taken only down to three days from now, and never
 * earlier than the current date when that is already sooner.
 */
export function nextExpiry(current: Date | null, wanted: Date, now: Date): Date {
  if (!current || wanted.getTime() >= current.getTime()) return wanted;
  const floor = Math.min(current.getTime(), now.getTime() + NOTICE_BEFORE_MS);
  return new Date(Math.max(wanted.getTime(), floor));
}

/** True when "last used" is old enough to be written again (or the video has no date yet). */
export function needsTouch(
  video: { lastUsedAt: Date; expiresAt: Date | null },
  now: Date,
): boolean {
  return video.expiresAt === null || now.getTime() - video.lastUsedAt.getTime() >= TOUCH_EVERY_MS;
}

/** The notice is due: the date is within three days and no notice went for it yet. */
export function noticeDue(
  video: { expiresAt: Date | null; expiryNoticeAt: Date | null },
  now: Date,
): boolean {
  return (
    video.expiresAt !== null &&
    video.expiryNoticeAt === null &&
    video.expiresAt.getTime() - now.getTime() <= NOTICE_BEFORE_MS
  );
}

/**
 * What the sweep does with a video whose date has come (`due`) or is near
 * (`notice`), after reading the plan again: a plan that now keeps videos
 * longer moves the date forward instead (`extend`, with the new date).
 */
export type DueDecision =
  | { kind: 'extend'; expiresAt: Date }
  | { kind: 'notice' }
  | { kind: 'remove' }
  | { kind: 'wait' };

export function decideDue(
  video: { lastUsedAt: Date; expiresAt: Date | null; expiryNoticeAt: Date | null },
  retentionDays: number,
  now: Date,
): DueDecision {
  if (video.expiresAt === null) return { kind: 'wait' };
  const byPlan = expiryFrom(video.lastUsedAt, retentionDays);
  // The plan now keeps it past the notice window: move the date, no notice yet.
  if (
    byPlan.getTime() > video.expiresAt.getTime() &&
    byPlan.getTime() - now.getTime() > NOTICE_BEFORE_MS
  ) {
    return { kind: 'extend', expiresAt: byPlan };
  }
  if (video.expiresAt.getTime() <= now.getTime()) {
    // A video whose notice never went out (the sweep was down) gets it now and three more days.
    return video.expiryNoticeAt === null ? { kind: 'notice' } : { kind: 'remove' };
  }
  return noticeDue(video, now) ? { kind: 'notice' } : { kind: 'wait' };
}
