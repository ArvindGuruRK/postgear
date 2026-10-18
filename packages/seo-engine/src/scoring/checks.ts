/**
 * The vocabulary the four evaluators share.
 *
 * A category score is the weighted mean of its checks' attainment, so two
 * things have to be true for the numbers to mean anything: the weights in a
 * category sum to 1 (asserted here at build time so a typo cannot quietly
 * shift a category), and attainment is 0–1 with graded checks using the same
 * ramps. `ramp` is for "more is better up to a point", `band` for "inside
 * this range is ideal, further away is worse", and `check` fills in the
 * invariants (`info` severity when passed, attainment from `passed` when the
 * check is binary).
 */
import type { CategoryScore, SeoCategory, SeoCheck, SeoSeverity } from '../types';

export interface CheckSpec {
  id: string;
  category: SeoCategory;
  label: string;
  weight: number;
  /** What a failure would mean; forced to `info` when the check passed. */
  severity: SeoSeverity;
  detail: string;
  value?: string | null;
  passed: boolean;
  /** Defaults to 1 when passed, 0 when not. */
  attainment?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function check(spec: CheckSpec): SeoCheck {
  const attainment = clamp01(spec.attainment ?? (spec.passed ? 1 : 0));
  return {
    id: spec.id,
    category: spec.category,
    label: spec.label,
    passed: spec.passed,
    severity: spec.passed ? 'info' : spec.severity,
    detail: spec.detail,
    value: spec.value ?? null,
    weight: spec.weight,
    attainment: Math.round(attainment * 1000) / 1000,
  };
}

/** 0 at or below `zeroAt`, 1 at or above `fullAt`, linear between. Works in either direction. */
export function ramp(value: number, zeroAt: number, fullAt: number): number {
  if (zeroAt === fullAt) return value >= fullAt ? 1 : 0;
  return clamp01((value - zeroAt) / (fullAt - zeroAt));
}

/**
 * 1 inside `[idealMin, idealMax]`, falling linearly to 0 at `zeroMin` on the
 * low side and `zeroMax` on the high side.
 */
export function band(
  value: number,
  ideal: readonly [number, number],
  zero: readonly [number, number],
): number {
  const [idealMin, idealMax] = ideal;
  const [zeroMin, zeroMax] = zero;
  if (value >= idealMin && value <= idealMax) return 1;
  if (value < idealMin) return ramp(value, zeroMin, idealMin);
  return ramp(value, zeroMax, idealMax);
}

export function scoreCategory(checks: SeoCheck[]): number {
  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;
  const attained = checks.reduce((sum, item) => sum + item.weight * item.attainment, 0);
  return Math.round((100 * attained) / totalWeight);
}

/** Builds a category and refuses weights that do not sum to 1: a programming error, not data. */
export function buildCategory(
  category: SeoCategory,
  weight: number,
  checks: SeoCheck[],
  estimated = false,
): CategoryScore {
  const total = checks.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`Check weights for ${category} sum to ${total.toFixed(3)}, not 1.`);
  }
  const ids = new Set<string>();
  for (const item of checks) {
    if (ids.has(item.id)) throw new Error(`Duplicate check id ${item.id} in ${category}.`);
    ids.add(item.id);
  }
  return { category, score: scoreCategory(checks), weight, checks, estimated };
}

export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
