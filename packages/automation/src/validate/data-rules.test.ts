import type { ConditionRule } from '../conditions/schema';
import type { GraphNode } from '../graph/schema';
import { graphOf, line, READY_CONTEXT, readySlack, step } from '../testing/builders';
import { aiScheduleLimit } from './rules/schedule';
import type { IssueCode } from './types';
import { validateGraph } from './validate-graph';

const codes = (issues: { code: IssueCode }[], prefix: string) =>
  issues.filter((issue) => issue.code.startsWith(prefix)).map((issue) => issue.code);

/** Post Published -> Set Fields -> Slack, with the Slack message given. */
function slackSaying(message: string, extra: GraphNode[] = [], extraLines = [line('set', 'slak')]) {
  return graphOf(
    [
      step('trig', 'trigger.postPublished', { name: 'Post Published' }),
      step('set', 'logic.setFields', {
        name: 'Set Fields',
        config: {
          fields: [{ name: 'channel', type: 'text', value: '{{ trigger.post.channel.name }}' }],
        },
      }),
      readySlack('slak', { name: 'Slack', config: { message } }),
      ...extra,
    ],
    [line('trig', 'set'), ...extraLines],
  );
}

describe('data chip checks', () => {
  it('accepts chips that point at earlier steps and real fields', () => {
    const graph = slackSaying(
      'On {{ nodes.set.output.channel }}: {{ trigger.post.url | truncate: 50 }}',
    );
    expect(codes(validateGraph(graph, READY_CONTEXT), 'token.')).toEqual([]);
  });

  it('flags a chip whose step was deleted', () => {
    const [issue] = validateGraph(
      slackSaying('{{ nodes.gone.output.text }}'),
      READY_CONTEXT,
    ).filter((i) => i.code.startsWith('token.'));
    expect(issue).toMatchObject({
      severity: 'error',
      code: 'token.unknown_node',
      message: 'This data is no longer available.',
      nodeKey: 'slak',
      field: 'message',
      token: '{{ nodes.gone.output.text }}',
    });
  });

  it('flags a chip from a step that runs later', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.postPublished'),
        step('set', 'logic.setFields', {
          config: {
            fields: [{ name: 'x', type: 'text', value: '{{ nodes.slak.output.preview }}' }],
          },
        }),
        readySlack('slak'),
      ],
      [line('trig', 'set'), line('set', 'slak')],
    );
    const issue = validateGraph(graph, READY_CONTEXT).find((i) => i.code === 'token.not_upstream');
    expect(issue).toMatchObject({
      message: 'This data comes from a step that runs later.',
      nodeKey: 'set',
      field: 'fields.0.value',
    });
  });

  it('flags a field the step does not have, by its name', () => {
    const issues = validateGraph(
      slackSaying('{{ trigger.post.bogus }} {{ nodes.set.output.nope }} {{ run.colour }}'),
      READY_CONTEXT,
    ).filter((i) => i.code === 'token.unknown_field');
    expect(issues.map((i) => i.message)).toEqual([
      "Post Published has no 'bogus'.",
      "Set Fields has no 'nope'.",
      "This run has no 'colour'.",
    ]);
  });

  it('flags a format that does not exist', () => {
    const issues = validateGraph(slackSaying('{{ trigger.post.url | shout }}'), READY_CONTEXT);
    expect(issues.find((i) => i.code === 'token.bad_filter')?.message).toBe(
      'This format option is not recognised.',
    );
  });

  it('flags an unknown kind of data', () => {
    expect(codes(validateGraph(slackSaying('{{ secrets.x }}'), READY_CONTEXT), 'token.')).toEqual([
      'token.unknown_node',
    ]);
  });

  it('flags more than 50 chips in one field', () => {
    const many = Array.from({ length: 51 }, () => '{{ trigger.post.url }}').join(' ');
    expect(codes(validateGraph(slackSaying(many), READY_CONTEXT), 'token.')).toEqual([
      'token.too_many',
    ]);
  });

  it('warns that data from one side of a branch may be empty after the rejoin', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.postPublished'),
        step('cond', 'logic.ifElse', {
          config: {
            condition: {
              match: 'all',
              rules: [
                {
                  id: 'a',
                  left: '{{ trigger.post.channel.provider }}',
                  operator: 'is',
                  right: 'instagram',
                },
              ],
            },
          },
        }),
        step('setA', 'logic.setFields', {
          config: { fields: [{ name: 'note', type: 'text', value: 'A' }] },
        }),
        step('setB', 'logic.setFields', {
          config: { fields: [{ name: 'note', type: 'text', value: 'B' }] },
        }),
        readySlack('slak', {
          config: {
            message: '{{ nodes.setA.output.note }} {{ nodes.setB.output.note | default: "-" }}',
          },
        }),
      ],
      [
        line('trig', 'cond'),
        line('cond', 'setA', 'true'),
        line('cond', 'setB', 'false'),
        line('setA', 'slak'),
        line('setB', 'slak'),
      ],
    );
    const issues = validateGraph(graph, READY_CONTEXT).filter(
      (i) => i.code === 'token.maybe_empty',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      message: 'This data may be empty when the other branch runs.',
      token: '{{ nodes.setA.output.note }}',
    });
  });

  it('accepts any field inside data whose shape is open, like a webhook body', () => {
    const graph = graphOf(
      [
        step('hook', 'trigger.webhook'),
        readySlack('slak', { config: { message: '{{ trigger.body.title }}' } }),
      ],
      [line('hook', 'slak')],
    );
    expect(codes(validateGraph(graph, READY_CONTEXT), 'token.')).toEqual([]);
  });

  it('does not check chips in a step that is turned off', () => {
    const graph = slackSaying(
      'ok',
      [
        step('off', 'notify.inApp', {
          disabled: true,
          config: { title: '{{ nodes.gone.output.x }}' },
        }),
      ],
      [line('set', 'slak'), line('slak', 'off')],
    );
    expect(codes(validateGraph(graph, READY_CONTEXT), 'token.')).toEqual([]);
  });

  it('warns about chips that read a turned-off step, using the new parser', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.postPublished'),
        step('ai', 'ai.generateText', { name: 'Write', disabled: true, config: { prompt: 'x' } }),
        readySlack('slak', {
          config: { message: 'Draft: \\{{ escaped }} {{ nodes.ai.output.text }}' },
        }),
      ],
      [line('trig', 'ai'), line('ai', 'slak')],
    );
    const issue = validateGraph(graph, READY_CONTEXT).find(
      (i) => i.code === 'node.disabled_output_used',
    );
    expect(issue).toMatchObject({
      message: "Write is turned off, so 'Text' will be empty.",
      token: '{{ nodes.ai.output.text }}',
    });
  });
});

function filterWith(rules: ConditionRule[], match: 'all' | 'any' = 'all') {
  return graphOf(
    [
      step('trig', 'trigger.postFailed'),
      step('chk', 'logic.filter', { config: { condition: { match, rules } } }),
      readySlack('slak'),
    ],
    [line('trig', 'chk'), line('chk', 'slak')],
  );
}

const conditionIssues = (rules: ConditionRule[]) =>
  validateGraph(filterWith(rules), READY_CONTEXT).filter((i) => i.code.startsWith('condition.'));

describe('condition checks', () => {
  it('a filter with no rules asks for one', () => {
    expect(conditionIssues([])).toEqual([
      {
        severity: 'error',
        code: 'condition.empty',
        message: 'Add at least one rule.',
        nodeKey: 'chk',
        field: 'condition',
      },
    ]);
  });

  it('a rule needs the data to check and, for most checks, a value', () => {
    expect(
      conditionIssues([
        { id: 'a', left: '', operator: 'is', right: 'x' },
        { id: 'b', left: '{{ trigger.error.reason }}', operator: 'is', right: ' ' },
        { id: 'c', left: '{{ trigger.error.reason }}', operator: 'isEmpty' },
      ]).map((i) => [i.field, i.message]),
    ).toEqual([
      ['condition.rules.0.left', 'Choose the data to check.'],
      ['condition.rules.1.right', 'Enter a value to compare with.'],
    ]);
  });

  it('"within the last N days" needs a whole number', () => {
    expect(
      conditionIssues([
        { id: 'a', left: '{{ trigger.publishedAt }}', operator: 'withinLastDays', right: 'a week' },
      ]).map((i) => i.message),
    ).toEqual(['Enter a whole number.']);
  });

  it('warns when a number is compared with text', () => {
    const issues = conditionIssues([
      { id: 'a', left: '{{ trigger.error.attempts }}', operator: 'greaterThan', right: 'many' },
      { id: 'b', left: '{{ trigger.error.reason }}', operator: 'greaterThan', right: '3' },
      { id: 'c', left: '{{ trigger.error.attempts }}', operator: 'startsWith', right: '3' },
    ]);
    expect(issues.map((i) => [i.severity, i.code, i.message, i.field])).toEqual([
      [
        'warning',
        'condition.type_mismatch',
        'This compares a number with text.',
        'condition.rules.0.right',
      ],
      [
        'warning',
        'condition.type_mismatch',
        'This compares a number with text.',
        'condition.rules.1.operator',
      ],
      [
        'warning',
        'condition.type_mismatch',
        'This compares a number with text.',
        'condition.rules.2.operator',
      ],
    ]);
  });

  it('warns when a date check gets something that is not a date', () => {
    const issues = conditionIssues([
      { id: 'a', left: '{{ trigger.post.publishAt }}', operator: 'before', right: 'soon' },
      { id: 'b', left: '{{ trigger.error.attempts }}', operator: 'after', right: '2026-11-03' },
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      'Enter a date like 2026-11-03.',
      'This check does not fit this kind of data.',
    ]);
  });

  it('accepts complete rules that compare like with like', () => {
    expect(
      conditionIssues([
        {
          id: 'a',
          left: '{{ trigger.error.reason }}',
          operator: 'isNot',
          right: 'retries_exhausted',
        },
        { id: 'b', left: '{{ trigger.error.attempts }}', operator: 'atLeast', right: '2' },
        { id: 'c', left: '{{ trigger.tags }}', operator: 'hasMoreThan', right: '1' },
        {
          id: 'd',
          left: '{{ trigger.post.publishAt }}',
          operator: 'after',
          right: '{{ trigger.publishedAt }}',
        },
      ]),
    ).toEqual([]);
  });

  it('checks every case of a Paths step', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.postPublished'),
        step('route', 'logic.switch', {
          config: {
            cases: [
              { id: 'a', name: 'Instagram', condition: { match: 'all', rules: [] } },
              {
                id: 'b',
                name: 'Other',
                condition: {
                  match: 'all',
                  rules: [{ id: 'r', left: '', operator: 'is', right: 'x' }],
                },
              },
            ],
          },
        }),
      ],
      [line('trig', 'route')],
    );
    expect(
      validateGraph(graph, READY_CONTEXT)
        .filter((i) => i.code.startsWith('condition.'))
        .map((i) => [i.code, i.field]),
    ).toEqual([
      ['condition.empty', 'cases.0.condition'],
      ['condition.missing_value', 'cases.1.condition.rules.0.left'],
    ]);
  });
});

describe('the AI schedule limit', () => {
  const scheduled = (everyHours: number, ai = true, disabled = false) =>
    graphOf(
      [
        step('tick', 'trigger.schedule', { config: { frequency: 'hourly', everyHours } }),
        ai
          ? step('write', 'ai.generateText', { disabled, config: { prompt: 'Hello' } })
          : step('write', 'notify.inApp', { config: { title: 'Hi' } }),
      ],
      [line('tick', 'write')],
    );

  it('lets an hourly schedule run AI steps (once an hour is the limit)', () => {
    expect(codes(validateGraph(scheduled(1)), 'schedule.')).toEqual([]);
  });

  it('stops a schedule faster than the limit from running AI steps', () => {
    const issues = validateGraph(scheduled(1), {}, [aiScheduleLimit(120)]);
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'schedule.too_frequent_for_ai',
        message: 'Workflows with AI steps can run at most once every 2 hours.',
        nodeKey: 'tick',
        field: 'everyHours',
      },
    ]);
  });

  it('does not limit schedules without AI steps, or with AI steps turned off', () => {
    expect(validateGraph(scheduled(1, false), {}, [aiScheduleLimit(120)])).toEqual([]);
    expect(validateGraph(scheduled(1, true, true), {}, [aiScheduleLimit(120)])).toEqual([]);
  });

  it('words a limit that is not whole hours in minutes', () => {
    const issues = validateGraph(scheduled(1), {}, [aiScheduleLimit(61)]);
    expect(issues[0].message).toBe(
      'Workflows with AI steps can run at most once every 61 minutes.',
    );
    expect(validateGraph(scheduled(1), {}, [aiScheduleLimit(60)])).toEqual([]);
  });
});
