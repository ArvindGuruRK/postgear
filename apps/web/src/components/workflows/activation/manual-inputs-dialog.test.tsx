import type { GraphNode } from '@postgear/automation';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '../fields/test-dom';
import { ManualInputsDialog } from '../runs/manual-inputs-dialog';

beforeAll(stubBrowserLayout);

const trigger: GraphNode = {
  key: 'trigger',
  type: 'trigger.manual',
  typeVersion: 1,
  name: 'Manual',
  position: { x: 0, y: 0 },
  config: {
    fields: [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'count', label: 'Count', type: 'number' },
    ],
  },
};

function renderDialog(onSubmit = jest.fn()) {
  render(
    <ManualInputsDialog
      open
      onOpenChange={jest.fn()}
      trigger={trigger}
      title="Test Workflow"
      submitLabel="Start Test"
      busy={false}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('ManualInputsDialog', () => {
  it('asks for each field with an "Enter your" placeholder', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Test Workflow' })).toBeTruthy();
    expect(screen.getByLabelText(/Topic/).getAttribute('placeholder')).toBe('Enter your topic');
    expect(screen.getByLabelText('Count').getAttribute('placeholder')).toBe('Enter your count');
  });

  it('will not submit until the required fields are filled', () => {
    const onSubmit = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Start Test' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Fill in topic.');
    expect(screen.getByLabelText(/Topic/).getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: 'Launch' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Test' }));
    expect(onSubmit).toHaveBeenCalledWith({ topic: 'Launch', count: 4 });
  });
});
