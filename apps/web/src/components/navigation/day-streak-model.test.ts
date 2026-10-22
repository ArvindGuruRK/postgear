import { dayStreakHint, dayStreakLabel, isFlameLit } from './day-streak-model';

describe('isFlameLit', () => {
  it('lights only when today has a post', () => {
    expect(isFlameLit({ days: 3, postedToday: true })).toBe(true);
    expect(isFlameLit({ days: 3, postedToday: false })).toBe(false);
    expect(isFlameLit({ days: 0, postedToday: false })).toBe(false);
  });
});

describe('dayStreakHint', () => {
  it('invites a first post when there is no streak', () => {
    expect(dayStreakHint({ days: 0, postedToday: false })).toBe(
      'Publish a post today to start a day streak.',
    );
  });

  it('welcomes the first day', () => {
    expect(dayStreakHint({ days: 1, postedToday: true })).toContain('started a streak today');
  });

  it('counts a longer streak', () => {
    expect(dayStreakHint({ days: 5, postedToday: true })).toBe(
      'You are on a 5 day posting streak. Keep it going!',
    );
  });

  it('asks for a post today while yesterday keeps it alive', () => {
    expect(dayStreakHint({ days: 5, postedToday: false })).toBe(
      'You are on a 5 day streak. Publish a post today to keep it going.',
    );
  });
});

describe('dayStreakLabel', () => {
  it('leads with the count', () => {
    expect(dayStreakLabel({ days: 1, postedToday: true })).toMatch(/^Posting streak: 1 day\./);
    expect(dayStreakLabel({ days: 4, postedToday: false })).toMatch(/^Posting streak: 4 days\./);
  });
});
