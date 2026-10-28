'use client';

/**
 * Typing straight onto the slide (DS-4.1).
 *
 * The element is `contenteditable="plaintext-only"`: a paste from a word
 * processor arrives as words, not as its fonts and colours, and there is no
 * markup for the stored document to pick up. It is also **uncontrolled**:
 * the text is written in once, when editing starts, and from then on the
 * element owns it. React re-rendering children into a contenteditable is what
 * makes carets jump to the start mid-word, so it never does here; every
 * change is reported through `onInput` instead, and the stored document
 * follows the element rather than the other way round.
 *
 * Length limits are enforced before the browser inserts anything
 * (`beforeinput`), because trimming the element afterwards would move the
 * caret, and the stored text must never exceed what the schema accepts.
 *
 * Ending the typing (Sprint 9b, after CarouselClick): Escape cancels, putting
 * back the text editing started from; Ctrl or Cmd with Enter keeps what was
 * typed, which is the way out of a multi-line slot, where Enter alone starts
 * a new line. A click elsewhere keeps it too, and on a one-line slot so does
 * Enter. Either way the element hands over through `onCommit`: a cancel
 * writes the starting text back into the element first, so the commit
 * carries that text and is the only report of the change back. While an
 * input method is composing, Escape and Enter are its own keys (dropping or
 * choosing a candidate), so neither ends anything then.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';

export interface EditableTextProps {
  /** The text editing starts from. Read once, on mount; Escape puts it back. */
  initialText: string;
  maxLength: number;
  /** False for a brand name or a handle: Enter finishes instead of breaking the line. */
  multiline: boolean;
  /** The slot's name, for screen readers ("Headline"). */
  label: string;
  style?: CSSProperties;
  /** Every change the person types, as it happens. */
  onInput: (text: string) => void;
  /**
   * Editing ended: a click elsewhere, Ctrl or Cmd with Enter, Enter on a
   * one-line slot (all keep the text), or Escape (back to `initialText`).
   */
  onCommit: (text: string) => void;
}

/** What a key does to the typing: ends it keeping the text, or ends it putting the old text back. */
export type TypingKeyAction = 'commit' | 'cancel';

/** The parts of a key press `typingKeyAction` reads; a `KeyboardEvent` has them all. */
export interface TypingKeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  /** True while an input method is composing a character. */
  isComposing: boolean;
  /** 229 is what Safari reports for the Enter that ends a composition, with `isComposing` false. */
  keyCode?: number;
}

/**
 * Whether a key ends the typing, and how; null for a key that is the text's
 * own (a letter, an arrow, Enter's new line in a multi-line slot). The canvas
 * reads the same keys to hand focus back to the element afterwards.
 */
export function typingKeyAction(press: TypingKeyPress, multiline: boolean): TypingKeyAction | null {
  if (press.isComposing || press.keyCode === 229) return null;
  if (press.key === 'Escape') return 'cancel';
  if (press.key !== 'Enter') return null;

  return press.ctrlKey || press.metaKey || !multiline ? 'commit' : null;
}

/** What the element holds, with any line ending the browser wrote made a plain newline. */
function readText(element: HTMLElement | null): string {
  return element ? element.innerText.replace(/\r\n?/g, '\n') : '';
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;

  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** How many characters of the element's text the current selection covers. */
function selectedLength(element: HTMLElement): number {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return 0;

  return selection.toString().length;
}

const LINE_BREAKS = new Set(['insertParagraph', 'insertLineBreak']);

export function EditableText({
  initialText,
  maxLength,
  multiline,
  label,
  style,
  onInput,
  onCommit,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  // What Escape puts back: the text as editing began, whatever the prop says later.
  const start = useRef(initialText);
  const handlers = useRef({ onInput, onCommit });

  useLayoutEffect(() => {
    handlers.current = { onInput, onCommit };
  });

  // The text is written once, on mount; see the note at the top.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.textContent = start.current;
    element.focus({ preventScroll: true });
    placeCaretAtEnd(element);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const beforeInput = (event: InputEvent) => {
      const type = event.inputType;
      if (!type.startsWith('insert') || type === 'insertCompositionText') return;

      if (LINE_BREAKS.has(type)) {
        if (!multiline) {
          event.preventDefault();
          return;
        }
      }

      const raw = LINE_BREAKS.has(type)
        ? '\n'
        : (event.data ?? event.dataTransfer?.getData('text/plain') ?? '');
      // A single-line slot takes a pasted paragraph as one line.
      const incoming = multiline ? raw : raw.replace(/\s*[\r\n]+\s*/g, ' ');
      const room = maxLength - (readText(element).length - selectedLength(element));

      if (incoming === raw && incoming.length <= room) return;

      event.preventDefault();

      if (room > 0 && incoming !== '') {
        // `insertText` keeps the browser's own undo for the edit, which a
        // direct DOM write would not. It raises its own `beforeinput`, which
        // passes this check because it now fits.
        element.ownerDocument.execCommand('insertText', false, incoming.slice(0, room));
      }
    };

    element.addEventListener('beforeinput', beforeInput);
    return () => element.removeEventListener('beforeinput', beforeInput);
  }, [maxLength, multiline]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a textarea cannot draw the slide's own typography in place, which is the point of typing on the canvas.
    <div
      ref={ref}
      data-fit-content=""
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline={multiline}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      onInput={() => handlers.current.onInput(readText(ref.current))}
      onBlur={() => handlers.current.onCommit(readText(ref.current))}
      onKeyDown={(event) => {
        // The editor's own shortcuts (arrows nudge, Delete removes) must not
        // fire while the user is typing.
        event.stopPropagation();

        const action = typingKeyAction(
          {
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.nativeEvent.isComposing,
            keyCode: event.keyCode,
          },
          multiline,
        );
        if (!action) return;

        event.preventDefault();
        const element = event.currentTarget;
        // Written straight into the element, which owns its text (see the top):
        // the blur below then commits the text editing started from.
        if (action === 'cancel') element.textContent = start.current;
        element.blur();
      }}
      style={{ ...style, outline: 'none', cursor: 'text', caretColor: 'currentColor' }}
    />
  );
}
