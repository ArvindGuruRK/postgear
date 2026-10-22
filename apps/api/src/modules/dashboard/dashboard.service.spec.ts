/**
 * The home dashboard's rules: the week streak, the suggested goal, the time
 * zone fallback, and what the summary reads.
 */
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    $queryRaw: jest.fn(),
    post: { count: jest.fn(), findFirst: jest.fn() },
    integration: { findFirst: jest.fn() },
    organization: { findUnique: jest.fn(), update: jest.fn() },
    userOrganization: { findFirst: jest.fn() },
  },
}));

import { PostingFrequency, prisma, Role, State } from '@postgear/db';
import {
  DashboardService,
  dayStreakFrom,
  isKnownTimeZone,
  previousDay,
  previousWeek,
  streakFrom,
  suggestedGoal,
} from './dashboard.service';
import { dashboardQuerySchema, weeklyGoalSchema } from './dto/dashboard.schema';

type Mocked = {
  $queryRaw: jest.Mock;
  post: { count: jest.Mock; findFirst: jest.Mock };
  integration: { findFirst: jest.Mock };
  organization: { findUnique: jest.Mock; update: jest.Mock };
  userOrganization: { findFirst: jest.Mock };
};

const db = prisma as unknown as Mocked;

/** The SQL text of a tagged-template `$queryRaw` call. */
function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('?');
}

describe('streakFrom', () => {
  it('counts back from this week when it already has a post', () => {
    const weeks = new Set(['2026-10-19', '2026-10-12', '2026-10-05', '2026-09-21']);

    expect(streakFrom(weeks, '2026-10-19')).toEqual({ weeks: 3, postedThisWeek: true });
  });

  it('keeps last week alive while this week has no post yet', () => {
    const weeks = new Set(['2026-10-12', '2026-10-05']);

    expect(streakFrom(weeks, '2026-10-19')).toEqual({ weeks: 2, postedThisWeek: false });
  });

  it('is broken by a whole week without a post', () => {
    const weeks = new Set(['2026-10-05', '2026-09-28']);

    expect(streakFrom(weeks, '2026-10-19')).toEqual({ weeks: 0, postedThisWeek: false });
  });

  it('is zero for a workspace that never published', () => {
    expect(streakFrom(new Set(), '2026-10-19')).toEqual({ weeks: 0, postedThisWeek: false });
  });

  it('steps back across a month and a year boundary', () => {
    expect(previousWeek('2026-03-02')).toBe('2026-02-23');
    expect(previousWeek('2027-01-04')).toBe('2026-12-28');
  });
});

describe('dayStreakFrom', () => {
  it('counts back from today when it already has a post', () => {
    const days = new Set(['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-18']);

    expect(dayStreakFrom(days, '2026-10-22')).toEqual({ days: 3, postedToday: true });
  });

  it('keeps yesterday alive while today has no post yet', () => {
    const days = new Set(['2026-10-21', '2026-10-20']);

    expect(dayStreakFrom(days, '2026-10-22')).toEqual({ days: 2, postedToday: false });
  });

  it('is broken by a whole day without a post', () => {
    const days = new Set(['2026-10-20', '2026-10-19']);

    expect(dayStreakFrom(days, '2026-10-22')).toEqual({ days: 0, postedToday: false });
  });

  it('is zero for a workspace that never published', () => {
    expect(dayStreakFrom(new Set(), '2026-10-22')).toEqual({ days: 0, postedToday: false });
  });

  it('is one for a single post today', () => {
    expect(dayStreakFrom(new Set(['2026-10-22']), '2026-10-22')).toEqual({
      days: 1,
      postedToday: true,
    });
  });

  it('steps back across a month, a year and a leap day', () => {
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');

    const days = new Set(['2027-01-01', '2026-12-31', '2026-12-30']);
    expect(dayStreakFrom(days, '2027-01-01')).toEqual({ days: 3, postedToday: true });
  });
});

describe('suggestedGoal', () => {
  it('follows the onboarding answer', () => {
    expect(suggestedGoal(PostingFrequency.DAILY)).toBe(7);
    expect(suggestedGoal(PostingFrequency.FEW_TIMES_WEEK)).toBe(3);
    expect(suggestedGoal(PostingFrequency.WEEKLY)).toBe(1);
    expect(suggestedGoal(PostingFrequency.MONTHLY)).toBe(1);
    expect(suggestedGoal(PostingFrequency.NOT_YET)).toBe(1);
  });

  it('falls back to three a week when the question was skipped', () => {
    expect(suggestedGoal(null)).toBe(3);
    expect(suggestedGoal(undefined)).toBe(3);
  });
});

describe('time zones', () => {
  it('knows real IANA zones and refuses made-up ones', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('America/St_Johns')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
  });

  it('accepts a zone-shaped query and refuses anything else', () => {
    expect(dashboardQuerySchema.safeParse({ tz: 'Etc/GMT+5' }).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ tz: "UTC'; DROP TABLE" }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ tz: 'UTC', extra: '1' }).success).toBe(false);
  });
});

describe('weeklyGoalSchema', () => {
  it('takes a whole number from 1 to 100, or null', () => {
    expect(weeklyGoalSchema.safeParse({ target: 5 }).success).toBe(true);
    expect(weeklyGoalSchema.safeParse({ target: null }).success).toBe(true);
    expect(weeklyGoalSchema.safeParse({ target: 0 }).success).toBe(false);
    expect(weeklyGoalSchema.safeParse({ target: 101 }).success).toBe(false);
    expect(weeklyGoalSchema.safeParse({ target: 2.5 }).success).toBe(false);
    expect(weeklyGoalSchema.safeParse({}).success).toBe(false);
  });
});

describe('DashboardService', () => {
  const service = new DashboardService();

  beforeEach(() => {
    jest.clearAllMocks();
    db.post.count.mockResolvedValue(2);
    db.post.findFirst.mockResolvedValue({ id: 'post_1' });
    db.integration.findFirst.mockResolvedValue({ id: 'ch_1' });
    db.organization.findUnique.mockResolvedValue({ weeklyPostGoal: null });
    db.userOrganization.findFirst.mockResolvedValue({
      user: { onboarding: { postingFrequency: PostingFrequency.DAILY } },
    });
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('now()')) return [{ week: '2026-10-19', today: '2026-10-22' }];
      if (sql.includes('AS day')) return [{ day: '2026-10-22' }, { day: '2026-10-21' }];
      return [
        { week: '2026-10-19', published: 2 },
        { week: '2026-10-12', published: 4 },
      ];
    });
  });

  it('summarizes the streaks, the goal, failures and the first steps', async () => {
    await expect(service.summary('org_1', 'Asia/Kolkata')).resolves.toEqual({
      streak: { weeks: 2, postedThisWeek: true },
      dayStreak: { days: 2, postedToday: true },
      goal: { target: 7, custom: false, published: 2 },
      failed: 2,
      firstSteps: { channel: true, post: true, published: true },
    });
  });

  it('buckets weeks in the viewer zone, root published posts of this workspace only', async () => {
    await service.summary('org_1', 'Asia/Kolkata');

    const weeksCall = db.$queryRaw.mock.calls.find(
      (call) => !sqlOf(call).includes('now()') && !sqlOf(call).includes('AS day'),
    );
    const daysCall = db.$queryRaw.mock.calls.find((call) => sqlOf(call).includes('AS day'));
    expect(weeksCall).toBeDefined();
    expect(daysCall).toBeDefined();

    for (const call of [weeksCall, daysCall] as unknown[][]) {
      const sql = sqlOf(call);
      expect(sql).toContain(`AT TIME ZONE 'UTC') AT TIME ZONE ?`);
      expect(sql).toContain(`"state" = 'PUBLISHED'`);
      expect(sql).toContain('"parentPostId" IS NULL');
      expect(sql).toContain('"deletedAt" IS NULL');
      expect(call.slice(1)).toEqual(['Asia/Kolkata', 'org_1']);
    }

    expect(db.post.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', state: State.ERROR, parentPostId: null, deletedAt: null },
    });
  });

  it('uses UTC for an unknown zone or none', async () => {
    await service.summary('org_1', 'Mars/Olympus_Mons');
    await service.summary('org_1', undefined);

    for (const call of db.$queryRaw.mock.calls) {
      expect(call).toContain('UTC');
      expect(call).not.toContain('Mars/Olympus_Mons');
    }
  });

  it('retries in UTC when the database refuses the zone', async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (values.includes('Asia/Kolkata')) {
        throw new Error('time zone "Asia/Kolkata" not recognized');
      }
      return strings.join('?').includes('now()')
        ? [{ week: '2026-10-19', today: '2026-10-22' }]
        : [];
    });

    const summary = await service.summary('org_1', 'Asia/Kolkata');

    expect(summary.streak).toEqual({ weeks: 0, postedThisWeek: false });
    expect(summary.dayStreak).toEqual({ days: 0, postedToday: false });
    expect(summary.firstSteps.published).toBe(false);
  });

  it('reports a fresh workspace as having done nothing yet', async () => {
    db.post.count.mockResolvedValue(0);
    db.post.findFirst.mockResolvedValue(null);
    db.integration.findFirst.mockResolvedValue(null);
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('now()') ? [{ week: '2026-10-19', today: '2026-10-22' }] : [],
    );

    const summary = await service.summary('org_1', 'UTC');

    expect(summary.firstSteps).toEqual({ channel: false, post: false, published: false });
    expect(summary.goal.published).toBe(0);
    expect(db.integration.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deletedAt: null, inBetweenSteps: false },
      select: { id: true },
    });
  });

  it('prefers the goal an admin set over the suggestion', async () => {
    db.organization.findUnique.mockResolvedValue({ weeklyPostGoal: 12 });

    await expect(service.goal('org_1')).resolves.toEqual({ target: 12, custom: true });
    expect(db.userOrganization.findFirst).not.toHaveBeenCalled();
  });

  it('suggests from the earliest admin, the workspace creator', async () => {
    await service.goal('org_1');

    expect(db.userOrganization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1', role: Role.ADMIN },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('stores a goal, and null clears it back to the suggestion', async () => {
    db.organization.findUnique.mockResolvedValueOnce({ weeklyPostGoal: 9 });
    await expect(service.setGoal('org_1', 9)).resolves.toEqual({ target: 9, custom: true });
    expect(db.organization.update).toHaveBeenLastCalledWith({
      where: { id: 'org_1' },
      data: { weeklyPostGoal: 9 },
    });

    await expect(service.setGoal('org_1', null)).resolves.toEqual({ target: 7, custom: false });
    expect(db.organization.update).toHaveBeenLastCalledWith({
      where: { id: 'org_1' },
      data: { weeklyPostGoal: null },
    });
  });
});
