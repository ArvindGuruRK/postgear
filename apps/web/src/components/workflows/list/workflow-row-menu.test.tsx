import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AutomationListItem } from '@/types/workflows';
import { stubBrowserLayout } from '../fields/test-dom';
import { WorkflowRowMenu } from './workflow-row-menu';

beforeAll(() => {
  stubBrowserLayout();
  // Keyboard focus plays the trigger's animated icon; the icon stub has no handle.
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const workflow = (status: AutomationListItem['status']): AutomationListItem => ({
  id: 'wf-1',
  name: 'Report',
  status,
  triggerType: 'trigger.postPublished',
  hasUnpublishedChanges: false,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  runs30d: 0,
  templateId: null,
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-29T10:00:00.000Z',
});

function openMenu(status: AutomationListItem['status'], canManage: boolean) {
  const handlers = {
    onOpen: jest.fn(),
    onDuplicate: jest.fn(),
    onActivate: jest.fn(),
    onPause: jest.fn(),
    onDelete: jest.fn(),
  };
  render(<WorkflowRowMenu workflow={workflow(status)} canManage={canManage} {...handlers} />);
  act(() => {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Report' }), {
      key: 'Enter',
    });
  });
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
  return { items, handlers };
}

describe('WorkflowRowMenu', () => {
  it('offers Activate to admins on a draft', () => {
    const { items, handlers } = openMenu('DRAFT', true);
    expect(items).toEqual(['Open', 'Duplicate', 'Activate', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Activate' }));
    expect(handlers.onActivate).toHaveBeenCalled();
  });

  it('offers Pause to admins on an active workflow', () => {
    const { items, handlers } = openMenu('ACTIVE', true);
    expect(items).toEqual(['Open', 'Duplicate', 'Pause', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(handlers.onPause).toHaveBeenCalled();
  });

  it('offers members neither', () => {
    expect(openMenu('ACTIVE', false).items).toEqual(['Open', 'Duplicate', 'Delete']);
  });
});
