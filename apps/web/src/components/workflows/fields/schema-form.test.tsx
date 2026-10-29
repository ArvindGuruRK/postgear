import {
  type AutomationGraph,
  type FormTab,
  type GraphNode,
  getDefinition,
  getTemplate,
  instantiateTemplate,
  type NodeDefinition,
  sampleScope,
  scheduleConfigSchema,
  type ValidationIssue,
} from '@postgear/automation';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { FieldContext } from './contract';
import { insertDataAtLastField } from './insert-target';
import { SchemaForm } from './schema-form';
import { stubBrowserLayout } from './test-dom';

beforeAll(stubBrowserLayout);

jest.mock('@/lib/api', () => ({
  api: jest.fn(() => Promise.resolve({ tags: [{ id: 'tag1', name: 'Launch', color: 'violet' }] })),
}));

let n = 0;
const base = instantiateTemplate(
  getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>,
  () => `k${(n++).toString().padStart(9, '0')}`,
) as AutomationGraph;

/** The template's graph with one more step of `type` right after the trigger. */
function withStep(type: string, config?: Record<string, unknown>) {
  const definition = getDefinition(type) as NodeDefinition;
  const node: GraphNode = {
    key: 'ktest00001',
    type,
    typeVersion: definition.typeVersion,
    name: definition.title,
    position: { x: 0, y: 400 },
    config:
      config ?? (JSON.parse(JSON.stringify(definition.defaultConfig)) as Record<string, unknown>),
  };
  const first = base.edges[0];
  const graph: AutomationGraph = {
    ...base,
    nodes: [...base.nodes, node],
    edges: [...base.edges, { ...first, id: 'e-test', target: node.key }],
  };
  return { definition, node, graph };
}

function context(graph: AutomationGraph): FieldContext {
  return {
    orgId: 'org1',
    automationId: 'auto1',
    connections: [],
    channels: [],
    canManage: true,
    scope: sampleScope(graph),
    scopeSource: {},
    timeZone: 'Asia/Kolkata',
  };
}

/** Renders a step's tab and keeps its config as edits arrive, like the panel does. */
function renderForm(
  type: string,
  options: { config?: Record<string, unknown>; tab?: FormTab; issues?: ValidationIssue[] } = {},
) {
  const step = withStep(type, options.config);
  const onChange = jest.fn();
  function Host() {
    const [config, setConfig] = useState(step.node.config);
    const node = { ...step.node, config };
    return (
      <SchemaForm
        definition={step.definition}
        node={node}
        graph={{
          ...step.graph,
          nodes: step.graph.nodes.map((entry) => (entry.key === node.key ? node : entry)),
        }}
        tab={options.tab ?? 'configure'}
        issues={options.issues ?? []}
        context={context(step.graph)}
        onChange={(path, value) => {
          onChange(path, value);
          setConfig((current) =>
            path === '' ? (value as Record<string, unknown>) : { ...current, [path]: value },
          );
        }}
      />
    );
  }
  const view = render(<Host />);
  return { ...view, onChange, step };
}

const field = (container: HTMLElement, path: string) =>
  container.querySelector<HTMLElement>(`[data-field-path="${path}"]`);

describe('SchemaForm', () => {
  it('marks every field with its config path', () => {
    const { container } = renderForm('notify.slack');
    for (const path of ['message', 'includeLink', 'footer'])
      expect(field(container, path)).not.toBeNull();
    expect(field(container, 'connectionId')).toBeNull();
    const setup = renderForm('notify.slack', { tab: 'setup' });
    expect(field(setup.container, 'connectionId')).not.toBeNull();
  });

  it('writes chips to the field path the step stores them at', async () => {
    const { container, onChange } = renderForm('notify.slack');
    const box = await within(field(container, 'message') as HTMLElement).findByRole('textbox');
    act(() => box.focus());
    act(() => {
      expect(insertDataAtLastField('trigger.post.url')).toBe(true);
    });
    expect(onChange).toHaveBeenLastCalledWith('message', '{{ trigger.post.url }}');
  });

  it('writes a toggle and a number at their paths', () => {
    const slack = renderForm('notify.slack');
    fireEvent.click(screen.getByRole('switch', { name: 'Say which workflow sent it' }));
    expect(slack.onChange).toHaveBeenLastCalledWith('footer', false);
    slack.unmount();

    const delay = renderForm('logic.delay');
    fireEvent.change(screen.getByLabelText('Wait for'), { target: { value: '5' } });
    expect(delay.onChange).toHaveBeenLastCalledWith('amount', 5);
  });

  it('shows a field only while its condition holds', () => {
    const forWhile = renderForm('logic.delay');
    expect(field(forWhile.container, 'amount')).not.toBeNull();
    expect(field(forWhile.container, 'until')).toBeNull();
    forWhile.unmount();
    const until = renderForm('logic.delay', {
      config: { mode: 'until', amount: 1, unit: 'hours', until: '' },
    });
    expect(field(until.container, 'amount')).toBeNull();
    expect(field(until.container, 'until')).not.toBeNull();
  });

  it('writes a whole schedule at the empty path, in a shape the package accepts', () => {
    const { onChange } = renderForm('trigger.schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Every Day' }));
    const [path, value] = onChange.mock.lastCall ?? [];
    expect(path).toBe('');
    expect(value).toEqual({ frequency: 'daily', time: '09:00', timeZone: 'UTC' });
    expect(scheduleConfigSchema.safeParse(value).success).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Every Week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    expect(onChange.mock.lastCall?.[1]).toEqual({
      frequency: 'weekly',
      time: '09:00',
      days: ['mon', 'fri'],
      timeZone: 'UTC',
    });
    expect(screen.getByText('Next Runs')).not.toBeNull();
  });

  it('writes rules, rows and inputs at their list paths', () => {
    const filter = renderForm('logic.filter');
    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));
    expect(filter.onChange).toHaveBeenLastCalledWith('condition', {
      match: 'all',
      rules: [{ id: 'r1', left: '', operator: 'is', right: '' }],
    });
    expect(field(filter.container, 'condition.rules.0.left')).not.toBeNull();
    expect(screen.getByText('Only continue if Something is ...')).not.toBeNull();
    filter.unmount();

    const fields = renderForm('logic.setFields');
    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));
    expect(fields.onChange).toHaveBeenLastCalledWith('fields', [
      { name: '', value: '', type: 'text' },
    ]);
    expect(field(fields.container, 'fields.0.name')).not.toBeNull();
    fields.unmount();

    const manual = renderForm('trigger.manual');
    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    expect(manual.onChange).toHaveBeenLastCalledWith('fields', [
      { key: 'field1', label: 'Field 1', type: 'text' },
    ]);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Post topic' } });
    expect(manual.onChange).toHaveBeenLastCalledWith('fields', [
      { key: 'postTopic', label: 'Post topic', type: 'text' },
    ]);
  });

  it('adds a path with a fresh id and keeps Otherwise last', () => {
    const paths = renderForm('logic.switch');
    fireEvent.click(screen.getByRole('button', { name: 'Add Path' }));
    const cases = paths.onChange.mock.lastCall?.[1] as { id: string; name: string }[];
    expect(paths.onChange.mock.lastCall?.[0]).toBe('cases');
    expect(cases.map((entry) => entry.name)).toEqual(['Path A', 'Path B', 'Path C']);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(3);
    expect(screen.getByText('Otherwise')).not.toBeNull();
  });

  it('shows issues inline under their field', () => {
    renderForm('notify.slack', {
      issues: [
        {
          severity: 'error',
          code: 'node.required_missing',
          message: 'Write a message.',
          nodeKey: 'ktest00001',
          field: 'message',
        },
      ],
    });
    expect(screen.getByText('Write a message.')).not.toBeNull();
  });

  it('ends Configure with the AI credits a run uses and the form notes', () => {
    const ai = renderForm('ai.generateText');
    expect(screen.getByText(/^Uses about \d+ AI credits? per run\.$/)).not.toBeNull();
    ai.unmount();
    renderForm('logic.manualReview');
    expect(
      screen.getByText('A review waits up to 7 days, then the run ends as expired.'),
    ).not.toBeNull();
  });

  it('never shows the words the product keeps out of the panel', () => {
    for (const type of [
      'trigger.schedule',
      'logic.ifElse',
      'logic.setFields',
      'notify.slack',
      'ai.generateText',
    ]) {
      const view = renderForm(type);
      expect(view.container.textContent ?? '').not.toMatch(
        /\b(cron|node|payload|json|execution)\b/i,
      );
      view.unmount();
    }
  });
});
