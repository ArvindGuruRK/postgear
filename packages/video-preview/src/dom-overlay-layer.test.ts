import {
  type ClipDocument,
  copyTextStyle,
  createClipDocument,
  frameState,
  type TextItem,
  textStylePreset,
} from '@postgear/video-engine';
import { DomOverlayLayer, textCss } from './dom-overlay-layer';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const UPDATE = { reason: 'seek' as const, playing: false, scrubbing: false };

function text(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'txt_a',
    type: 'text',
    start: 1_000,
    duration: 2_000,
    anchor: 'moment',
    text: 'Hello there',
    style: copyTextStyle(textStylePreset('bold-outline').style),
    transform: { x: 0.5, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 864,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...overrides,
  };
}

function docWith(items: TextItem[], fades = { inMs: 0, outMs: 0 }): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' });
  return { ...doc, fades, tracks: [{ id: 'trk_text', kind: 'overlay', items }] };
}

function mounted(options: ConstructorParameters<typeof DomOverlayLayer>[0] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const layer = new DomOverlayLayer(options);
  layer.mount(host);
  const nodeOf = (id: string) => host.querySelector<HTMLElement>(`[data-clip-text="${id}"]`);
  return { host, layer, nodeOf };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DomOverlayLayer', () => {
  it('draws a text only inside its window, in canvas pixels', () => {
    const { layer, nodeOf, host } = mounted();
    const doc = docWith([text()]);
    layer.update(frameState(doc, 500), UPDATE);
    expect(nodeOf('txt_a')).toBeNull();

    layer.update(frameState(doc, 1_500), UPDATE);
    const node = nodeOf('txt_a') as HTMLElement;
    expect(node.textContent).toBe('Hello there');
    expect(node.style.left).toBe('108px');
    expect(node.style.top).toBe('480px');
    expect(node.style.width).toBe('864px');
    expect(node.style.fontSize).toBe('76px');
    expect(node.style.fontWeight).toBe('800');
    expect(node.style.fontFamily).toContain('Montserrat');
    // Montserrat's own ascent plus descent, as libass spaces lines.
    expect(Number(node.style.lineHeight)).toBeCloseTo(1.562, 3);
    expect(node.style.transform).toBe('translateY(-50%) rotate(0deg)');
    const box = host.querySelector<HTMLElement>('[data-preview-layer="canvas-box"]') as HTMLElement;
    expect(box.style.width).toBe('1080px');
    expect(box.style.height).toBe('1920px');

    layer.update(frameState(doc, 3_000), UPDATE);
    expect(nodeOf('txt_a')).toBeNull();
  });

  it('draws the weight the export draws, and the words in upper case from the data', () => {
    const { layer, nodeOf } = mounted();
    const anton = text({
      text: 'big news',
      style: { ...text().style, font: 'Anton', weight: 900, uppercase: true },
    });
    layer.update(frameState(docWith([anton]), 1_500), UPDATE);
    const node = nodeOf('txt_a') as HTMLElement;
    expect(node.style.fontWeight).toBe('400');
    expect(node.textContent).toBe('BIG NEWS');
  });

  it('strokes an outline at twice its width under the fill, pads a box, and shadows plain text', () => {
    const canvas = { width: 1080, height: 1920 };
    const outlined = textCss(text(), canvas);
    expect(outlined.words['-webkit-text-stroke']).toBe('10px #111111');
    expect(outlined.words['paint-order']).toBe('stroke fill');
    expect(outlined.words.background).toBe('');

    const boxed = textCss(
      text({ style: copyTextStyle(textStylePreset('on-a-box').style) }),
      canvas,
    );
    expect(boxed.words['-webkit-text-stroke']).toBe('');
    expect(boxed.words.background).toBe('rgba(255, 255, 255, 1)');
    expect(boxed.words.padding).toBe('18px');
    expect(boxed.box['font-family']).toBe('"Inter", sans-serif');

    const plain = textCss(text({ style: copyTextStyle(textStylePreset('plain').style) }), canvas);
    expect(plain.words['text-shadow']).toBe('4px 4px 0 rgba(0, 0, 0, 0.6)');

    // The layer applies the same CSS (jsdom keeps the properties it knows).
    const { layer, nodeOf } = mounted();
    layer.update(
      frameState(
        docWith([text({ style: copyTextStyle(textStylePreset('on-a-box').style) })]),
        1_500,
      ),
      UPDATE,
    );
    const words = (nodeOf('txt_a') as HTMLElement).firstElementChild as HTMLElement;
    expect(words.style.padding).toBe('18px');
  });

  it('turns about the centre and fades with its own fade (the stage fades the frame)', () => {
    const { layer, nodeOf } = mounted();
    const turning = text({
      fadeInMs: 500,
      transform: { x: 0.5, y: 0.25, scale: 2, rotation: 30, opacity: 0.8 },
    });
    const doc = docWith([turning], { inMs: 2_000, outMs: 0 });
    layer.update(frameState(doc, 1_250), UPDATE);
    const node = nodeOf('txt_a') as HTMLElement;
    expect(node.style.transform).toBe('translateY(-50%) rotate(30deg)');
    expect(node.style.width).toBe('1728px');
    // 0.8 x half its fade in; the clip's own fade (0.625 here) is the stage's, over the whole frame.
    expect(Number(node.style.opacity)).toBeCloseTo(0.8 * 0.5, 6);
  });

  it('hides the text being typed in place, and draws texts in track order', () => {
    const { layer, nodeOf } = mounted();
    const doc = docWith([text(), text({ id: 'txt_b', start: 0, duration: 5_000 })]);
    layer.update(frameState(doc, 1_500), UPDATE);
    expect((nodeOf('txt_a') as HTMLElement).style.zIndex).toBe('0');
    expect((nodeOf('txt_b') as HTMLElement).style.zIndex).toBe('1');
    layer.setHidden('txt_b');
    expect((nodeOf('txt_b') as HTMLElement).style.visibility).toBe('hidden');
    expect((nodeOf('txt_a') as HTMLElement).style.visibility).toBe('visible');
    layer.setHidden(null);
    expect((nodeOf('txt_b') as HTMLElement).style.visibility).toBe('visible');
  });

  it('restyles only when the item changes, and reports heights when they do', () => {
    const heights: Array<ReadonlyMap<string, number>> = [];
    const { layer, nodeOf } = mounted({ onMeasure: (h) => heights.push(h) });
    const doc = docWith([text()]);
    layer.update(frameState(doc, 1_500), UPDATE);
    const node = nodeOf('txt_a') as HTMLElement;
    expect(heights).toHaveLength(1);
    expect(heights[0]?.has('txt_a')).toBe(true);
    node.style.left = '1px';
    layer.update(frameState(doc, 1_600), UPDATE);
    // Same item: nothing rewritten.
    expect(node.style.left).toBe('1px');
    layer.update(frameState(docWith([{ ...text(), text: 'New words' }]), 1_600), UPDATE);
    expect(node.style.left).toBe('108px');
    expect(node.textContent).toBe('New words');
    layer.update(frameState(doc, 5_000), UPDATE);
    expect(heights.at(-1)?.size).toBe(0);
  });

  it('waits for the font before it shows the text', async () => {
    let resolve: () => void = () => undefined;
    const fonts = {
      check: () => false,
      load: jest.fn(() => new Promise<void>((r) => (resolve = r))),
    };
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    try {
      const { layer, nodeOf } = mounted();
      layer.update(frameState(docWith([text()]), 1_500), UPDATE);
      expect((nodeOf('txt_a') as HTMLElement).style.visibility).toBe('hidden');
      expect(fonts.load).toHaveBeenCalledWith('800 64px "Montserrat", sans-serif');
      resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect((nodeOf('txt_a') as HTMLElement).style.visibility).toBe('visible');
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('lets go of everything on destroy', () => {
    const { layer, host } = mounted();
    layer.update(frameState(docWith([text()]), 1_500), UPDATE);
    layer.destroy();
    expect(host.children).toHaveLength(0);
  });
});
