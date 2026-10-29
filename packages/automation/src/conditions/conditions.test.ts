import type { RunScope } from '../tokens/values';
import { describeCondition, describeRule } from './describe';
import { evaluateCondition } from './evaluate';
import { conditionTypeOf, OPERATORS_BY_TYPE, operatorsFor } from './operators';
import type { ConditionGroup, ConditionOperator, ConditionRule } from './schema';

const scope: RunScope = {
  trigger: {
    channel: 'Instagram',
    text: '  Our LAUNCH is today  ',
    likes: 12,
    likesText: '12',
    blank: '',
    words: '12 likes',
    yes: true,
    yesText: 'Yes',
    no: false,
    tags: ['Launch', 'bakery'],
    none: [],
    publishedAt: '2026-11-01T09:00:00Z',
    broken: 'last Tuesday',
  },
  run: { startedAt: '2026-11-03T09:00:00Z' },
};

let next = 0;
function rule(
  left: string,
  operator: ConditionOperator,
  right?: string,
  matchCase?: boolean,
): ConditionRule {
  next += 1;
  return {
    id: `r${next}`,
    left: `{{ trigger.${left} }}`,
    operator,
    ...(right === undefined ? {} : { right }),
    ...(matchCase ? { matchCase } : {}),
  };
}

const check = (r: ConditionRule) => evaluateCondition({ match: 'all', rules: [r] }, scope).result;

describe('text checks', () => {
  it('"is" ignores case and spaces around the words', () => {
    expect(check(rule('channel', 'is', ' instagram '))).toBe(true);
    expect(check(rule('channel', 'is', 'Facebook'))).toBe(false);
  });

  it('"is" matches case exactly when Match Case is on', () => {
    expect(check(rule('channel', 'is', 'instagram', true))).toBe(false);
    expect(check(rule('channel', 'is', 'Instagram', true))).toBe(true);
  });

  it('"is not" is true when the text differs', () => {
    expect(check(rule('channel', 'isNot', 'Facebook'))).toBe(true);
    expect(check(rule('channel', 'isNot', 'INSTAGRAM'))).toBe(false);
  });

  it('"contains" and "does not contain" look inside the text', () => {
    expect(check(rule('text', 'contains', 'launch'))).toBe(true);
    expect(check(rule('text', 'contains', 'launch', true))).toBe(false);
    expect(check(rule('text', 'notContains', 'sale'))).toBe(true);
  });

  it('"starts with" and "ends with" ignore the spaces around the text', () => {
    expect(check(rule('text', 'startsWith', 'our'))).toBe(true);
    expect(check(rule('text', 'endsWith', 'today'))).toBe(true);
    expect(check(rule('text', 'endsWith', 'Our'))).toBe(false);
  });

  it('"is empty" is true for blank text, missing data and empty lists', () => {
    expect(check(rule('blank', 'isEmpty'))).toBe(true);
    expect(check(rule('missing', 'isEmpty'))).toBe(true);
    expect(check(rule('none', 'isEmpty'))).toBe(true);
    expect(check(rule('channel', 'isEmpty'))).toBe(false);
    expect(check(rule('channel', 'isNotEmpty'))).toBe(true);
  });
});

describe('number checks', () => {
  it('compare numbers, and numbers written as text', () => {
    expect(check(rule('likes', 'greaterThan', '10'))).toBe(true);
    expect(check(rule('likesText', 'atLeast', '12'))).toBe(true);
    expect(check(rule('likes', 'lessThan', '12'))).toBe(false);
    expect(check(rule('likes', 'atMost', '12'))).toBe(true);
    expect(check(rule('likes', 'equals', '12.0'))).toBe(true);
    expect(check(rule('likes', 'notEquals', '13'))).toBe(true);
  });

  it('never treat empty data as 0: every comparison with it is false', () => {
    expect(check(rule('blank', 'lessThan', '5'))).toBe(false);
    expect(check(rule('blank', 'greaterThan', '-5'))).toBe(false);
    expect(check(rule('blank', 'equals', '0'))).toBe(false);
    expect(check(rule('blank', 'notEquals', '5'))).toBe(false);
    expect(check(rule('missing', 'atMost', '5'))).toBe(false);
  });

  it('never read "12 likes" as 12', () => {
    expect(check(rule('words', 'equals', '12'))).toBe(false);
    const [detail] = evaluateCondition(
      { match: 'all', rules: [rule('words', 'equals', '12')] },
      scope,
    ).details;
    expect(detail.problem).toBe('notANumber');
  });
});

describe('yes or no checks', () => {
  it('"is true" accepts true and the word yes', () => {
    expect(check(rule('yes', 'isTrue'))).toBe(true);
    expect(check(rule('yesText', 'isTrue'))).toBe(true);
    expect(check(rule('no', 'isTrue'))).toBe(false);
    expect(check(rule('blank', 'isTrue'))).toBe(false);
  });

  it('"is false" accepts false and the word no, but not empty data', () => {
    expect(check(rule('no', 'isFalse'))).toBe(true);
    expect(check(rule('blank', 'isFalse'))).toBe(false);
  });
});

describe('date checks', () => {
  it('"is before" and "is after" compare dates', () => {
    expect(check(rule('publishedAt', 'before', '2026-11-02'))).toBe(true);
    expect(check(rule('publishedAt', 'after', '2026-11-02'))).toBe(false);
    expect(check(rule('publishedAt', 'after', '2026-10-31T23:00:00+05:30'))).toBe(true);
  });

  it('"is within the last N days" counts back from the run start', () => {
    expect(check(rule('publishedAt', 'withinLastDays', '3'))).toBe(true);
    expect(check(rule('publishedAt', 'withinLastDays', '1'))).toBe(false);
  });

  it('a date that cannot be read is never before or after anything', () => {
    expect(check(rule('broken', 'before', '2030-01-01'))).toBe(false);
    expect(check(rule('broken', 'after', '2000-01-01'))).toBe(false);
    expect(check(rule('publishedAt', 'before', 'next week'))).toBe(false);
  });
});

describe('list checks', () => {
  it('"contains" means one item equals the value, ignoring case', () => {
    expect(check(rule('tags', 'contains', 'launch'))).toBe(true);
    expect(check(rule('tags', 'contains', 'laun'))).toBe(false);
    expect(check(rule('tags', 'contains', 'launch', true))).toBe(false);
    expect(check(rule('tags', 'notContains', 'sale'))).toBe(true);
  });

  it('"has more than N" counts the items', () => {
    expect(check(rule('tags', 'hasMoreThan', '1'))).toBe(true);
    expect(check(rule('tags', 'hasMoreThan', '2'))).toBe(false);
    expect(check(rule('none', 'hasMoreThan', '0'))).toBe(false);
  });
});

describe('All Of and Any Of', () => {
  const yes = rule('channel', 'is', 'Instagram');
  const no = rule('channel', 'is', 'Facebook');

  it('All Of needs every rule to match', () => {
    expect(evaluateCondition({ match: 'all', rules: [yes, no] }, scope).result).toBe(false);
    expect(evaluateCondition({ match: 'all', rules: [yes, yes] }, scope).result).toBe(true);
  });

  it('Any Of needs one rule to match', () => {
    expect(evaluateCondition({ match: 'any', rules: [no, yes] }, scope).result).toBe(true);
    expect(evaluateCondition({ match: 'any', rules: [no, no] }, scope).result).toBe(false);
  });

  it('reports each rule for the run inspector', () => {
    const { details } = evaluateCondition({ match: 'any', rules: [yes, no] }, scope);
    expect(details.map((detail) => [detail.id, detail.result])).toEqual([
      [yes.id, true],
      [no.id, false],
    ]);
    expect(details[0].left).toBe('Instagram');
  });

  it('an empty group matches for All Of and not for Any Of (validation stops it running)', () => {
    expect(evaluateCondition({ match: 'all', rules: [] }, scope).result).toBe(true);
    expect(evaluateCondition({ match: 'any', rules: [] }, scope).result).toBe(false);
  });
});

describe('the operator menu', () => {
  it('offers only the checks that fit the kind of data', () => {
    expect(operatorsFor('number')).toContain('greaterThan');
    expect(operatorsFor('number')).not.toContain('startsWith');
    expect(operatorsFor('list')).toContain('hasMoreThan');
    expect(operatorsFor(undefined)).toEqual(OPERATORS_BY_TYPE.text);
    expect(conditionTypeOf('media')).toBe('text');
  });
});

describe('the condition sentence', () => {
  const label = (path: string) =>
    ({ 'trigger.post.channel.name': 'Channel', 'trigger.post.preview': 'Text' })[path];

  it('reads like a sentence', () => {
    const group: ConditionGroup = {
      match: 'all',
      rules: [
        { id: 'a', left: '{{ trigger.post.channel.name }}', operator: 'is', right: 'Instagram' },
        { id: 'b', left: '{{ trigger.post.preview }}', operator: 'contains', right: 'launch' },
      ],
    };
    expect(describeCondition(group, { tokenLabel: label })).toBe(
      "Channel is 'Instagram' and Text contains 'launch'",
    );
  });

  it('joins Any Of rules with "or" and writes numbers bare', () => {
    const group: ConditionGroup = {
      match: 'any',
      rules: [
        { id: 'a', left: '{{ trigger.likes }}', operator: 'greaterThan', right: '10' },
        { id: 'b', left: '{{ trigger.tags }}', operator: 'isEmpty' },
      ],
    };
    expect(describeCondition(group)).toBe('Likes is greater than 10 or Tags is empty');
  });

  it('spells out counts in words', () => {
    expect(
      describeRule({ id: 'a', left: '{{ trigger.tags }}', operator: 'hasMoreThan', right: '3' }),
    ).toBe('Tags has more than 3 items');
    expect(
      describeRule({
        id: 'a',
        left: '{{ trigger.publishedAt }}',
        operator: 'withinLastDays',
        right: '7',
      }),
    ).toBe('Published At is within the last 7 days');
  });

  it('names data on the right too', () => {
    expect(
      describeRule(
        {
          id: 'a',
          left: '{{ trigger.post.preview }}',
          operator: 'contains',
          right: '{{ trigger.post.channel.name }}',
        },
        { tokenLabel: label },
      ),
    ).toBe('Text contains Channel');
  });

  it('stops after three rules', () => {
    const rules = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      left: '{{ trigger.likes }}',
      operator: 'atLeast' as const,
      right: String(i),
    }));
    expect(describeCondition({ match: 'all', rules })).toBe(
      'Likes is at least 0 and Likes is at least 1 and Likes is at least 2 and 2 more rules',
    );
  });

  it('says when there are no rules yet', () => {
    expect(describeCondition({ match: 'all', rules: [] })).toBe('No rules yet');
  });
});
