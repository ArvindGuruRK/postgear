import { fireEvent, render } from '@testing-library/react';
import { ROTATE_HANDLE_OFFSET, TransformBox, type TransformPart } from './transform-box';

describe('TransformBox', () => {
  it('sits on the item centre, turned with it', () => {
    const { container } = render(
      <TransformBox x={200} y={100} width={120} height={40} rotation={30} />,
    );
    const box = container.querySelector<HTMLElement>('[data-transform-box]') as HTMLElement;
    expect(box.style.left).toBe('140px');
    expect(box.style.top).toBe('80px');
    expect(box.style.width).toBe('120px');
    expect(box.style.height).toBe('40px');
    expect(box.style.transform).toBe('rotate(30deg)');
  });

  it('shows eight handles and the turning handle, or just the ones asked for', () => {
    const { container, rerender } = render(
      <TransformBox x={0} y={0} width={10} height={10} rotation={0} />,
    );
    const parts = () =>
      [...container.querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part'));
    expect(parts()).toEqual(['body', 'rotate', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    const rotate = container.querySelector<HTMLElement>('[data-part="rotate"]') as HTMLElement;
    expect(rotate.style.top).toBe(`-${ROTATE_HANDLE_OFFSET}px`);
    rerender(
      <TransformBox
        x={0}
        y={0}
        width={10}
        height={10}
        rotation={0}
        handles={['nw', 'ne', 'se', 'sw']}
        noRotate
      />,
    );
    expect(parts()).toEqual(['body', 'nw', 'ne', 'se', 'sw']);
  });

  it('says which part was pressed', () => {
    const pressed: TransformPart[] = [];
    const { container } = render(
      <TransformBox
        x={0}
        y={0}
        width={10}
        height={10}
        rotation={0}
        onPartPointerDown={(part) => pressed.push(part)}
      />,
    );
    const part = (name: string) => container.querySelector(`[data-part="${name}"]`) as HTMLElement;
    fireEvent.pointerDown(part('se'), { button: 0 });
    fireEvent.pointerDown(part('rotate'), { button: 0 });
    fireEvent.pointerDown(part('body'), { button: 0 });
    expect(pressed).toEqual(['se', 'rotate', 'body']);
  });
});
