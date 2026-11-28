import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

  it('reads what is only seen: a cut word and an unsure word point at a note, and the keys are named', () => {
    const { text, word } = setup();
    const noteOf = (el: HTMLElement) =>
      document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(noteOf(word(14))).toBe('Cut. Enter restores it.');
    expect(noteOf(word(11))).toBe('Hard to hear.');
    expect(word(12)).not.toHaveAttribute('aria-describedby');
    // The word's own text stays just the word.
    expect(word(14)).toHaveTextContent(/^cut$/);
    expect(noteOf(text)).toBe(
      'Arrow keys move word by word, Shift and an arrow selects, Enter jumps there, Delete cuts, F2 fixes the word.',
    );
  });

  it('names only the keys it answers, and a cut word without Restore says only that it is cut', () => {
    render(<TranscriptText paragraphs={PARAGRAPHS} label="Words" />);
    const text = screen.getByRole('listbox', { name: 'Words' });
    const noteOf = (el: Element | null) =>
      document.getElementById(el?.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(noteOf(text)).toBe('Arrow keys move word by word, Shift and an arrow selects.');
    expect(noteOf(text.querySelector('[data-word-id="14"]'))).toBe('Cut.');
  });

  it('says how many words are selected once a selection grows past one word', () => {
    const { text } = setup();
    const status = screen.getByTestId('transcript-selected-count');
    expect(status).toHaveAttribute('role', 'status');
    fireEvent.keyDown(text, { key: 'Home' });
    expect(status).toHaveTextContent(/^$/);
    fireEvent.keyDown(text, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(text, { key: 'ArrowRight', shiftKey: true });
    expect(status).toHaveTextContent('3 words selected.');
  });

  it('opens the caret word with F2, but not a cut word', () => {
    const { text, onWordOpen } = setup();
    fireEvent.keyDown(text, { key: 'Home' });
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    fireEvent.keyDown(text, { key: 'F2' });
    expect(onWordOpen).toHaveBeenCalledWith(12);
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    fireEvent.keyDown(text, { key: 'F2' });
    expect(onWordOpen).toHaveBeenCalledTimes(1);
  });

  it('shows Restore under the caret on a cut run and restores it with Enter', () => {
    const { text, onRestore, onActivate } = setup();
    fireEvent.keyDown(text, { key: 'End' });
    fireEvent.keyDown(text, { key: 'ArrowLeft' });
    expect(screen.getByTestId('transcript-restore')).toBeInTheDocument();
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(onRestore).toHaveBeenCalledWith([14, 15]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('gives focus back to the text when the field after a word closes', () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <TranscriptText
          paragraphs={PARAGRAPHS}
          label="Transcript"
          renderAfterWord={(id) =>
            id === 12 && open ? <input aria-label="Fix" onKeyDown={() => setOpen(false)} /> : null
          }
        />
      );
    }
    render(<Host />);
    const field = screen.getByRole('textbox', { name: 'Fix' });
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Fix' })).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Transcript' })).toHaveFocus();
  });

  it('draws again only the paragraphs the spoken word moves through', () => {
    // Each paragraph draws its words with words.map, so counting the calls counts its draws.
    let draws = 0;
    const many: TranscriptTextParagraph[] = Array.from({ length: 40 }, (_, p) => {
      const words = Array.from({ length: 25 }, (_, w) => ({
        id: p * 25 + w,
        text: `w${p * 25 + w}`,
      }));
      return {
        key: `p${p}`,
        label: `${p}:00`,
        words: Object.assign(words, {
          map(this: typeof words, ...args: Parameters<typeof words.map>) {
            draws += 1;
            return Array.prototype.map.apply(this, args);
          },
        }),
      };
    });
    const { rerender } = render(
      <TranscriptText paragraphs={many} label="Transcript" spokenId={0} />,
    );
    expect(draws).toBe(40);
    draws = 0;
    // Word to word inside the first paragraph: that paragraph alone.
    for (let id = 1; id <= 5; id += 1) {
      rerender(<TranscriptText paragraphs={many} label="Transcript" spokenId={id} />);
    }
    expect(draws).toBe(5);
    draws = 0;
    // Across into the second: the one it leaves and the one it enters.
    rerender(<TranscriptText paragraphs={many} label="Transcript" spokenId={25} />);
    expect(draws).toBe(2);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1000);
    expect(document.querySelector('[data-word-id="25"]')).toHaveAttribute('aria-current', 'true');
    expect(document.querySelector('[data-word-id="5"]')).not.toHaveAttribute('aria-current');
  });
});
