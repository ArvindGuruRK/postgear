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
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';

export interface EditableTextProps {
  /** The text editing starts from. Read once, on mount. */
  initialText: string;
  maxLength: number;
  /** False for a brand name or a handle: Enter finishes instead of breaking the line. */
  multiline: boolean;
  /** The slot's name, for screen readers ("Headline"). */
  label: string;
  style?: CSSProperties;
  /** Every change, as it happens. */
  onInput: (text: string) => void;
  /** Editing ended: Escape, a click elsewhere, or Enter on a single-line slot. */
  onCommit: (text: string) => void;
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
  const handlers = useRef({ onInput, onCommit });

  useLayoutEffect(() => {
    handlers.current = { onInput, onCommit };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is written once, on mount; see the note at the top.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.textContent = initialText;
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

        if (event.key === 'Escape' || (!multiline && event.key === 'Enter')) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      style={{ ...style, outline: 'none', cursor: 'text', caretColor: 'currentColor' }}
    />
  );
}
