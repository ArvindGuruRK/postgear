/**
 * The Home page's rules, kept pure so they are testable without React: the
 * greeting, what the stats say, which banners show, and how a post's line in
 * "Up next" reads.
 */
import type { Channel } from '@/types/channel';
import type { DashboardFirstSteps, DashboardStreak } from '@/types/dashboard';
import { MAX_WEEKLY_GOAL, MIN_WEEKLY_GOAL } from '@/types/dashboard';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * Morning 05:00 to 11:59, afternoon 12:00 to 16:59, evening the rest, on the
 * viewer's own clock (the Claude desktop app's split). The small hours count
 * as evening: "Good morning" at 2am reads as a joke.
 */
export function timeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/** The first word of a name, or null when there is none to use. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Good morning, Arvind", or just "Good morning" for an account with no name. */
export function greeting(date: Date, name: string | null | undefined): string {
  const opening = `Good ${timeOfDay(date)}`;
  const first = firstName(name);
  return first ? `${opening}, ${first}` : opening;
}

/** "Mon, Oct 19, 2026" in the viewer's locale. */
export function formatToday(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The streak's tooltip: what it counts, and what keeps it alive this week. */
export function streakHint(streak: DashboardStreak): string {
  const base = 'Weeks in a row with at least one published post.';

  if (streak.weeks > 0 && !streak.postedThisWeek) {
    return `${base} Nothing has gone out this week yet: a post this week keeps it going.`;
  }

  return base;
}

/** Whole posts a week, inside the range the API accepts. */
export function clampGoal(value: number): number {
  if (!Number.isFinite(value)) return MIN_WEEKLY_GOAL;
  return Math.min(MAX_WEEKLY_GOAL, Math.max(MIN_WEEKLY_GOAL, Math.round(value)));
}

/** How far round the goal ring is, 0 to 1. Past the goal it stays full. */
export function goalProgress(published: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, published / target));
}

/**
 * One week in the streak tile's chain: published in, still open (this week,
 * with a streak waiting on it), or nothing.
 */
export type StreakWeek = 'done' | 'open' | 'empty';

/**
 * The streak as a chain of the last `length` weeks, oldest first and this
 * week last. A streak counted from last week (nothing out yet this week)
 * leaves this week open rather than empty: it is not broken yet.
 */
export function streakChain(streak: DashboardStreak, length = 8): StreakWeek[] {
  const chain: StreakWeek[] = Array.from({ length }, () => 'empty');

  if (streak.postedThisWeek) {
    for (let index = 0; index < Math.min(streak.weeks, length); index += 1) {
      chain[length - 1 - index] = 'done';
    }
    return chain;
  }

  if (streak.weeks > 0) {
    chain[length - 1] = 'open';
  }
  for (let index = 0; index < Math.min(streak.weeks, length - 1); index += 1) {
    chain[length - 2 - index] = 'done';
  }
  return chain;
}

/** The line under the streak's chain: what this week needs, if anything. */
export function streakCaption(streak: DashboardStreak): string {
  if (streak.weeks === 0) return 'Publish a post to start one';
  if (streak.postedThisWeek) return 'Posted this week';
  return 'Post this week to keep it';
}

/** The line under the goal's bar. */
export function goalCaption(published: number, target: number): string {
  if (published >= target) return 'Goal met this week';
  const left = target - published;
  return `${left} more ${left === 1 ? 'post' : 'posts'} to go`;
}

/** "1 week", "3 weeks": the unit beside a count. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The team tile's numbers: who is in, against the plan's seats. `limit` is
 * null for an unlimited plan and undefined when the plan did not load.
 */
export function seatSummary(
  members: number,
  limit: number | null | undefined,
): { unit: string; progress: number | null; caption: string } {
  if (limit === undefined) {
    return {
      unit: plural(members, 'member', 'members'),
      progress: null,
      caption: 'In this workspace',
    };
  }

  if (limit === null) {
    return {
      unit: plural(members, 'member', 'members'),
      progress: null,
      caption: 'Unlimited seats on this plan',
    };
  }

  const left = Math.max(0, limit - members);
  return {
    unit: `of ${limit} ${plural(limit, 'seat', 'seats')}`,
    progress: goalProgress(members, limit),
    caption: left === 0 ? 'Every seat is taken' : `${left} ${plural(left, 'seat', 'seats')} left`,
  };
}

/** How many of the first steps are done, for the section's "1 of 3 done". */
export function firstStepsCount(steps: DashboardFirstSteps): number {
  return [steps.channel, steps.post, steps.published].filter(Boolean).length;
}

/** The first non-empty line of a post's preview, or null for an empty post. */
export function firstLine(preview: string): string | null {
  const line = preview
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

/** "Today", "Tomorrow", or a short date ("Wed, Oct 21") in the viewer's locale. */
export function dayLabel(date: Date, now: Date): string {
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(date) - start(now)) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Every first step is done, so the row has nothing left to offer. */
export function firstStepsDone(steps: DashboardFirstSteps): boolean {
  return steps.channel && steps.post && steps.published;
}

/** A banner under the stats. Each is true right now; none is decoration. */
export type HomeBanner =
  | { kind: 'no-channels' }
  | { kind: 'reconnect'; channel: Channel }
  | { kind: 'setup'; channel: Channel }
  | { kind: 'failed'; count: number }
  | { kind: 'stats-error' };

/**
 * Which banners show, most urgent first: nothing can be published without a
 * channel, a broken channel stops its posts, failed posts are already late.
 *
 * `channels` is null when the list failed to load: then nothing is said
 * about channels at all, rather than claiming there are none.
 */
export function bannersFor(input: {
  channels: Channel[] | null;
  failed: number | null;
  statsFailed: boolean;
}): HomeBanner[] {
  const banners: HomeBanner[] = [];

  if (input.channels && input.channels.length === 0) {
    banners.push({ kind: 'no-channels' });
  }

  for (const channel of input.channels ?? []) {
    if (channel.health === 'needs_reconnect') {
      banners.push({ kind: 'reconnect', channel });
    } else if (channel.health === 'needs_setup') {
      banners.push({ kind: 'setup', channel });
    }
  }

  if (input.failed && input.failed > 0) {
    banners.push({ kind: 'failed', count: input.failed });
  }

  if (input.statsFailed) {
    banners.push({ kind: 'stats-error' });
  }

  return banners;
}

/** The viewer's IANA time zone, which decides where their weeks start. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
