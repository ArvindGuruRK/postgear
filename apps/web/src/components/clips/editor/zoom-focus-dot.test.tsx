import { type ClipDocument, createClipDocument } from '@postgear/video-engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { EditorSelection } from './editor-state';
import { PlaybackStore } from './playback';
import { MeasuredHeights, TransformLayer } from './transform-layer';
import { focusAt, focusText } from './zoom-focus-dot';

const VIDEO = '11111111-1111-4111-8111-111111111112';

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

/** A 9:16 clip (1080 by 1920) of 0 to 30 s, with a 2x zoom on 4 to 6 s at the centre. */
function clip(): ClipDocument {
  const base = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
  return {
    ...base,
    zooms: [
      {
        id: 'z1',
        source: base.segments[0]?.source ?? '',
        from: 4_000,
        to: 6_000,
        scale: 2,
        focus: { x: 0.5, y: 0.5 },
        ease: 300,
      },
    ],
  };
}

function setup(selection: EditorSelection = { kind: 'zoom', id: 'z1' }) {
  const doc = clip();
  const playback = new PlaybackStore();
  jest.spyOn(playback, 'pause');
  const calls = { select: jest.fn(), commit: jest.fn(), draft: jest.fn() };
  const utils = render(
    <div style={{ position: 'relative' }}>
      <TransformLayer
        document={doc}
        shown={doc}
        selection={selection}
        playback={playback}
        heights={new MeasuredHeights()}
        editingId={null}
        fontFamily={(family) => `"${family}"`}
        onSelect={calls.select}
        onCommit={calls.commit}
        onDraft={calls.draft}
        onEdit={jest.fn()}
        onTyping={jest.fn()}
        onTypingDone={jest.fn()}
        onEmoji={jest.fn()}
      />
    </div>,
  );
  return { ...utils, doc, calls, playback };
}

function on(target: Element, type: 'down' | 'move' | 'up', init: PointerEventInit) {
  act(() => {
    if (type === 'down') fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...init });
    if (type === 'move') fireEvent.pointerMove(target, { pointerId: 1, ...init });
    if (type === 'up') fireEvent.pointerUp(target, { pointerId: 1, ...init });
  });
}

const focusOf = (doc: ClipDocument) => doc.zooms[0]?.focus;

describe('focusAt', () => {
  const canvas = { width: 1080, height: 1920 };

  it('reads a point as a share of the clip, kept on it', () => {
    expect(focusAt({ x: 270, y: 480 }, canvas, 6, true).focus).toEqual({ x: 0.25, y: 0.25 });
    expect(focusAt({ x: -50, y: 2_500 }, canvas, 6, true).focus).toEqual({ x: 0, y: 1 });
  });

  it('snaps to the centre lines and says which', () => {
    const near = focusAt({ x: 545, y: 700 }, canvas, 6, true);
    expect(near.focus.x).toBe(0.5);
    expect(near.guides).toEqual({ x: [540], y: [] });
    expect(focusAt({ x: 545, y: 700 }, canvas, 6, false).focus.x).toBeCloseTo(545 / 1080, 6);
  });

  it('says where it is in words', () => {
    expect(focusText({ x: 0.4, y: 0.6 })).toBe('40% across, 60% down');
  });
});

describe('the zoom focus dot', () => {
  it('shows only for a selected zoom, on its focus', () => {
    setup(null);
    expect(screen.queryByTestId('clip-zoom-focus')).toBeNull();
  });

  it('sits on the focus, named and described', () => {
    setup();
    const dot = screen.getByRole('button', { name: 'Zoom Focus' });
    // Stage scale 1 outside a Stage: the centre is 540 by 960, the dot 28 px wide.
    expect(dot.style.left).toBe('526px');
    expect(dot.style.top).toBe('946px');
    expect(dot).toHaveAccessibleDescription(
      '50% across, 50% down. Drag it, or move it with the arrow keys.',
    );
  });

  it('drags the focus as a draft at the full amount, then commits it once', () => {
    const { calls, doc, playback } = setup();
    const dot = screen.getByTestId('clip-zoom-focus');
    on(dot, 'down', { clientX: 540, clientY: 960 });
    // A press on the dot is not a press on empty clip.
    expect(calls.select).not.toHaveBeenCalled();
    expect(playback.pause).toHaveBeenCalled();

    on(dot, 'move', { clientX: 270, clientY: 480 });
    const [draft] = calls.draft.mock.calls.at(-1) ?? [];
    expect(focusOf(draft.doc)).toEqual({ x: 0.25, y: 0.25 });
    // The middle of the zoom, where it is at its full amount.
    expect(draft.seekMs).toBe(5_000);

    on(dot, 'up', { clientX: 270, clientY: 480 });
    expect(calls.commit).toHaveBeenCalledTimes(1);
    const [start, next, options] = calls.commit.mock.calls[0] ?? [];
    expect(start).toBe(doc);
    expect(focusOf(next)).toEqual({ x: 0.25, y: 0.25 });
    expect(options.coalesceKey).toMatch(/^focus:z1:/);
    expect(calls.draft).toHaveBeenLastCalledWith(null);
  });

  it('snaps to the centre with a guide, and Alt lets it go', () => {
    const { calls, container } = setup();
    const dot = screen.getByTestId('clip-zoom-focus');
    on(dot, 'down', { clientX: 540, clientY: 960 });
    on(dot, 'move', { clientX: 545, clientY: 700 });
    expect(focusOf(calls.draft.mock.calls.at(-1)?.[0].doc)?.x).toBe(0.5);
    expect(container.querySelectorAll('[data-testid="clip-guide"]')).toHaveLength(1);
    on(dot, 'move', { clientX: 545, clientY: 700, altKey: true } as PointerEventInit);
    expect(focusOf(calls.draft.mock.calls.at(-1)?.[0].doc)?.x).toBeCloseTo(545 / 1080, 4);
    expect(container.querySelectorAll('[data-testid="clip-guide"]')).toHaveLength(0);
  });

  it('puts the focus back on Escape', () => {
    const { calls } = setup();
    const dot = screen.getByTestId('clip-zoom-focus');
    on(dot, 'down', { clientX: 540, clientY: 960 });
    on(dot, 'move', { clientX: 270, clientY: 480 });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(calls.draft).toHaveBeenLastCalledWith(null);
    on(dot, 'up', { clientX: 270, clientY: 480 });
    expect(calls.commit).not.toHaveBeenCalled();
  });

  it('moves with the arrows, a tenth with Shift, as one undo step', () => {
    const { calls } = setup();
    const dot = screen.getByTestId('clip-zoom-focus');
    fireEvent.keyDown(dot, { key: 'ArrowRight' });
    fireEvent.keyDown(dot, { key: 'ArrowDown', shiftKey: true });
    const [first, second] = calls.commit.mock.calls;
    expect(focusOf(first?.[1])).toEqual({ x: 0.51, y: 0.5 });
    // Each press starts from the document the editor has (here still the first).
    expect(focusOf(second?.[1])).toEqual({ x: 0.5, y: 0.6 });
    expect(first?.[2].coalesceKey).toBe(second?.[2].coalesceKey);
  });
});
