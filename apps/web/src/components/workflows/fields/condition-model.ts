/**
 * The condition builder's rules as pure functions (Module 06): which
 * operators a rule offers for its left side's data, and every edit to a
 * group (add, remove, change a side or the operator, All Of or Any Of).
 * Paths' cases live here too. No React, so each rule is unit tested.
 */
import {
  type AutomationGraph,
  type ConditionGroup,
  type ConditionOperator,
  type ConditionRule,
  type ConditionType,
  conditionTypeOf,
  emptyConditionGroup,
  type FieldType,
  MAX_CONDITION_RULES,
  OPERATORS,
  operatorsFor,
  parseTemplate,
  singleToken,
} from '@postgear/automation';
import { chipInfo } from './chip-model';
import { freshId } from './form-model';

/** Formats that change what kind of data a token gives. */
const TEXT_FILTERS = new Set([
  'truncate',
  'upper',
  'lower',
  'trim',
  'date',
  'json',
  'join',
  'urlencode',
]);

/**
 * The data type of a rule's left side: the type of its one data chip, after
 * its formats ("Count the items" gives a number). Typed text or several
 * chips compare as text.
 */
export function leftType(
  graph: AutomationGraph | undefined,
  nodeKey: string | undefined,
  left: string,
): FieldType | undefined {
  const token = singleToken(parseTemplate(left));
  if (!token) return undefined;
  let type = graph ? chipInfo(graph, nodeKey, token.path).type : undefined;
  for (const filter of token.filters) {
    if (filter.name === 'count') type = 'number';
    else if (filter.name === 'first') type = type === 'list' ? 'text' : type;
    else if (TEXT_FILTERS.has(filter.name)) type = 'text';
  }
  return type;
}

/** An operator in menu words: "is greater than", "is within the last N days". */
export function operatorLabel(operator: ConditionOperator): string {
  const info = OPERATORS[operator];
  if (operator === 'hasMoreThan') return 'has more than N items';
  return info.words.replace('{n}', 'N');
}

export interface OperatorChoice {
  value: ConditionOperator;
  label: string;
}

/**
 * The operators a rule offers for its left side's type, in menu order. A
 * stored operator that does not fit (the data changed type) is kept at the
 * end so the menu still shows what is saved.
 */
export function operatorChoices(
  type: FieldType | undefined,
  current?: ConditionOperator,
): OperatorChoice[] {
  const ids = [...operatorsFor(type)];
  if (current && !ids.includes(current)) ids.push(current);
  return ids.map((id) => ({ value: id, label: operatorLabel(id) }));
}

/** True when the operator compares text, where Match Case means something. */
export function takesMatchCase(type: FieldType | undefined, operator: ConditionOperator): boolean {
  const kind: ConditionType = conditionTypeOf(type);
  return kind === 'text' && OPERATORS[operator].takesValue;
}

function fitRule(rule: ConditionRule, type: FieldType | undefined): ConditionRule {
  const allowed = operatorsFor(type);
  const operator = allowed.includes(rule.operator) ? rule.operator : allowed[0];
  const next: ConditionRule = { id: rule.id, left: rule.left, operator };
  if (OPERATORS[operator].takesValue) next.right = rule.right ?? '';
  if (rule.matchCase && takesMatchCase(type, operator)) next.matchCase = true;
  return next;
}

/** A new empty rule with an id no other rule of the group has. */
export function newRule(group: ConditionGroup): ConditionRule {
  const id = freshId(
    group.rules.map((rule) => rule.id),
    'r',
  );
  return { id, left: '', operator: 'is', right: '' };
}

/** The group with one more empty rule (at most `MAX_CONDITION_RULES`). */
export function addRule(group: ConditionGroup): ConditionGroup {
  if (group.rules.length >= MAX_CONDITION_RULES) return group;
  return { ...group, rules: [...group.rules, newRule(group)] };
}

export function removeRule(group: ConditionGroup, id: string): ConditionGroup {
  return { ...group, rules: group.rules.filter((rule) => rule.id !== id) };
}

export function setMatch(group: ConditionGroup, match: ConditionGroup['match']): ConditionGroup {
  return { ...group, match };
}

/**
 * A new left side: the operator moves to the first one that fits the new
 * data's type (a number never keeps "starts with"), and a value the new
 * operator does not take is dropped.
 */
export function setLeft(
  group: ConditionGroup,
  id: string,
  left: string,
  typeOf: (left: string) => FieldType | undefined,
): ConditionGroup {
  return {
    ...group,
    rules: group.rules.map((rule) =>
      rule.id === id ? fitRule({ ...rule, left }, typeOf(left)) : rule,
    ),
  };
}

export function setOperator(
  group: ConditionGroup,
  id: string,
  operator: ConditionOperator,
  type: FieldType | undefined,
): ConditionGroup {
  return {
    ...group,
    rules: group.rules.map((rule) => {
      if (rule.id !== id) return rule;
      const next: ConditionRule = { id: rule.id, left: rule.left, operator };
      if (OPERATORS[operator].takesValue) next.right = rule.right ?? '';
      if (rule.matchCase && takesMatchCase(type, operator)) next.matchCase = true;
      return next;
    }),
  };
}

export function setRight(group: ConditionGroup, id: string, right: string): ConditionGroup {
  return {
    ...group,
    rules: group.rules.map((rule) => (rule.id === id ? { ...rule, right } : rule)),
  };
}

export function setMatchCase(
  group: ConditionGroup,
  id: string,
  matchCase: boolean,
): ConditionGroup {
  return {
    ...group,
    rules: group.rules.map((rule) => {
      if (rule.id !== id) return rule;
      const { matchCase: _old, ...rest } = rule;
      return matchCase ? { ...rest, matchCase: true } : rest;
    }),
  };
}

/** A stored value that is not a well-formed group reads as an empty one. */
export function asGroup(value: unknown): ConditionGroup {
  if (typeof value !== 'object' || value === null) return emptyConditionGroup();
  const raw = value as Partial<ConditionGroup>;
  return {
    match: raw.match === 'any' ? 'any' : 'all',
    rules: Array.isArray(raw.rules) ? raw.rules : [],
  };
}

// Paths' cases ---------------------------------------------------------------

export interface PathCase {
  id: string;
  name: string;
  condition: ConditionGroup;
}

export const MAX_CASES = 10;

/** "Path C" for the third path: the first letter no case's name uses yet. */
function nextCaseName(cases: readonly PathCase[]): string {
  const names = new Set(cases.map((entry) => entry.name.trim().toLowerCase()));
  for (let i = 0; i < 26; i++) {
    const name = `Path ${String.fromCharCode(65 + i)}`;
    if (!names.has(name.toLowerCase())) return name;
  }
  return `Path ${cases.length + 1}`;
}

/** Stored cases, keeping only well-formed entries' shape (a broken one reads empty). */
export function asCases(value: unknown): PathCase[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const raw = (typeof entry === 'object' && entry !== null ? entry : {}) as Partial<PathCase>;
    return {
      id: typeof raw.id === 'string' ? raw.id : `case${i + 1}`,
      name: typeof raw.name === 'string' ? raw.name : '',
      condition: asGroup(raw.condition),
    };
  });
}

/** One more path with a fresh id (letters and digits, `CASE_ID_PATTERN`) and the next free name. */
export function addCase(cases: readonly PathCase[]): PathCase[] {
  if (cases.length >= MAX_CASES) return [...cases];
  const id = freshId(
    cases.map((entry) => entry.id),
    'p',
  );
  return [...cases, { id, name: nextCaseName(cases), condition: emptyConditionGroup() }];
}

/** Without the path; the last one is never removed (Paths needs one besides Otherwise). */
export function removeCase(cases: readonly PathCase[], id: string): PathCase[] {
  if (cases.length <= 1) return [...cases];
  return cases.filter((entry) => entry.id !== id);
}

/** The path at `from` moved to `to`; Otherwise is not a case, so it stays last. */
export function moveCase(cases: readonly PathCase[], from: number, to: number): PathCase[] {
  if (from === to || from < 0 || to < 0 || from >= cases.length || to >= cases.length) {
    return [...cases];
  }
  const next = [...cases];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
