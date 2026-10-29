import {
  type AutomationGraph,
  type FieldSpec,
  type FormTab,
  getTemplate,
  instantiateTemplate,
  type NodeDefinition,
  type ValidationIssue,
} from '@postgear/automation';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { issuePlace } from '../builder/issue-focus';
import type { FieldContext } from '../fields/contract';
import type { PinControls } from './output-pane';
import { buildScope } from './panel-view-model';
import { StepPanel, type StepPanelProps } from './step-panel';
import type { FocusRequest } from './step-tabs';

// The field kit draws the real form; here each field is a plain input with its path.
jest.mock('../fields/schema-form', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    SchemaForm: ({
      definition,
      tab,
      onChange,
    }: {
      definition: NodeDefinition;
      tab: FormTab;
      onChange: (path: string, value: unknown) => void;
    }) =>
      createElement(
        'div',
        { 'data-testid': `form-${tab}` },
        (definition.form?.tabs[tab] ?? []).map((field: FieldSpec) =>
          createElement(
            'div',
            { key: field.path, 'data-field-path': field.path },
            createElement('label', { htmlFor: `field-${field.path}` }, field.label),
            createElement('input', {
              id: `field-${field.path}`,
              onChange: (event: { target: { value: string } }) =>
                onChange(field.path, event.target.value),
            }),
          ),
        ),
      ),
  };
});

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

function report(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

const graph = report();
const slack = graph.nodes.find((node) => node.key === 'slack');
if (!slack) throw new Error('missing slack');
const { scope, scopeSource } = buildScope(graph, []);
const context: FieldContext = {
  orgId: 'org-1',
  automationId: 'wf-1',
  connections: [],
  channels: [],
  canManage: true,
  scope,
  scopeSource,
  timeZone: 'UTC',
};
const pin: PinControls = {
  pinned: undefined,
  onPin: async () => undefined,
  onUnpin: async () => undefined,
};
const missingConnection: ValidationIssue = {
  severity: 'error',
  code: 'node.connection_missing',
  message: 'Choose a Slack connection.',
  nodeKey: 'slack',
  field: 'connectionId',
};

function renderPanel(overrides: Partial<StepPanelProps> = {}) {
  const dispatch = jest.fn();
  const props: StepPanelProps = {
    node: slack as NonNullable<typeof slack>,
    graph,
    issues: [missingConnection],
    context,
    dispatch,
    pin,
    onClose: () => undefined,
    renameSignal: 0,
    ...overrides,
  };
  const view = render(
    <TooltipProvider>
      <StepPanel {...props} />
    </TooltipProvider>,
  );
  const again = (next: Partial<StepPanelProps>) =>
    view.rerender(
      <TooltipProvider>
        <StepPanel {...props} {...next} />
      </TooltipProvider>,
    );
  return { ...view, dispatch, again };
}

describe('StepPanel', () => {
  it('keeps keys pressed in its fields away from the canvas, so Backspace never deletes the step', () => {
    const canvas = jest.fn();
    window.addEventListener('keydown', canvas);
    try {
      renderPanel();
      const name = screen.getByLabelText('Step name');
      fireEvent.keyDown(name, { key: 'Backspace' });
      fireEvent.keyDown(name, { key: 'Delete' });
      fireEvent.keyDown(screen.getByLabelText('Slack connection'), { key: 'Backspace' });
      // A focused tab is not a field, but arrows and Delete still stay in the panel.
      const setup = screen.getByRole('tab', { name: /Setup/ });
      fireEvent.keyDown(setup, { key: 'Delete' });
      fireEvent.keyDown(setup, { key: 'ArrowRight' });
      expect(canvas).not.toHaveBeenCalled();

      // Esc still reaches the builder, which closes the panel.
      fireEvent.keyDown(setup, { key: 'Escape' });
      expect(canvas).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', canvas);
    }
  });

  it('writes each edit through updateConfig at its path', () => {
    const { dispatch } = renderPanel({ issues: [] });
    act(() => {
      screen.getByRole('tab', { name: /Configure/ }).focus();
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Configure/ }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'New post' } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateConfig',
        key: 'slack',
        path: 'message',
        value: 'New post',
      }),
    );
  });

  it('draws the connection once: the form has its own connection field', () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll('[data-field-path="connectionId"]')).toHaveLength(1);
  });

  it('marks Setup with "!" for its error and ticks Configure once it is filled', () => {
    renderPanel();
    const setup = screen.getByRole('tab', { name: /Setup/ });
    const configure = screen.getByRole('tab', { name: /Configure/ });
    expect(setup.querySelector('[data-testid="tab-mark-error"]')).not.toBeNull();
    expect(configure.querySelector('[data-testid="tab-mark-done"]')).not.toBeNull();
    expect(configure.querySelector('[data-testid="tab-mark-error"]')).toBeNull();
  });

  it('lands on the field an issue points at: the right tab, then the field has focus', async () => {
    const issue: ValidationIssue = {
      severity: 'error',
      code: 'token.unknown_node',
      message: 'This data is no longer available.',
      nodeKey: 'slack',
      field: 'message',
    };
    const place = issuePlace(graph, issue);
    expect(place).toMatchObject({ kind: 'step', place: 'configure', field: 'message' });
    if (place?.kind !== 'step') return;

    const { again } = renderPanel({ issues: [missingConnection, issue] });
    // Opens on Setup (its connection is missing).
    expect(screen.getByRole('tab', { name: /Setup/ }).getAttribute('aria-selected')).toBe('true');

    const focus: FocusRequest = { place: place.place, field: place.field, seq: 1 };
    again({ issues: [missingConnection, issue], focus });
    await waitFor(() => expect(document.activeElement?.id).toBe('field-message'));
    expect(screen.getByRole('tab', { name: /Configure/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('opens Settings for a settings field, and focuses the name for a name issue', async () => {
    const { again } = renderPanel();
    again({ focus: { place: 'settings', field: 'notes', seq: 1 } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Notes')));
    again({ focus: { place: 'name', field: 'name', seq: 2 } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Step name')));
  });

  it('shows the pin sticker and an Expand button', () => {
    const onExpand = jest.fn();
    renderPanel({
      onExpand,
      pin: { ...pin, pinned: { nodeKey: 'slack', pinnedAt: '2026-11-03T09:00:00Z' } },
    });
    expect(screen.getByText('Pinned data')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onExpand).toHaveBeenCalled();
  });
});
