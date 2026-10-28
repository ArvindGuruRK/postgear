/**
 * @jest-environment jsdom
 */

/**
 * How typing on the canvas ends (Sprint 9b): Escape cancels and puts back the
 * text editing started from, Ctrl or Cmd with Enter keeps what was typed even
 * in a multi-line slot, Enter alone keeps it on a one-line slot only, and an
 * input method's own keys end nothing.
 *
 * The component is rendered for real, in jsdom. jsdom lays nothing out, so it
 * has no `innerText`; the test gives elements one that reads `textContent`,
 * which is what `innerText` returns for text with no layout to speak of.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditableText, type TypingKeyPress, typingKeyAction } from './EditableText';

const PRESS: TypingKeyPress = { key: 'a', ctrlKey: false, metaKey: false, isComposing: false };

function press(patch: Partial<TypingKeyPress>): TypingKeyPress {
  return { ...PRESS, ...patch };
}

describe('typingKeyAction', () => {
  it('cancels on Escape, on one line or many', () => {
    expect(typingKeyAction(press({ key: 'Escape' }), true)).toBe('cancel');
    expect(typingKeyAction(press({ key: 'Escape' }), false)).toBe('cancel');
  });

  it('keeps the text on Ctrl or Cmd with Enter, on one line or many', () => {
    for (const multiline of [true, false]) {
      expect(typingKeyAction(press({ key: 'Enter', ctrlKey: true }), multiline)).toBe('commit');
      expect(typingKeyAction(press({ key: 'Enter', metaKey: true }), multiline)).toBe('commit');
    }
  });

  it('leaves Enter to make a new line in a multi-line slot, and ends a one-line slot with it', () => {
    expect(typingKeyAction(press({ key: 'Enter' }), true)).toBeNull();
    expect(typingKeyAction(press({ key: 'Enter' }), false)).toBe('commit');
  });

  it('ends nothing while an input method is composing', () => {
    expect(typingKeyAction(press({ key: 'Escape', isComposing: true }), true)).toBeNull();
    expect(
      typingKeyAction(press({ key: 'Enter', ctrlKey: true, isComposing: true }), true),
    ).toBeNull();
    // Safari's Enter that chooses a candidate: not composing any more, but key code 229.
    expect(typingKeyAction(press({ key: 'Enter', keyCode: 229 }), false)).toBeNull();
  });

  it('leaves every other key to the text', () => {
    for (const key of ['a', 'Backspace', 'ArrowLeft', 'Tab', 'Delete']) {
      expect(typingKeyAction(press({ key }), true)).toBeNull();
      expect(typingKeyAction(press({ key, ctrlKey: true }), false)).toBeNull();
    }
  });
});

describe('EditableText', () => {
  let container: HTMLDivElement;
  let root: Root;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? '';
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value;
      },
    });
  });

  afterAll(() => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor);
    else delete (HTMLElement.prototype as { innerText?: string }).innerText;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  let mounts = 0;

  function mount(multiline: boolean, initialText = 'Before') {
    const onInput = jest.fn();
    const onCommit = jest.fn();
    // A new key each time, so a second mount in one test is a fresh start rather than an update.
    mounts += 1;

    act(() => {
      root.render(
        <EditableText
          key={mounts}
          initialText={initialText}
          maxLength={600}
          multiline={multiline}
          label="Headline"
          onInput={onInput}
          onCommit={onCommit}
        />,
      );
    });

    const box = container.querySelector<HTMLElement>('[role="textbox"]');
    if (!box) throw new Error('No textbox was rendered.');
    return { box, onInput, onCommit };
  }

  /** What a person typing leaves behind: new text and an input event. */
  function type(box: HTMLElement, text: string) {
    act(() => {
      box.textContent = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function key(box: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => {
      box.dispatchEvent(event);
    });
    return event;
  }

  it('starts with the text it was given, focused', () => {
    const { box } = mount(true);

    expect(box.textContent).toBe('Before');
    expect(document.activeElement).toBe(box);
  });

  it('reports what is typed as it is typed', () => {
    const { box, onInput, onCommit } = mount(true);

    type(box, 'After');

    expect(onInput).toHaveBeenLastCalledWith('After');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('puts the starting text back on Escape and commits that, once', () => {
    const { box, onInput, onCommit } = mount(true);
    type(box, 'Typed by mistake');

    const event = key(box, { key: 'Escape' });

    expect(event.defaultPrevented).toBe(true);
    expect(box.textContent).toBe('Before');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Before');
    // The restore is reported by the commit alone.
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(box);
  });

  it('cancels back to the text it started from, not a later version of the prop', () => {
    const { box, onCommit } = mount(true);
    type(box, 'Changed');

    // The parent redraws with the live text as its prop; Escape still means "as it was".
    act(() => {
      root.render(
        <EditableText
          key={mounts}
          initialText="Changed"
          maxLength={600}
          multiline
          label="Headline"
          onInput={jest.fn()}
          onCommit={onCommit}
        />,
      );
    });
    key(box, { key: 'Escape' });

    expect(onCommit).toHaveBeenCalledWith('Before');
  });

  it('keeps the typed text on Ctrl or Cmd with Enter in a multi-line slot', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const { box, onCommit } = mount(true);
      type(box, 'Line one\nLine two');

      const event = key(box, { key: 'Enter', ...modifier });

      expect(event.defaultPrevented).toBe(true);
      expect(onCommit).toHaveBeenCalledWith('Line one\nLine two');
      expect(document.activeElement).not.toBe(box);
    }
  });

  it('lets Enter alone make a new line in a multi-line slot', () => {
    const { box, onCommit } = mount(true);

    const event = key(box, { key: 'Enter' });

    expect(event.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it('ends a one-line slot with Enter, keeping the text', () => {
    const { box, onCommit } = mount(false, 'Acme');
    type(box, 'Acme Studio');

    key(box, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('Acme Studio');
  });

  it('leaves Escape and Enter to an input method while it composes', () => {
    const { box, onCommit } = mount(true);

    const escapePress = key(box, { key: 'Escape', isComposing: true });
    const enterPress = key(box, { key: 'Enter', ctrlKey: true, isComposing: true });

    expect(escapePress.defaultPrevented).toBe(false);
    expect(enterPress.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it('commits what is there when focus moves elsewhere, as before', () => {
    const { box, onCommit } = mount(true);
    type(box, 'Kept');

    act(() => box.blur());

    expect(onCommit).toHaveBeenCalledWith('Kept');
  });

  it("keeps every key, Escape included, from the editor's own shortcuts while typing", () => {
    const parent = jest.fn();
    act(() => {
      root.render(
        // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the canvas, which listens for its shortcuts around the slide
        <div onKeyDown={parent}>
          <EditableText
            initialText="Before"
            maxLength={600}
            multiline
            label="Headline"
            onInput={jest.fn()}
            onCommit={jest.fn()}
          />
        </div>,
      );
    });
    const box = container.querySelector<HTMLElement>('[role="textbox"]');
    if (!box) throw new Error('No textbox was rendered.');

    key(box, { key: 'ArrowLeft' });
    key(box, { key: 'Escape' });

    expect(parent).not.toHaveBeenCalled();
  });
});
