/**
 * What the top bar's flame says. Kept pure so it is testable without React.
 */
import type { DashboardDayStreak } from '@/types/dashboard';

/** Lit and moving only once today has a published post; otherwise dimmed and still. */
export function isFlameLit(streak: DashboardDayStreak): boolean {
  return streak.postedToday && streak.days > 0;
}

/** The flame's tooltip: the count in words, and what keeps it going today. */
export function dayStreakHint(streak: DashboardDayStreak): string {
  if (streak.days === 0) {
    return 'Publish a post today to start a day streak.';
  }

  if (streak.postedToday) {
    return streak.days === 1
      ? 'You started a streak today. Post every day to keep it going.'
      : `You are on a ${streak.days} day posting streak. Keep it going!`;
  }

  return `You are on a ${streak.days} day streak. Publish a post today to keep it going.`;
}

/** The screen-reader name of the badge, which the tooltip text alone would not give a link. */
export function dayStreakLabel(streak: DashboardDayStreak): string {
  const count = `${streak.days} ${streak.days === 1 ? 'day' : 'days'}`;
  return `Posting streak: ${count}. ${dayStreakHint(streak)}`;
}
