import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { hexToHsv, hsvToHex, parseHex, pushRecent } from '../lib/color';
import { ColorPicker } from './color-picker';

describe('colour maths', () => {
  it.each([
    ['#fff', '#FFFFFF'],
    ['abc', '#AABBCC'],
    [' #1a2B3c ', '#1A2B3C'],
    ['1A2B3C', '#1A2B3C'],
  ])('reads %s as %s', (input, hex) => {
    expect(parseHex(input)).toBe(hex);
  });

  it.each(['', '#12', '#1234', 'red', '#GGGGGG', '#1A2B3C4'])('refuses %s', (input) => {
    expect(parseHex(input)).toBeNull();
  });

  it('goes to hue, saturation and value and back without drift', () => {
    for (const hex of [
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFD400',
      '#7B61FF',
      '#111111',
      '#FFFFFF',
      '#808080',
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(hexToHsv('#FF0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToHex({ h: 120, s: 1, v: 0.5 })).toBe('#008000');
  });

  it('keeps recent colours newest first, each once', () => {
    expect(pushRecent(['#111111', '#FFFFFF'], '#ffffff')).toEqual(['#FFFFFF', '#111111']);
    expect(pushRecent([], 'nope')).toEqual([]);
    expect(
      pushRecent(
        ['#1', '#2', '#3'].map((c) => c.padEnd(7, '0')),
        '#4',
        3,
      ),
    ).toHaveLength(3);
  });
});

function Harness({ onCommit = () => undefined }: { onCommit?: (hex: string) => void }) {
  const [value, setValue] = useState('#FF0000');
  const [opacity, setOpacity] = useState(1);
  return (
    <>
      <ColorPicker
        label="Text colour"
        value={value}
        onChange={setValue}
        onCommit={onCommit}
        opacity={opacity}
        onOpacityChange={setOpacity}
        recent={['#123456']}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Text colour: #FF0000' }));
}

describe('ColorPicker', () => {
  beforeAll(() => {
    // Radix popovers watch their size; jsdom has no ResizeObserver.
    if (!('ResizeObserver' in globalThis)) {
      class NoResize {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      (globalThis as unknown as { ResizeObserver: typeof NoResize }).ResizeObserver = NoResize;
    }
  });

  it('shows the colour on a flat trigger and opens the picker', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Text colour: #FF0000' });
    expect(trigger.className).not.toMatch(/shadow-(surface|brutal)/);
    expect(trigger).toHaveTextContent('#FF0000');
    open();
    expect(screen.getByRole('dialog', { name: 'Text colour' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Shade' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#123456' })).toBeInTheDocument();
  });

  it('picks a swatch and commits it once', () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: '#2F80ED' }));
    expect(screen.getByTestId('value')).toHaveTextContent('#2F80ED');
    expect(onCommit).toHaveBeenCalledWith('#2F80ED');
    expect(screen.getByRole('button', { name: '#2F80ED' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves in the shade square and along the hue strip with the arrows', () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    open();
    const shade = screen.getByRole('slider', { name: 'Shade' });
    fireEvent.keyDown(shade, { key: 'ArrowDown', shiftKey: true });
    // Red at 90% brightness.
    expect(screen.getByTestId('value')).toHaveTextContent('#E60000');
    expect(onCommit).toHaveBeenLastCalledWith('#E60000');
    const hue = screen.getByRole('slider', { name: 'Hue' });
    fireEvent.keyDown(hue, { key: 'ArrowRight' });
    expect(hue).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByTestId('value')).not.toHaveTextContent('#E60000');
  });

  it('takes a typed hex on Enter and refuses a bad one', () => {
    render(<Harness />);
    open();
    const field = screen.getByLabelText('Hex');
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByTestId('value')).toHaveTextContent('#AABBCC');
    fireEvent.change(field, { target: { value: 'nope' } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(field);
    expect(screen.getByTestId('value')).toHaveTextContent('#AABBCC');
  });

  it('shows the opacity slider when asked', () => {
    render(<Harness />);
    open();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveAttribute('aria-valuenow', '100');
  });
});
