/**
 * The home dashboard's numbers (UI revamp, 2026-10-19): the posting streak,
 * the weekly goal, failed posts and the first-steps checklist.
 *
 * Everything else on the page (channels, AI credits, the posts up next) comes
 * from the endpoints that already serve it, so this only computes what no
 * other route knows.
 *
 * ## Weeks belong to the viewer
 *
 * A week runs Monday to Sunday in the viewer's time zone, sent by the browser.
 * Postgres does the bucketing (`AT TIME ZONE` with the IANA name, then
 * `date_trunc('week')`, which starts weeks on Monday), so daylight-saving
 * changes and zones with odd offsets are handled by the same tz database that
 * stores the timestamps. `publishDate` is a `timestamp` holding UTC, hence the
 * `AT TIME ZONE 'UTC'` before converting to the viewer's zone.
 *
 * ## What counts as a post
 *
 * Root rows only (`parentPostId: null`): a thread's follow-ups are part of
 * the same post. Each channel's copy is its own root row, so a post sent to
 * three channels counts three times, the way Buffer counts posts toward a
 * goal.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PostingFrequency, prisma, Role, State } from '@postgear/db';

export interface DashboardGoal {
  target: number;
  /** False when `target` is the suggestion derived from onboarding. */
  custom: boolean;
}

export interface DashboardSummary {
  streak: { weeks: number; postedThisWeek: boolean };
  goal: DashboardGoal & { published: number };
  /** Posts currently failed, waiting for a retry or an edit. */
  failed: number;
  firstSteps: { channel: boolean; post: boolean; published: boolean };
}

/** Used when the creator skipped the onboarding question. */
const DEFAULT_WEEKLY_GOAL = 3;

/**
 * The suggested weekly goal from "How often do you post today?": roughly what
 * they already do, so the first goal is reachable. Monthly and not-yet both
 * start at one post a week.
 */
const GOAL_BY_FREQUENCY: Record<PostingFrequency, number> = {
  [PostingFrequency.DAILY]: 7,
  [PostingFrequency.FEW_TIMES_WEEK]: 3,
  [PostingFrequency.WEEKLY]: 1,
  [PostingFrequency.MONTHLY]: 1,
  [PostingFrequency.NOT_YET]: 1,
};

export function suggestedGoal(frequency: PostingFrequency | null | undefined): number {
  return frequency ? GOAL_BY_FREQUENCY[frequency] : DEFAULT_WEEKLY_GOAL;
}

/** True when the runtime knows the zone. Postgres and Node share the IANA database. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` of the Monday seven days earlier. Calendar arithmetic, so no DST. */
export function previousWeek(week: string): string {
  const [year, month, day] = week.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 7)).toISOString().slice(0, 10);
}

/**
 * Weeks in a row with at least one published post.
 *
 * Counted back from this week when it already has a post; otherwise from last
 * week, because a streak is not broken until a whole week passes without a
 * post. `weeks` holds the Mondays (`YYYY-MM-DD`) that had a post.
 */
export function streakFrom(
  weeks: ReadonlySet<string>,
  currentWeek: string,
): { weeks: number; postedThisWeek: boolean } {
  const postedThisWeek = weeks.has(currentWeek);
  let week = postedThisWeek ? currentWeek : previousWeek(currentWeek);
  let count = 0;

  while (weeks.has(week)) {
    count += 1;
    week = previousWeek(week);
  }

  return { weeks: count, postedThisWeek };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  async summary(orgId: string, timeZone: string | undefined): Promise<DashboardSummary> {
    const zone = timeZone && isKnownTimeZone(timeZone) ? timeZone : 'UTC';

    const [published, goal, failed, channel, post] = await Promise.all([
      this.publishedWeeks(orgId, zone),
      this.goal(orgId),
      prisma.post.count({
        where: { organizationId: orgId, state: State.ERROR, parentPostId: null, deletedAt: null },
      }),
      prisma.integration.findFirst({
        where: { organizationId: orgId, deletedAt: null, inBetweenSteps: false },
        select: { id: true },
      }),
      prisma.post.findFirst({
        where: { organizationId: orgId, parentPostId: null, deletedAt: null },
        select: { id: true },
      }),
    ]);

    const weeks = new Set(published.weeks.keys());

    return {
      streak: streakFrom(weeks, published.currentWeek),
      goal: { ...goal, published: published.weeks.get(published.currentWeek) ?? 0 },
      failed,
      firstSteps: { channel: channel !== null, post: post !== null, published: weeks.size > 0 },
    };
  }

  /** The weekly goal: the admin's number, or the suggestion when none is set. */
  async goal(orgId: string): Promise<DashboardGoal> {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { weeklyPostGoal: true },
    });

    if (organization?.weeklyPostGoal != null) {
      return { target: organization.weeklyPostGoal, custom: true };
    }

    return { target: await this.suggestion(orgId), custom: false };
  }

  /** Sets the weekly goal; null goes back to the suggestion. */
  async setGoal(orgId: string, target: number | null): Promise<DashboardGoal> {
    await prisma.organization.update({
      where: { id: orgId },
      data: { weeklyPostGoal: target },
    });

    return this.goal(orgId);
  }

  /**
   * The workspace creator's onboarding answer. The schema records no creator,
   * so it is the earliest admin membership: the row `OrgService.create` writes
   * in the same transaction as the workspace.
   */
  private async suggestion(orgId: string): Promise<number> {
    const creator = await prisma.userOrganization.findFirst({
      where: { organizationId: orgId, role: Role.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { onboarding: { select: { postingFrequency: true } } } } },
    });

    return suggestedGoal(creator?.user.onboarding?.postingFrequency);
  }

  /**
   * Published posts per week (keyed by the week's Monday) and this week's
   * Monday, both in `zone`. A zone Postgres turns out not to know falls back
   * to UTC rather than failing the dashboard.
   */
  private async publishedWeeks(
    orgId: string,
    zone: string,
  ): Promise<{ weeks: Map<string, number>; currentWeek: string }> {
    try {
      return await this.publishedWeeksIn(orgId, zone);
    } catch (error) {
      if (zone === 'UTC') {
        throw error;
      }
      this.logger.warn(`Dashboard weeks fell back to UTC for zone "${zone}"`);
      return this.publishedWeeksIn(orgId, 'UTC');
    }
  }

  private async publishedWeeksIn(
    orgId: string,
    zone: string,
  ): Promise<{ weeks: Map<string, number>; currentWeek: string }> {
    // `state` is compared with a literal rather than a bound parameter: a
    // parameter arrives as text, and Postgres has no `"State" = text` operator.
    const [rows, [current]] = await Promise.all([
      prisma.$queryRaw<{ week: string; published: number }[]>`
        SELECT
          to_char(date_trunc('week', ("publishDate" AT TIME ZONE 'UTC') AT TIME ZONE ${zone}), 'YYYY-MM-DD') AS week,
          COUNT(*)::int AS published
        FROM "Post"
        WHERE "organizationId" = ${orgId}
          AND "state" = 'PUBLISHED'
          AND "parentPostId" IS NULL
          AND "deletedAt" IS NULL
        GROUP BY 1`,
      prisma.$queryRaw<{ week: string }[]>`
        SELECT to_char(date_trunc('week', now() AT TIME ZONE ${zone}), 'YYYY-MM-DD') AS week`,
    ]);

    return {
      weeks: new Map(rows.map((row) => [row.week, row.published])),
      currentWeek: current.week,
    };
  }
}
