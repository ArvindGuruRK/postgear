/**
 * The stored shape of a condition, shared by If / Else, Filter, the cases
 * of Paths and trigger filters.
 *
 * Only the shape lives here. Evaluating a condition and describing it in
 * words is Module 02's (`evaluateCondition`, `describeCondition`), next to
 * this file. A group may hold no rules so a new step's default config
 * still parses; an empty group is a validation issue there, not a parse
 * error here.
 */
import { z } from 'zod';

/**
 * Operator ids. Which ones apply depends on the type of the left side
 * (text, number, yes/no, date, list); the UI shows them in words.
 */
export const CONDITION_OPERATORS = [
  'is',
  'isNot',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'equals',
  'notEquals',
  'greaterThan',
  'atLeast',
  'lessThan',
  'atMost',
  'isTrue',
  'isFalse',
  'before',
  'after',
  'withinLastDays',
  'hasMoreThan',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const MAX_CONDITION_RULES = 10;

export const conditionRuleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,21}$/),
    /** A template, usually one data token. */
    left: z.string().max(500),
    operator: z.enum(CONDITION_OPERATORS),
    /** A template; absent for operators that take no value ("is empty"). */
    right: z.string().max(1_000).optional(),
    matchCase: z.boolean().optional(),
  })
  .strict();

export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionGroupSchema = z
  .object({
    match: z.enum(['all', 'any']),
    rules: z.array(conditionRuleSchema).max(MAX_CONDITION_RULES),
  })
  .strict();

export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

export function emptyConditionGroup(): ConditionGroup {
  return { match: 'all', rules: [] };
}
