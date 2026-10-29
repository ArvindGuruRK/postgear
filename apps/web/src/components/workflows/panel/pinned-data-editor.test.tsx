import type { GraphNode } from '@postgear/automation';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { PINNED_NOT_SAVED_YET, PINNED_TOO_LARGE } from './panel-view-model';
import { PinnedDataEditor, pinErrorMessage } from './pinned-data-editor';

const fields: Pick<GraphNode, 'key' | 'type' | 'typeVersion' | 'config' | 'name'> = {
  key: 'fields',
  type: 'logic.setFields',
  typeVersion: 1,
  config: { fields: [{ name: 'title', type: 'text', value: 'Launch' }] },
  name: 'Set Fields',
};

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

function renderEditor(initialText: string, onSave = jest.fn(async () => undefined)) {
  render(
    <PinnedDataEditor
      node={fields}
      initialText={initialText}
      onSave={onSave}
      onCancel={() => undefined}
    />,
  );
  return {
    onSave,
    box: screen.getByLabelText('Pinned data for Set Fields') as HTMLTextAreaElement,
    save: () => screen.getByRole('button', { name: 'Save Pinned Data' }) as HTMLButtonElement,
  };
}

describe('PinnedDataEditor', () => {
  it('names the line of bad data and will not save it', () => {
    const { box, save, onSave } = renderEditor(
      '{\n  "title": "Launch",\n  "count": 3\n  "done": true\n}',
    );
    expect(screen.getByRole('alert').textContent).toMatch(/^Line 4 /);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says when the data ends too early', () => {
    renderEditor('{\n  "title": "Launch"');
    expect(screen.getByRole('alert').textContent).toMatch(/ends too early on line 2/);
  });

  it('refuses data that cannot stand in for a result, and clears once it is fixed', () => {
    const { box, save } = renderEditor('[1, 2]');
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(save().disabled).toBe(true);
    fireEvent.change(box, { target: { value: '{ "title": "Launch" }' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('saves the parsed data', async () => {
    const { save, onSave } = renderEditor('{ "title": "Launch" }');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(onSave).toHaveBeenCalledWith({ title: 'Launch' });
  });

  it('shows the 64 KB refusal as an alert and keeps the text', async () => {
    const onSave = jest.fn(async () => {
      throw new ApiError('Too large', 422, 'pinned_too_large');
    });
    const { save, box } = renderEditor('{ "title": "Launch" }', onSave);
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByText(PINNED_TOO_LARGE)).not.toBeNull();
    expect(box.value).toBe('{ "title": "Launch" }');
    expect(save().disabled).toBe(false);
  });
});

describe('pinErrorMessage', () => {
  it('words each refusal for people', () => {
    expect(pinErrorMessage(new ApiError('x', 422, 'pinned_too_large'))).toBe(PINNED_TOO_LARGE);
    expect(pinErrorMessage(new ApiError('x', 404))).toBe(PINNED_NOT_SAVED_YET);
    expect(pinErrorMessage(new ApiError('You cannot edit this workflow.', 403))).toBe(
      'You cannot edit this workflow.',
    );
    expect(pinErrorMessage(new Error('fetch failed'))).toMatch(/Check your connection/);
  });
});
