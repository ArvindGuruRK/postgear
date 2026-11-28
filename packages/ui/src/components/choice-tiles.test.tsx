import { fireEvent, render, screen } from '@testing-library/react';
import { ChoiceTiles } from './choice-tiles';

const OPTIONS = [
  { value: 'short', label: 'Short', line: 'One line.' },
  { value: 'long', label: 'Long', line: 'A sentence long enough to wrap onto a second line.' },
] as const;

function show(value: 'short' | 'long' = 'short') {
  const onValueChange = jest.fn();
  render(
    <ChoiceTiles label="Length" options={OPTIONS} value={value} onValueChange={onValueChange} />,
  );
  return { onValueChange };
}

describe('ChoiceTiles', () => {
  it('chooses one tile by press, with the chosen one pressed', () => {
    const { onValueChange } = show();
    expect(screen.getByRole('button', { name: /^Short/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Long/ }));
    expect(onValueChange).toHaveBeenCalledWith('long');
  });

  it('starts worded tiles at their top, so names line up across the row (Module 16)', () => {
    show();
    for (const name of [/^Short/, /^Long/]) {
      const tile = screen.getByRole('button', { name });
      expect(tile.className).toContain('justify-start');
      expect(tile.className).not.toContain('justify-center');
    }
  });

  it('keeps the chosen tile line at full strength, muting only the others (Module 16)', () => {
    show('long');
    expect(screen.getByText(OPTIONS[1].line).className).not.toContain('type-muted');
    expect(screen.getByText(OPTIONS[0].line).className).toContain('type-muted');
  });

  it('keeps a tile with a drawing centred', () => {
    render(
      <ChoiceTiles
        label="Shape"
        options={[{ value: 'v', label: 'Vertical', drawing: <svg />, line: '9:16' }]}
        value="v"
        onValueChange={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Vertical/ }).className).toContain('justify-center');
  });
});
