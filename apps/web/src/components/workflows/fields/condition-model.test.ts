import {
  type AutomationGraph,
  CASE_ID_PATTERN,
  CONDITION_OPERATORS,
  conditionGroupSchema,
  emptyConditionGroup,
  getTemplate,
  instantiateTemplate,
  MAX_CONDITION_RULES,
  OPERATORS_BY_TYPE,
} from '@postgear/automation';
import {
  addCase,
  addRule,
  asCases,
  asGroup,
  leftType,
  moveCase,
  operatorChoices,
  operatorLabel,
  removeCase,
  removeRule,
  setLeft,
  setMatchCase,
  setOperator,
  setRight,
  takesMatchCase,
} from './condition-model';

let n = 0;
const graph = instantiateTemplate(
  getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>,
  () => `k${(n++).toString().padStart(9, '0')}`,
) as AutomationGraph;
const slack = graph.nodes.find((node) => node.type === 'notify.slack');
const typeOf = (left: string) => leftType(graph, slack?.key, left);

describe('operator lists per type', () => {
  it.each(['text', 'number', 'boolean', 'date', 'list'] as const)(
    'offers the %s operators, in words',
    (type) => {
      const choices = operatorChoices(type);
      expect(choices.map((choice) => choice.value)).toEqual(OPERATORS_BY_TYPE[type]);
      for (const choice of choices) {
        expect(choice.label).not.toMatch(/[{}]/);
        expect(choice.label).toBe(choice.label.toLowerCase().replace(/\bn\b/, 'N'));
      }
    },
  );

  it('never offers text operators for a number, nor number ones for text', () => {
    const number = operatorChoices('number').map((choice) => choice.value);
    expect(number).not.toContain('startsWith');
    expect(number).not.toContain('contains');
    const text = operatorChoices('text').map((choice) => choice.value);
    expect(text).not.toContain('greaterThan');
    expect(operatorChoices('boolean').map((choice) => choice.label)).toEqual([
      'is true',
      'is false',
    ]);
  });

  it('treats unknown and object data as text', () => {
    expect(operatorChoices(undefined).map((c) => c.value)).toEqual(OPERATORS_BY_TYPE.text);
    expect(operatorChoices('object').map((c) => c.value)).toEqual(OPERATORS_BY_TYPE.text);
  });

  it('keeps a saved operator that no longer fits at the end', () => {
    const choices = operatorChoices('number', 'startsWith');
    expect(choices.at(-1)).toEqual({ value: 'startsWith', label: 'starts with' });
  });

  it('has words for every operator', () => {
    for (const id of CONDITION_OPERATORS) expect(operatorLabel(id)).toMatch(/^[a-z]/);
    expect(operatorLabel('withinLastDays')).toBe('is within the last N days');
    expect(operatorLabel('hasMoreThan')).toBe('has more than N items');
  });

  it('reads the left side type from its chip and formats', () => {
    expect(typeOf('{{ trigger.post.url }}')).toBe('text');
    expect(typeOf('{{ trigger.publishedAt }}')).toBe('date');
    expect(typeOf('{{ trigger.tags }}')).toBe('list');
    expect(typeOf('{{ trigger.tags | count }}')).toBe('number');
    expect(typeOf('{{ trigger.publishedAt | date: "yyyy" }}')).toBe('text');
    expect(typeOf('typed text')).toBeUndefined();
    expect(typeOf('{{ trigger.tags }} and more')).toBeUndefined();
  });

  it('offers Match Case for text comparisons only', () => {
    expect(takesMatchCase('text', 'contains')).toBe(true);
    expect(takesMatchCase('text', 'isEmpty')).toBe(false);
    expect(takesMatchCase('number', 'equals')).toBe(false);
  });
});

describe('group edits', () => {
  it('adds rules with fresh ids up to the cap, every one valid', () => {
    let group = emptyConditionGroup();
    for (let i = 0; i < MAX_CONDITION_RULES + 3; i++) group = addRule(group);
    expect(group.rules).toHaveLength(MAX_CONDITION_RULES);
    expect(new Set(group.rules.map((rule) => rule.id)).size).toBe(MAX_CONDITION_RULES);
    expect(conditionGroupSchema.safeParse(group).success).toBe(true);
    const fewer = removeRule(group, group.rules[0].id);
    expect(fewer.rules).toHaveLength(MAX_CONDITION_RULES - 1);
    const added = addRule(fewer).rules.at(-1)?.id;
    expect(fewer.rules.map((rule) => rule.id)).not.toContain(added);
  });

  it('moves the operator to one that fits when the left side changes type', () => {
    let group = addRule(emptyConditionGroup());
    const id = group.rules[0].id;
    group = setOperator(group, id, 'startsWith', 'text');
    group = setRight(group, id, 'Launch');
    group = setMatchCase(group, id, true);
    group = setLeft(group, id, '{{ trigger.tags | count }}', typeOf);
    expect(group.rules[0]).toEqual({
      id,
      left: '{{ trigger.tags | count }}',
      operator: 'equals',
      right: 'Launch',
    });

    group = setOperator(group, id, 'isEmpty', 'number');
    expect(group.rules[0]).toEqual({ id, left: '{{ trigger.tags | count }}', operator: 'isEmpty' });
    expect(conditionGroupSchema.safeParse(group).success).toBe(true);

    group = setLeft(group, id, '{{ trigger.publishedAt }}', typeOf);
    expect(group.rules[0].operator).toBe('isEmpty');
    group = setLeft(group, id, '{{ trigger.tags }}', typeOf);
    expect(group.rules[0].operator).toBe('isEmpty');
    group = setOperator(group, id, 'hasMoreThan', 'list');
    expect(group.rules[0].right).toBe('');
  });

  it('turns Match Case on and off without leaving false behind', () => {
    let group = addRule(emptyConditionGroup());
    const id = group.rules[0].id;
    group = setMatchCase(group, id, true);
    expect(group.rules[0].matchCase).toBe(true);
    group = setMatchCase(group, id, false);
    expect('matchCase' in group.rules[0]).toBe(false);
  });

  it('reads a broken stored value as an empty group', () => {
    expect(asGroup(undefined)).toEqual({ match: 'all', rules: [] });
    expect(asGroup({ match: 'any', rules: 'x' })).toEqual({ match: 'any', rules: [] });
  });
});

describe('paths', () => {
  const start = asCases([
    { id: 'a', name: 'Path A', condition: emptyConditionGroup() },
    { id: 'b', name: 'Path B', condition: emptyConditionGroup() },
  ]);

  it('adds paths with valid fresh ids and the next free name', () => {
    const more = addCase(start);
    expect(more).toHaveLength(3);
    expect(more[2].name).toBe('Path C');
    expect(more[2].id).toMatch(CASE_ID_PATTERN);
    expect(start.map((entry) => entry.id)).not.toContain(more[2].id);
    let full = start;
    for (let i = 0; i < 20; i++) full = addCase(full);
    expect(full).toHaveLength(10);
    expect(new Set(full.map((entry) => entry.id)).size).toBe(10);
  });

  it('reorders and removes, keeping at least one path', () => {
    const three = addCase(start);
    expect(moveCase(three, 2, 0).map((entry) => entry.name)).toEqual([
      'Path C',
      'Path A',
      'Path B',
    ]);
    expect(moveCase(three, 0, 9)).toEqual(three);
    expect(removeCase(three, 'a').map((entry) => entry.id)).toEqual(['b', three[2].id]);
    expect(removeCase([three[0]], three[0].id)).toHaveLength(1);
  });
});
