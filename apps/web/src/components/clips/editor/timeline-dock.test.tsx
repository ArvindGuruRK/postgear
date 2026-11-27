import { TooltipProvider } from '@postgear/ui';
import {
  applyBrandKit,
  type ClipDocument,
  createClipDocument,
  defaultSoundItem,
  dragTrimEnd,
  dragTrimStart,
  pxPerMs,
  setHook,
  type TextItem,
  zoomBounds,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { SNAP_STORAGE_KEY } from '../timeline/timeline-model';
import { PlaybackStore } from './playback';
import { GETTING_MORE, TimelineDock, type TimelineDockProps } from './timeline-dock';

/** The scroller is 1104 px wide: 1000 px of track after the label column and padding. */
const SCROLLER_PX = 1104;
const TRACK_PX = 1000;
/** Room kept after the clip's end (`TAIL_PX`). */
const TAIL_PX = 96;
const FPS = 30;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'clip-timeline' ? SCROLLER_PX : 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

beforeEach(() => {
  window.localStorage.clear();
});

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';

/** 10 s to 40 s of the video: one 30 s part. */
function clip(): ClipDocument {
  return {
    ...createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' }),
    meta: { shapeChosen: true },
  };
}

function text(id: string, start: number, duration: number): TextItem {
  return {
    id,
    type: 'text',
    start,
    duration,
    anchor: 'moment',
    text: 'HE REALLY DID THAT',
    style: {
      font: 'Sora',
      size: 64,
      weight: 600,
      italic: false,
      colour: '#ffffff',
      align: 'center',
      outline: null,
      background: null,
      shadow: false,
      uppercase: false,
    },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 864,
    fadeInMs: 0,
    fadeOutMs: 0,
  };
}

function withTexts(doc: ClipDocument, items: TextItem[]): ClipDocument {
  return { ...doc, tracks: [{ id: 'trk_overlay', kind: 'overlay', items }] };
}

/** The dock's scale for a clip of `durationMs` at its fit zoom. */
function fitScale(durationMs: number): number {
  return pxPerMs(zoomBounds(durationMs, TRACK_PX - TAIL_PX, FPS).min);
}

const SCALE = fitScale(30_000);
/** The whole pixel nearest a time (a pointer reports whole pixels), and the time it reads back as. */
const px = (ms: number) => Math.round(ms * SCALE);
const msOf = (ms: number) => px(ms) / SCALE;

function setup(overrides: Partial<TimelineDockProps> = {}) {
  const playback = new PlaybackStore();
  jest.spyOn(playback, 'seekMs');
  jest.spyOn(playback, 'setScrubbing');
  const props: TimelineDockProps = {
    document: clip(),
    selection: null,
    playback,
    filmstrip: null,
    waveform: null,
    fps: FPS,
    held: null,
    videoDurationMs: 600_000,
    gettingMore: false,
    notice: null,
    splitProblemAt: () => null,
    removeProblem: null,
    controlRef: { current: null },
    onSelect: jest.fn(),
    onOpen: jest.fn(),
    onCommit: jest.fn(),
    onDraft: jest.fn(),
    onSplit: jest.fn(),
    onRemove: jest.fn(),
    onAnnounce: jest.fn(),
    ...overrides,
  };
  const view = render(
    <TooltipProvider>
      <TimelineDock {...props} />
    </TooltipProvider>,
  );
  return { props, playback, view };
}

/** The calls the dock made to `onCommit`. */
const commits = (props: TimelineDockProps) => (props.onCommit as jest.Mock).mock.calls;

const part = (index = 0) => screen.getAllByTestId('clip-part')[index] as HTMLElement;
const grip = (bar: HTMLElement, side: 'start' | 'end') =>
  bar.querySelector(`[data-grip="${side}"]`) as HTMLElement;

function pointer(
  type: 'pointerMove' | 'pointerUp',
  clientX: number,
  extra: { altKey?: boolean } = {},
) {
  act(() => {
    fireEvent[type](window, { pointerId: 1, button: 0, clientX, ...extra });
  });
}

function down(target: HTMLElement, clientX: number) {
  target.setPointerCapture = jest.fn();
  act(() => {
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX });
  });
}

describe('TimelineDock rows', () => {
  it('shows every row, the empty ones slim, so people learn where things go', () => {
    setup();
    const names = screen
      .getAllByRole('group')
      .map((row) => row.getAttribute('aria-label'))
      .filter((name) => name !== 'Time Ruler');
    expect(names).toEqual(['Video', 'Video Sound', 'Overlay', 'Zoom', 'Sound']);
    expect(part()).toHaveAccessibleName('Part 1, from 0 seconds, 30 seconds long');
  });

  it('draws a sound bar with its shape and name, only as far as an effect plays', () => {
    const doc = clip();
    const whoosh = {
      ...defaultSoundItem(
        doc,
        1_000,
        { library: 'sound', id: '5c0e8a52-0000-4000-8000-0000000000a1' },
        'sfx',
        {
          durationMs: 2_000,
        },
      ),
      id: 'snd_a',
    };
    const soundShape = jest.fn(() => ({ peaks: [10, 200, 90], fill: 0.5, name: 'Quick Whoosh' }));
    setup({
      document: { ...doc, tracks: [{ id: 'trk_sound', kind: 'audio', items: [whoosh] }] },
      soundShape,
    });
    const bar = within(screen.getByRole('group', { name: 'Sound' })).getByTestId('clip-bar-item');
    expect(bar).toHaveTextContent('Quick Whoosh');
    expect(within(bar).getByTestId('clip-sound-shape')).toBeInTheDocument();
    expect(soundShape).toHaveBeenCalledWith('snd_a');
  });

  it('opens a second Overlay row when two overlays overlap', () => {
    setup({ document: withTexts(clip(), [text('t1', 0, 5_000), text('t2', 2_000, 2_000)]) });
    expect(screen.getByRole('group', { name: 'Overlay 2' })).toBeInTheDocument();
    expect(screen.getAllByTestId('clip-bar-item')).toHaveLength(2);
  });

  it('hatches the ends of a part that reach past what we hold', () => {
    setup({ held: { fromMs: 15_000, toMs: 35_000 } });
    expect(part().querySelector('[data-hatch="start"]')).not.toBeNull();
    expect(part().querySelector('[data-hatch="end"]')).not.toBeNull();
  });

  it('hatches nothing when what we hold covers the clip', () => {
    setup({ held: { fromMs: 5_000, toMs: 45_000 } });
    expect(part().querySelector('[data-hatch]')).toBeNull();
  });
});

describe('trimming a part', () => {
  beforeEach(() => window.localStorage.setItem(SNAP_STORAGE_KEY, 'off'));

  it('shows the drag live and hands it over once, on release, as one change', () => {
    const { props, playback } = setup({ held: { fromMs: 5_000, toMs: 45_000 } });
    const start = props.document;
    down(grip(part(), 'end'), px(30_000));
    expect(playback.setScrubbing).toHaveBeenLastCalledWith(true);
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'segment', id: start.segments[0].id });

    pointer('pointerMove', px(25_000));
    pointer('pointerMove', px(22_000));
    expect(screen.getByTestId('clip-drag-time')).toBeInTheDocument();
    expect(props.onDraft).toHaveBeenLastCalledWith({
      doc: expect.objectContaining({
        segments: [expect.objectContaining({ sourceOut: Math.round(10_000 + msOf(22_000)) })],
      }),
      seekMs: expect.any(Number),
    });
    expect(props.onCommit).not.toHaveBeenCalled();

    pointer('pointerUp', px(22_000));
    const expected = dragTrimEnd(start, {
      segmentId: start.segments[0].id,
      pointerMs: msOf(22_000),
      videoDurationMs: 600_000,
      held: { fromMs: 5_000, toMs: 45_000 },
    }).doc;
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith(start, expected, {
      select: { kind: 'segment', id: start.segments[0].id },
    });
    expect(props.onDraft).toHaveBeenLastCalledWith(null);
    expect(playback.setScrubbing).toHaveBeenLastCalledWith(false);
    expect(props.onAnnounce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Part 1, from 0 seconds, 2[12](\.\d)? seconds long\.$/),
    );
    expect(screen.queryByTestId('clip-drag-time')).toBeNull();
  });

  it('trims a start edge from where the drag began, however far the pointer went', () => {
    const { props } = setup();
    const start = props.document;
    down(grip(part(), 'start'), 0);
    pointer('pointerMove', px(9_000));
    pointer('pointerMove', px(2_000));
    pointer('pointerMove', px(4_000));
    pointer('pointerUp', px(4_000));
    const expected = dragTrimStart(start, {
      segmentId: start.segments[0].id,
      pointerMs: msOf(4_000),
      videoDurationMs: 600_000,
    }).doc;
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(commits(props)[0][1]).toEqual(expected);
    expect(expected.segments[0].sourceIn).toBe(Math.round(10_000 + msOf(4_000)));
  });

  it('says it is getting more of the video while a trim reaches past what we hold', () => {
    const { props } = setup({ held: { fromMs: 5_000, toMs: 41_000 } });
    down(grip(part(), 'end'), px(30_000));
    pointer('pointerMove', px(32_000));
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(GETTING_MORE);
    expect(part().querySelector('[data-hatch="end"]')).not.toBeNull();
    pointer('pointerUp', px(32_000));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it('drops the drag on Escape: nothing is handed over', () => {
    const { props } = setup();
    down(grip(part(), 'end'), px(30_000));
    pointer('pointerMove', px(20_000));
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    pointer('pointerUp', px(20_000));
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onDraft).toHaveBeenLastCalledWith(null);
  });

  it('moves an edge by how far the pointer went, wherever on the grip it was grabbed', () => {
    const { props } = setup();
    const start = props.document;
    // Grabbed four pixels inside the end edge: the edge must not jump to the pointer.
    down(grip(part(), 'end'), px(30_000) - 4);
    pointer('pointerMove', px(22_000) - 4);
    pointer('pointerUp', px(22_000) - 4);
    const edgeMs = (px(22_000) - 4) / SCALE - ((px(30_000) - 4) / SCALE - 30_000);
    const expected = dragTrimEnd(start, {
      segmentId: start.segments[0].id,
      pointerMs: edgeMs,
      videoDurationMs: 600_000,
    }).doc;
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(commits(props)[0][1]).toEqual(expected);
    expect(expected.segments[0].sourceOut).toBe(Math.round(10_000 + edgeMs));
  });

  it('treats a press that barely moves as a click: no draft, no change', () => {
    const { props } = setup();
    down(grip(part(), 'start'), px(0) + 3);
    pointer('pointerMove', px(0) + 5);
    expect(screen.queryByTestId('clip-drag-time')).toBeNull();
    pointer('pointerUp', px(0) + 5);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onDraft).not.toHaveBeenCalledWith(
      expect.objectContaining({ doc: expect.anything() }),
    );
  });

  it('changes nothing when the edge comes back to where it began', () => {
    const { props } = setup();
    down(grip(part(), 'end'), px(30_000));
    pointer('pointerMove', px(20_000));
    pointer('pointerMove', px(30_000));
    pointer('pointerUp', px(30_000));
    expect(props.onCommit).not.toHaveBeenCalled();
  });
});

describe('snapping', () => {
  it('snaps an edge to the playhead with a guide line, and Alt lets it go', () => {
    const playback = new PlaybackStore();
    jest.spyOn(playback, 'getCurrentMs').mockReturnValue(20_000);
    setup({ playback });
    down(grip(part(), 'end'), px(30_000));
    // Five px from the playhead: inside the 8 px.
    pointer('pointerMove', px(20_000) + 5);
    const guide = screen.getByTestId('clip-snap-guide');
    expect(guide.style.left).toBe(`${20_000 * SCALE}px`);
    pointer('pointerMove', px(20_000) + 5, { altKey: true });
    expect(screen.queryByTestId('clip-snap-guide')).toBeNull();
    pointer('pointerUp', px(20_000) + 5, { altKey: true });
  });

  it('never snaps an edge on a press alone, even right next to the playhead', () => {
    const playback = new PlaybackStore();
    // The playhead is a few pixels inside the end edge, well within the snap distance.
    jest.spyOn(playback, 'getCurrentMs').mockReturnValue(29_900);
    const { props } = setup({ playback });
    down(grip(part(), 'end'), px(30_000) - 1);
    pointer('pointerUp', px(30_000) - 1);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clip-snap-guide')).toBeNull();
  });

  it('turns off with the switch, and the browser remembers', () => {
    const playback = new PlaybackStore();
    jest.spyOn(playback, 'getCurrentMs').mockReturnValue(20_000);
    setup({ playback });
    const toggle = screen.getByRole('switch', { name: 'Snapping' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(SNAP_STORAGE_KEY)).toBe('off');

    down(grip(part(), 'end'), px(30_000));
    pointer('pointerMove', px(20_000) + 5);
    expect(screen.queryByTestId('clip-snap-guide')).toBeNull();
    pointer('pointerUp', px(20_000) + 5);
  });
});

describe('items on the rows', () => {
  const doc = withTexts(clip(), [text('t1', 4_000, 3_000)]);

  it('moves a selected item a frame with the arrows, a second with Shift, as one step', () => {
    const { props } = setup({ document: doc, selection: { kind: 'item', id: 't1' } });
    const bar = screen.getByTestId('clip-bar-item');
    const right = fireEvent.keyDown(bar, { key: 'ArrowRight' });
    // Handled here, so the window's playhead step does not also run.
    expect(right).toBe(false);
    const [start, next, options] = commits(props)[0];
    expect(start).toBe(doc);
    expect(next.tracks[0].items[0].start).toBe(4_033);
    expect(options).toEqual({ select: { kind: 'item', id: 't1' }, coalesceKey: 'nudge:t1' });

    fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true });
    expect(commits(props)[1][1].tracks[0].items[0].start).toBe(3_000);
  });

  it('opens its panel with Enter, and says what it is when it gets focus', () => {
    const { props } = setup({ document: doc });
    const bar = screen.getByTestId('clip-bar-item');
    act(() => bar.focus());
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'item', id: 't1' });
    expect(props.onAnnounce).toHaveBeenCalledWith(
      'Text, HE REALLY DID THAT, from 4 seconds, 3 seconds long.',
    );
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(props.onOpen).toHaveBeenCalledWith({ kind: 'item', id: 't1' });
  });

  it('moves an item by its body and hands the move over once', () => {
    window.localStorage.setItem(SNAP_STORAGE_KEY, 'off');
    const { props } = setup({ document: doc });
    down(screen.getByTestId('clip-bar-item'), px(5_000));
    pointer('pointerMove', px(8_000));
    pointer('pointerUp', px(8_000));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(commits(props)[0][1].tracks[0].items[0].start).toBe(
      Math.round(4_000 + msOf(8_000) - msOf(5_000)),
    );
  });

  it('resizes an item by how far its grip went, not to where it was grabbed', () => {
    window.localStorage.setItem(SNAP_STORAGE_KEY, 'off');
    const { props } = setup({ document: doc });
    const bar = screen.getByTestId('clip-bar-item');
    // The item ends at 7 s; grabbed three pixels inside that end.
    down(grip(bar, 'end'), px(7_000) - 3);
    pointer('pointerMove', px(9_000) - 3);
    pointer('pointerUp', px(9_000) - 3);
    const edgeMs = (px(9_000) - 3) / SCALE - ((px(7_000) - 3) / SCALE - 7_000);
    const item = commits(props)[0][1].tracks[0].items[0];
    expect(item.start).toBe(4_000);
    expect(item.duration).toBe(Math.round(edgeMs) - 4_000);
  });
});

describe('zooms on the Zoom row', () => {
  /** A 1.5x zoom on 14 to 16 s of the video: 4 to 6 s of the clip. */
  function withZoom(): ClipDocument {
    const doc = clip();
    return {
      ...doc,
      zooms: [
        {
          id: 'z1',
          source: doc.segments[0]?.source ?? '',
          from: 14_000,
          to: 16_000,
          scale: 1.5,
          focus: { x: 0.5, y: 0.5 },
          ease: 300,
        },
      ],
    };
  }

  it('moves a zoom by its bar, keeping its length, and hands the move over once', () => {
    window.localStorage.setItem(SNAP_STORAGE_KEY, 'off');
    const doc = withZoom();
    const { props } = setup({ document: doc });
    down(screen.getByTestId('clip-bar-zoom'), px(5_000));
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'zoom', id: 'z1' });
    pointer('pointerMove', px(8_000));
    expect(props.onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ seekMs: null, doc: expect.anything() }),
    );
    pointer('pointerUp', px(8_000));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const [start, next, options] = commits(props)[0];
    expect(start).toBe(doc);
    const moved = next.zooms[0];
    expect(Math.abs(moved.from - (14_000 + msOf(8_000) - msOf(5_000)))).toBeLessThanOrEqual(1);
    expect(moved.to - moved.from).toBe(2_000);
    expect(options).toEqual({ select: { kind: 'zoom', id: 'z1' } });
    expect(props.onAnnounce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Zoom 1\.5x, from 7 seconds, 2 seconds long\.$/),
    );
    expect(props.onDraft).toHaveBeenLastCalledWith(null);
  });

  it('resizes a zoom from either end, keeping the other', () => {
    window.localStorage.setItem(SNAP_STORAGE_KEY, 'off');
    const doc = withZoom();
    const { props } = setup({ document: doc });
    const bar = screen.getByTestId('clip-bar-zoom');
    down(grip(bar, 'end'), px(6_000) - 3);
    pointer('pointerMove', px(9_000) - 3);
    pointer('pointerUp', px(9_000) - 3);
    const edgeMs = (px(9_000) - 3) / SCALE - ((px(6_000) - 3) / SCALE - 6_000);
    const longer = commits(props)[0][1].zooms[0];
    expect(longer.from).toBe(14_000);
    expect(Math.abs(longer.to - (10_000 + edgeMs))).toBeLessThanOrEqual(1);

    down(grip(bar, 'start'), px(4_000) + 3);
    pointer('pointerMove', px(2_000) + 3);
    pointer('pointerUp', px(2_000) + 3);
    const startMs = (px(2_000) + 3) / SCALE - ((px(4_000) + 3) / SCALE - 4_000);
    const earlier = commits(props)[1][1].zooms[0];
    expect(earlier.to).toBe(16_000);
    expect(Math.abs(earlier.from - (10_000 + startMs))).toBeLessThanOrEqual(1);
  });

  it('moves a selected zoom a frame with the arrows, a second with Shift, as one step', () => {
    const doc = withZoom();
    const { props } = setup({ document: doc, selection: { kind: 'zoom', id: 'z1' } });
    const bar = screen.getByTestId('clip-bar-zoom');
    expect(fireEvent.keyDown(bar, { key: 'ArrowRight' })).toBe(false);
    const [start, next, options] = commits(props)[0];
    expect(start).toBe(doc);
    expect(next.zooms[0]).toMatchObject({ from: 14_033, to: 16_033 });
    expect(options).toEqual({ select: { kind: 'zoom', id: 'z1' }, coalesceKey: 'nudge:z1' });
    fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true });
    expect(commits(props)[1][1].zooms[0]).toMatchObject({ from: 13_000, to: 15_000 });
  });

  it('changes nothing when a zoom is let go where it began', () => {
    const { props } = setup({ document: withZoom() });
    down(screen.getByTestId('clip-bar-zoom'), px(5_000));
    pointer('pointerMove', px(5_000) + 20);
    pointer('pointerMove', px(5_000));
    pointer('pointerUp', px(5_000));
    expect(props.onCommit).not.toHaveBeenCalled();
  });
});

describe('the tools row', () => {
  it('splits and removes from its buttons', () => {
    const { props } = setup({ selection: { kind: 'segment', id: 'x' } });
    const tools = screen.getByTestId('clip-timeline-tools');
    fireEvent.click(within(tools).getByRole('button', { name: 'Split At The Playhead' }));
    fireEvent.click(within(tools).getByRole('button', { name: 'Remove' }));
    expect(props.onSplit).toHaveBeenCalledTimes(1);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('turns both off when they cannot run', () => {
    setup({
      splitProblemAt: () => 'Move the playhead at least 0.2 seconds inside a part to split it.',
      removeProblem: 'A clip needs at least one part.',
    });
    expect(screen.getByTestId('clip-timeline-split')).toBeDisabled();
    expect(screen.getByTestId('clip-timeline-remove')).toBeDisabled();
  });

  it('shows a refused edit first, then More Video', () => {
    const { view, props } = setup({ gettingMore: true });
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(GETTING_MORE);
    view.rerender(
      <TooltipProvider>
        <TimelineDock {...props} notice="A clip needs at least one part." />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('clip-timeline-status')).toHaveTextContent(
      'A clip needs at least one part.',
    );
  });

  it('moves the playhead from the time field, held inside the clip', () => {
    const playback = new PlaybackStore();
    jest.spyOn(playback, 'useDurationMs').mockReturnValue(30_000);
    jest.spyOn(playback, 'seekMs');
    setup({ playback });
    const field = screen.getByRole('spinbutton', { name: 'Playhead Time' });
    fireEvent.change(field, { target: { value: '0:05.0' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(playback.seekMs).toHaveBeenLastCalledWith(5_000);
    fireEvent.change(field, { target: { value: '9:00' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(playback.seekMs).toHaveBeenLastCalledWith(30_000);
  });
});

describe('the Speaker strip (Module 08)', () => {
  const stretch = (
    key: string,
    kind: 'person' | 'lost' | 'fixed',
    fromMs: number,
    toMs: number,
    person: number | null,
  ) => ({
    key,
    kind,
    person,
    fromMs,
    toMs,
    source: { from: fromMs + 10_000, to: toMs + 10_000 },
    label:
      kind === 'person' ? `Person ${(person ?? 0) + 1}` : 'We lost the speaker for 4 seconds here.',
  });

  it('is not shown when not following', () => {
    setup();
    expect(screen.queryByTestId('clip-speaker-strip')).toBeNull();
  });

  it('draws the people and hatches the lost stretch under the Video row, and selects it', () => {
    const onSelect = jest.fn();
    setup({
      speaker: {
        stretches: [
          stretch('a', 'person', 0, 10_000, 0),
          stretch('b', 'person', 10_000, 20_000, 1),
          stretch('c', 'lost', 20_000, 24_000, null),
        ],
        selectedKey: null,
        onSelect,
      },
    });
    const strip = screen.getByTestId('clip-speaker-strip');
    const people = within(strip).getAllByRole('img');
    expect(people.map((p) => p.getAttribute('aria-label'))).toEqual(['Person 1', 'Person 2']);
    expect(people[1]).toHaveStyle({ left: `${10_000 * SCALE}px` });
    const lost = within(strip).getByRole('button', { name: /lost the speaker/ });
    expect(lost).toHaveClass('bg-stripes');
    fireEvent.click(lost);
    expect(onSelect).toHaveBeenCalledWith('c');
    // It sits right under the Video row.
    const rows = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(rows.indexOf('Speaker')).toBe(rows.indexOf('Video') + 1);
  });
});

describe('the hook (Module 09)', () => {
  const hooked = () => setHook(clip(), { fromOutputMs: 4_000, toOutputMs: 6_500 });

  it('labels the hook bar and gives it its own delete', () => {
    const onRemoveHook = jest.fn();
    setup({ document: hooked(), onRemoveHook });
    const parts = screen.getAllByTestId('clip-part');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveAttribute('data-hook');
    expect(parts[0]).toHaveAccessibleName('Hook, from 0 seconds, 2.5 seconds long');
    expect(within(parts[0] as HTMLElement).getByTestId('clip-hook-label')).toHaveTextContent(
      'Hook',
    );
    expect(parts[1]).not.toHaveAttribute('data-hook');
    expect(screen.getAllByTestId('clip-hook-label')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hook' }));
    expect(onRemoveHook).toHaveBeenCalledTimes(1);
  });

  it('removes the hook itself, as one step, when the editor does not', () => {
    const doc = hooked();
    const { props } = setup({ document: doc });
    fireEvent.click(screen.getByTestId('clip-hook-delete'));
    const [[start, next]] = commits(props);
    expect(start).toBe(doc);
    expect(next.segments).toHaveLength(1);
    expect(next.segments[0]?.role).toBeUndefined();
  });

  it('shows no hook label on a clip without one', () => {
    setup();
    expect(screen.queryByTestId('clip-hook-label')).toBeNull();
    expect(screen.queryByTestId('clip-hook-delete')).toBeNull();
  });
});

describe('the brand kit intro and outro (Module 10)', () => {
  const branded = () =>
    applyBrandKit(clip(), {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Acme Kit',
      logo: null,
      logoPosition: null,
      captionStyleId: null,
      intro: {
        videoId: '44444444-4444-4444-8444-444444444444',
        durationMs: 3_000,
        width: 1920,
        height: 1080,
      },
      outro: {
        kind: 'video',
        video: {
          videoId: '55555555-5555-4555-8555-555555555555',
          durationMs: 4_000,
          width: 1280,
          height: 720,
        },
      },
    });

  it('labels the intro and outro bars on the Video row', () => {
    setup({ document: branded() });
    const parts = screen.getAllByTestId('clip-part');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveAttribute('data-brand', 'intro');
    expect(parts[0]).toHaveAccessibleName('Intro, from 0 seconds, 3 seconds long');
    expect(parts[2]).toHaveAttribute('data-brand', 'outro');
    expect(parts[1]).not.toHaveAttribute('data-brand');
    expect(screen.getAllByTestId('clip-brand-part-label').map((chip) => chip.textContent)).toEqual([
      'Intro',
      'Outro',
    ]);
  });
});
