/**
 * The credit rules, pinned: costs, allowances, the low-water mark, and the
 * cycle maths — especially month-end clamping, which is where date code
 * usually goes wrong.
 */
import {
  AI_CREDIT_ALLOWANCE,
  AI_CREDIT_COSTS,
  AI_LEDGER_TYPES,
  buildCredits,
  cycleFor,
  generateCost,
  isLow,
  refundTypeFor,
  tierOf,
} from './credits.policy';

const utc = (iso: string) => new Date(iso);

describe('credits policy', () => {
  it('prices a generation by whether an image was asked for', () => {
    expect(generateCost(false)).toBe(5);
    expect(generateCost(true)).toBe(15);
    expect(AI_CREDIT_COSTS.copilot_message).toBe(1);
  });

  it('names a refund after what it refunds, and counts both in the ledger', () => {
    expect(refundTypeFor('generate_image')).toBe('refund:generate_image');
    expect(AI_LEDGER_TYPES).toEqual([
      'generate_post',
      'generate_image',
      'copilot_message',
      'refund:generate_post',
      'refund:generate_image',
      'refund:copilot_message',
    ]);
  });

  it('gives each tier its allowance, and a trial to a workspace with no active subscription', () => {
    expect(AI_CREDIT_ALLOWANCE).toEqual({
      NONE: 25,
      STANDARD: 100,
      PRO: 500,
      TEAM: 2000,
      ULTIMATE: 10000,
    });
    expect(tierOf(null)).toBe('NONE');
    expect(tierOf({ subscriptionTier: 'PRO', createdAt: new Date(), deletedAt: new Date() })).toBe(
      'NONE',
    );
    expect(tierOf({ subscriptionTier: 'TEAM', createdAt: new Date(), deletedAt: null })).toBe(
      'TEAM',
    );
  });

  it('is low under a fifth of the allowance', () => {
    expect(isLow(20, 100)).toBe(false);
    expect(isLow(19, 100)).toBe(true);
    expect(isLow(0, 25)).toBe(true);
  });

  describe('cycleFor', () => {
    it('runs from the anchor day of this month when that day has passed', () => {
      const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-20T09:00:00Z'));

      expect(cycle.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
      expect(cycle.end.toISOString()).toBe('2026-11-13T00:00:00.000Z');
    });

    it('runs from last month when the anchor day is still ahead', () => {
      const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-05T09:00:00Z'));

      expect(cycle.start.toISOString()).toBe('2026-09-13T00:00:00.000Z');
      expect(cycle.end.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    });

    it('starts a new cycle at midnight on the anchor day itself', () => {
      const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-13T00:00:00Z'));

      expect(cycle.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    });

    it('clamps a day-31 anchor to shorter months without skipping any', () => {
      const anchor = utc('2026-01-31T10:00:00Z');

      const february = cycleFor(anchor, utc('2026-02-15T00:00:00Z'));
      expect(february.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
      expect(february.end.toISOString()).toBe('2026-02-28T00:00:00.000Z');

      const march = cycleFor(anchor, utc('2026-03-01T00:00:00Z'));
      expect(march.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
      expect(march.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');

      const april = cycleFor(anchor, utc('2026-04-30T23:59:59Z'));
      expect(april.start.toISOString()).toBe('2026-04-30T00:00:00.000Z');
      expect(april.end.toISOString()).toBe('2026-05-31T00:00:00.000Z');
    });

    it('crosses the year boundary', () => {
      const cycle = cycleFor(utc('2025-12-20T00:00:00Z'), utc('2026-01-10T00:00:00Z'));

      expect(cycle.start.toISOString()).toBe('2025-12-20T00:00:00.000Z');
      expect(cycle.end.toISOString()).toBe('2026-01-20T00:00:00.000Z');
    });
  });

  it('builds the summary the UI shows, never with a negative remainder', () => {
    const credits = buildCredits({ tier: 'STANDARD', used: 23, resetsAt: utc('2026-11-13') });

    expect(credits).toEqual({
      allowance: 100,
      used: 23,
      remaining: 77,
      resetsAt: '2026-11-13T00:00:00.000Z',
      tier: 'STANDARD',
      low: false,
      costs: AI_CREDIT_COSTS,
    });
    expect(buildCredits({ tier: 'NONE', used: 30, resetsAt: utc('2026-11-13') })).toMatchObject({
      remaining: 0,
      low: true,
    });
  });
});
