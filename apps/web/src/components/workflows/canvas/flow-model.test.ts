import { EMPTY_SELECTION } from '../builder/builder-state';
import { graphOf, line, runOf, step, stepRow } from './canvas-test-kit';
import { edgeRunState, stepAriaLabel, toFlowEdges, toFlowNodes } from './flow-model';

// A trigger, an If / Else with Yes on a, No on b, and c after a.
const graph = graphOf(
  [
    step('t', 'trigger.manual', { name: 'Start' }),
    step('check', 'logic.ifElse', { name: 'Check' }),
    step('a', 'notify.slack', { name: 'Slack' }),
    step('b', 'notify.inApp', { name: 'In App' }),
    step('c', 'logic.setFields', { name: 'Set Fields' }),
  ],
  [line('t', 'check'), line('check', 'a', 'true'), line('check', 'b', 'false'), line('a', 'c')],
);

const run = runOf(graph, [
  stepRow('t', 'SUCCEEDED', { durationMs: 12 }),
  stepRow('check', 'SUCCEEDED', { ports: ['true'], durationMs: 3 }),
  stepRow('a', 'SUCCEEDED', { durationMs: 1200, attempts: 2, attempt: 2 }),
  stepRow('b', 'SKIPPED'),
  stepRow('c', 'RUNNING'),
]);

const options = {
  selection: EMPTY_SELECTION,
  issues: new Map(),
  summary: {},
  drag: null,
};

describe('toFlowNodes with a run', () => {
  it('puts each step its paint, and none without a run', () => {
    const painted = toFlowNodes(graph, { ...options, paint: run.paint });
    const slack = painted.find((node) => node.id === 'a');
    expect(slack?.type === 'step' && slack.data.paint?.state).toBe('succeeded');

    const plain = toFlowNodes(graph, options);
    for (const node of plain) if (node.type === 'step') expect(node.data.paint).toBeUndefined();
  });

  it('reads the state to a screen reader', () => {
    const painted = toFlowNodes(graph, { ...options, paint: run.paint });
    expect(painted.find((node) => node.id === 'a')?.ariaLabel).toBe(
      'Slack step, Succeeded after 2 attempts',
    );
  });
});

describe('toFlowEdges with a run', () => {
  it('takes, skips and flows lines from the model', () => {
    const edges = toFlowEdges(graph, EMPTY_SELECTION, run);
    const byId = Object.fromEntries(edges.map((edge) => [edge.id, edge]));
    expect(byId['t:out->check'].data?.run).toBe('taken');
    expect(byId['check:true->a'].data?.run).toBe('taken');
    expect(byId['check:false->b'].data?.run).toBe('skipped');
    // Into the running step: React Flow's animated dashes.
    expect(byId['a:out->c'].data?.run).toBe('active');
    expect(byId['a:out->c'].animated).toBe(true);
    expect(byId['t:out->check'].animated).toBe(false);
  });

  it('draws plain lines without a run', () => {
    for (const edge of toFlowEdges(graph, EMPTY_SELECTION)) {
      expect(edge.data?.run).toBeUndefined();
      expect(edge.animated).toBe(false);
    }
    expect(edgeRunState(null, 't:out->check')).toBeUndefined();
  });
});

describe('stepAriaLabel', () => {
  it('adds the error sentence to a failed step', () => {
    expect(
      stepAriaLabel({
        node: step('a', 'notify.slack', { name: 'Slack' }),
        issues: [],
        isTrigger: false,
        paint: {
          state: 'failed',
          attempt: 1,
          attempts: 1,
          durationMs: 40,
          startedAt: null,
          dryRun: false,
          error: 'the link was not accepted',
        },
      }),
    ).toBe('Slack step, Failed: the link was not accepted');
  });
});
