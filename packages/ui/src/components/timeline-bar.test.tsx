import { fireEvent, render, screen } from '@testing-library/react';
import { TimelineBar, TimelineBarChip } from './timeline-bar';
import { TimelineRow } from './timeline-row';

/** jsdom has no PointerEvent, so fireEvent would drop pointerId. */
beforeAll(() => {
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

function renderBar(props: Partial<React.ComponentProps<typeof TimelineBar>> = {}) {
  const handlers = {
    onBodyPointerDown: jest.fn(),
    onStartGripPointerDown: jest.fn(),
    onEndGripPointerDown: jest.fn(),
  };
  const view = render(
    <TimelineRow label="Video">
      <TimelineBar
        aria-label="Part 1, from 0 seconds, 8 seconds long"
        leftPx={40}
        widthPx={200}
        {...handlers}
        {...props}
      >
        Part 1
      </TimelineBar>
    </TimelineRow>,
  );
  const bar = screen.getByRole('button', { name: 'Part 1, from 0 seconds, 8 seconds long' });
  const grip = (side: 'start' | 'end') => bar.querySelector(`[data-grip="${side}"]`) as HTMLElement;
  return { ...view, bar, grip, handlers };
}

describe('TimelineBar', () => {
  it('sits where it is told, in px', () => {
    const { bar } = renderBar();
    expect(bar).toHaveStyle({ left: '40px', width: '200px' });
    expect(bar).toHaveAttribute('tabindex', '0');
  });

  it('passes a press on the body up, and not to a grip', () => {
    const { bar, handlers } = renderBar();
    fireEvent.pointerDown(bar, { pointerId: 1 });
    expect(handlers.onBodyPointerDown).toHaveBeenCalledTimes(1);
    expect(handlers.onStartGripPointerDown).not.toHaveBeenCalled();
    expect(handlers.onEndGripPointerDown).not.toHaveBeenCalled();
  });

  it('passes a press on each grip up, and not to the body', () => {
    const { grip, handlers } = renderBar();
    fireEvent.pointerDown(grip('start'), { pointerId: 1 });
    expect(handlers.onStartGripPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(grip('end'), { pointerId: 1 });
    expect(handlers.onEndGripPointerDown).toHaveBeenCalledTimes(1);
    expect(handlers.onBodyPointerDown).not.toHaveBeenCalled();
  });

  it('captures the pointer on a grip', () => {
    const { grip } = renderBar();
    const capture = jest.fn();
    grip('end').setPointerCapture = capture;
    fireEvent.pointerDown(grip('end'), { pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
  });

  it('shows the ring in the row colour when selected', () => {
    const { bar, rerender } = renderBar({ tone: 'success' });
    expect(bar).toHaveAttribute('aria-pressed', 'false');
    expect(bar).not.toHaveClass('ring-actionSuccess');

    rerender(
      <TimelineRow label="Video">
        <TimelineBar
          aria-label="Part 1, from 0 seconds, 8 seconds long"
          leftPx={40}
          widthPx={200}
          tone="success"
          selected
        >
          Part 1
        </TimelineBar>
      </TimelineRow>,
    );
    expect(bar).toHaveAttribute('aria-pressed', 'true');
    expect(bar).toHaveClass('ring-2', 'ring-actionSuccess');
  });

  it('passes nothing up while disabled', () => {
    const { bar, grip, handlers } = renderBar({ disabled: true });
    fireEvent.pointerDown(bar, { pointerId: 1 });
    fireEvent.pointerDown(grip('start'), { pointerId: 1 });
    expect(handlers.onBodyPointerDown).not.toHaveBeenCalled();
    expect(handlers.onStartGripPointerDown).not.toHaveBeenCalled();
    expect(bar).toHaveAttribute('tabindex', '-1');
  });

  it('has no grips when it cannot be resized', () => {
    const { grip } = renderBar({ resizable: false });
    expect(grip('start')).toBeNull();
  });

  it('hatches the part it does not hold, from hatchFromPx to its end', () => {
    const { bar } = renderBar({ hatchFromPx: 150 });
    const hatch = bar.querySelector('[data-hatch]');
    expect(hatch).toHaveStyle({ left: '150px' });
    expect(hatch).toHaveClass('bg-stripes');
  });

  it('draws no hatch without hatchFromPx', () => {
    expect(renderBar().bar.querySelector('[data-hatch]')).toBeNull();
  });

  it('draws no hatch when it starts at or past the end', () => {
    expect(renderBar({ hatchFromPx: 400 }).bar.querySelector('[data-hatch]')).toBeNull();
  });

  it('hatches from its left edge to hatchUntilPx, for video brought back before the start', () => {
    const { bar } = renderBar({ hatchUntilPx: 60 });
    const hatch = bar.querySelector('[data-hatch="start"]');
    expect(hatch).toHaveStyle({ width: '60px' });
    expect(hatch).toHaveClass('bg-stripes');
    expect(bar.querySelector('[data-hatch="end"]')).toBeNull();
  });

  it('hatches both ends at once', () => {
    const both = renderBar({ hatchUntilPx: 40, hatchFromPx: 160 }).bar;
    expect(both.querySelector('[data-hatch="start"]')).not.toBeNull();
    expect(both.querySelector('[data-hatch="end"]')).not.toBeNull();
  });

  it('draws no leading hatch at a zero width', () => {
    expect(renderBar({ hatchUntilPx: 0 }).bar.querySelector('[data-hatch]')).toBeNull();
  });

  it('shows its children, such as a speed chip', () => {
    render(
      <TimelineBar aria-label="Part 2" leftPx={0} widthPx={120}>
        <TimelineBarChip>2x</TimelineBarChip>
      </TimelineBar>,
    );
    expect(screen.getByRole('button', { name: 'Part 2' })).toHaveTextContent('2x');
  });
});

describe('TimelineRow', () => {
  it('names the row and is slim when empty', () => {
    render(<TimelineRow label="Overlay" slim />);
    const row = screen.getByRole('group', { name: 'Overlay' });
    expect(row).toHaveTextContent('Overlay');
    expect(row.querySelector('.h-7')).not.toBeNull();
  });

  it('passes a press on the empty track up', () => {
    const onTrackPointerDown = jest.fn();
    render(<TimelineRow label="Sound" widthPx={600} onTrackPointerDown={onTrackPointerDown} />);
    const track = screen.getByRole('group', { name: 'Sound' }).querySelector('.bg-inset');
    expect(track).toHaveStyle({ width: '600px' });
    fireEvent.pointerDown(track as Element);
    expect(onTrackPointerDown).toHaveBeenCalledTimes(1);
  });
});
