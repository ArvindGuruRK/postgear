import { TooltipProvider } from '@postgear/ui';
import {
  applyLayout,
  type ClipDocument,
  createClipDocument,
  type LayoutArea,
  type Rect,
} from '@postgear/video-engine';
import type { PreviewEngine } from '@postgear/video-preview';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { EditorSelection } from '@/components/clips/editor/editor-state';
import { PlaybackStore } from '@/components/clips/editor/playback';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { CropStage } from './crop-stage';
import {
  CROP_LIMIT_SENTENCE,
  CROP_NUDGE,
  CROP_SNAP_STORAGE_KEY,
  firstCropOf,
  LAST_CROP_SENTENCE,
  moveCrop,
} from './layouts-model';
import type { LayoutEdit } from './layouts-panel';

/** The pane's room is 1032 by 600: the 16:9 video is drawn 1000 by 562 inside its padding. */
const ROOM = { width: 1032, height: 600 };
const PANE = { width: 1000, height: 562 };
const VIDEO_SIZE = { width: 1920, height: 1080 };
const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';

const drawImage = jest.fn();

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  if (!('PointerEvent' in window)) {
    class PointerEventStub extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStub });
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'clip-crop-room' ? ROOM.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'clip-crop-room' ? ROOM.height : 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage })) as never;
});

beforeEach(() => {
  window.localStorage.clear();
  drawImage.mockClear();
});

function splitClip(): ClipDocument {
  return applyLayout(
    {
      ...createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' }),
      meta: { shapeChosen: true },
    },
    'split',
    VIDEO_SIZE,
  );
}

interface Harness {
  current: () => ClipDocument;
  commits: jest.Mock;
  drafts: jest.Mock;
  announce: jest.Mock;
  selection: () => EditorSelection;
}

function renderStage(
  initial: ClipDocument = splitClip(),
  options: { engine?: PreviewEngine | null; hasVideo?: boolean } = {},
): Harness {
  const commits = jest.fn();
  const drafts = jest.fn();
  const announce = jest.fn();
  const state = { doc: initial, selection: null as EditorSelection };
  const playback = new PlaybackStore();

  function Host() {
    const [doc, setDoc] = useState(initial);
    const [draft, setDraft] = useState<ClipDocument | null>(null);
    const [selection, setSelection] = useState<EditorSelection>(null);
    state.doc = doc;
    state.selection = selection;
    const commit = (
      start: ClipDocument,
      next: ClipDocument,
      opts: { select?: EditorSelection; coalesceKey?: string } = {},
    ) => {
      commits(start, next, opts);
      setDoc((d) => (d === start ? next : d));
      if (opts.select !== undefined) setSelection(opts.select);
    };
    const edit: LayoutEdit = (change, spoken, opts) => {
      const next = change(state.doc);
      if (next === state.doc) return;
      const added = opts?.selectArea === 'last' ? next.layout.areas.at(-1) : undefined;
      commit(state.doc, next, added ? { select: { kind: 'area', id: added.id } } : {});
      announce(spoken);
    };
    return (
      <div style={{ display: 'flex' }}>
        <CropStage
          engine={options.engine ?? null}
          playback={playback}
          document={doc}
          shown={draft ?? doc}
          videoSize={VIDEO_SIZE}
          hasVideo={options.hasVideo ?? true}
          selection={selection}
          onSelect={setSelection}
          onCommit={commit}
          onDraft={(next) => {
            drafts(next);
            setDraft(next?.doc ?? null);
          }}
          onEdit={edit}
          onAnnounce={announce}
        />
      </div>
    );
  }

  render(
    <TooltipProvider>
      <Host />
    </TooltipProvider>,
  );
  return {
    current: () => state.doc,
    commits,
    drafts,
    announce,
    selection: () => state.selection,
  };
}

const boxes = () => screen.getAllByTestId('clip-crop-box');
const boxOf = (name: string) => screen.getByRole('button', { name: `${name} Crop` });
const areaNamed = (doc: ClipDocument, name: string) =>
  doc.layout.areas.find((a) => a.name === name) as LayoutArea;
const cropNamed = (doc: ClipDocument, name: string) => firstCropOf(areaNamed(doc, name));

function expectRect(a: Rect, b: Rect, digits = 6) {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.w).toBeCloseTo(b.w, digits);
  expect(a.h).toBeCloseTo(b.h, digits);
}

function pointer(target: Element | Window, type: 'down' | 'move' | 'up', init: PointerEventInit) {
  act(() => {
    if (type === 'down') fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...init });
    if (type === 'move') fireEvent.pointerMove(target, { pointerId: 1, ...init });
    if (type === 'up') fireEvent.pointerUp(target, { pointerId: 1, ...init });
  });
}

describe('CropStage: the boxes', () => {
  it('draws one box per area where its crop is, named, with eight handles', () => {
    const h = renderStage();
    expect(boxes()).toHaveLength(2);
    const camera = boxOf('Camera');
    const crop = cropNamed(h.current(), 'Camera');
    expect(camera.style.left).toBe(`${crop.x * 100}%`);
    expect(camera.style.top).toBe(`${crop.y * 100}%`);
    expect(camera.style.width).toBe(`${crop.w * 100}%`);
    expect(camera.querySelectorAll('[data-handle]')).toHaveLength(8);
    expect(within(camera).getByTestId('clip-crop-tag')).toHaveTextContent('Camera');
    expect(boxOf('Content')).toBeInTheDocument();
  });

  it('draws the video from the engine each time it draws', () => {
    const video = document.createElement('video');
    let tell: ((v: HTMLVideoElement) => void) | null = null;
    const stop = jest.fn();
    const engine = {
      onPicture: (listener: (v: HTMLVideoElement) => void) => {
        tell = listener;
        listener(video);
        return stop;
      },
    } as unknown as PreviewEngine;
    renderStage(splitClip(), { engine });
    expect(drawImage).toHaveBeenCalledTimes(1);
    const [drawn, x, y, w, hgt] = drawImage.mock.calls[0] ?? [];
    expect(drawn).toBe(video);
    expect([x, y]).toEqual([0, 0]);
    expect(w).toBeGreaterThanOrEqual(PANE.width);
    expect(hgt).toBeGreaterThanOrEqual(PANE.height);
    act(() => tell?.(video));
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('says so when there is no video to draw', () => {
    renderStage(splitClip(), { hasVideo: false });
    expect(screen.getByText('The video cannot be shown, but the crops still work.')).toBeVisible();
    expect(boxes()).toHaveLength(2);
    expect(screen.queryByTestId('clip-crop-dim')).toBeNull();
  });

  it('shades the video outside the crops, with one hole per crop where it is', () => {
    const h = renderStage();
    const dim = screen.getByTestId('clip-crop-dim');
    expect(dim.getAttribute('viewBox')).toBe(`0 0 ${PANE.width} ${PANE.height}`);
    const holes = [...dim.querySelectorAll('mask rect[fill="black"]')];
    expect(holes).toHaveLength(2);
    const camera = cropNamed(h.current(), 'Camera');
    const hole = holes[0] as SVGRectElement;
    expect(Number(hole.getAttribute('x'))).toBeCloseTo(camera.x * PANE.width, 3);
    expect(Number(hole.getAttribute('width'))).toBeCloseTo(camera.w * PANE.width, 3);
    expect(Number(hole.getAttribute('height'))).toBeCloseTo(camera.h * PANE.height, 3);
    const shade = dim.querySelector(':scope > rect') as SVGRectElement;
    const maskId = dim.querySelector('mask')?.id ?? '';
    expect(maskId).toMatch(/^crop-dim-[A-Za-z0-9_-]+$/);
    expect(shade.getAttribute('mask')).toBe(`url(#${maskId})`);
  });
});

describe('CropStage: dragging', () => {
  it('moves a box with the pointer, shows the draft live, and is one undo step on release', () => {
    const h = renderStage();
    const start = cropNamed(h.current(), 'Camera');
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    expect(h.selection()).toEqual({ kind: 'area', id: areaNamed(h.current(), 'Camera').id });
    pointer(window, 'move', { clientX: 300, clientY: 300, altKey: true });
    pointer(window, 'move', { clientX: 400, clientY: 300, altKey: true });
    expect(h.drafts).toHaveBeenLastCalledWith(expect.objectContaining({ seekMs: null }));
    expect(h.commits).not.toHaveBeenCalled();
    // The box follows the draft while dragging.
    const expected = moveCrop(start, 300 / PANE.width, -100 / PANE.height).rect;
    expect(Number.parseFloat(boxOf('Camera').style.left)).toBeCloseTo(expected.x * 100, 6);

    pointer(window, 'up', { clientX: 400, clientY: 300 });
    expect(h.commits).toHaveBeenCalledTimes(1);
    expect(h.drafts).toHaveBeenLastCalledWith(null);
    const after = cropNamed(h.current(), 'Camera');
    expectRect(after, expected);
    // The shape is kept and it stays inside the video.
    expect(after.w / after.h).toBeCloseTo(start.w / start.h, 9);
    expect(h.announce).toHaveBeenCalledWith('Camera Crop moved.');
  });

  it('cannot leave the video', () => {
    const h = renderStage();
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: -2000, clientY: 5000, altKey: true });
    pointer(window, 'up', { clientX: -2000, clientY: 5000 });
    const after = cropNamed(h.current(), 'Camera');
    expect(after.x).toBeCloseTo(0, 9);
    expect(after.y + after.h).toBeCloseTo(1, 9);
  });

  it('snaps to the other box edges with a guide, and Alt drags freely', () => {
    const h = renderStage();
    const content = cropNamed(h.current(), 'Content');
    const camera = cropNamed(h.current(), 'Camera');
    // Bring the Camera's left edge 5 px short of the Content's left edge.
    const toX = Math.round((content.x - camera.x) * PANE.width) - 5;
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 100 + toX, clientY: 400 });
    const guides = screen.getAllByTestId('clip-crop-guide');
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.some((g) => Number.parseFloat(g.style.left) === content.x * 100)).toBe(true);
    pointer(window, 'up', { clientX: 100 + toX, clientY: 400 });
    expect(cropNamed(h.current(), 'Camera').x).toBeCloseTo(content.x, 9);
    expect(screen.queryAllByTestId('clip-crop-guide')).toHaveLength(0);

    // The same move with Alt held does not snap.
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 105, clientY: 400, altKey: true });
    expect(screen.queryAllByTestId('clip-crop-guide')).toHaveLength(0);
    pointer(window, 'up', { clientX: 105, clientY: 400 });
    expect(cropNamed(h.current(), 'Camera').x).toBeCloseTo(content.x + 5 / PANE.width, 6);
  });

  it('does not snap with the switch off, and keeps the choice in this browser', () => {
    const h = renderStage();
    const content = cropNamed(h.current(), 'Content');
    const camera = cropNamed(h.current(), 'Camera');
    fireEvent.click(screen.getByTestId('clip-crop-snapping'));
    expect(window.localStorage.getItem(CROP_SNAP_STORAGE_KEY)).toBe('off');
    const toX = Math.round((content.x - camera.x) * PANE.width) - 5;
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 100 + toX, clientY: 400 });
    expect(screen.queryAllByTestId('clip-crop-guide')).toHaveLength(0);
    pointer(window, 'up', { clientX: 100 + toX, clientY: 400 });
    expect(cropNamed(h.current(), 'Camera').x).toBeCloseTo(camera.x + toX / PANE.width, 6);
  });

  it('resizes from a corner keeping the shape and the opposite corner', () => {
    const h = renderStage();
    const start = cropNamed(h.current(), 'Camera');
    const handle = boxOf('Camera').querySelector('[data-handle="ne"]') as HTMLElement;
    pointer(handle, 'down', { clientX: 300, clientY: 340 });
    pointer(window, 'move', { clientX: 250, clientY: 340, altKey: true });
    pointer(window, 'up', { clientX: 250, clientY: 340 });
    const after = cropNamed(h.current(), 'Camera');
    expect(after.w).toBeCloseTo(start.w - 50 / PANE.width, 6);
    expect(after.w / after.h).toBeCloseTo(start.w / start.h, 9);
    expect(after.x).toBeCloseTo(start.x, 9);
    expect(after.y + after.h).toBeCloseTo(start.y + start.h, 9);
    expect(h.announce).toHaveBeenCalledWith('Camera Crop resized.');
  });

  it('puts the box back on Escape, and a press without a move changes nothing', () => {
    const h = renderStage();
    const start = cropNamed(h.current(), 'Camera');
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 300, clientY: 300 });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    pointer(window, 'up', { clientX: 300, clientY: 300 });
    expect(h.commits).not.toHaveBeenCalled();
    expect(h.drafts).toHaveBeenLastCalledWith(null);
    expectRect(cropNamed(h.current(), 'Camera'), start, 12);

    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 101, clientY: 401 });
    pointer(window, 'up', { clientX: 101, clientY: 401 });
    expect(h.commits).not.toHaveBeenCalled();
  });
});

describe('CropStage: keys and tools', () => {
  it('moves a focused box with the arrows, as one coalesced step per box', () => {
    const h = renderStage();
    const start = cropNamed(h.current(), 'Content');
    const id = areaNamed(h.current(), 'Content').id;
    act(() => boxOf('Content').focus());
    expect(h.selection()).toEqual({ kind: 'area', id });
    fireEvent.keyDown(boxOf('Content'), { key: 'ArrowRight' });
    fireEvent.keyDown(boxOf('Content'), { key: 'ArrowLeft', shiftKey: true });
    expect(h.commits).toHaveBeenCalledTimes(2);
    expect(h.commits.mock.calls.map((call) => call[2].coalesceKey)).toEqual([
      `crop:${id}`,
      `crop:${id}`,
    ]);
    const after = cropNamed(h.current(), 'Content');
    expect(after.x).toBeCloseTo(start.x + CROP_NUDGE - 0.05, 9);
    // The crop is the video's full height: Up has nowhere to go, so it is no step at all.
    fireEvent.keyDown(boxOf('Content'), { key: 'ArrowUp' });
    expect(h.commits).toHaveBeenCalledTimes(2);
  });

  it('adds a crop and selects it, up to four', () => {
    const h = renderStage();
    fireEvent.click(screen.getByTestId('clip-add-crop'));
    expect(boxes()).toHaveLength(3);
    expect(h.current().layout.kind).toBe('custom');
    const added = h.current().layout.areas.at(-1) as LayoutArea;
    expect(h.selection()).toEqual({ kind: 'area', id: added.id });
    expect(h.announce).toHaveBeenCalledWith('Crop added.');
    expect(added.name).toBe('Crop 3');
    // Spoken once, never "Crop 3 Crop".
    expect(screen.getByRole('button', { name: 'Crop 3' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('clip-add-crop'));
    expect(boxes()).toHaveLength(4);
    expect(h.current().layout.areas.at(-1)?.name).toBe('Crop 4');
    expect(screen.getByTestId('clip-add-crop')).toBeDisabled();
    expect(CROP_LIMIT_SENTENCE).toBe('A layout can have at most 4 crops.');
  });

  it('renames a crop from its tag, and removes it unless it is the last', async () => {
    const h = renderStage();
    fireEvent.keyDown(within(boxOf('Camera')).getByTestId('clip-crop-tag'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByTestId('clip-rename-crop-dialog');
    const field = within(dialog).getByLabelText('Crop name');
    fireEvent.change(field, { target: { value: '  Face  ' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(areaNamed(h.current(), 'Face')).toBeDefined();
    expect(boxOf('Face')).toBeInTheDocument();

    fireEvent.keyDown(within(boxOf('Face')).getByTestId('clip-crop-tag'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(boxes()).toHaveLength(1);
    expect(h.announce).toHaveBeenLastCalledWith('Face Crop removed.');

    fireEvent.keyDown(within(boxOf('Content')).getByTestId('clip-crop-tag'), { key: 'Enter' });
    const remove = await screen.findByRole('menuitem', { name: 'Remove' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(LAST_CROP_SENTENCE)).toBeInTheDocument();
  });

  it('cancels a drag when the document changes under it', () => {
    const h = renderStage();
    pointer(boxOf('Camera'), 'down', { clientX: 100, clientY: 400 });
    pointer(window, 'move', { clientX: 300, clientY: 300 });
    // Something else changes the clip (an undo, say): the Content box moves by key.
    act(() => boxOf('Content').focus());
    fireEvent.keyDown(boxOf('Content'), { key: 'ArrowRight' });
    pointer(window, 'up', { clientX: 300, clientY: 300 });
    // Only the key's change landed; the drag was dropped.
    expect(h.commits).toHaveBeenCalledTimes(1);
    expect(h.drafts).toHaveBeenLastCalledWith(null);
  });
});
