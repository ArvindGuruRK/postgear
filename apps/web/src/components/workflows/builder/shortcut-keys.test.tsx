import { render } from '@testing-library/react';
import { ShortcutKeys } from './shortcut-keys';

const caps = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="kbd"]')).map((cap) => cap.textContent);

describe('ShortcutKeys', () => {
  it('draws one key cap for a single key', () => {
    const { container } = render(<ShortcutKeys keys={['N']} />);
    expect(caps(container)).toEqual(['N']);
    expect(container.querySelector('[data-slot="kbd-group"]')).toBeNull();
  });

  it('draws one key cap per key, grouped, for a combination', () => {
    const { container } = render(<ShortcutKeys keys={['Ctrl', 'Shift', 'Z']} />);
    expect(caps(container)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(container.querySelector('[data-slot="kbd-group"]')).not.toBeNull();
  });
});
