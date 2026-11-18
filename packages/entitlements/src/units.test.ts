/**
 * Thousandths and display rounding: a charge rounds up, the page never
 * promises more than the server allows.
 */
import {
  displayLimit,
  displayRemaining,
  displayUsed,
  fitsLimit,
  MILLI,
  meterAmounts,
  toMilli,
} from './units';

describe('toMilli', () => {
  it('stores whole thousandths and rounds a fraction up', () => {
    expect(MILLI).toBe(1000);
    expect(toMilli(61.5)).toBe(61_500);
    expect(toMilli(1)).toBe(1000);
    expect(toMilli(0.0001)).toBe(1);
    expect(toMilli(2.0004)).toBe(2001);
  });

  it('ignores floating point noise', () => {
    expect(toMilli(0.1)).toBe(100);
    expect(toMilli(0.3)).toBe(300);
    expect(toMilli(1.005)).toBe(1005);
    expect(toMilli(999_999.999)).toBe(999_999_999);
  });

  it('refuses amounts that are not finite', () => {
    expect(() => toMilli(Number.NaN)).toThrow(RangeError);
    expect(() => toMilli(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('display rounding', () => {
  it('rounds used up and remaining and the limit down', () => {
    expect(displayUsed(37_001)).toBe(38);
    expect(displayUsed(38_000)).toBe(38);
    expect(displayRemaining(261_999)).toBe(261);
    expect(displayLimit(2.9)).toBe(2);
    expect(displayLimit(null)).toBeNull();
  });

  it('never shows a negative or unreadable number', () => {
    expect(displayUsed(-5)).toBe(0);
    expect(displayUsed(Number.NaN)).toBe(0);
    expect(displayRemaining(-1)).toBe(0);
    expect(displayLimit(-3)).toBe(0);
  });
});

describe('meterAmounts', () => {
  it('gives the chip its whole numbers', () => {
    expect(meterAmounts(261_500, 300)).toEqual({ used: 262, limit: 300, remaining: 38 });
  });

  it('leaves remaining at 0 when a lowered limit is below what is used', () => {
    expect(meterAmounts(500_000, 300)).toEqual({ used: 500, limit: 300, remaining: 0 });
  });

  it('keeps unlimited as null', () => {
    expect(meterAmounts(12_000, null)).toEqual({ used: 12, limit: null, remaining: null });
  });
});

describe('fitsLimit', () => {
  it('allows a charge that reaches the limit exactly, not one past it', () => {
    expect(fitsLimit(290_000, 10_000, 300)).toBe(true);
    expect(fitsLimit(290_000, 10_001, 300)).toBe(false);
    expect(fitsLimit(0, 100, 0.1)).toBe(true);
  });

  it('always fits unlimited, and never fits on unreadable numbers', () => {
    expect(fitsLimit(1e12, 1e12, null)).toBe(true);
    expect(fitsLimit(Number.NaN, 1, 300)).toBe(false);
  });
});
