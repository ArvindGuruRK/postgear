import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  createClipDocument,
  type StickerItem,
  type TextItem,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipDetail, ClipView } from '@/types/clips';
import { fixtureVideo } from '../clips-fixtures';
import type { ClipSaveState } from './clip-autosave';
import { ClipEditor } from './clip-editor';
import { CONFLICT_SENTENCE, SHARP_GONE_SENTENCE } from './clip-editor-model';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/org-1/clips/edit/clip-1',
}));
// The plan dialog links to this workspace's billing.
jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ activeOrgId: 'org-1' }),
}));
jest.mock('@/lib/clips-api', () => ({
  openClip: jest.fn(async () => ({})),
  // Sprint 13: the Captions tab's reads. No captions, nothing listened to, the AI layer on.
  listCaptionStyles: jest.fn(async () => ({
    styles: [],
    defaultStyleId: 'bold-pop',
    own: 0,
    limit: 30,
  })),
  getClipWords: jest.fn(async () => ({ transcript: null, ranges: [], missing: false, price: 2 })),
  getClipsStatus: jest.fn(async () => ({
    ai: {
      service: 'ok',
      prices: {},
      captions: true,
      languages: [{ code: 'en', name: 'English', highlight: 'word' }],
    },
  })),
  addCaptions: jest.fn(),
  uploadCaptionsFile: jest.fn(),
  translateCaptions: jest.fn(),
  replaceTranscriptWord: jest.fn(),
  createCaptionStyle: jest.fn(),
  updateCaptionStyle: jest.fn(),
  deleteCaptionStyle: jest.fn(),
  getClipJob: jest.fn(),
  clipJobEventsPath: jest.fn((jobId: string) => `/clips/jobs/${jobId}/events`),
  searchSounds: jest.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 24,
    total: 0,
    hasMore: false,
  })),
  soundCategories: jest.fn(async () => []),
  favouriteSound: jest.fn(),
  unfavouriteSound: jest.fn(),
  listSoundUploads: jest.fn(async () => []),
  uploadSound: jest.fn(),
  deleteSoundUpload: jest.fn(),
  soundFiles: jest.fn(async () => []),
  getClip: jest.fn(),
  updateClip: jest.fn(),
  exportClip: jest.fn(),
  listClipExports: jest.fn(async () => []),
  previewClip: jest.fn(),
  latestClipPreview: jest.fn(async () => null),
  cancelClipJob: jest.fn(),
  requestMoreVideo: jest.fn(async () => ({ job: null, sharp: 'fetching' })),
  listLayouts: jest.fn(async () => []),
  saveLayout: jest.fn(),
  renameLayout: jest.fn(),
  deleteLayout: jest.fn(),
  searchStickers: jest.fn(async () => ({
    items: [
      {
        id: '5c0e8a52-0000-4000-8000-000000000001',
        kind: 'static',
        name: 'Gold Star',
        category: 'arrows-shapes',
        tags: [],
        fileUrl: 'https://space.test/gold-star.png',
        previewUrl: null,
        width: 256,
        height: 128,
        durationMs: null,
        fps: null,
        frames: null,
        credit: null,
        isFavourite: false,
      },
    ],
    page: 1,
    pageSize: 24,
    total: 1,
    hasMore: false,
  })),
  stickerCategories: jest.fn(async () => []),
  listStickerUploads: jest.fn(async () => []),
  stickerFiles: jest.fn(async () => []),
  favouriteSticker: jest.fn(async () => undefined),
  unfavouriteSticker: jest.fn(async () => undefined),
  uploadSticker: jest.fn(),
  deleteStickerUpload: jest.fn(),
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
      flushRevision: async () => 1,
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
    expect(within(panel()).getByTestId('clip-audio-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('clip-video-pane')).toBeNull();
    expect(screen.queryByTestId('clip-split-stage')).toBeNull();
    // The clip's stage is the same element: never remounted, so playback carries on.
    expect(screen.getByTestId('clip-stage-picture')).toBe(picture);
    expect(screen.getByTestId('clip-tab-audio')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clip-tab-layouts')).toHaveAttribute('aria-pressed', 'false');
  });

  it('walks the tabs with buttons that name where they go, and ends on Export Clip', () => {
    renderEditor();
    // The first tab has no way back; the way on names the next tab.
    expect(screen.queryByTestId('clip-panel-back')).toBeNull();
    expect(screen.getByTestId('clip-panel-next')).toHaveTextContent('Elements');
    fireEvent.click(screen.getByTestId('clip-panel-next'));
    expect(panelTitle()).toHaveTextContent('Elements');
    expect(screen.getByTestId('clip-panel-back')).toHaveTextContent('Layouts');
    expect(screen.getByTestId('clip-panel-next')).toHaveTextContent('Text');
    fireEvent.click(screen.getByTestId('clip-panel-back'));
    expect(panelTitle()).toHaveTextContent('Layouts');
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByTestId('clip-panel-next'));
    // Sprint 13: Captions is the tab before Export, and it offers captions with their price.
    expect(panelTitle()).toHaveTextContent('Captions');
    expect(screen.getByTestId('clip-captions-panel')).toBeInTheDocument();
    expect(screen.getByTestId('clip-panel-next')).toHaveTextContent('Export');
    fireEvent.click(screen.getByTestId('clip-panel-next'));
    expect(panelTitle()).toHaveTextContent('Export');
    expect(screen.queryByTestId('clip-panel-next')).toBeNull();
    expect(screen.getByTestId('clip-panel-export')).toHaveTextContent('Export Clip');
  });

  it('folds the panel away and back', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-panel-hide'));
    expect(screen.queryByTestId('clip-editor-panel')).toBeNull();
    // Show Panel in the head row brings it back on the same tab.
    fireEvent.click(screen.getByTestId('clip-panel-show'));
    expect(panelTitle()).toHaveTextContent('Layouts');
    // The open tab pressed again folds it; another tab opens it on that tab.
    fireEvent.click(screen.getByTestId('clip-tab-layouts'));
    expect(screen.queryByTestId('clip-editor-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('clip-tab-audio'));
    expect(panelTitle()).toHaveTextContent('Audio');
  });

  it('Export in the top bar selects the Export tab', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-editor-export'));
    expect(panelTitle()).toHaveTextContent('Export');
    expect(screen.getByTestId('clip-export-summary')).toHaveTextContent('Vertical 9:16');
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
    // Named by its title (Module 20 a11y finding: an id of our own on the
    // title had left the dialog with no name), the tiles by their own label.
    expect(screen.getByRole('dialog', { name: 'What Do You Want To Make?' })).toBe(dialog);
    expect(within(dialog).getByRole('group', { name: 'Shape' })).toBeInTheDocument();
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

describe('effects in the editor', () => {
  let clock: jest.SpyInstance<number, []>;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });
  afterEach(() => clock.mockRestore());

  it('Add Zoom puts a two second zoom at the playhead, selected, with its dot on the clip', () => {
    mockClock.ms = 5_000;
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-tab-effects'));
    expect(panelTitle()).toHaveTextContent('Effects');
    fireEvent.click(within(panel()).getByRole('button', { name: /^Zoom/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Zoom' }));
    const [zoom] = lastDocument().zooms;
    // 5 s into the clip is 15 s of the video.
    expect(zoom).toMatchObject({ from: 15_000, to: 17_000, scale: 1.5 });
    expect(screen.getByTestId('clip-selected-zoom')).toBeInTheDocument();
    expect(screen.getByTestId('clip-zoom-focus')).toBeInTheDocument();
    expect(screen.getByTestId('clip-bar-zoom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Zoom added.');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Zoom' }));
    expect(lastDocument().zooms).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDocument().zooms).toHaveLength(1);
  });

  it('selecting a part opens Speed Control; 2x halves it as one undo step', () => {
    mockClock.ms = 12_000;
    renderEditor();
    key({ key: 's' });
    const parts = screen.getAllByTestId('clip-part');
    act(() => (parts[1] as HTMLElement).focus());
    fireEvent.click(screen.getByTestId('clip-tab-effects'));
    expect(within(panel()).getByRole('button', { name: /^Speed Control/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(within(panel()).getByRole('button', { name: '2x' }));
    expect(lastDocument().segments.map((segment) => segment.speed)).toEqual([1, 2]);
    expect(screen.getByTestId('clip-speed-length')).toHaveTextContent('18.0 s becomes 9.0 s');
    const second = screen.getAllByTestId('clip-part')[1] as HTMLElement;
    expect(within(second).getByText('2x')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDocument().segments.map((segment) => segment.speed)).toEqual([1, 1]);
  });

  it('a look, its strength and the fades go on the whole clip', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-tab-effects'));
    fireEvent.click(within(panel()).getByRole('button', { name: /^Looks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Black And White' }));
    expect(lastDocument().looks).toEqual({ colour: 'black_white', strength: 1, vignette: 0 });
    fireEvent.click(screen.getByRole('switch', { name: 'Fade Out' }));
    expect(lastDocument().fades).toEqual({ inMs: 0, outMs: 1_000 });
  });
});

describe('text in the editor', () => {
  const texts = () =>
    lastDocument().tracks.flatMap((track) =>
      track.kind === 'overlay' ? track.items : [],
    ) as TextItem[];
  const firstText = () => texts()[0] as TextItem;

  // Edits sharing a key coalesce within 700 ms of the clock: a still clock keeps these
  // tests from depending on how fast the machine runs them.
  let clock: jest.SpyInstance<number, []>;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });
  afterEach(() => clock.mockRestore());

  function addText() {
    fireEvent.click(screen.getByTestId('clip-tab-text'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }));
    return screen.getByRole('textbox', { name: 'Text' });
  }

  function type(box: HTMLElement, words: string) {
    act(() => {
      box.textContent = words;
      fireEvent.input(box);
    });
  }

  it('Add Text puts a text at the playhead and starts typing on the clip, as two undo steps', () => {
    mockClock.ms = 5_000;
    renderEditor();
    const box = addText();
    expect(firstText().start).toBe(5_000);
    expect(firstText().text).toBe('Your text here');
    expect(box).toHaveFocus();
    type(box, 'Hello');
    type(box, 'Hello there');
    expect(firstText().text).toBe('Hello there');
    key({ key: 'Escape' }, box);
    expect(screen.queryByTestId('clip-text-typing')).toBeNull();
    // Escape ends the typing and keeps the words; the selection stays.
    expect(firstText().text).toBe('Hello there');
    expect(screen.getByRole('textbox', { name: 'Words' })).toHaveValue('Hello there');
    // All the typing is one step; the add is the one before it.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(firstText().text).toBe('Your text here');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(texts()).toHaveLength(0);
  });

  it('a text left empty when typing ends is removed', () => {
    renderEditor();
    const box = addText();
    type(box, '');
    act(() => {
      fireEvent.blur(box);
    });
    expect(texts()).toHaveLength(0);
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Empty text removed.');
  });

  it('arrows nudge the selected text a pixel, Shift ten, as one undo step; Enter types again', () => {
    renderEditor();
    key({ key: 'Escape' }, addText());
    const { x, y } = firstText().transform;
    key({ key: 'ArrowRight' });
    key({ key: 'ArrowDown', shiftKey: true });
    expect(firstText().transform.x).toBeCloseTo(x + 1 / 1080, 6);
    expect(firstText().transform.y).toBeCloseTo(y + 10 / 1920, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(firstText().transform).toMatchObject({ x, y });
    key({ key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeInTheDocument();
  });

  it('the panel restyles the text, and Whole Clip stretches it over the clip', () => {
    renderEditor();
    key({ key: 'Escape' }, addText());
    fireEvent.click(screen.getByRole('button', { name: 'On A Box' }));
    expect(firstText().style.background).toMatchObject({ colour: '#FFFFFF', pad: 18 });
    expect(firstText().style.outline).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Whole Clip' }));
    expect(firstText()).toMatchObject({ anchor: 'clip', start: 0, duration: 30_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Long' }));
    expect(firstText()).toMatchObject({ fadeInMs: 500, fadeOutMs: 500 });
  });

  it('leaves an emoji out of the words and says where emoji go', () => {
    renderEditor();
    key({ key: 'Escape' }, addText());
    fireEvent.change(screen.getByRole('textbox', { name: 'Words' }), {
      target: { value: 'Big news \u{1F525}' },
    });
    expect(firstText().text).toBe('Big news ');
    expect(screen.getByTestId('clip-text-emoji')).toHaveTextContent(
      'Emoji are stickers. Add one from Elements.',
    );
  });
});

describe('stickers in the editor', () => {
  const stickers = () =>
    lastDocument().tracks.flatMap((track) =>
      track.kind === 'overlay' ? track.items.filter((item) => item.type === 'sticker') : [],
    ) as StickerItem[];
  const firstSticker = () => stickers()[0] as StickerItem;

  let clock: jest.SpyInstance<number, []>;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });
  afterEach(() => clock.mockRestore());

  async function addGoldStar() {
    fireEvent.click(screen.getByTestId('clip-tab-elements'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Gold Star' }));
  }

  it('a tile adds its sticker at the playhead in the picture shape, selected, as one undo step', async () => {
    mockClock.ms = 4_000;
    renderEditor();
    await addGoldStar();
    expect(screen.getByTestId('clip-announcer')).toHaveTextContent('Gold Star added.');
    expect(firstSticker()).toMatchObject({
      start: 4_000,
      duration: 3_000,
      ref: { library: 'sticker', id: '5c0e8a52-0000-4000-8000-000000000001' },
      widthPx: 270,
      heightPx: 135,
      flipX: false,
    });
    // Selected at once: the panel shows its name and its own controls.
    expect(screen.getByTestId('clip-selected-sticker')).toHaveTextContent('Gold Star');
    // A still picture has no Loop to set.
    expect(screen.queryByRole('switch', { name: 'Loop' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(stickers()).toHaveLength(0);
  });

  it('Flip mirrors the selected sticker, arrows nudge it, and Remove Sticker takes it out', async () => {
    renderEditor();
    await addGoldStar();
    fireEvent.click(screen.getByRole('switch', { name: 'Flip' }));
    expect(firstSticker().flipX).toBe(true);
    const { x } = firstSticker().transform;
    key({ key: 'ArrowLeft', shiftKey: true });
    expect(firstSticker().transform.x).toBeCloseTo(x - 10 / 1080, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sticker' }));
    expect(stickers()).toHaveLength(0);
  });
});

describe('captions in the editor', () => {
  const api = jest.requireMock('@/lib/clips-api') as {
    addCaptions: jest.Mock;
    translateCaptions: jest.Mock;
    getClipsStatus: jest.Mock;
  };
  const SAID = '3f2a9c1e-0000-4000-8000-0000000000a1';
  const HINDI = '3f2a9c1e-0000-4000-8000-0000000000a2';

  function transcript(id: string, language: string, texts: string[], source: string) {
    return {
      id,
      language,
      model: 'test',
      source,
      words: texts.map((text, i) => ({
        i,
        start: 11_000 + i * 400,
        end: 11_300 + i * 400,
        text,
        sure: 1,
      })),
      covered: [{ fromMs: 10_000, toMs: 40_000 }],
      fixes: 0,
      fileName: null,
    };
  }
  function track(transcriptAssetId: string, language: string) {
    return {
      id: 'captions',
      kind: 'captions',
      transcriptAssetId,
      language,
      styleId: 'bold-pop',
      position: { x: 0.5, y: 0.75 },
      sizePx: 72,
      maxWords: 3,
      edits: {},
    };
  }
  const shownTranscript = () =>
    lastDocument().tracks.flatMap((entry) =>
      entry.kind === 'captions' ? [entry.transcriptAssetId] : [],
    );
  const words = () => screen.getAllByTestId('clip-caption-word').map((word) => word.textContent);

  beforeEach(() => {
    api.getClipsStatus.mockResolvedValue({
      ai: {
        service: 'ok',
        prices: {},
        captions: true,
        languages: [
          { code: 'en', name: 'English', highlight: 'word' },
          { code: 'hi', name: 'Hindi', highlight: 'page' },
        ],
      },
    });
    api.addCaptions.mockResolvedValue({
      covered: true,
      track: track(SAID, 'en'),
      transcript: transcript(SAID, 'en', ['Hello', 'there', 'friend'], 'listened'),
    });
    api.translateCaptions.mockResolvedValue({
      track: track(HINDI, 'hi'),
      transcript: transcript(HINDI, 'hi', ['Namaste', 'dost'], 'translated'),
    });
  });

  it('Undo after a translation shows the words as said again, and Redo the translation', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('clip-tab-captions'));
    fireEvent.click(await screen.findByTestId('clip-captions-add'));
    await screen.findAllByTestId('clip-caption-word');
    expect(shownTranscript()).toEqual([SAID]);
    expect(words()).toEqual(['HELLO', 'THERE', 'FRIEND']);

    fireEvent.click(await screen.findByTestId('clip-captions-translate'));
    await screen.findByText('NAMASTE');
    expect(shownTranscript()).toEqual([HINDI]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(shownTranscript()).toEqual([SAID]);
    expect(words()).toEqual(['HELLO', 'THERE', 'FRIEND']);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(shownTranscript()).toEqual([HINDI]);
    expect(words()).toEqual(['NAMASTE', 'DOST']);

    // The keyboard does the same, from wherever the focus is in the panel.
    key({ key: 'z', metaKey: true }, screen.getByTestId('clip-captions-translate'));
    expect(shownTranscript()).toEqual([SAID]);
    // Undo once more takes the captions off again.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(shownTranscript()).toEqual([]);
  });
});
