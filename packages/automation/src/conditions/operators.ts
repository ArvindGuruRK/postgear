/**
 * The condition builder's operators: their words, which kinds of data
 * they fit, and whether they take a value. The UI lists `operatorsFor`
 * the left side's type, so a number never offers "starts with".
 */
import type { FieldType } from '../catalog/types';
import type { ConditionOperator } from './schema';

/** The kinds of data a condition can check (`FieldType` folded down). */
export type ConditionType = 'text' | 'number' | 'boolean' | 'date' | 'list';

export interface OperatorInfo {
  id: ConditionOperator;
  /** Sentence words: "is greater than". `{n}` is the value. */
  words: string;
  /** False for "is empty", "is true" and the like. */
  takesValue: boolean;
  /** "within the last {n} days", "has more than {n}": the value is a whole number. */
  valueIsCount?: boolean;
}

export const OPERATORS: Readonly<Record<ConditionOperator, OperatorInfo>> = {
  is: { id: 'is', words: 'is', takesValue: true },
  isNot: { id: 'isNot', words: 'is not', takesValue: true },
  contains: { id: 'contains', words: 'contains', takesValue: true },
  notContains: { id: 'notContains', words: 'does not contain', takesValue: true },
  startsWith: { id: 'startsWith', words: 'starts with', takesValue: true },
  endsWith: { id: 'endsWith', words: 'ends with', takesValue: true },
  isEmpty: { id: 'isEmpty', words: 'is empty', takesValue: false },
  isNotEmpty: { id: 'isNotEmpty', words: 'is not empty', takesValue: false },
  equals: { id: 'equals', words: 'equals', takesValue: true },
  notEquals: { id: 'notEquals', words: 'does not equal', takesValue: true },
  greaterThan: { id: 'greaterThan', words: 'is greater than', takesValue: true },
  atLeast: { id: 'atLeast', words: 'is at least', takesValue: true },
  lessThan: { id: 'lessThan', words: 'is less than', takesValue: true },
  atMost: { id: 'atMost', words: 'is at most', takesValue: true },
  isTrue: { id: 'isTrue', words: 'is true', takesValue: false },
  isFalse: { id: 'isFalse', words: 'is false', takesValue: false },
  before: { id: 'before', words: 'is before', takesValue: true },
  after: { id: 'after', words: 'is after', takesValue: true },
  withinLastDays: {
    id: 'withinLastDays',
    words: 'is within the last {n} days',
    takesValue: true,
    valueIsCount: true,
  },
  hasMoreThan: {
    id: 'hasMoreThan',
    words: 'has more than {n}',
    takesValue: true,
    valueIsCount: true,
  },
};

/** What the builder offers for each kind of data, in menu order. */
export const OPERATORS_BY_TYPE: Readonly<Record<ConditionType, readonly ConditionOperator[]>> = {
  text: [
    'is',
    'isNot',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'isEmpty',
    'isNotEmpty',
  ],
  number: [
    'equals',
    'notEquals',
    'greaterThan',
    'atLeast',
    'lessThan',
    'atMost',
    'isEmpty',
    'isNotEmpty',
  ],
  boolean: ['isTrue', 'isFalse'],
  date: ['before', 'after', 'withinLastDays', 'isEmpty'],
  list: ['contains', 'notContains', 'isEmpty', 'isNotEmpty', 'hasMoreThan'],
};

/** The condition type for a field's data type; unknown or object data is text. */
export function conditionTypeOf(type: FieldType | undefined): ConditionType {
  switch (type) {
    case 'number':
    case 'boolean':
    case 'date':
    case 'list':
      return type;
    default:
      return 'text';
  }
}

export function operatorsFor(type: FieldType | undefined): readonly ConditionOperator[] {
  return OPERATORS_BY_TYPE[conditionTypeOf(type)];
}

/** The type an operator compares as; `contains` works on text and lists. */
export function operatorFamily(operator: ConditionOperator): ConditionType | 'any' {
  if (operator === 'isEmpty' || operator === 'isNotEmpty') return 'any';
  if (operator === 'contains' || operator === 'notContains') return 'any';
  for (const type of ['number', 'boolean', 'date', 'list', 'text'] as const) {
    if (OPERATORS_BY_TYPE[type].includes(operator)) return type;
  }
  return 'text';
}
