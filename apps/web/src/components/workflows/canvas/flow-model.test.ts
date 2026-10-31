import { EMPTY_SELECTION } from '../builder/builder-state';
import { graphOf, line, runOf, step, stepRow } from './canvas-test-kit';
import {
  type CanvasNode,
  EDITOR_ARIA_LABELS,
  edgeRunState,
  reuseUnchanged,
  stepAriaLabel,
  toFlowEdges,
  toFlowNodes,
} from './flow-model';

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

describe('reuseUnchanged', () => {
  const issue = (message: string) => ({
    severity: 'error' as const,
    code: 'node.required_missing' as const,
    message,
    nodeKey: 'a',
  });

  it('keeps the object of every card that did not change', () => {
    const before = toFlowNodes(graph, {
      ...options,
      issues: new Map([['a', [issue('Add a message.')]]]),
    });
    // Fresh objects all round, as after a validation pass with the same result.
    const after = toFlowNodes(graph, {
      ...options,
      issues: new Map([['a', [issue('Add a message.')]]]),
    });
    const kept = reuseUnchanged(before, after);
    for (let i = 0; i < kept.length; i += 1) expect(kept[i]).toBe(before[i]);
  });

  it('hands over a new object only for the card that changed', () => {
    const before = toFlowNodes(graph, options);
    const edited = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === 'a' ? { ...node, config: { ...node.config, message: 'Hi' } } : node,
      ),
    };
    const kept = reuseUnchanged(before, toFlowNodes(edited, options));
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i].id === 'a') expect(kept[i]).not.toBe(before[i]);
      else expect(kept[i]).toBe(before[i]);
    }
  });

  it('repaints a card whose issues, selection or position changed', () => {
    const before = toFlowNodes(graph, options);
    const byId = (nodes: CanvasNode[], id: string) => nodes.find((node) => node.id === id);
    const withIssue = reuseUnchanged(
      before,
      toFlowNodes(graph, { ...options, issues: new Map([['a', [issue('Add a message.')]]]) }),
    );
    expect(byId(withIssue, 'a')).not.toBe(byId(before, 'a'));
    const selected = reuseUnchanged(
      before,
      toFlowNodes(graph, { ...options, selection: { ...EMPTY_SELECTION, nodes: ['b'] } }),
    );
    expect(byId(selected, 'b')).not.toBe(byId(before, 'b'));
    expect(byId(selected, 'a')).toBe(byId(before, 'a'));
    const dragged = reuseUnchanged(
      before,
      toFlowNodes(graph, { ...options, drag: { c: { x: 500, y: 500 } } }),
    );
    expect(byId(dragged, 'c')).not.toBe(byId(before, 'c'));
  });
});

describe('what a screen reader hears from React Flow', () => {
  it('names cards steps and lines lines, with the step names, never "node" or "edge"', () => {
    const steps = toFlowNodes(graph, options);
    expect(steps.find((node) => node.id === 'a')?.domAttributes).toEqual({
      'aria-roledescription': 'step',
    });
    const line = toFlowEdges(graph, EMPTY_SELECTION).find((edge) =>
      edge.id.startsWith('check:true'),
    );
    expect(line?.ariaLabel).toBe('Line from Check to Slack');
    expect(line?.domAttributes).toEqual({ 'aria-roledescription': 'line' });
    for (const words of Object.values(EDITOR_ARIA_LABELS)) {
      if (typeof words === 'string') expect(words).not.toMatch(/\b(node|edge)s?\b/i);
    }
  });
});
