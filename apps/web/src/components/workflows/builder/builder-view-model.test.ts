import { getTemplate, instantiateTemplate, validateGraph } from '@postgear/automation';
import type { Connection } from '@/types/workflows';
import {
  builderSearch,
  initialTab,
  issuesChip,
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

  it('words the issues chip, errors and warnings apart', () => {
    expect(issuesChip([])).toEqual({
      label: 'No issues found',
      errors: 0,
      warnings: 0,
      errorLabel: null,
      warningLabel: null,
    });
    const warning = { severity: 'warning', code: 'token.maybe_empty', message: 'x' } as const;
    const error = { severity: 'error', code: 'graph.no_trigger', message: 'y' } as const;
    expect(issuesChip([warning])).toMatchObject({
      label: '1 Warning',
      errors: 0,
      warnings: 1,
      errorLabel: null,
    });
    expect(issuesChip([error, error, warning])).toMatchObject({
      label: '2 Issues, 1 Warning',
      errorLabel: '2 Issues',
      warningLabel: '1 Warning',
    });
  });

  it('keeps the issue behind each Finish Setup line, for focus-the-field', () => {
    const graph = report();
    const issues = validateGraph(graph, validationContext([], []));
    const slackItem = setupItems(graph, issues).find((item) => item.nodeKey === 'slack');
    expect(slackItem?.issue.field).toBe('connectionId');
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
