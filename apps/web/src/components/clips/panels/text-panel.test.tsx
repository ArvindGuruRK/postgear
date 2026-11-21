import { TooltipProvider } from '@postgear/ui';
import { createClipDocument, defaultTextItem, type TextItem } from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { EMOJI_SENTENCE, TextPanel, type TextPanelProps } from './text-panel';

const VIDEO = '11111111-1111-4111-8111-111111111111';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

function newText(): TextItem {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
  return { ...defaultTextItem(doc, 2_000), id: 'txt_a' };
}

/** The panel over one text, applying each edit to it as the editor would. */
function Harness({
  initial,
  spy,
  extra = {},
}: {
  initial: TextItem | null;
  spy: { edits: (string | undefined)[]; added: string[]; timing: number[][]; anchor: string[] };
  extra?: Partial<TextPanelProps>;
}) {
  const [item, setItem] = useState(initial);
  return (
    <TooltipProvider>
      <TextPanel
        item={item}
        totalMs={30_000}
        fps={30}
        recent={[]}
        onRecent={() => undefined}
        emojiDropped={false}
        onEmoji={() => undefined}
        onAdd={(style) => spy.added.push(style)}
        onEdit={(change, key) => {
          spy.edits.push(key);
          setItem((current) => (current ? change(current) : current));
        }}
        onTiming={(start, duration) => spy.timing.push([start, duration])}
        onAnchor={(choice) => spy.anchor.push(choice)}
        onRemove={() => undefined}
        {...extra}
      />
      <output data-testid="item">{JSON.stringify(item)}</output>
    </TooltipProvider>
  );
}

function setup(initial: TextItem | null = newText(), extra: Partial<TextPanelProps> = {}) {
  const spy = {
    edits: [] as (string | undefined)[],
    added: [] as string[],
    timing: [] as number[][],
    anchor: [] as string[],
  };
  render(<Harness initial={initial} spy={spy} extra={extra} />);
  const item = () => JSON.parse(screen.getByTestId('item').textContent ?? 'null') as TextItem;
  return { spy, item };
}

describe('TextPanel', () => {
  it('with nothing selected, Add Text and a style tile each add a text', () => {
    const { spy } = setup(null);
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(spy.added).toEqual(['bold-outline', 'plain']);
  });

  it('shows the selected text style as chosen and restyles it from a tile', () => {
    const { item } = setup();
    expect(screen.getByRole('button', { name: 'Bold Outline' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(item().style).toMatchObject({ font: 'Inter', shadow: true, outline: null });
  });

  it('edits the words, keeping an emptied box from emptying the text', () => {
    const { item, spy } = setup();
    const words = screen.getByRole('textbox', { name: 'Words' });
    fireEvent.change(words, { target: { value: 'New words' } });
    expect(item().text).toBe('New words');
    expect(spy.edits.at(-1)).toBe('words:txt_a');
    fireEvent.change(words, { target: { value: '   ' } });
    expect(item().text).toBe('New words');
    fireEvent.blur(words);
    expect(words).toHaveValue('New words');
  });

  it('switches the backing between none, an outline and a box', () => {
    const { item } = setup();
    const backing = within(screen.getByRole('region', { name: 'Backing' }));
    fireEvent.click(backing.getByRole('button', { name: 'Box' }));
    expect(item().style.outline).toBeNull();
    expect(item().style.background).toMatchObject({ colour: '#FFFFFF', opacity: 1, pad: 18 });
    expect(screen.getByRole('button', { name: /^Box Colour/ })).toBeInTheDocument();
    fireEvent.click(backing.getByRole('button', { name: 'None' }));
    expect(item().style).toMatchObject({ outline: null, background: null });
    fireEvent.click(backing.getByRole('button', { name: 'Outline' }));
    expect(item().style.outline).toEqual({ colour: '#111111', width: 5 });
  });

  it('turns the shadow on, aligns, upper-cases and fades', () => {
    const { item } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upper Case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Short' }));
    expect(item().style).toMatchObject({ shadow: true, align: 'left', uppercase: true });
    expect(item()).toMatchObject({ fadeInMs: 200, fadeOutMs: 200 });
  });

  it('changes the size and the opacity with their sliders, each drag one step', () => {
    const { item, spy } = setup();
    const size = screen.getByRole('slider', { name: 'Size' });
    act(() => size.focus());
    fireEvent.keyDown(size, { key: 'ArrowRight' });
    expect(item().style.size).toBe(77);
    expect(spy.edits.at(-1)).toBe('size:txt_a');
    const opacity = screen.getByRole('slider', { name: 'Opacity' });
    act(() => opacity.focus());
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    expect(item().transform.opacity).toBe(0.95);
    expect(spy.edits.at(-1)).toBe('opacity:txt_a');
  });

  it('times the text and puts it on the whole clip', () => {
    const { spy } = setup();
    const from = screen.getByRole('spinbutton', { name: 'From' });
    fireEvent.change(from, { target: { value: '4' } });
    fireEvent.keyDown(from, { key: 'Enter' });
    expect(spy.timing.at(-1)).toEqual([4_000, 3_000]);
    fireEvent.click(screen.getByRole('button', { name: 'Whole Clip' }));
    expect(spy.anchor).toEqual(['whole']);
  });

  it('warns when the font cannot draw a letter, and says where emoji go', () => {
    setup({ ...newText(), text: 'Hi 中' }, { emojiDropped: true });
    expect(screen.getByTestId('clip-text-missing')).toHaveTextContent('This font cannot draw 中');
    expect(screen.getByTestId('clip-text-emoji')).toHaveTextContent(EMOJI_SENTENCE);
  });
});
