import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
} from '@postgear/automation';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AutomationDetail, RunSummary } from '@/types/workflows';
import { stubBrowserLayout } from '../fields/test-dom';
import { ADMINS_ONLY, CHANGES_DISCARDED } from './activation-model';
import { type LiveControlsProps, WorkflowLiveControls } from './live-controls';

jest.mock('@/lib/workflows-api', () => ({
  activateWorkflow: jest.fn(),
  pauseWorkflow: jest.fn(),
  discardChanges: jest.fn(),
  getVersion: jest.fn(),
  runNow: jest.fn(),
}));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const api = jest.requireMock('@/lib/workflows-api') as Record<string, jest.Mock>;
const { toast } = jest.requireMock('@postgear/ui') as { toast: jest.Mock };

beforeAll(stubBrowserLayout);
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  toast.mockReset();
});

function node(key: string, type: string, config: Record<string, unknown> = {}): GraphNode {
  return { key, type, typeVersion: 1, name: key, position: { x: 0, y: 0 }, config };
}

function chain(...nodes: GraphNode[]): AutomationGraph {
  const edges = nodes.slice(1).map((target, i) => ({
    id: edgeId(nodes[i].key, 'out', target.key),
    source: nodes[i].key,
    sourcePort: 'out' as const,
    target: target.key,
    targetPort: 'in' as const,
  }));
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

const notify = chain(
  node('trigger', 'trigger.postPublished'),
  node('notify', 'notify.inApp', { message: 'Hi' }),
);

function renderControls(props: Partial<LiveControlsProps> = {}) {
  const all: LiveControlsProps = {
    automation: {
      id: 'wf-1',
      name: 'Report',
      status: 'DRAFT',
      activeVersion: null,
      hasUnpublishedChanges: false,
    },
    graph: notify,
    issues: [],
    catalog: null,
    canManage: true,
    flush: jest.fn(async () => 3),
    onChanged: jest.fn(),
    onOpenIssue: jest.fn(),
    onRunStarted: jest.fn(),
    ...props,
  };
  render(
    <TooltipProvider>
      <WorkflowLiveControls {...all} />
    </TooltipProvider>,
  );
  return all;
}

const switchControl = () => screen.getByRole('switch', { name: 'Activate' }) as HTMLButtonElement;

describe('WorkflowLiveControls', () => {
  it('disables the switch for members and says why', () => {
    renderControls({ canManage: false });
    expect(switchControl().disabled).toBe(true);
    const described = switchControl().getAttribute('aria-describedby');
    expect(described && document.getElementById(described)?.textContent).toBe(ADMINS_ONLY);
  });

  it('opens the activation dialog from the switch for admins', () => {
    renderControls();
    expect(switchControl().disabled).toBe(false);
    expect(screen.getByTestId('status-badge').textContent).toBe('Draft');
    fireEvent.click(switchControl());
    expect(screen.getByRole('heading', { name: 'Turn On Workflow' })).toBeTruthy();
  });

  it('opens the pause dialog when an active workflow is switched off', () => {
    renderControls({
      automation: {
        id: 'wf-1',
        name: 'Report',
        status: 'ACTIVE',
        activeVersion: 3,
        hasUnpublishedChanges: false,
      },
    });
    expect(screen.getByTestId('status-badge').textContent).toBe('Active v3');
    expect(switchControl().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switchControl());
    expect(screen.getByRole('heading', { name: 'Pause Workflow' })).toBeTruthy();
  });

  it('shows Unpublished Changes with Activate Changes for admins only', () => {
    const automation = {
      id: 'wf-1',
      name: 'Report',
      status: 'ACTIVE' as const,
      activeVersion: 3,
      hasUnpublishedChanges: true,
    };
    renderControls({ automation });
    expect(screen.getByTestId('unpublished-badge').textContent).toBe('Unpublished Changes');
    expect(screen.getByRole('button', { name: 'Activate Changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeTruthy();
  });

  it('hides Activate Changes from members but lets them discard after a confirm', async () => {
    const detail = { id: 'wf-1', status: 'ACTIVE' } as AutomationDetail;
    api.discardChanges.mockResolvedValue(detail);
    const props = renderControls({
      canManage: false,
      automation: {
        id: 'wf-1',
        name: 'Report',
        status: 'ACTIVE',
        activeVersion: 3,
        hasUnpublishedChanges: true,
      },
    });
    expect(screen.queryByRole('button', { name: 'Activate Changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(screen.getByText(/back to version 3/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('discard-confirm'));
    });
    expect(api.discardChanges).toHaveBeenCalledWith('wf-1');
    expect(toast).toHaveBeenCalledWith({ title: CHANGES_DISCARDED });
    expect(props.onChanged).toHaveBeenCalledWith(detail);
  });

  it('asks for the Manual fields, then starts a live run', async () => {
    const run = { id: 'run-1' } as RunSummary;
    api.runNow.mockResolvedValue(run);
    const manual = chain(
      node('trigger', 'trigger.manual', {
        fields: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
      }),
      node('notify', 'notify.inApp', { message: 'Hi' }),
    );
    const props = renderControls({
      graph: manual,
      automation: {
        id: 'wf-1',
        name: 'Report',
        status: 'ACTIVE',
        activeVersion: 1,
        hasUnpublishedChanges: false,
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-now'));
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your topic'), {
      target: { value: 'Launch' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Now' }));
    });
    expect(api.runNow).toHaveBeenCalledWith('wf-1', { topic: 'Launch' });
    expect(props.onRunStarted).toHaveBeenCalledWith(run);
  });

  const active = {
    id: 'wf-1',
    name: 'Report',
    status: 'ACTIVE' as const,
    activeVersion: 1,
    hasUnpublishedChanges: false,
  };

  it('runs at once when the Manual trigger has no fields', async () => {
    const run = { id: 'run-2' } as RunSummary;
    api.runNow.mockResolvedValue(run);
    const props = renderControls({
      automation: active,
      graph: chain(node('trigger', 'trigger.manual', { fields: [] })),
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-now'));
    });
    expect(screen.queryByTestId('manual-inputs-dialog')).toBeNull();
    expect(api.runNow).toHaveBeenCalledWith('wf-1', {});
    expect(props.onRunStarted).toHaveBeenCalledWith(run);
  });

  it('offers no Run Now for other triggers', () => {
    renderControls({ automation: active });
    expect(screen.queryByTestId('run-now')).toBeNull();
  });
});
