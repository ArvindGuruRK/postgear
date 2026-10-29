import { getTemplate, instantiateTemplate, validateGraph } from '@postgear/automation';
import type { Connection } from '@/types/workflows';
import { issuesChip, setupItems, validationContext } from './builder-view-model';

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
