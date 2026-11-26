import { fireEvent, render, screen } from '@testing-library/react';
import { SpeakerStrip, type SpeakerStripStretch, speakerStripTone } from './speaker-strip';

const STRETCHES: SpeakerStripStretch[] = [
  { key: 'a', kind: 'person', person: 0, leftPx: 0, widthPx: 120, label: 'Person 1' },
  { key: 'b', kind: 'person', person: 1, leftPx: 120, widthPx: 80, label: 'Person 2' },
  {
    key: 'c',
    kind: 'lost',
    leftPx: 200,
    widthPx: 60,
    label: 'We lost the speaker for 3 seconds here.',
  },
  {
    key: 'd',
    kind: 'fixed',
    leftPx: 300,
    widthPx: 40,
    label: 'You placed the frame by hand here.',
  },
];

describe('SpeakerStrip', () => {
  it('draws one coloured stretch per person, by their place', () => {
    render(<SpeakerStrip stretches={STRETCHES} widthPx={400} />);
    const one = screen.getByRole('img', { name: 'Person 1' });
    const two = screen.getByRole('img', { name: 'Person 2' });
    expect(one).toHaveClass(speakerStripTone(0));
    expect(two).toHaveClass(speakerStripTone(1));
    expect(one).toHaveStyle({ left: '0px', width: '120px' });
    expect(speakerStripTone(4)).toBe(speakerStripTone(0));
  });

  it('hatches a lost stretch and marks a fixed one with a hand', () => {
    render(<SpeakerStrip stretches={STRETCHES} widthPx={400} />);
    const lost = screen.getByRole('button', { name: 'We lost the speaker for 3 seconds here.' });
    expect(lost).toHaveClass('bg-stripes');
    expect(lost.querySelector('[data-mark="hand"]')).toBeNull();
    const fixed = screen.getByRole('button', { name: 'You placed the frame by hand here.' });
    expect(fixed).not.toHaveClass('bg-stripes');
    expect(fixed.querySelector('[data-mark="hand"]')).not.toBeNull();
  });

  it('selects lost and fixed stretches, and shows the selected one', () => {
    const onSelect = jest.fn();
    render(
      <SpeakerStrip
        stretches={STRETCHES.map((s) => (s.key === 'c' ? { ...s, selected: true } : s))}
        onSelect={onSelect}
      />,
    );
    const lost = screen.getByRole('button', { name: /lost the speaker/ });
    expect(lost).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(lost);
    fireEvent.click(screen.getByRole('button', { name: /by hand/ }));
    expect(onSelect.mock.calls).toEqual([['c'], ['d']]);
  });

  it('names the row for screen readers', () => {
    render(<SpeakerStrip stretches={[]} />);
    expect(screen.getByRole('group', { name: 'Speaker' })).toBeInTheDocument();
  });
});
