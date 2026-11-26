import { fireEvent, render, screen } from '@testing-library/react';
import {
  TranscriptText,
  type TranscriptTextParagraph,
  type TranscriptTextProps,
} from './transcript-text';

/** jsdom has no PointerEvent, so fireEvent would drop button and shiftKey. */
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

const PARAGRAPHS: TranscriptTextParagraph[] = [
  {
    key: 'p0',
    label: '0:00',
    words: [
      { id: 10, text: 'Before', state: 'outside' },
      { id: 11, text: 'So', unsure: true },
      { id: 12, text: 'this' },
      { id: 13, text: 'is' },
    ],
  },
  {
    key: 'p1',
    label: '0:04',
    words: [
      { id: 14, text: 'cut', state: 'removed' },
      { id: 15, text: 'out', state: 'removed' },
      { id: 16, text: 'great.' },
      { id: 17, text: 'After', state: 'outside' },
    ],
  },
];

function setup(props: Partial<TranscriptTextProps> = {}) {
  const handlers = {
    onWordPress: jest.fn(),
    onWordOpen: jest.fn(),
    onActivate: jest.fn(),
    onDelete: jest.fn(),
    onRestore: jest.fn(),
    onSelectionChange: jest.fn(),
  };
  render(<TranscriptText paragraphs={PARAGRAPHS} label="Transcript" {...handlers} {...props} />);
  const text = screen.getByRole('listbox', { name: 'Transcript' });
  const word = (id: number) => text.querySelector(`[data-word-id="${id}"]`) as HTMLElement;
  return { ...handlers, text, word };
}

describe('TranscriptText', () => {
  it('shows each state: spoken, removed, outside, unsure, and the margin times', () => {
    const { word } = setup({ spokenId: 12 });
    expect(word(12)).toHaveAttribute('aria-current', 'true');
    expect(word(14)).toHaveAttribute('data-state', 'removed');
    expect(word(14).className).toContain('line-through');
    expect(word(10)).toHaveAttribute('aria-disabled', 'true');
    expect(word(11).className).toContain('decoration-dotted');
    expect(screen.getByText('0:04')).toBeInTheDocument();
  });

  it('jumps on a press and opens a word on a double press', () => {
    const { word, onWordPress, onWordOpen } = setup();
    fireEvent.click(word(13));
    expect(onWordPress).toHaveBeenCalledWith(13);
    fireEvent.doubleClick(word(13));
    expect(onWordOpen).toHaveBeenCalledWith(13);
    // Outside words are context only.
    fireEvent.click(word(10));
    expect(onWordPress).toHaveBeenCalledTimes(1);
    // A cut word is not fixed in place.
    fireEvent.doubleClick(word(14));
    expect(onWordOpen).toHaveBeenCalledTimes(1);
  });

  it('moves a caret by word with the arrows, skipping words outside', () => {
    const { text, word, onActivate } = setup();
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    expect(word(11)).toHaveAttribute('aria-selected', 'true');
    expect(text).toHaveAttribute('aria-activedescendant', word(11).id);
    fireEvent.keyDown(text, { key: 'End' });
    expect(word(16)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    expect(word(16)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(16);
  });

  it('extends with Shift and deletes the selection in reading order', () => {
    const { text, word, onDelete, onSelectionChange } = setup();
    fireEvent.keyDown(text, { key: 'Home' });
    fireEvent.keyDown(text, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(text, { key: 'ArrowRight', shiftKey: true });
    expect(word(11)).toHaveAttribute('aria-selected', 'true');
    expect(word(13)).toHaveAttribute('aria-selected', 'true');
    expect(onSelectionChange).toHaveBeenLastCalledWith({ anchor: 11, focus: 13 }, [11, 12, 13]);
    fireEvent.keyDown(text, { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledWith([11, 12, 13]);
    // The cut words are not left selected.
    expect(word(11)).toHaveAttribute('aria-selected', 'false');
    expect(word(13)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(text, { key: 'Escape' });
    expect(word(11)).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(text, { key: 'Backspace' });
    expect(onDelete).toHaveBeenLastCalledWith([13]);
  });

  it('selects by dragging across words', () => {
    const { word, onSelectionChange } = setup();
    fireEvent.pointerDown(word(12), { button: 0 });
    fireEvent.pointerEnter(word(16));
    fireEvent.pointerUp(window);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      { anchor: 12, focus: 16 },
      [12, 13, 14, 15, 16],
    );
    // After the drag, moving over words selects nothing more.
    fireEvent.pointerEnter(word(11));
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      { anchor: 12, focus: 16 },
      [12, 13, 14, 15, 16],
    );
  });

  it('offers Restore on hover over a cut run, with every word of the run', () => {
    const { word, onRestore } = setup();
    expect(screen.queryByTestId('transcript-restore')).toBeNull();
    fireEvent.mouseEnter(word(15));
    fireEvent.click(screen.getByTestId('transcript-restore'));
    expect(onRestore).toHaveBeenCalledWith([14, 15]);
  });

  it('has no Restore when the caller does not offer it, and marks find matches', () => {
    const { word } = setup({
      onRestore: undefined,
      matchIds: new Set([12, 16]),
      currentMatchId: 16,
    });
    fireEvent.mouseEnter(word(14));
    expect(screen.queryByTestId('transcript-restore')).toBeNull();
    expect(word(12)).toHaveAttribute('data-match', 'true');
    expect(word(16).className).toContain('bg-actionAccent');
  });

  it('draws what the caller puts after a word', () => {
    setup({ renderAfterWord: (id) => (id === 12 ? <span data-testid="fix">Fix</span> : null) });
    expect(screen.getByTestId('fix')).toBeInTheDocument();
  });
});
