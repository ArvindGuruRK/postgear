/**
 * The shipped executors, run through `executeNodeActivity` on the memory
 * store with real `@postgear/automation` conditions, so each test covers the
 * resolve, write and port rules as well as the executor.
 */
import { EXECUTABLE_TYPES, NODE_CATALOG } from '@postgear/automation';
import { graphOf, harness, line, rules, step } from '../testing';
import { EXECUTORS } from '.';
import { coerceField, FILTER_STOPPED_MESSAGE, portsTaken } from './logic';

describe('the executor registry', () => {
  it('plus the steps the workflow handles equals EXECUTABLE_TYPES exactly', () => {
    const blocking = NODE_CATALOG.filter((definition) => definition.blocking).map((d) => d.type);
    const runnable = [...EXECUTORS.keys(), ...blocking].sort();
    expect(runnable).toEqual([...EXECUTABLE_TYPES].sort());
    expect(new Set(runnable).size).toBe(runnable.length);
  });
});

describe('triggers', () => {
  it('hand the trigger data on as the step output (Manual: its inputs)', async () => {
    const h = harness(graphOf([step('trig1', 'trigger.manual')]), {
      triggerPayload: { inputs: { topic: 'Sourdough' } },
    });

    const result = await h.activities.executeNodeActivity(h.stepRef('trig1'));

    expect(result).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
    const row = h.store.latest('run_1', 'trig1');
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.output).toEqual({ inputs: { topic: 'Sourdough' } });
  });

  it('use the seeded trigger output in a step test', async () => {
    const h = harness(graphOf([step('trig1', 'trigger.postPublished')]), {
      triggerPayload: { post: { id: 'from-payload' } },
      seedOutputs: { trig1: { post: { id: 'seeded' } } },
      options: {
        scope: { kind: 'step', nodeKey: 'trig1' },
        sendForReal: [],
        triggerData: 'pinned',
      },
    });

    await h.activities.executeNodeActivity(h.stepRef('trig1'));

    expect(h.store.latest('run_1', 'trig1')?.output).toEqual({ post: { id: 'seeded' } });
  });
});

describe('If / Else', () => {
  const graph = (right: string) =>
    graphOf(
      [
        step('trig1', 'trigger.manual'),
        step('check', 'logic.ifElse', {
          config: {
            condition: rules({
              left: '{{ trigger.inputs.likes }}',
              operator: 'greaterThan',
              right,
            }),
          },
        }),
      ],
      [line('trig1', 'check')],
    );

  it('goes True when the rules match, with the rule details in its output', async () => {
    const h = harness(graph('10'), { triggerPayload: { inputs: { likes: 25 } } });
    h.store.steps.push({
      ...stepRowFor('trig1', 'trigger.manual'),
      output: { inputs: { likes: 25 } },
    });

    const result = await h.activities.executeNodeActivity(h.stepRef('check'));

    expect(result.ports).toEqual(['true']);
    const output = h.store.latest('run_1', 'check')?.output as {
      result: boolean;
      details: { left: unknown; result: boolean }[];
    };
    expect(output.result).toBe(true);
    expect(output.details[0]).toMatchObject({ left: 25, result: true });
  });

  it('goes False when they do not', async () => {
    const h = harness(graph('100'), { triggerPayload: { inputs: { likes: 25 } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('check'));

    expect(result).toMatchObject({ status: 'succeeded', ports: ['false'] });
  });
});

describe('Paths', () => {
  const graph = graphOf(
    [
      step('trig1', 'trigger.manual'),
      step('route', 'logic.switch', {
        config: {
          cases: [
            {
              id: 'ig',
              name: 'Instagram',
              condition: rules({
                left: '{{ trigger.inputs.where }}',
                operator: 'is',
                right: 'instagram',
              }),
            },
            {
              id: 'li',
              name: 'LinkedIn',
              condition: rules({
                left: '{{ trigger.inputs.where }}',
                operator: 'contains',
                right: 'linked',
              }),
            },
          ],
        },
      }),
    ],
    [line('trig1', 'route')],
  );

  it('takes the first case that matches', async () => {
    const h = harness(graph, { triggerPayload: { inputs: { where: 'LinkedIn' } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('route'));

    expect(result.ports).toEqual(['case:li']);
    expect(h.store.latest('run_1', 'route')?.output).toMatchObject({
      path: 'LinkedIn',
      caseId: 'li',
    });
  });

  it('falls to Otherwise when none match', async () => {
    const h = harness(graph, { triggerPayload: { inputs: { where: 'TikTok' } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('route'));

    expect(result.ports).toEqual(['fallback']);
    expect(h.store.latest('run_1', 'route')?.output).toMatchObject({
      path: 'Otherwise',
      caseId: null,
    });
  });
});

describe('Filter', () => {
  const graph = graphOf(
    [
      step('trig1', 'trigger.manual'),
      step('only', 'logic.filter', {
        config: {
          condition: rules({
            left: '{{ trigger.inputs.text }}',
            operator: 'contains',
            right: 'launch',
          }),
        },
      }),
    ],
    [line('trig1', 'only')],
  );

  it('lets the run through when the rules match', async () => {
    const h = harness(graph, { triggerPayload: { inputs: { text: 'Big launch today' } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('only'));

    expect(result).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
  });

  it('ends the branch without failing when they do not', async () => {
    const h = harness(graph, { triggerPayload: { inputs: { text: 'Just a croissant' } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('only'));

    expect(result).toEqual({ status: 'succeeded', ports: [], attempt: 1 });
    const row = h.store.latest('run_1', 'only');
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.output).toMatchObject({ passed: false, message: FILTER_STOPPED_MESSAGE });
  });
});

describe('Set Fields', () => {
  it('resolves each field and gives it its type', async () => {
    const h = harness(
      graphOf(
        [
          step('trig1', 'trigger.manual'),
          step('shape', 'logic.setFields', {
            config: {
              fields: [
                { name: 'headline', type: 'text', value: 'New: {{ trigger.inputs.topic }}' },
                { name: 'likes', type: 'number', value: '{{ trigger.inputs.likes }}' },
                { name: 'boost', type: 'boolean', value: 'yes' },
                { name: 'tags', type: 'list', value: 'bread, bakery ,' },
              ],
            },
          }),
        ],
        [line('trig1', 'shape')],
      ),
      { triggerPayload: { inputs: { topic: 'Sourdough', likes: '42' } } },
    );

    await h.activities.executeNodeActivity(h.stepRef('shape'));

    expect(h.store.latest('run_1', 'shape')?.output).toEqual({
      headline: 'New: Sourdough',
      likes: 42,
      boost: true,
      tags: ['bread', 'bakery'],
    });
  });

  it('coerces and refuses values plainly', () => {
    expect(coerceField('n', 'number', '')).toBeNull();
    expect(coerceField('ok', 'boolean', 'No')).toBe(false);
    expect(coerceField('l', 'list', '["a", 2]')).toEqual(['a', 2]);
    expect(coerceField('l', 'list', 7)).toEqual([7]);
    expect(coerceField('t', 'text', ['a', 'b'])).toBe('a, b');
    expect(() => coerceField('likes', 'number', 'lots')).toThrow(
      `'likes' should be a number, but it was "lots".`,
    );
    expect(() => coerceField('flag', 'boolean', 'maybe')).toThrow(/should be yes or no/);
  });
});

describe('Merge', () => {
  it('keys the outputs of the branches that ran by step name, and only those', async () => {
    const graph = graphOf(
      [
        step('trig1', 'trigger.manual'),
        step('check', 'logic.ifElse', {
          config: { condition: rules({ left: 'a', operator: 'is', right: 'a' }) },
        }),
        step('yesSide', 'logic.setFields', { name: 'Yes Side' }),
        step('noSide', 'logic.setFields', { name: 'No Side' }),
        step('gate', 'logic.filter', { name: 'Gate' }),
        step('join', 'logic.merge', { name: 'Join' }),
      ],
      [
        line('trig1', 'check'),
        line('check', 'yesSide', 'true'),
        line('check', 'noSide', 'false'),
        line('trig1', 'gate'),
        line('yesSide', 'join'),
        line('noSide', 'join'),
        line('gate', 'join'),
      ],
    );
    const h = harness(graph);
    h.store.steps.push(
      { ...stepRowFor('yesSide', 'logic.setFields'), output: { headline: 'Hi' } },
      // A Filter that stopped ran, but its line into the Merge carried nothing.
      { ...stepRowFor('gate', 'logic.filter'), output: { passed: false } },
    );

    await h.activities.executeNodeActivity(h.stepRef('join'));

    expect(h.store.latest('run_1', 'join')?.output).toEqual({ 'Yes Side': { headline: 'Hi' } });
  });

  it('reads the ports a step left through back from its result', () => {
    const ifElse = step('c', 'logic.ifElse');
    expect(portsTaken(ifElse, { status: 'SUCCEEDED', output: { result: false } })).toEqual([
      'false',
    ]);
    expect(
      portsTaken(step('p', 'logic.switch'), { status: 'SUCCEEDED', output: { caseId: 'a' } }),
    ).toEqual(['case:a']);
    expect(
      portsTaken(step('s', 'notify.slack', { onError: { mode: 'branch' } }), {
        status: 'HANDLED_ERROR',
        output: {},
      }),
    ).toEqual(['error']);
  });
});

describe('In-App Notification', () => {
  const graph = graphOf(
    [
      step('trig1', 'trigger.manual'),
      step('bell', 'notify.inApp', {
        config: { title: 'Ready: {{ trigger.inputs.topic }}', message: 'Have a look.' },
      }),
    ],
    [line('trig1', 'bell')],
  );

  it('writes one notification for the workspace, emailed by the outbox, marked (Test) in a test', async () => {
    const h = harness(graph, { triggerPayload: { inputs: { topic: 'Sourdough' } } });

    const result = await h.activities.executeNodeActivity(h.stepRef('bell'));

    expect(result.status).toBe('succeeded');
    expect(h.store.notifications).toHaveLength(1);
    expect(h.store.notifications[0]).toMatchObject({
      organizationId: 'org_test',
      type: 'automation',
      title: 'Ready: Sourdough (Test)',
      content: 'Have a look.',
      link: '/org_test/workflows/auto_1?tab=runs&run=run_1',
      emailStatus: 'PENDING',
    });
    expect(h.store.latest('run_1', 'bell')?.output).toMatchObject({ sent: true });
  });

  it('has no "(Test)" in a live run, and is not written twice when called again', async () => {
    const h = harness(graph, { mode: 'LIVE', triggerPayload: { inputs: { topic: 'Rye' } } });

    await h.activities.executeNodeActivity(h.stepRef('bell'));
    h.attempt.value = 2;
    const again = await h.activities.executeNodeActivity(h.stepRef('bell'));

    expect(again).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
    expect(h.store.notifications).toHaveLength(1);
    expect(h.store.notifications[0].title).toBe('Ready: Rye');
  });
});

function stepRowFor(nodeKey: string, nodeType: string) {
  return {
    runId: 'run_1',
    nodeKey,
    nodeType,
    nodeName: nodeKey,
    status: 'SUCCEEDED' as const,
    attempt: 1,
    input: null,
    output: null,
    truncated: false,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    ports: [] as string[],
  };
}
