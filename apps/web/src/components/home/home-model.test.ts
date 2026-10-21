/**
 * The Home page's rules: the greeting's boundaries, the streak's hint, the
 * goal's range, the banners' order and what Up next shows of a post.
 */
import type { Channel } from '@/types/channel';
import {
  bannersFor,
  clampGoal,
  dayLabel,
  firstLine,
  firstName,
  firstStepsCount,
  firstStepsDone,
  goalCaption,
  goalProgress,
  greeting,
  seatSummary,
  streakCaption,
  streakChain,
  streakHint,
  timeOfDay,
} from './home-model';

const at = (hours: number, minutes = 0) => new Date(2026, 9, 19, hours, minutes);

function channel(id: string, health: Channel['health']): Channel {
  return {
    id,
    providerIdentifier: 'linkedin',
    providerName: 'LinkedIn',
    name: `Channel ${id}`,
    profile: null,
    picture: null,
    health,
    disabled: false,
    refreshNeeded: health === 'needs_reconnect',
    inBetweenSteps: health === 'needs_setup',
    tokenExpiration: null,
    postingTimes: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    color: 0,
  };
}

describe('timeOfDay', () => {
  it.each([
    [0, 0, 'evening'],
    [4, 59, 'evening'],
    [5, 0, 'morning'],
    [11, 59, 'morning'],
    [12, 0, 'afternoon'],
    [16, 59, 'afternoon'],
    [17, 0, 'evening'],
    [23, 59, 'evening'],
  ] as const)('%i:%i is %s', (hours, minutes, expected) => {
    expect(timeOfDay(at(hours, minutes))).toBe(expected);
  });
});

describe('greeting', () => {
  it('uses the first word of the name', () => {
    expect(greeting(at(9), '  Arvind  Kumar ')).toBe('Good morning, Arvind');
    expect(firstName('Arvind Kumar')).toBe('Arvind');
  });

  it('drops the comma and the name when there is none', () => {
    expect(greeting(at(14), null)).toBe('Good afternoon');
    expect(greeting(at(20), '   ')).toBe('Good evening');
  });
});

describe('streakHint', () => {
  it('says a post this week keeps a live streak going', () => {
    expect(streakHint({ weeks: 3, postedThisWeek: false })).toContain('keeps it going');
  });

  it('just explains the count otherwise', () => {
    expect(streakHint({ weeks: 3, postedThisWeek: true })).not.toContain('keeps it going');
    expect(streakHint({ weeks: 0, postedThisWeek: false })).not.toContain('keeps it going');
  });
});

describe('the weekly goal', () => {
  it('keeps the target between 1 and 100 whole posts', () => {
    expect(clampGoal(0)).toBe(1);
    expect(clampGoal(250)).toBe(100);
    expect(clampGoal(4.6)).toBe(5);
    expect(clampGoal(Number.NaN)).toBe(1);
  });

  it('fills the ring to the goal and no further', () => {
    expect(goalProgress(2, 5)).toBeCloseTo(0.4);
    expect(goalProgress(9, 5)).toBe(1);
    expect(goalProgress(0, 5)).toBe(0);
  });
});

describe('Up next', () => {
  it('shows the first line with words on it', () => {
    expect(firstLine('\n  Launch day!  \nMore below')).toBe('Launch day!');
    expect(firstLine('')).toBeNull();
  });

  it('names today and tomorrow, and dates the rest', () => {
    const now = at(22);
    expect(dayLabel(at(23, 30), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 20, 1), now)).toBe('Tomorrow');
    expect(dayLabel(new Date(2026, 9, 23, 9), now)).not.toMatch(/Today|Tomorrow/);
  });
});

describe('firstStepsDone', () => {
  it('is done only when all three are', () => {
    expect(firstStepsDone({ channel: true, post: true, published: true })).toBe(true);
    expect(firstStepsDone({ channel: true, post: true, published: false })).toBe(false);
  });

  it('counts the steps done so far', () => {
    expect(firstStepsCount({ channel: true, post: false, published: false })).toBe(1);
    expect(firstStepsCount({ channel: true, post: true, published: true })).toBe(3);
  });
});

describe('the streak tile', () => {
  it('ends the chain on this week when it already has a post', () => {
    expect(streakChain({ weeks: 2, postedThisWeek: true }, 4)).toEqual([
      'empty',
      'empty',
      'done',
      'done',
    ]);
  });

  it('leaves this week open while the streak waits on it', () => {
    expect(streakChain({ weeks: 2, postedThisWeek: false }, 4)).toEqual([
      'empty',
      'done',
      'done',
      'open',
    ]);
  });

  it('stays empty with no streak, and full past its length', () => {
    expect(streakChain({ weeks: 0, postedThisWeek: false }, 3)).toEqual([
      'empty',
      'empty',
      'empty',
    ]);
    expect(streakChain({ weeks: 12, postedThisWeek: true }, 3)).toEqual(['done', 'done', 'done']);
  });

  it('says what this week needs', () => {
    expect(streakCaption({ weeks: 0, postedThisWeek: false })).toBe('Publish a post to start one');
    expect(streakCaption({ weeks: 3, postedThisWeek: true })).toBe('Posted this week');
    expect(streakCaption({ weeks: 3, postedThisWeek: false })).toBe('Post this week to keep it');
  });
});

describe('the goal and team tiles', () => {
  it('counts down to the goal', () => {
    expect(goalCaption(2, 5)).toBe('3 more posts to go');
    expect(goalCaption(4, 5)).toBe('1 more post to go');
    expect(goalCaption(6, 5)).toBe('Goal met this week');
  });

  it('measures members against the plan’s seats', () => {
    expect(seatSummary(2, 3)).toEqual({
      unit: 'of 3 seats',
      progress: 2 / 3,
      caption: '1 seat left',
    });
    expect(seatSummary(3, 3).caption).toBe('Every seat is taken');
  });

  it('draws no bar for an unlimited or unknown plan', () => {
    expect(seatSummary(1, null)).toEqual({
      unit: 'member',
      progress: null,
      caption: 'Unlimited seats on this plan',
    });
    expect(seatSummary(4, undefined).progress).toBeNull();
  });
});

describe('bannersFor', () => {
  it('asks for a channel only when the list loaded and is empty', () => {
    expect(bannersFor({ channels: [], failed: 0, statsFailed: false })).toEqual([
      { kind: 'no-channels' },
    ]);
    expect(bannersFor({ channels: null, failed: 0, statsFailed: false })).toEqual([]);
  });

  it('lists broken channels, then failed posts, then a stats error', () => {
    const expired = channel('a', 'needs_reconnect');
    const unfinished = channel('b', 'needs_setup');
    const fine = channel('c', 'connected');

    expect(
      bannersFor({ channels: [expired, fine, unfinished], failed: 2, statsFailed: true }),
    ).toEqual([
      { kind: 'reconnect', channel: expired },
      { kind: 'setup', channel: unfinished },
      { kind: 'failed', count: 2 },
      { kind: 'stats-error' },
    ]);
  });

  it('says nothing about failed posts before the count is known', () => {
    expect(
      bannersFor({ channels: [channel('c', 'connected')], failed: null, statsFailed: false }),
    ).toEqual([]);
  });
});
