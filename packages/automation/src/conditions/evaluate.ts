/**
 * Evaluating a condition against run data, with semantics a person would
 * predict:
 *
 * - Text trims both sides and ignores case unless Match Case is on.
 * - Numbers are read strictly: empty or non-numeric is never 0, so every
 *   number comparison with it is false (`"" < 5` is false, and so is
 *   `"" does not equal 5`).
 * - Dates are ISO; an unreadable date makes the rule false.
 * - Lists: "contains" means one item equals the value, as text, with the
 *   same case rule.
 * - No regular expressions (nothing for a slow pattern to hang on).
 *
 * An empty group matches when it is "all" and does not when it is "any";
 * validation never lets an empty group run (`condition.empty`).
 */
import { MS_PER_DAY } from '../time/calendar';
import { resolveTemplate } from '../tokens/resolve';
import { isEmptyValue, type RunScope, toEpoch, toNumber, toText } from '../tokens/values';
import type { ConditionGroup, ConditionOperator, ConditionRule } from './schema';

export interface RuleResult {
  id: string;
  operator: ConditionOperator;
  result: boolean;
  /** The resolved left side, for the run inspector. */
  left: unknown;
  right?: unknown;
  /** Why a comparison could not be made: it is then false. */
  problem?: 'notANumber' | 'notADate';
}

export interface ConditionResult {
  result: boolean;
  details: RuleResult[];
}

export interface EvaluateOptions {
  /** "Now" for "within the last N days"; defaults to the run's start. */
  now?: string;
  timeZone?: string;
}

function text(value: unknown, matchCase: boolean): string {
  const written = toText(value).trim();
  return matchCase ? written : written.toLowerCase();
}

function listItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isEmptyValue(value) ? [] : [value];
}

function compare(
  operator: ConditionOperator,
  left: unknown,
  right: unknown,
  matchCase: boolean,
  now: number | undefined,
): Pick<RuleResult, 'result' | 'problem'> {
  switch (operator) {
    case 'isEmpty':
      return { result: isEmptyValue(left) };
    case 'isNotEmpty':
      return { result: !isEmptyValue(left) };
    case 'is':
      return { result: text(left, matchCase) === text(right, matchCase) };
    case 'isNot':
      return { result: text(left, matchCase) !== text(right, matchCase) };
    case 'contains':
    case 'notContains': {
      const needle = text(right, matchCase);
      const found = Array.isArray(left)
        ? left.some((item) => text(item, matchCase) === needle)
        : text(left, matchCase).includes(needle);
      return { result: operator === 'contains' ? found : !found };
    }
    case 'startsWith':
      return { result: text(left, matchCase).startsWith(text(right, matchCase)) };
    case 'endsWith':
      return { result: text(left, matchCase).endsWith(text(right, matchCase)) };
    case 'equals':
    case 'notEquals':
    case 'greaterThan':
    case 'atLeast':
    case 'lessThan':
    case 'atMost': {
      const a = toNumber(left);
      const b = toNumber(right);
      if (Number.isNaN(a) || Number.isNaN(b)) return { result: false, problem: 'notANumber' };
      const result = {
        equals: a === b,
        notEquals: a !== b,
        greaterThan: a > b,
        atLeast: a >= b,
        lessThan: a < b,
        atMost: a <= b,
      }[operator];
      return { result };
    }
    case 'isTrue':
      return { result: left === true || ['true', 'yes'].includes(text(left, false)) };
    case 'isFalse':
      return { result: left === false || ['false', 'no'].includes(text(left, false)) };
    case 'before':
    case 'after': {
      const a = toEpoch(left);
      const b = toEpoch(typeof right === 'string' ? right.trim() : right);
      if (a === undefined || b === undefined) return { result: false, problem: 'notADate' };
      return { result: operator === 'before' ? a < b : a > b };
    }
    case 'withinLastDays': {
      const at = toEpoch(left);
      const days = toNumber(right);
      if (Number.isNaN(days) || days < 0) return { result: false, problem: 'notANumber' };
      if (at === undefined || now === undefined) return { result: false, problem: 'notADate' };
      return { result: at <= now && at >= now - days * MS_PER_DAY };
    }
    case 'hasMoreThan': {
      const limit = toNumber(right);
      if (Number.isNaN(limit)) return { result: false, problem: 'notANumber' };
      return { result: listItems(left).length > limit };
    }
  }
}

function evaluateRule(
  rule: ConditionRule,
  scope: RunScope,
  options: EvaluateOptions,
  now: number | undefined,
): RuleResult {
  const left = resolveTemplate(rule.left, scope, options).value;
  const right =
    rule.right === undefined ? undefined : resolveTemplate(rule.right, scope, options).value;
  const outcome = compare(rule.operator, left, right, rule.matchCase === true, now);
  return {
    id: rule.id,
    operator: rule.operator,
    left,
    ...(rule.right === undefined ? {} : { right }),
    ...outcome,
  };
}

/** Evaluates every rule (the inspector shows each), then combines them. */
export function evaluateCondition(
  group: ConditionGroup,
  scope: RunScope,
  options: EvaluateOptions = {},
): ConditionResult {
  const nowText = options.now ?? scope.run?.startedAt;
  const now = nowText === undefined ? undefined : toEpoch(nowText);
  const details = group.rules.map((rule) => evaluateRule(rule, scope, options, now));
  const result =
    group.match === 'all'
      ? details.every((detail) => detail.result)
      : details.some((detail) => detail.result);
  return { result, details };
}
