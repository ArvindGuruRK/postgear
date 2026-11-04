import {
  getDefinition,
  getTemplate,
  instantiateTemplate,
  type ValidationIssue,
  validateGraph,
} from '@postgear/automation';
import type { Connection } from '@/types/workflows';
import {
  builderSearch,
  initialTab,
  issueKey,
  issueLines,
  refusedTestText,
  type SetupItem,
  setupGroups,
  setupItems,
  structureKey,
  validationContext,
} from './builder-view-model';

function report() {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

const slack: Connection = {
  id: 'c1',
  provider: 'slack',
  name: 'Marketing Slack',
  status: 'CONNECTED',
  maskedHint: 'hooks.slack.com/...1234',
  meta: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  usedBy: [],
};

describe('issueLines', () => {
  const owner = getDefinition('notify.slack');
  it('names the field, says each problem once, and keeps what has no field', () => {
    const issue = (message: string, field?: string): ValidationIssue => ({
      severity: 'error',
      code: 'node.required_missing',
      message,
      nodeKey: 'a',
      ...(field ? { field } : {}),
    });
    expect(
      issueLines(owner, [
        issue('Fill in this field.', 'message'),
        issue('Fill in this field.', 'message'),
        issue('Slack cannot run yet.'),
      ]),
    ).toEqual(['Message: Fill in this field.', 'Slack cannot run yet.']);
  });
});

describe('builder view model', () => {
  it('lists what a fresh Publishing Report still needs, one line per step', () => {
    const graph = report();
    const issues = validateGraph(graph, validationContext([], []));
    const items = setupItems(graph, issues);
    expect(items.map((item) => item.nodeKey)).toEqual(expect.arrayContaining(['sheet', 'slack']));
    expect(new Set(items.map((item) => item.nodeKey)).size).toBe(items.length);
    expect(items.every((item) => item.message.length > 0)).toBe(true);
  });

  it('ticks a step off once it has a working connection', () => {
    const graph = report();
    const linked = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === 'slack' ? { ...node, config: { ...node.config, connectionId: 'c1' } } : node,
      ),
    };
    const before = setupItems(graph, validateGraph(graph, validationContext([slack], [])));
    const after = setupItems(linked, validateGraph(linked, validationContext([slack], [])));
    expect(before.some((item) => item.nodeKey === 'slack')).toBe(true);
    expect(after.some((item) => item.nodeKey === 'slack')).toBe(false);
  });

  it('keeps the issue behind each Finish Setup line, for focus-the-field', () => {
    const graph = report();
    const issues = validateGraph(graph, validationContext([], []));
    const slackItem = setupItems(graph, issues).find((item) => item.nodeKey === 'slack');
    expect(slackItem?.issue.field).toBe('connectionId');
  });
});

describe('the Setup dock', () => {
  const error = (nodeKey: string, code: ValidationIssue['code'], field: string): ValidationIssue => ({
    severity: 'error',
    code,
    message: `${nodeKey} ${field}`,
    nodeKey,
    field,
  });

  it('keeps every error of a step, puts the steps that need something first', () => {
    const graph = report();
    const groups = setupGroups(graph, [
      error('slack', 'node.connection_missing', 'connectionId'),
      error('slack', 'token.unknown_node', 'message'),
    ]);
    expect(groups.steps[0].node.key).toBe('slack');
    expect(groups.steps[0].done).toBe(false);
    expect(groups.steps[0].errors).toHaveLength(2);
    expect(groups.steps.slice(1).every((row) => row.done)).toBe(true);
  });

  it('keeps warnings and what belongs to no step, and drops what merely cannot run yet', () => {
    const graph = report();
    const warning = { severity: 'warning', code: 'token.maybe_empty', message: 'x' } as const;
    const noTrigger = { severity: 'error', code: 'graph.no_trigger', message: 'y' } as const;
    const groups = setupGroups(graph, [
      warning,
      noTrigger,
      error('slack', 'node.not_runnable', 'type'),
    ]);
    expect(groups.warnings).toEqual([warning]);
    expect(groups.workflow).toEqual([noTrigger]);
    expect(groups.steps.find((row) => row.node.key === 'slack')?.errors ?? []).toEqual([]);
  });

  it('tells two issues on one step apart', () => {
    expect(issueKey(error('a', 'node.not_runnable', 'one'))).not.toBe(
      issueKey(error('a', 'node.not_runnable', 'two')),
    );
  });
});

describe('a refused test', () => {
  const item = (stepName: string) => ({ stepName, message: 'Choose one.' }) as SetupItem;

  it('says what the one step needs', () => {
    expect(refusedTestText([item('Slack')], 'From the API.')).toBe('Slack: Choose one.');
  });

  it('names up to three steps and counts the rest', () => {
    expect(refusedTestText([item('A'), item('B')], 'x')).toBe(
      '2 steps need attention: A, B.',
    );
    expect(refusedTestText(['A', 'B', 'C', 'D', 'E'].map(item), 'x')).toBe(
      '5 steps need attention: A, B, C and 2 more.',
    );
  });

  it('falls back to the API sentence when the browser found nothing', () => {
    expect(refusedTestText([], 'From the API.')).toBe('From the API.');
  });
});

describe('builder tabs and the painted run', () => {
  it('opens the Runs tab for ?tab=runs or a ?run= link alone', () => {
    expect(initialTab('runs', null)).toBe('runs');
    expect(initialTab(undefined, 'run-1')).toBe('runs');
    expect(initialTab(undefined, undefined)).toBe('editor');
    expect(initialTab('editor', '')).toBe('editor');
  });

  it('writes its own params and keeps the others', () => {
    expect(
      builderSearch('?step=slack&tab=runs&run=r1&review=1', {
        tab: 'editor',
        runId: 'r1',
        review: true,
      }),
    ).toBe('?step=slack');
    expect(builderSearch('', { tab: 'runs', runId: 'r2', review: true })).toBe(
      '?tab=runs&run=r2&review=1',
    );
    expect(builderSearch('?setup=1', { tab: 'runs', runId: null, review: true })).toBe(
      '?setup=1&tab=runs',
    );
  });

  it('changes its structure key on a new step or line, not on a move or an edit', () => {
    const graph = report();
    const key = structureKey(graph);
    const moved = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, position: { x: node.position.x + 48, y: 0 } })),
    };
    const edited = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, config: { ...node.config, extra: 1 } })),
    };
    expect(structureKey(moved)).toBe(key);
    expect(structureKey(edited)).toBe(key);
    expect(structureKey({ ...graph, edges: graph.edges.slice(1) })).not.toBe(key);
    expect(structureKey({ ...graph, nodes: graph.nodes.slice(1) })).not.toBe(key);
  });
});
