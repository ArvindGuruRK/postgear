import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  topologicalOrder,
} from '@postgear/automation';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FieldContext } from '../fields/contract';
import { forgetInsertTarget, registerInsertTarget } from '../fields/insert-target';
import { ExpandedView, type ExpandedViewProps } from './expanded-view';
import type { PinControls } from './output-pane';
import { buildScope } from './panel-view-model';

jest.mock('../fields/schema-form', () => ({ SchemaForm: () => null }));

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

function renderView(key: string, overrides: Partial<ExpandedViewProps> = {}) {
  const onNavigate = jest.fn();
  render(
    <TooltipProvider>
      <ExpandedView
        node={graph.nodes.find((node) => node.key === key)}
        graph={graph}
        issues={[]}
        context={context}
        dispatch={jest.fn()}
        pin={pin}
        onClose={() => undefined}
        onNavigate={onNavigate}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onNavigate };
}

const previousButton = () => screen.getByTestId('expanded-previous') as HTMLButtonElement;
const nextButton = () => screen.getByTestId('expanded-next') as HTMLButtonElement;

describe('ExpandedView', () => {
  it('walks the steps in run order: trigger, then each step after it', () => {
    const order = topologicalOrder(graph);
    expect(order).toEqual(['published', 'fields', 'sheet', 'slack']);

    const { onNavigate } = renderView('fields');
    fireEvent.click(previousButton());
    fireEvent.click(nextButton());
    expect(onNavigate.mock.calls).toEqual([['published'], ['sheet']]);
  });

  it('has no previous step on the trigger and no next step on the last step', () => {
    const first = renderView('published');
    expect(previousButton().disabled).toBe(true);
    expect(nextButton().disabled).toBe(false);
    fireEvent.click(nextButton());
    expect(first.onNavigate).toHaveBeenCalledWith('fields');
  });

  it('stops at the last step', () => {
    renderView('slack');
    expect(nextButton().disabled).toBe(true);
    expect(previousButton().disabled).toBe(false);
  });

  it('shows the Input, Settings and Output columns, with nothing open when no step is', () => {
    const { container } = render(
      <TooltipProvider>
        <ExpandedView
          node={undefined}
          graph={graph}
          issues={[]}
          context={context}
          dispatch={jest.fn()}
          pin={pin}
          onClose={() => undefined}
          onNavigate={() => undefined}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('expanded-view')).toBeNull();
    expect(container.textContent).toBe('');

    renderView('slack');
    expect(screen.getByRole('region', { name: 'Input' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Settings' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Output' })).not.toBeNull();
    expect(screen.getByText('Test this step to see its result.')).not.toBeNull();
  });

  it('inserts a clicked Input row into the last field used, and never shows braces outside Raw', () => {
    const inserted: string[] = [];
    const target = { insertData: (path: string) => inserted.push(path) };
    registerInsertTarget(target);
    try {
      renderView('slack');
      const input = screen.getByRole('region', { name: 'Input' });
      const rows = Array.from(input.querySelectorAll('button[aria-label^="Insert "]'));
      expect(rows.length).toBeGreaterThan(0);
      fireEvent.click(rows[0] as HTMLElement);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).not.toContain('{{');
      expect(input.textContent).not.toContain('{{');
      expect((rows[0] as HTMLElement).getAttribute('draggable')).toBe('true');
    } finally {
      forgetInsertTarget(target);
    }
  });
});
