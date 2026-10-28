import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { Button } from './button';

/** jsdom has no matchMedia; GSAP's matchMedia needs one. */
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('Button hover fill', () => {
  it('runs the fill on a secondary button when a mouse can hover', async () => {
    mockMatchMedia(true);
    render(<Button variant="secondary">Add Channel</Button>);
    const button = screen.getByRole('button', { name: 'Add Channel' });

    expect(button).toHaveAttribute('data-fill-hover');
    fireEvent.pointerEnter(button);
    // The label flips a beat into the grow, once the circle is under it.
    await waitFor(() => expect(button).toHaveAttribute('data-filled'), { timeout: 2000 });
    fireEvent.pointerMove(button);
    fireEvent.pointerLeave(button);
    // Still filled while the circle shrinks away, so a label never flips
    // back to a colour that matches the fill under it.
    expect(button).toHaveAttribute('data-filled');
    await waitFor(() => expect(button).not.toHaveAttribute('data-filled'), { timeout: 2000 });
  });

  it('leaves the plain CSS hover in charge without a fine pointer or with reduced motion', () => {
    mockMatchMedia(false);
    render(<Button variant="secondary">Add Channel</Button>);
    const button = screen.getByRole('button', { name: 'Add Channel' });

    expect(button).not.toHaveAttribute('data-fill-hover');
    fireEvent.pointerEnter(button);
    expect(button).not.toHaveAttribute('data-filled');
  });

  it('leaves the filled variants (primary, red delete, highlight) without the fill', () => {
    mockMatchMedia(true);
    render(
      <>
        <Button>Create Post</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="highlight">Ask AI</Button>
      </>,
    );

    for (const name of ['Create Post', 'Delete', 'Ask AI']) {
      const button = screen.getByRole('button', { name });
      expect(button).not.toHaveAttribute('data-fill-hover');
      expect(button.querySelector('[aria-hidden]')).toBeNull();
    }
  });

  it('closes the fill when the button turns disabled under the pointer', async () => {
    mockMatchMedia(true);
    const { rerender } = render(<Button variant="secondary">Sync</Button>);
    const button = screen.getByRole('button', { name: 'Sync' });

    fireEvent.pointerEnter(button);
    await waitFor(() => expect(button).toHaveAttribute('data-filled'), { timeout: 2000 });
    rerender(
      <Button variant="secondary" disabled>
        Sync
      </Button>,
    );
    expect(button).not.toHaveAttribute('data-filled');
  });

  it('stops the fill when the variant stops being neutral', () => {
    mockMatchMedia(true);
    const { rerender } = render(<Button variant="secondary">Page 2</Button>);
    const button = screen.getByRole('button', { name: 'Page 2' });
    expect(button).toHaveAttribute('data-fill-hover');

    rerender(<Button variant="primary">Page 2</Button>);
    expect(button).not.toHaveAttribute('data-fill-hover');
    fireEvent.pointerEnter(button);
    expect(button).not.toHaveAttribute('data-filled');
  });

  it('still forwards its ref', () => {
    mockMatchMedia(true);
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} variant="secondary">
        Cancel
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });
});
