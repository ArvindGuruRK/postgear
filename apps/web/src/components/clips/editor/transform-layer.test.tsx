import {
  type ClipDocument,
  createClipDocument,
  defaultTextItem,
  findItem,
  type TextItem,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { EditorSelection } from './editor-state';
import { PlaybackStore } from './playback';
import { MeasuredHeights, TransformLayer } from './transform-layer';

const VIDEO = '11111111-1111-4111-8111-111111111111';

beforeAll(() => {
  // jsdom has no PointerEvent, so fireEvent would drop pointerId, button and clientX.
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
});

/** A 9:16 clip with one text from 0 to 3 s, centred across at a fifth of the way down. */
function docWithText(): { doc: ClipDocument; text: TextItem } {
  const base = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
  const text = { ...defaultTextItem(base, 0), id: 'txt_a' };
  return { doc: { ...base, tracks: [{ id: 'trk_o', kind: 'overlay', items: [text] }] }, text };
}

function setup(selection: EditorSelection = null) {
  const { doc, text } = docWithText();
  const heights = new MeasuredHeights();
  // 100 canvas pixels tall, as if the preview had measured it.
  heights.set(new Map([[text.id, 100]]));
  const calls = {
    select: jest.fn(),
    commit: jest.fn(),
    draft: jest.fn(),
    edit: jest.fn(),
  };
  const utils = render(
    <div style={{ position: 'relative' }}>
      <TransformLayer
        document={doc}
        shown={doc}
        selection={selection}
        playback={new PlaybackStore()}
        heights={heights}
        editingId={null}
        fontFamily={(family) => `"${family}"`}
        onSelect={calls.select}
        onCommit={calls.commit}
        onDraft={calls.draft}
        onEdit={calls.edit}
        onTyping={jest.fn()}
        onTypingDone={jest.fn()}
        onEmoji={jest.fn()}
      />
    </div>,
  );
  return { ...utils, doc, text, calls, layer: screen.getByTestId('clip-transform-layer') };
}

/** The text in a document (the test fails if it is gone). */
function textIn(doc: ClipDocument): TextItem {
  const found = findItem(doc, 'txt_a');
  if (found?.item.type !== 'text') throw new Error('The text is gone');
  return found.item;
}

function pointer(target: Element | Window, type: 'down' | 'move' | 'up', init: PointerEventInit) {
  act(() => {
    if (type === 'down') fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...init });
    if (type === 'move') fireEvent.pointerMove(target, { pointerId: 1, ...init });
    if (type === 'up') fireEvent.pointerUp(target, { pointerId: 1, ...init });
  });
}

// The text's centre on the canvas (the stage scale is 1 outside a Stage): 540 across, 384 down.
const CENTRE = { clientX: 540, clientY: 384 };

describe('TransformLayer', () => {
  it('selects the text under the pointer and clears on empty space', () => {
    const { layer, calls } = setup();
    pointer(layer, 'down', CENTRE);
    expect(calls.select).toHaveBeenLastCalledWith({ kind: 'item', id: 'txt_a' });
    pointer(window, 'up', CENTRE);
    // A press that never moved changes nothing.
    expect(calls.commit).not.toHaveBeenCalled();
    pointer(layer, 'down', { clientX: 540, clientY: 1_500 });
    expect(calls.select).toHaveBeenCalledTimes(1);
  });

  it('clears a selection when empty space is pressed', () => {
    const { layer, calls } = setup({ kind: 'item', id: 'txt_a' });
    pointer(layer, 'down', { clientX: 540, clientY: 1_500 });
    expect(calls.select).toHaveBeenCalledWith(null);
  });

  it('frames the selected text with corner and side handles, no top or bottom', () => {
    const { container } = setup({ kind: 'item', id: 'txt_a' });
    const box = container.querySelector<HTMLElement>('[data-transform-box]') as HTMLElement;
    expect(box.style.width).toBe('864px');
    expect(box.style.height).toBe('100px');
    const parts = [...box.querySelectorAll('[data-part]')].map((el) =>
      el.getAttribute('data-part'),
    );
    expect(parts).toEqual(['body', 'rotate', 'nw', 'ne', 'se', 'sw', 'e', 'w']);
  });

  it('moves a text as a draft while dragging and commits once, as one undo step', () => {
    const { layer, calls, doc } = setup();
    pointer(layer, 'down', CENTRE);
    pointer(window, 'move', { clientX: 600, clientY: 384 });
    pointer(window, 'move', { clientX: 640, clientY: 400 });
    expect(calls.draft).toHaveBeenCalledTimes(2);
    pointer(window, 'up', { clientX: 640, clientY: 400 });
    expect(calls.commit).toHaveBeenCalledTimes(1);
    const [start, next, options] = calls.commit.mock.calls[0] as [
      ClipDocument,
      ClipDocument,
      { coalesceKey: string },
    ];
    expect(start).toBe(doc);
    expect(options.coalesceKey).toMatch(/^stage:txt_a:body:/);
    const moved = textIn(next);
    expect(moved.transform.x).toBeCloseTo(640 / 1080, 5);
    expect(moved.transform.y).toBeCloseTo(400 / 1920, 5);
    // The draft is let go after the commit.
    expect(calls.draft).toHaveBeenLastCalledWith(null);
  });

  it('snaps to the canvas centre line and shows the guide, and Alt moves freely', () => {
    const { layer, calls } = setup();
    pointer(layer, 'down', CENTRE);
    // 3 px right of the upright centre line (540) is inside the 6 px snap.
    pointer(window, 'move', { clientX: 543, clientY: 384, altKey: false });
    // The centre stays on the upright centre line (540), with its guide shown.
    let last = calls.draft.mock.calls.at(-1)?.[0] as { doc: ClipDocument };
    expect(textIn(last.doc).transform.x).toBe(0.5);
    expect(screen.getAllByTestId('clip-guide').length).toBeGreaterThan(0);
    pointer(window, 'move', { clientX: 543, clientY: 384, altKey: true });
    last = calls.draft.mock.calls.at(-1)?.[0] as { doc: ClipDocument };
    expect(textIn(last.doc).transform.x).toBeCloseTo(543 / 1080, 5);
    expect(screen.queryAllByTestId('clip-guide')).toHaveLength(0);
  });

  it('Escape during a drag puts the text back and commits nothing', () => {
    const { layer, calls } = setup();
    pointer(layer, 'down', CENTRE);
    pointer(window, 'move', { clientX: 700, clientY: 500 });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(calls.draft).toHaveBeenLastCalledWith(null);
    pointer(window, 'up', { clientX: 700, clientY: 500 });
    expect(calls.commit).not.toHaveBeenCalled();
  });

  it('turns from the round handle, snapping to a quarter turn', () => {
    const { container, calls } = setup({ kind: 'item', id: 'txt_a' });
    const rotate = container.querySelector('[data-part="rotate"]') as HTMLElement;
    // From straight above the centre to nearly straight right of it: a quarter turn clockwise.
    pointer(rotate, 'down', { clientX: 540, clientY: 200 });
    pointer(window, 'move', { clientX: 740, clientY: 390 });
    pointer(window, 'up', { clientX: 740, clientY: 390 });
    const next = calls.commit.mock.calls[0]?.[1] as ClipDocument;
    expect(textIn(next).transform.rotation).toBe(90);
  });

  it('widens the box from a side handle', () => {
    const { container, calls } = setup({ kind: 'item', id: 'txt_a' });
    const east = container.querySelector('[data-part="e"]') as HTMLElement;
    // The box runs from 108 to 972; the east side goes to 872, so the box is 764 wide.
    pointer(east, 'down', { clientX: 972, clientY: 384 });
    pointer(window, 'move', { clientX: 872, clientY: 384 });
    pointer(window, 'up', { clientX: 872, clientY: 384 });
    const next = calls.commit.mock.calls[0]?.[1] as ClipDocument;
    const item = textIn(next);
    expect(item.widthPx).toBe(764);
    expect(item.transform.x).toBeCloseTo(490 / 1080, 5);
  });

  it('a double-click starts typing into the text', () => {
    const { layer, calls } = setup();
    act(() => {
      fireEvent.doubleClick(layer, CENTRE);
    });
    expect(calls.edit).toHaveBeenCalledWith('txt_a');
  });
});
