'use client';

/**
 * Typing on the clip (Module 11 section 6): the words of a text, edited
 * where they are drawn, in their own font, size, colour and backing.
 *
 * - The box is laid out with the preview's own `textCss` (the numbers the
 *   export's ASS line is written from), inside a canvas-pixel box scaled to
 *   the stage, so it sits exactly over the text it replaces (the preview
 *   hides that text while this is open).
 * - **Uncontrolled**, as Studio's typing on the canvas is: the text is
 *   written in once, and every change is reported through `onInput`, so the
 *   caret never jumps.
 * - Escape, Ctrl or Cmd with Enter, or a click elsewhere end the typing and
 *   keep what was typed (`onDone`). Enter alone starts a new line.
 * - Emoji are stickers, never text: one typed or pasted is left out and
 *   `onEmoji` says so. The text never grows past `TEXT_MAX`.
 */
import { typingKeyAction } from '@postgear/design-engine';
import {
  type FontManifest,
  hasEmoji,
  stripEmoji,
  TEXT_MAX,
  type TextItem,
} from '@postgear/video-engine';
import { textCss } from '@postgear/video-preview';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Size } from './transform-model';

/** What the element holds, line endings made plain newlines. */
function readText(element: HTMLElement | null): string {
  if (!element) return '';
  // `innerText` keeps the line breaks as typed (jsdom has none: its text content then).
  const text =
    typeof element.innerText === 'string' ? element.innerText : (element.textContent ?? '');
  return text.replace(/\r\n?/g, '\n');
}

function selectAll(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectedLength(element: HTMLElement): number {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return 0;
  return selection.toString().length;
}

const LINE_BREAKS = new Set(['insertParagraph', 'insertLineBreak']);

export function InPlaceText({
  item,
  canvas,
  stageScale,
  manifest,
  fontFamily,
  onInput,
  onDone,
  onEmoji,
}: {
  /** The text as it is now (its words are read once, when typing starts). */
  item: TextItem;
  canvas: Size;
  /** Screen pixels per canvas pixel. */
  stageScale: number;
  manifest?: FontManifest;
  fontFamily: (family: string) => string;
  onInput: (text: string) => void;
  onDone: (text: string) => void;
  onEmoji: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const handlers = useRef({ onInput, onDone, onEmoji });
  const initial = useRef(item.text);
  const ended = useRef(false);

  useLayoutEffect(() => {
    handlers.current = { onInput, onDone, onEmoji };
  });

  // The look follows the item (a size or colour changed while typing); the words never do.
  useLayoutEffect(() => {
    const boxNode = box.current;
    const wordsNode = words.current;
    if (!boxNode || !wordsNode) return;
    const css = textCss(item, canvas, manifest, fontFamily);
    for (const [name, value] of Object.entries(css.box)) boxNode.style.setProperty(name, value);
    for (const [name, value] of Object.entries(css.words)) {
      if (value === '') wordsNode.style.removeProperty(name);
      else wordsNode.style.setProperty(name, value);
    }
    wordsNode.style.textTransform = item.style.uppercase ? 'uppercase' : 'none';
  }, [item, canvas, manifest, fontFamily]);

  // The words are written once, then the element owns them; the first press replaces them all.
  useLayoutEffect(() => {
    const element = words.current;
    if (!element) return;
    element.textContent = initial.current;
    element.focus({ preventScroll: true });
    selectAll(element);
  }, []);

  useEffect(() => {
    const element = words.current;
    if (!element) return;
    const beforeInput = (event: InputEvent) => {
      const type = event.inputType;
      if (!type.startsWith('insert') || type === 'insertCompositionText') return;
      const raw = LINE_BREAKS.has(type)
        ? '\n'
        : (event.data ?? event.dataTransfer?.getData('text/plain') ?? '');
      const clean = hasEmoji(raw) ? stripEmoji(raw) : raw;
      const room = TEXT_MAX - (readText(element).length - selectedLength(element));
      if (clean === raw && clean.length <= room) return;
      event.preventDefault();
      if (clean !== raw) handlers.current.onEmoji();
      if (room > 0 && clean !== '') {
        // `insertText` keeps the browser's own undo; its `beforeinput` passes this check.
        element.ownerDocument.execCommand('insertText', false, clean.slice(0, room));
      }
    };
    element.addEventListener('beforeinput', beforeInput);
    return () => element.removeEventListener('beforeinput', beforeInput);
  }, []);

  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    handlers.current.onDone(readText(words.current));
  };

  return (
    <div
      className="pointer-events-none absolute top-0 left-0"
      style={{
        width: canvas.width,
        height: canvas.height,
        transform: `scale(${stageScale})`,
        transformOrigin: '0 0',
      }}
    >
      <div
        ref={box}
        data-testid="clip-text-typing"
        className="pointer-events-auto absolute"
        style={{ transformOrigin: '50% 50%', whiteSpace: 'pre-wrap' }}
        dir="auto"
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a textarea cannot draw the clip's own typography in place, which is the point of typing on the clip. */}
        <span
          ref={words}
          role="textbox"
          tabIndex={0}
          aria-label="Text"
          aria-multiline
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck
          style={{
            outline: 'none',
            cursor: 'text',
            caretColor: 'currentColor',
            WebkitBoxDecorationBreak: 'clone',
            boxDecorationBreak: 'clone',
          }}
          onInput={() => {
            const element = words.current;
            let text = readText(element);
            // A drop or an input method can still bring one in: take it out again.
            if (hasEmoji(text) && element) {
              text = stripEmoji(text);
              element.textContent = text;
              handlers.current.onEmoji();
            }
            handlers.current.onInput(text);
          }}
          onBlur={finish}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // The editor's keys (arrows nudge, Delete removes) never fire while typing.
            event.stopPropagation();
            const action = typingKeyAction(
              {
                key: event.key,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode,
              },
              true,
            );
            if (!action) return;
            // Escape ends the typing too, keeping the words (the clip's rule, not Studio's).
            event.preventDefault();
            finish();
          }}
        />
      </div>
    </div>
  );
}
