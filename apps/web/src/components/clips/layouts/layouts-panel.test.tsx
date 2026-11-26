import { TooltipProvider } from '@postgear/ui';
import {
  applyLayout,
  type ClipDocument,
  createClipDocument,
  setAreaCrop,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { SavedLayoutView } from '@/types/clips';
import { firstCropOf, SAVED_LAYOUTS_FAILED } from './layouts-model';
import { type LayoutEdit, LayoutsPanel } from './layouts-panel';

jest.mock('@/lib/clips-api', () => ({
  listLayouts: jest.fn(),
  saveLayout: jest.fn(),
  renameLayout: jest.fn(),
  deleteLayout: jest.fn(),
}));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const api = jest.requireMock('@/lib/clips-api') as {
  listLayouts: jest.Mock;
  saveLayout: jest.Mock;
  renameLayout: jest.Mock;
  deleteLayout: jest.Mock;
};

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';
const VIDEO_SIZE = { width: 1920, height: 1080 };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.listLayouts.mockResolvedValue([]);
  toast.mockClear();
});

function clip(ratio: '9:16' | '16:9' = '9:16'): ClipDocument {
  return {
    ...createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio }),
    meta: { shapeChosen: true },
  };
}

function saved(name: string, doc: ClipDocument, id = `layout-${name}`): SavedLayoutView {
  return {
    id,
    name,
    ratio: doc.canvas.ratio,
    layout: doc.layout,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
  };
}

function renderPanel(initial: ClipDocument = clip()) {
  const state = { doc: initial, steps: 0 };
  const spoken: string[] = [];
  function Host() {
    const [doc, setDoc] = useState(initial);
    state.doc = doc;
    const edit: LayoutEdit = (change, sentence) => {
      const next = change(state.doc);
      if (next === state.doc) return;
      state.steps += 1;
      spoken.push(sentence);
      setDoc(next);
    };
    return (
      <>
        <h2 id="panel-heading">Layouts</h2>
        <LayoutsPanel
          clipId="55555555-5555-4555-8555-555555555555"
          document={doc}
          videoSize={VIDEO_SIZE}
          labelledBy="panel-heading"
          facesAvailable
          onEdit={edit}
        />
      </>
    );
  }
  render(
    <TooltipProvider>
      <Host />
    </TooltipProvider>,
  );
  return { state, spoken };
}

const tiles = () => within(screen.getByRole('group', { name: 'Layouts' })).getAllByRole('button');

describe('LayoutsPanel: shape and layouts', () => {
  it('offers seven layouts on a vertical clip, the current one pressed', async () => {
    renderPanel();
    await screen.findByText(/No saved layouts for Vertical clips yet/);
    expect(tiles().map((t) => t.textContent)).toEqual([
      'Fullscreen',
      'Blurred',
      'Split',
      'Three',
      'Four',
      'Gameplay',
      'Screen Share',
    ]);
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Each tile carries a drawing of its own layout.
    expect(document.querySelectorAll('[data-layout-drawing]').length).toBe(7);
  });

  it('applies a layout as one step, and says it', async () => {
    const { state, spoken } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(state.doc.layout.kind).toBe('split');
    expect(state.doc.layout.areas.map((a) => a.name)).toEqual(['Camera', 'Content']);
    expect(state.steps).toBe(1);
    expect(spoken).toEqual(['Split layout.']);
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
    // Pressing the chosen one again is nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(state.steps).toBe(1);
    await screen.findByText(/No saved layouts/);
  });

  it('changes the shape, and Horizontal offers Fullscreen and Blurred only', async () => {
    const { state } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal' }));
    expect(state.doc.canvas.ratio).toBe('16:9');
    // Split is not offered there, so the clip falls back to Blurred.
    expect(state.doc.layout.kind).toBe('blurred');
    expect(tiles().map((t) => t.textContent)).toEqual(['Fullscreen', 'Blurred']);
    await waitFor(() =>
      expect(api.listLayouts).toHaveBeenLastCalledWith('16:9', expect.anything()),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
    expect(state.doc.canvas.ratio).toBe('4:5');
    expect(tiles()).toHaveLength(7);
  });

  it('shows Crop Ratio for Blurred only, and sets it', async () => {
    const { state } = renderPanel();
    expect(screen.queryByTestId('clip-crop-ratio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Blurred' }));
    const ratio = screen.getByTestId('clip-crop-ratio');
    expect(within(ratio).getByRole('button', { name: 'Original' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(ratio).getByRole('button', { name: '1:1' }));
    expect(state.doc.layout.fitCrop).toBe('1:1');
    const crop = firstCropOf(state.doc.layout.areas[0] as never);
    expect((crop.w * 16) / 9 / crop.h).toBeCloseTo(1, 9);
    fireEvent.click(screen.getByRole('button', { name: 'Gameplay' }));
    expect(screen.queryByTestId('clip-crop-ratio')).toBeNull();
    await screen.findByText(/No saved layouts/);
  });

  it('marks no tile when the layout is custom', async () => {
    const custom: ClipDocument = {
      ...applyLayout(clip(), 'split', VIDEO_SIZE),
    };
    custom.layout = { ...custom.layout, kind: 'custom', base: 'solid' };
    renderPanel(custom);
    for (const tile of tiles()) expect(tile).toHaveAttribute('aria-pressed', 'false');
    await screen.findByText(/No saved layouts/);
  });
});

describe('LayoutsPanel: My Layouts', () => {
  it('lists the saved layouts for the shape and applies one in a press', async () => {
    const split = applyLayout(clip(), 'split', VIDEO_SIZE);
    const camera = split.layout.areas[0]?.id ?? '';
    const moved = setAreaCrop(split, camera, { x: 0.5, y: 0.5, w: 0.2, h: 0.3 }, VIDEO_SIZE);
    api.listLayouts.mockResolvedValue([saved('My Stream', moved)]);
    const { state, spoken } = renderPanel();
    const row = await screen.findByRole('button', { name: 'My Stream' });
    expect(api.listLayouts).toHaveBeenCalledWith('9:16', expect.anything());
    fireEvent.click(row);
    expect(state.doc.layout.kind).toBe('split');
    const after = firstCropOf(state.doc.layout.areas[0] as never);
    const want = firstCropOf(moved.layout.areas[0] as never);
    expect(after.x).toBeCloseTo(want.x, 9);
    expect(after.y).toBeCloseTo(want.y, 9);
    expect(spoken).toEqual(['My Stream applied.']);
  });

  it('saves the layout by name, and the new one shows first', async () => {
    api.listLayouts.mockResolvedValue([saved('Older', clip())]);
    const { state } = renderPanel(applyLayout(clip(), 'gameplay', VIDEO_SIZE));
    await screen.findByRole('button', { name: 'Older' });
    api.saveLayout.mockImplementation(async (input: { name: string }) =>
      saved(input.name, state.doc, 'layout-new'),
    );
    fireEvent.click(screen.getByTestId('clip-save-layout'));
    const dialog = await screen.findByTestId('clip-save-layout-dialog');
    const field = within(dialog).getByLabelText('Layout name');
    expect(field).toHaveAttribute('placeholder', 'Enter your layout name');
    fireEvent.change(field, { target: { value: '  My   Stream ' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Layout' }));
    });
    expect(api.saveLayout).toHaveBeenCalledWith({
      name: 'My Stream',
      ratio: '9:16',
      layout: state.doc.layout,
    });
    expect(screen.queryByTestId('clip-save-layout-dialog')).toBeNull();
    const rows = within(screen.getByTestId('clip-saved-layouts')).getAllByTestId(
      'clip-saved-layout',
    );
    expect(rows.map((r) => r.textContent)).toEqual(['My Stream', 'Older']);
    expect(toast).toHaveBeenCalledWith({ title: 'Layout saved as My Stream.' });
  });

  it('keeps the dialog open with the reason when saving is refused', async () => {
    renderPanel();
    await screen.findByText(/No saved layouts/);
    const limit =
      'This workspace has 50 saved layouts, the most it can keep. Delete one to save another.';
    api.saveLayout.mockRejectedValue(new ApiError(limit, 409, 'layout_limit'));
    fireEvent.click(screen.getByTestId('clip-save-layout'));
    const dialog = await screen.findByTestId('clip-save-layout-dialog');
    fireEvent.change(within(dialog).getByLabelText('Layout name'), {
      target: { value: 'One More' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Layout' }));
    });
    expect(within(dialog).getByText(limit)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Layout name')).toHaveValue('One More');

    // An empty name is never sent.
    api.saveLayout.mockClear();
    fireEvent.change(within(dialog).getByLabelText('Layout name'), { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Layout' }));
    });
    expect(api.saveLayout).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Enter a name for the layout.')).toBeInTheDocument();
  });

  it('renames and deletes a saved layout behind a red confirm', async () => {
    api.listLayouts.mockResolvedValue([saved('My Stream', clip())]);
    renderPanel();
    await screen.findByRole('button', { name: 'My Stream' });

    api.renameLayout.mockImplementation(async (id: string, name: string) => ({
      ...saved(name, clip(), id),
    }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for My Stream' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByTestId('clip-rename-layout-dialog');
    fireEvent.change(within(dialog).getByLabelText('Layout name'), {
      target: { value: 'Stream Look' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(api.renameLayout).toHaveBeenCalledWith('layout-My Stream', 'Stream Look');
    expect(await screen.findByRole('button', { name: 'Stream Look' })).toBeInTheDocument();

    api.deleteLayout.mockResolvedValue({ message: 'Layout deleted.' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for Stream Look' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Layout' }));
    expect(
      screen.getByText(
        'Delete "Stream Look" for everyone in this workspace? Clips that use it keep their crops.',
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-delete-layout-confirm'));
    });
    expect(api.deleteLayout).toHaveBeenCalledWith('layout-My Stream');
    expect(screen.queryByRole('button', { name: 'Stream Look' })).toBeNull();
    expect(toast).toHaveBeenCalledWith({ title: 'Layout deleted.' });
    expect(screen.getByText(/No saved layouts for Vertical clips yet/)).toBeInTheDocument();
  });

  it('drops a layout someone else deleted', async () => {
    api.listLayouts.mockResolvedValue([saved('Gone', clip())]);
    renderPanel();
    await screen.findByRole('button', { name: 'Gone' });
    api.deleteLayout.mockRejectedValue(
      new ApiError('We could not find that saved layout.', 404, 'not_found'),
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for Gone' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Layout' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-delete-layout-confirm'));
    });
    expect(screen.queryByRole('button', { name: 'Gone' })).toBeNull();
    expect(toast).toHaveBeenCalledWith({
      title: 'We could not find that saved layout.',
      variant: 'danger',
    });
  });

  it('says when the list did not load, and Try Again reads it again', async () => {
    api.listLayouts.mockRejectedValueOnce(new ApiError('Offline', 0));
    renderPanel();
    expect(await screen.findByText(SAVED_LAYOUTS_FAILED)).toBeInTheDocument();
    api.listLayouts.mockResolvedValue([saved('Back', clip())]);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(api.listLayouts).toHaveBeenCalledTimes(2);
  });
});
