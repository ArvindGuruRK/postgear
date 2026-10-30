import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
  type ValidationIssue,
} from '@postgear/automation';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { ActivationResult, AutomationDetail } from '@/types/workflows';
import { stubBrowserLayout } from '../fields/test-dom';
import { ActivationDialog, type ActivationDialogProps } from './activation-dialog';
import { AUTOMATIC_POSTING_TICK, STALE } from './activation-model';

jest.mock('@/lib/workflows-api', () => ({ activateWorkflow: jest.fn() }));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const { activateWorkflow } = jest.requireMock('@/lib/workflows-api') as {
  activateWorkflow: jest.Mock;
};
const { toast } = jest.requireMock('@postgear/ui') as { toast: jest.Mock };

beforeAll(stubBrowserLayout);
beforeEach(() => {
  activateWorkflow.mockReset();
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
const autoPublish = chain(
  node('trigger', 'trigger.manual', { fields: [] }),
  node('publish', 'postgear.publish'),
);

const result: ActivationResult = {
  automation: { id: 'wf-1', status: 'ACTIVE' } as AutomationDetail,
  version: {
    version: 1,
    note: null,
    triggerType: 'trigger.manual',
    createdAt: '2026-10-29T12:00:00.000Z',
    createdBy: null,
    active: true,
  },
  warnings: [],
};

function renderDialog(props: Partial<ActivationDialogProps> = {}) {
  const all: ActivationDialogProps = {
    open: true,
    onOpenChange: jest.fn(),
    automationId: 'wf-1',
    mode: 'turnOn',
    graph: notify,
    issues: [],
    flush: jest.fn(async () => 7),
    onActivated: jest.fn(),
    onOpenIssue: jest.fn(),
    ...props,
  };
  render(<ActivationDialog {...all} />);
  return all;
}

const turnOn = () => screen.getByRole('button', { name: 'Turn On' }) as HTMLButtonElement;

describe('ActivationDialog', () => {
  it('lists the errors instead, each opening its step', () => {
    const problem: ValidationIssue = {
      severity: 'error',
      code: 'node.required_missing',
      message: 'Add a message.',
      nodeKey: 'notify',
    };
    const props = renderDialog({ issues: [problem] });
    expect(screen.getByText('Fix These Issues First')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn On' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add a message\./ }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onOpenIssue).toHaveBeenCalledWith(problem);
  });

  it('says what the workflow does and turns it on with the note', async () => {
    activateWorkflow.mockResolvedValue({
      ...result,
      warnings: ['The schedule is not set up yet.'],
    });
    const props = renderDialog();
    expect(screen.getByTestId('activation-sentence').textContent).toBe(
      'When a post is published, this workflow will send an in-app notification.',
    );
    expect(screen.queryByText(AUTOMATIC_POSTING_TICK)).toBeNull();
    fireEvent.change(screen.getByLabelText('Version note'), { target: { value: ' First go ' } });
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(props.flush).toHaveBeenCalled();
    expect(activateWorkflow).toHaveBeenCalledWith('wf-1', { draftRevision: 7, note: 'First go' });
    expect(toast).toHaveBeenCalledWith({
      title: 'Workflow turned on.',
      description: 'The schedule is not set up yet.',
    });
    expect(props.onActivated).toHaveBeenCalledWith(
      expect.objectContaining({ version: result.version }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps Turn On disabled until the automatic posting tick', async () => {
    activateWorkflow.mockResolvedValue(result);
    renderDialog({ graph: autoPublish });
    expect(turnOn().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: AUTOMATIC_POSTING_TICK }));
    expect(turnOn().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(activateWorkflow).toHaveBeenCalledWith('wf-1', {
      draftRevision: 7,
      acceptAutomaticPosting: true,
    });
  });

  it('says the draft changed on a 409 and stays open', async () => {
    activateWorkflow.mockRejectedValue(new ApiError('Conflict', 409, 'automation_conflict'));
    const props = renderDialog();
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(screen.getByTestId('activation-error').textContent).toBe(STALE);
    expect(props.onActivated).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows the API sentence for a blocked activation', async () => {
    activateWorkflow.mockRejectedValue(
      new ApiError(
        'Slack is disconnected. Reconnect it in Connections.',
        422,
        'activation_blocked',
      ),
    );
    renderDialog();
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(screen.getByTestId('activation-error').textContent).toBe(
      'Slack is disconnected. Reconnect it in Connections.',
    );
  });

  it('shows the tick when the API asks for it', async () => {
    activateWorkflow.mockRejectedValue(
      new ApiError(
        'Confirm that posts will go out automatically.',
        422,
        'confirm_automatic_posting',
      ),
    );
    renderDialog();
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(screen.getByRole('checkbox', { name: AUTOMATIC_POSTING_TICK })).toBeTruthy();
    expect(turnOn().disabled).toBe(true);
  });

  it('does not activate when the latest edits could not be saved', async () => {
    renderDialog({
      flush: jest.fn(async () => {
        throw new ApiError('Conflict', 409);
      }),
    });
    await act(async () => {
      fireEvent.click(turnOn());
    });
    expect(activateWorkflow).not.toHaveBeenCalled();
    expect(screen.getByTestId('activation-error').textContent).toBe(STALE);
  });

  it('names Activate Changes and the new live version', async () => {
    activateWorkflow.mockResolvedValue({ ...result, version: { ...result.version, version: 4 } });
    renderDialog({ mode: 'changes' });
    expect(screen.getByRole('heading', { name: 'Activate Changes' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Activate Changes' }));
    });
    expect(toast).toHaveBeenCalledWith({ title: 'Version 4 is live.' });
  });
});
