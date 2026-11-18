import { TooltipProvider } from '@postgear/ui';
import { type ClipDocument, createClipDocument } from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipDetail, ClipView } from '@/types/clips';
import { fixtureVideo } from '../clips-fixtures';
import type { ClipSaveState } from './clip-autosave';
import { ClipEditor } from './clip-editor';
import { CONFLICT_SENTENCE, LATER_PANEL_SENTENCE, SHARP_GONE_SENTENCE } from './clip-editor-model';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/clips-api', () => ({
  openClip: jest.fn(async () => ({})),
  getClip: jest.fn(),
  updateClip: jest.fn(),
  exportClip: jest.fn(),
  requestMoreVideo: jest.fn(async () => ({ job: null, sharp: 'fetching' })),
  listLayouts: jest.fn(async () => []),
  saveLayout: jest.fn(),
  renameLayout: jest.fn(),
  deleteLayout: jest.fn(),
}));
// The clock the keys read: no engine runs in jsdom, so the playhead is set here.
const mockClock = { ms: 0 };
jest.mock('./playback', () => {
  const actual = jest.requireActual('./playback');
  class TestStore extends actual.PlaybackStore {
    getCurrentMs() {
      return mockClock.ms;
    }
  }
  const store = new TestStore();
  return { ...actual, usePlaybackStore: () => store };
});
jest.mock('@/lib/entitlements', () => ({
  useEntitlements: () => ({ snapshot: null, status: 'loading', refresh: jest.fn() }),
}));
jest.mock('../use-clip-job', () => ({
  useClipJob: () => ({ job: null, error: null, refresh: jest.fn() }),
}));
// jsdom plays no video: the stage is drawn without an engine.
jest.mock('@postgear/video-preview', () => ({
  ...jest.requireActual('@postgear/video-preview'),
  usePreviewEngine: () => ({ engine: null, containerRef: () => undefined }),
}));

const autosave = {
  status: 'saved' as ClipSaveState,
  refusal: null as { kind: 'retry' | 'signIn' | 'gone'; message: string } | null,
  update: jest.fn(),
};
jest.mock('./use-clip-autosave', () => ({
  useClipAutosave: (input: { document: unknown; title: string }) => {
    autosave.update(input);
    return {
      status: autosave.status,
      refusal: autosave.refusal,
      flush: async () => true,
      retry: jest.fn(),
      replace: jest.fn(),
      letGo: jest.fn(),
      isUnsaved: () => false,
    };
  },
}));

const { openClip, requestMoreVideo } = jest.requireMock('@/lib/clips-api') as {
  openClip: jest.Mock;
  requestMoreVideo: jest.Mock;
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => {
  autosave.status = 'saved';
  autosave.refusal = null;
  autosave.update.mockReset();
  openClip.mockClear();
  requestMoreVideo.mockClear();
  mockClock.ms = 0;
});

function makeDoc(chosen: boolean): ClipDocument {
  const doc = createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '9:16',
  });
  return chosen ? { ...doc, meta: { shapeChosen: true } } : doc;
}

function detailOf(
  doc: ClipDocument,
  sharp: ClipDetail['sharp'] = 'ready',
  held: ClipDetail['held'] = null,
): ClipDetail {
  const clip = {
    id: 'clip-1',
    videoId: 'video-ready',
    title: 'Best Moment',
    status: 'DRAFT',
    state: 'draft',
    origin: 'MANUAL',
    ratio: '9:16',
    durationMs: 30_000,
    score: null,
    reasons: [],
    revision: 3,
    exported: false,
    lastExportedRevision: null,
    exportedMediaId: null,
    document: doc,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
  } as unknown as ClipView;
  return {
    clip,
    video: fixtureVideo(),
    playback: { url: 'https://space.test/copy.mp4', expiresAt: '2099-01-01T00:00:00.000Z' },
    proxy: { width: 1280, height: 720, fps: 30 },
    filmstrip: null,
    waveform: null,
    sharp,
    held,
  };
}

function renderEditor(
  doc = makeDoc(true),
  sharp: ClipDetail['sharp'] = 'ready',
  held: ClipDetail['held'] = null,
) {
  return render(
    <TooltipProvider>
      <ClipEditor orgId="org-1" initial={detailOf(doc, sharp, held)} document={doc} />
    </TooltipProvider>,
  );
}

/** The document the editor last handed to autosave. */
function lastDocument(): ClipDocument {
  const call = autosave.update.mock.calls.at(-1);
  if (!call) throw new Error('Nothing was handed to autosave yet');
  return (call[0] as { document: ClipDocument }).document;
}

function key(init: KeyboardEventInit & { key: string }, target: Window | Element = window) {
  act(() => {
    fireEvent.keyDown(target, init);
  });
}

const panel = () => screen.getByTestId('clip-editor-panel');
const panelTitle = () => within(panel()).getByRole('heading', { level: 2 });

describe('ClipEditor frame', () => {
  it('opens on Layouts with the split stage, and marks the clip opened', () => {
    renderEditor();
    expect(panelTitle()).toHaveTextContent('Layouts');
    expect(screen.getByTestId('clip-layouts-panel')).toBeInTheDocument();
    expect(screen.getByTestId('clip-split-stage')).toBeInTheDocument();
    expect(screen.getByTestId('clip-video-pane')).toBeInTheDocument();
    expect(screen.getByTestId('clip-tab-layouts')).toHaveAttribute('aria-pressed', 'true');
    expect(openClip).toHaveBeenCalledWith('clip-1');
  });

  it('switches tabs from the rail, and the stage is the clip alone off Layouts', () => {
    renderEditor();
    const picture = screen.getByTestId('clip-stage-picture');
    fireEvent.click(screen.getByTestId('clip-tab-audio'));
    expect(panelTitle()).toHaveTextContent('Audio');
    expect(within(panel()).getByText(LATER_PANEL_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByTestId('clip-video-pane')).toBeNull();
    expect(screen.queryByTestId('clip-split-stage')).toBeNull();
    // The clip's stage is the same element: never remounted, so playback carries on.
    expect(screen.getByTestId('clip-stage-picture')).toBe(picture);
    expect(screen.getByTestId('clip-tab-audio')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clip-tab-layouts')).toHaveAttribute('aria-pressed', 'false');
  });

  it('walks the tabs with Back and Next, and Next is Export Clip on Export', () => {
    renderEditor();
    expect(screen.getByTestId('clip-panel-back')).toBeDisabled();
    fireEvent.click(screen.getByTestId('clip-panel-next'));
    expect(panelTitle()).toHaveTextContent('Elements');
    fireEvent.click(screen.getByTestId('clip-panel-back'));
    expect(panelTitle()).toHaveTextContent('Layouts');
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByTestId('clip-panel-next'));
    expect(panelTitle()).toHaveTextContent('Export');
    expect(screen.queryByTestId('clip-panel-next')).toBeNull();
    expect(screen.getByTestId('clip-panel-export')).toHaveTextContent('Export Clip');
  });

  it('Export in the top bar selects the Export tab', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-editor-export'));
    expect(panelTitle()).toHaveTextContent('Export');
    expect(screen.getByRole('combobox', { name: 'Export Quality' })).toBeInTheDocument();
  });

  it('renames in place, and Undo brings the old name back', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-editor-name'));
    const field = screen.getByLabelText('Clip name');
    fireEvent.change(field, { target: { value: 'Even Better Moment' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByTestId('clip-editor-name')).toHaveTextContent('Even Better Moment');
    expect(autosave.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Even Better Moment' }),
    );

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(screen.getByTestId('clip-editor-name')).toHaveTextContent('Best Moment');
    fireEvent.keyDown(window, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('clip-editor-name')).toHaveTextContent('Even Better Moment');
  });

  it('shows the conflict alert with Reload', () => {
    autosave.status = 'conflict';
    renderEditor();
    const alert = screen.getByTestId('clip-conflict');
    expect(alert).toHaveTextContent(CONFLICT_SENTENCE);
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByTestId('clip-save-status')).toHaveTextContent('Not saved');
  });

  it('says when the sharp video is gone, and nothing when it is still coming', () => {
    const { unmount } = renderEditor(makeDoc(true), 'gone');
    expect(screen.getByTestId('clip-sharp-gone')).toHaveTextContent(SHARP_GONE_SENTENCE);
    unmount();
    renderEditor(makeDoc(true), 'fetching');
    expect(screen.queryByTestId('clip-sharp-gone')).toBeNull();
  });

  it('shows a refused save with Try Again', () => {
    autosave.status = 'failed';
    autosave.refusal = { kind: 'retry', message: 'This change could not be saved.' };
    renderEditor();
    const alert = screen.getByTestId('clip-save-refused');
    expect(alert).toHaveTextContent('This change could not be saved.');
    expect(within(alert).getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('says Offline, will retry while offline', () => {
    autosave.status = 'offline';
    renderEditor();
    expect(screen.getByTestId('clip-save-status')).toHaveTextContent('Offline, will retry');
  });
});

describe('the shape dialog', () => {
  it('is not asked once the shape was chosen', () => {
    renderEditor(makeDoc(true));
    expect(screen.queryByTestId('clip-shape-dialog')).toBeNull();
  });

  it.each([
    ['Vertical', '9:16'],
    ['Horizontal', '16:9'],
    ['Square', '1:1'],
  ])('%s sets the shape as one undo step', async (name, ratio) => {
    renderEditor(makeDoc(false));
    const dialog = screen.getByTestId('clip-shape-dialog');
    expect(within(dialog).getByText('What Do You Want To Make?')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${name}`) }));
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clip-shape-continue'));
    });
    expect(screen.queryByTestId('clip-shape-dialog')).toBeNull();

    const saved = autosave.update.mock.calls.at(-1)?.[0] as { document: ClipDocument };
    expect(saved.document.canvas.ratio).toBe(ratio);
    expect(saved.document.meta?.shapeChosen).toBe(true);

    // One step: Undo is now on, and one press puts the first shape back.
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    const undone = autosave.update.mock.calls.at(-1)?.[0] as { document: ClipDocument };
    expect(undone.document.canvas.ratio).toBe('9:16');
    expect(undone.document.meta?.shapeChosen).toBe(true);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

describe('timeline keys', () => {
  it('S splits the part under the playhead as one undo step', () => {
    renderEditor();
    mockClock.ms = 12_000;
    key({ key: 's' });
    expect(lastDocument().segments).toHaveLength(2);
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Split at the playhead.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDocument().segments).toHaveLength(1);
  });

  it('S near an edge splits nothing and says why', () => {
    renderEditor();
    mockClock.ms = 100;
    key({ key: 's' });
    expect(lastDocument().segments).toHaveLength(1);
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(
      'Move the playhead at least 0.2 seconds inside a part to split it.',
    );
  });

  it('S typed into the name field splits nothing', () => {
    renderEditor();
    mockClock.ms = 12_000;
    fireEvent.click(screen.getByTestId('clip-editor-name'));
    key({ key: 's' }, screen.getByLabelText('Clip name'));
    expect(lastDocument().segments).toHaveLength(1);
  });

  it('Delete removes the selected part and the rest close up; the last part stays', () => {
    renderEditor();
    mockClock.ms = 12_000;
    key({ key: 's' });
    const [first] = screen.getAllByTestId('clip-part');
    act(() => first.focus());
    key({ key: 'Delete' });
    expect(lastDocument().segments).toHaveLength(1);
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Part removed.');

    const [only] = screen.getAllByTestId('clip-part');
    act(() => only.focus());
    key({ key: 'Backspace' });
    expect(lastDocument().segments).toHaveLength(1);
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(
      'A clip needs at least one part.',
    );
  });

  it('Escape clears the selection', () => {
    renderEditor();
    const [part] = screen.getAllByTestId('clip-part');
    act(() => part.focus());
    expect(part).toHaveAttribute('aria-pressed', 'true');
    key({ key: 'Escape' });
    expect(part).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the shortcuts sheet with ?', () => {
    renderEditor();
    key({ key: '?', shiftKey: true });
    expect(screen.getByTestId('clip-shortcuts-sheet')).toBeInTheDocument();
  });
});

describe('more video', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('asks once for the whole clip when it reaches past what we hold', async () => {
    renderEditor(makeDoc(true), 'ready', { fromMs: 12_000, toMs: 45_000 });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(requestMoreVideo).toHaveBeenCalledTimes(1);
    expect(requestMoreVideo).toHaveBeenCalledWith('clip-1', 10_000, 40_000);
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(
      'Getting more of the video',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(requestMoreVideo).toHaveBeenCalledTimes(1);
  });

  it('asks nothing while what we hold covers the clip', async () => {
    renderEditor(makeDoc(true), 'ready', { fromMs: 5_000, toMs: 45_000 });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(requestMoreVideo).not.toHaveBeenCalled();
  });
});

describe('layouts in the editor', () => {
  it('a layout tile is one undo step', () => {
    renderEditor();
    const before = lastDocument().layout.kind;
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(lastDocument().layout.kind).toBe('split');
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Split layout.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDocument().layout.kind).toBe(before);
  });

  it('Delete removes the selected crop, but never the last one', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    const camera = screen.getByRole('button', { name: 'Camera Crop' });
    act(() => camera.focus());
    key({ key: 'Delete' });
    expect(lastDocument().layout.areas.map((a) => a.name)).toEqual(['Content']);
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Crop removed.');

    act(() => screen.getByRole('button', { name: 'Content Crop' }).focus());
    key({ key: 'Delete' });
    expect(lastDocument().layout.areas).toHaveLength(1);
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(
      'A layout needs at least one crop.',
    );
  });
});
