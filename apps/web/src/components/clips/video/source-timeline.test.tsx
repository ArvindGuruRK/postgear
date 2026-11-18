import { TooltipProvider } from '@postgear/ui';
import { pxPerMs, ZOOM_STEP, zoomBounds } from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipSummary } from '@/types/clips';
import { fixtureClipSummary } from '../library/clip-list-fixtures';
import { SourcePlayerStore } from './source-player';
import { SourceTimeline, type TimelineControls } from './source-timeline';
import { dragMarkEdge, type MarkedRange, moveMark, NO_MARK } from './video-page-model';

/** The scroller is 1088 px wide: 1000 px of track after the 88 px label column. */
const SCROLLER_PX = 1088;
const TRACK_PX = 1000;
const FPS = 30;
const DURATION = 180_000;
const SCALE = pxPerMs(zoomBounds(DURATION, TRACK_PX, FPS).min);

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  // jsdom has no PointerEvent, so fireEvent would drop pointerId and clientX.
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
      return this.dataset.testid === 'source-timeline' ? SCROLLER_PX : 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const CUT = fixtureClipSummary({
  id: 'cut-1',
  title: 'Cut One',
  range: { fromMs: 20_000, toMs: 50_000 },
});
const SHOWN = fixtureClipSummary({
  id: 'cut-2',
  title: 'Cut Two',
  state: 'exported',
  range: { fromMs: 90_000, toMs: 120_000 },
});
const UNREADABLE = fixtureClipSummary({ id: 'cut-3', title: 'Cut Three', range: null });

function setup(
  options: { mark?: MarkedRange; clips?: readonly ClipSummary[]; selectedClipId?: string } = {},
) {
  const store = new SourcePlayerStore(DURATION);
  jest.spyOn(store, 'seek');
  jest.spyOn(store, 'pause');
  const onMarkChange = jest.fn();
  const onSelectClip = jest.fn();
  const controlRef = createRef<TimelineControls | null>() as { current: TimelineControls | null };
  const view = render(
    <TooltipProvider>
      <SourceTimeline
        store={store}
        durationMs={DURATION}
        fps={FPS}
        filmstrip={null}
        waveform={null}
        mark={options.mark ?? NO_MARK}
        onMarkChange={onMarkChange}
        clips={options.clips ?? []}
        selectedClipId={options.selectedClipId ?? null}
        onSelectClip={onSelectClip}
        controlRef={controlRef}
      />
    </TooltipProvider>,
  );
  return { store, onMarkChange, onSelectClip, controlRef, view };
}

/** The pressable track of a named row (the row's second child; the first is its label). */
function track(name: string): HTMLElement {
  return screen.getByRole('group', { name }).children[1] as HTMLElement;
}

function press(target: Element, clientX: number) {
  (target as HTMLElement).setPointerCapture = jest.fn();
  act(() => {
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX });
  });
}

function pointer(type: 'pointerMove' | 'pointerUp', clientX: number) {
  act(() => {
    fireEvent[type](window, { pointerId: 1, button: 0, clientX });
  });
}

const zoomIn = () => screen.getByRole('button', { name: 'Zoom In' });
const zoomOut = () => screen.getByRole('button', { name: 'Zoom Out' });
const fit = () => screen.getByRole('button', { name: 'Show The Whole Video' });

describe('the marking sentence', () => {
  it('says how to start, then what is marked', () => {
    const { view } = setup();
    expect(screen.getByText('Press I to mark a start and O to mark an end.')).toBeVisible();

    view.unmount();
    setup({ mark: { inMs: 12_000, outMs: null } });
    expect(screen.getByText(/^Start at .+\. Press O to mark the end\.$/)).toBeVisible();
  });

  it('names both ends once the range is marked', () => {
    setup({ mark: { inMs: 12_000, outMs: 42_000 } });
    expect(screen.getByText(/^Marked .+ to .+$/)).toBeVisible();
  });
});

describe('zooming', () => {
  it('opens showing the whole video, so only Zoom In works', () => {
    setup();
    expect(zoomIn()).toBeEnabled();
    expect(zoomOut()).toBeDisabled();
    expect(fit()).toBeDisabled();
    expect(track('Video').style.width).toBe(`${TRACK_PX}px`);
  });

  it('zooms in by one step from the button, and back to the whole video with Show The Whole Video', () => {
    setup();
    fireEvent.click(zoomIn());
    expect(zoomOut()).toBeEnabled();
    expect(fit()).toBeEnabled();
    const wider = Number.parseFloat(track('Video').style.width);
    expect(wider).toBeGreaterThan(TRACK_PX);
    expect(wider).toBeCloseTo(TRACK_PX * ZOOM_STEP, -1);

    fireEvent.click(fit());
    expect(track('Video').style.width).toBe(`${TRACK_PX}px`);
    expect(zoomOut()).toBeDisabled();
  });

  it('hands the page its + and - through the control ref', () => {
    const { controlRef } = setup();
    expect(controlRef.current).not.toBeNull();
    act(() => controlRef.current?.zoomIn());
    act(() => controlRef.current?.zoomIn());
    const twice = Number.parseFloat(track('Video').style.width);
    expect(twice).toBeGreaterThan(TRACK_PX * ZOOM_STEP);
    act(() => controlRef.current?.zoomOut());
    expect(Number.parseFloat(track('Video').style.width)).toBeLessThan(twice);
    act(() => controlRef.current?.fit());
    expect(track('Video').style.width).toBe(`${TRACK_PX}px`);
  });

  it('lets go of the control ref when it leaves', () => {
    const { controlRef, view } = setup();
    view.unmount();
    expect(controlRef.current).toBeNull();
  });

  it('zooms with Ctrl and the wheel, never with the wheel alone', () => {
    setup();
    const scroller = screen.getByTestId('source-timeline');
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(track('Video').style.width).toBe(`${TRACK_PX}px`);
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
    expect(Number.parseFloat(track('Video').style.width)).toBeGreaterThan(TRACK_PX);
  });
});

describe('moving the playhead', () => {
  it('seeks to where a row is pressed', () => {
    const { store } = setup();
    press(track('Video'), 250);
    expect(store.seek).toHaveBeenLastCalledWith(250 / SCALE);
    press(track('Sound'), 500);
    expect(store.seek).toHaveBeenLastCalledWith(500 / SCALE);
    expect(store.getCurrentMs()).toBe(Math.round(500 / SCALE));
  });

  it('keeps a seek inside the video', () => {
    const { store } = setup();
    press(track('Video'), TRACK_PX + 400);
    expect(store.seek).toHaveBeenLastCalledWith(DURATION);
  });

  it('scrubs while the ruler is held, and stops when let go', () => {
    const { store } = setup();
    press(screen.getByRole('group', { name: 'Time Ruler' }), 100);
    expect(store.seek).toHaveBeenLastCalledWith(100 / SCALE);
    pointer('pointerMove', 300);
    expect(store.seek).toHaveBeenLastCalledWith(300 / SCALE);
    pointer('pointerUp', 300);
    const calls = (store.seek as jest.Mock).mock.calls.length;
    pointer('pointerMove', 600);
    expect(store.seek).toHaveBeenCalledTimes(calls);
  });

  it('is a slider the keys move a second at a time, five with Shift, and Home and End', () => {
    const { store } = setup();
    act(() => store.seek(60_000));
    const playhead = screen.getByRole('slider', { name: 'Playhead' });
    expect(playhead).toHaveAttribute('aria-valuenow', '60000');
    expect(playhead).toHaveAttribute('aria-valuemax', String(DURATION));

    fireEvent.keyDown(playhead, { key: 'ArrowRight' });
    expect(store.seek).toHaveBeenLastCalledWith(61_000);
    fireEvent.keyDown(playhead, { key: 'ArrowLeft', shiftKey: true });
    expect(store.seek).toHaveBeenLastCalledWith(56_000);
    fireEvent.keyDown(playhead, { key: 'End' });
    expect(store.seek).toHaveBeenLastCalledWith(DURATION);
    fireEvent.keyDown(playhead, { key: 'Home' });
    expect(store.seek).toHaveBeenLastCalledWith(0);
  });

  it('pauses when the playhead is dragged, and follows the drag', () => {
    const { store } = setup();
    const playhead = screen.getByRole('slider', { name: 'Playhead' });
    press(playhead, 0);
    expect(store.pause).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.pointerMove(playhead, { pointerId: 1, clientX: 200 });
    });
    expect(store.seek).toHaveBeenLastCalledWith(200 / SCALE);
  });
});

describe('the marked band', () => {
  const MARK = { inMs: 30_000, outMs: 60_000 };

  it('shows the range as one band with its length, and only a line for a start alone', () => {
    const { view } = setup({ mark: MARK });
    const band = screen.getByRole('button', { name: 'Marked range, 0:30' });
    expect(band.style.left).toBe(`${30_000 * SCALE}px`);
    expect(within(band).getByText('0:30')).toBeInTheDocument();
    expect(band.className).toContain('ring-actionPrimary');
    expect(band.className).not.toContain('ring-actionDanger');

    view.unmount();
    setup({ mark: { inMs: 30_000, outMs: null } });
    expect(screen.queryByRole('button', { name: /^Marked range/ })).toBeNull();
  });

  it('rings the band in red while the range is too short to be a clip', () => {
    setup({ mark: { inMs: 30_000, outMs: 31_000 } });
    const band = screen.getByRole('button', { name: 'Marked range, 0:01' });
    expect(band.className).toContain('ring-actionDanger');
    // The fill stays a light tint so the filmstrip shows through.
    expect(band.className).toContain('bg-actionPrimary/25');
    // At least six pixels wide, so it can still be grabbed.
    expect(Number.parseFloat(band.style.width)).toBeGreaterThanOrEqual(6);
  });

  it('moves the whole band by its body, from where the drag began, without seeking', () => {
    const { onMarkChange, store } = setup({ mark: MARK });
    const band = screen.getByRole('button', { name: 'Marked range, 0:30' });
    press(band, 200);
    expect(store.seek).not.toHaveBeenCalled();
    pointer('pointerMove', 260);
    pointer('pointerMove', 300);
    expect(onMarkChange).toHaveBeenLastCalledWith(moveMark(MARK, 100 / SCALE, DURATION));
    pointer('pointerUp', 300);
  });

  it('moves one end by its grip, never past the other', () => {
    const { onMarkChange } = setup({ mark: MARK });
    const band = screen.getByRole('button', { name: 'Marked range, 0:30' });
    press(band.querySelector('[data-grip="start"]') as HTMLElement, 100);
    pointer('pointerMove', 130);
    expect(onMarkChange).toHaveBeenLastCalledWith(
      dragMarkEdge(MARK, 'in', 30_000 + 30 / SCALE, DURATION),
    );
    pointer('pointerMove', 900);
    const last = onMarkChange.mock.calls.at(-1)?.[0] as MarkedRange;
    expect(last.inMs).toBe(MARK.outMs - 3_000);
    pointer('pointerUp', 900);

    press(band.querySelector('[data-grip="end"]') as HTMLElement, 400);
    pointer('pointerMove', 450);
    expect(onMarkChange).toHaveBeenLastCalledWith(
      dragMarkEdge(MARK, 'out', 60_000 + 50 / SCALE, DURATION),
    );
    pointer('pointerUp', 450);
  });

  it('ignores a press with any button but the main one', () => {
    const { onMarkChange } = setup({ mark: MARK });
    const band = screen.getByRole('button', { name: 'Marked range, 0:30' });
    act(() => {
      fireEvent.pointerDown(band, { pointerId: 1, button: 2, clientX: 200 });
    });
    pointer('pointerMove', 400);
    expect(onMarkChange).not.toHaveBeenCalled();
  });
});

describe('the clips already cut', () => {
  it('has no Clips row while the video has none', () => {
    setup();
    expect(screen.queryByRole('group', { name: 'Clips' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sound' })).toBeInTheDocument();
  });

  it('draws a line for each clip with a range, coloured by its state, the chosen one marked', () => {
    setup({ clips: [CUT, SHOWN, UNREADABLE], selectedClipId: 'cut-2' });
    const row = screen.getByRole('group', { name: 'Clips' });
    const bars = within(row).getAllByRole('button');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual(['Cut One', 'Cut Two']);
    expect(bars[0].style.left).toBe(`${20_000 * SCALE}px`);
    expect(bars[0].className).toContain('bg-actionAccent');
    expect(bars[1].className).toContain('bg-actionSuccess');
    expect(bars[0]).toHaveAttribute('aria-pressed', 'false');
    expect(bars[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('chooses a clip from its line, without seeking', () => {
    const { onSelectClip, store } = setup({ clips: [CUT] });
    press(screen.getByRole('button', { name: 'Cut One' }), 150);
    expect(onSelectClip).toHaveBeenCalledWith(CUT);
    expect(store.seek).not.toHaveBeenCalled();
  });
});
