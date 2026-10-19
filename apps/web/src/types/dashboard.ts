/**
 * The home dashboard's own numbers, mirroring what `GET /dashboard` and
 * `PATCH /dashboard/goal` return (UI revamp, 2026-10-19).
 *
 * Everything else on the Home page (channels, AI credits, the posts up next)
 * comes from the endpoints that already serve it, so these types only cover
 * what no other route knows. Declared here rather than imported from the API
 * for the reason `channel.ts` gives: no server package reaches the browser.
 */

/**
 * Consecutive Monday-to-Sunday weeks, in the viewer's time zone, with at
 * least one published post. Counted back from this week when it already has
 * one, otherwise from last week, so a streak is not "broken" on a Monday
 * morning before anyone has had the chance to post.
 */
export interface DashboardStreak {
  weeks: number;
  postedThisWeek: boolean;
}

/** The workspace's weekly goal. */
export interface DashboardGoalSetting {
  target: number;
  /** False when `target` is the suggestion derived from the onboarding answer. */
  custom: boolean;
}

export interface DashboardGoal extends DashboardGoalSetting {
  /** Posts published this week; each channel's copy counts. */
  published: number;
}

/** What the first-steps checklist reads: any live channel, any post, any published post. */
export interface DashboardFirstSteps {
  channel: boolean;
  post: boolean;
  published: boolean;
}

/** `GET /dashboard?tz=`. */
export interface DashboardSummary {
  streak: DashboardStreak;
  goal: DashboardGoal;
  /** Posts currently in the failed state (each channel's copy counts). */
  failed: number;
  firstSteps: DashboardFirstSteps;
}

/** `PATCH /dashboard/goal`. No `published`: the caller keeps the count it has. */
export interface DashboardGoalResponse {
  goal: DashboardGoalSetting;
}

/** The goal an admin may set, mirroring the API's `MAX_WEEKLY_GOAL`. */
export const MIN_WEEKLY_GOAL = 1;
export const MAX_WEEKLY_GOAL = 100;
