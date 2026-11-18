import { fireEvent, render, screen } from '@testing-library/react';
import { Playhead, type PlayheadProps } from './playhead';
import { TimeRuler } from './time-ruler';

/** jsdom has no PointerEvent, so fireEvent would drop pointerId, button and clientX. */
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

function renderPlayhead(props: Partial<PlayheadProps> = {}) {
  const handlers = {
    onDragStart: jest.fn(),
    onDrag: jest.fn(),
    onDragEnd: jest.fn(),
    onStep: jest.fn(),
    onJump: jest.fn(),
  };
  render(
    <div className="relative">
      <Playhead
        px={120}
        valueMs={12000}
        maxMs={42000}
        valueText="12 seconds of 42 seconds"
        {...handlers}
        {...props}
      />
    </div>,
  );
  return { grip: screen.getByRole('slider', { name: 'Playhead' }), handlers };
}

describe('Playhead', () => {
  it('is a slider over the time, placed in px', () => {
    const { grip } = renderPlayhead();
    expect(grip).toHaveAttribute('aria-valuenow', '12000');
    expect(grip).toHaveAttribute('aria-valuemin', '0');
    expect(grip).toHaveAttribute('aria-valuemax', '42000');
    expect(grip).toHaveAttribute('aria-valuetext', '12 seconds of 42 seconds');
    expect(grip.parentElement).toHaveStyle({ left: '120px' });
  });

  it('steps a frame with the arrows and a second with Shift', () => {
    const { grip, handlers } = renderPlayhead();
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowLeft', shiftKey: true });
    expect(handlers.onStep).toHaveBeenNthCalledWith(1, 1, false);
    expect(handlers.onStep).toHaveBeenNthCalledWith(2, -1, true);
  });

  it('jumps with Home and End', () => {
    const { grip, handlers } = renderPlayhead();
    fireEvent.keyDown(grip, { key: 'Home' });
    fireEvent.keyDown(grip, { key: 'End' });
    expect(handlers.onJump).toHaveBeenNthCalledWith(1, 'start');
    expect(handlers.onJump).toHaveBeenNthCalledWith(2, 'end');
  });

  it('reports a drag in px from where it began, and its end', () => {
    const { grip, handlers } = renderPlayhead();
    const capture = jest.fn();
    grip.setPointerCapture = capture;
    fireEvent.pointerDown(grip, { pointerId: 3, button: 0, clientX: 500 });
    expect(capture).toHaveBeenCalledWith(3);
    expect(handlers.onDragStart).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(grip, { pointerId: 3, clientX: 530 });
    expect(handlers.onDrag).toHaveBeenLastCalledWith(150);
    fireEvent.pointerMove(grip, { pointerId: 3, clientX: 460 });
    expect(handlers.onDrag).toHaveBeenLastCalledWith(80);

    fireEvent.pointerUp(grip, { pointerId: 3, clientX: 460 });
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(grip, { pointerId: 3, clientX: 600 });
    expect(handlers.onDrag).toHaveBeenCalledTimes(2);
  });

  it('ignores a move with no drag under way', () => {
    const { grip, handlers } = renderPlayhead();
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 50 });
    expect(handlers.onDrag).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const { grip, handlers } = renderPlayhead({ disabled: true });
    expect(grip).toHaveAttribute('tabindex', '-1');
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    expect(handlers.onStep).not.toHaveBeenCalled();
  });
});

describe('TimeRuler', () => {
  it('draws the ticks it is given and labels the major ones', () => {
    render(
      <TimeRuler
        widthPx={400}
        ticks={[
          { px: 0, label: '0:00', major: true },
          { px: 50, major: false },
          { px: 100, label: '0:10', major: true },
        ]}
      />,
    );
    const ruler = screen.getByRole('group', { name: 'Time Ruler' });
    expect(ruler).toHaveStyle({ width: '400px' });
    expect(ruler).toHaveTextContent('0:000:10');
    expect(ruler.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('passes pointer presses up for click to seek', () => {
    const onPointerDown = jest.fn();
    render(<TimeRuler widthPx={100} ticks={[]} onPointerDown={onPointerDown} />);
    fireEvent.pointerDown(screen.getByRole('group', { name: 'Time Ruler' }), { clientX: 30 });
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
