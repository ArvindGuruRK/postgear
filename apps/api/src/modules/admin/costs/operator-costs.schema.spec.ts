/**
 * The costs query (Module 15 section 3): strict UTC days, `[from, to)`,
 * today by default, at most 92 days.
 */
import { COSTS_MAX_DAYS, costsQuerySchema, costsWindow, dayStart } from './operator-costs.schema';

const NOW = new Date('2026-11-28T21:30:00.000Z');

describe('costsQuerySchema', () => {
  it('takes two days, one, or none', () => {
    expect(costsQuerySchema.safeParse({}).success).toBe(true);
    expect(costsQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(true);
    expect(costsQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-29' }).success).toBe(true);
  });

  it('refuses an unknown key, a day that does not exist and a time', () => {
    for (const query of [
      { from: '2026-11-01', orgId: 'x' },
      { from: '2026-02-30' },
      { from: '2026-11-01T00:00:00Z' },
      { to: '28-11-2026' },
      { from: ['2026-11-01', '2026-11-02'] },
    ]) {
      expect(costsQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('refuses a window that ends before it starts, or is empty', () => {
    expect(costsQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-10' }).success).toBe(
      false,
    );
    expect(costsQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success).toBe(
      false,
    );
  });

  it('allows 92 days and refuses 93', () => {
    expect(COSTS_MAX_DAYS).toBe(92);
    expect(costsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-12-02' }).success).toBe(true);
    expect(costsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-12-03' }).success).toBe(
      false,
    );
  });
});

describe('costsWindow', () => {
  it('is today UTC by default', () => {
    expect(costsWindow({}, NOW)).toEqual({
      from: new Date('2026-11-28T00:00:00.000Z'),
      to: new Date('2026-11-29T00:00:00.000Z'),
    });
  });

  it('is one day beside a lone from or to', () => {
    expect(costsWindow({ from: '2026-11-10' }, NOW)).toEqual({
      from: new Date('2026-11-10T00:00:00.000Z'),
      to: new Date('2026-11-11T00:00:00.000Z'),
    });
    expect(costsWindow({ to: '2026-11-10' }, NOW)).toEqual({
      from: new Date('2026-11-09T00:00:00.000Z'),
      to: new Date('2026-11-10T00:00:00.000Z'),
    });
  });

  it('keeps both days as given, to exclusive', () => {
    expect(costsWindow({ from: '2026-11-01', to: '2026-12-01' }, NOW)).toEqual({
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('reads leap days and refuses made-up ones', () => {
    expect(dayStart('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(dayStart('2027-02-29')).toBeNull();
  });
});
