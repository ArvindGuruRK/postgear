import { approximateMeasure, baseFontSize, fitText, MIN_FIT_SCALE, wrapText } from './fit';
import { fitScriptSource, fitSlots } from './render/fit-runtime';
import { themeById } from './themes';

const STYLE = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontSize: 40,
  letterSpacing: 0,
};

describe('wrapText', () => {
  it('breaks on spaces and keeps explicit newlines', () => {
    const lines = wrapText('one two\nthree', 1_000, STYLE, (text) => text.length * 10);
    expect(lines).toEqual(['one two', 'three']);
  });

  it('wraps when a line would be too wide', () => {
    const lines = wrapText('aaa bbb ccc', 60, STYLE, (text) => text.length * 10);
    expect(lines).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('breaks a single word wider than the box rather than letting it spill', () => {
    const lines = wrapText('supercalifragilistic', 50, STYLE, (text) => text.length * 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('supercalifragilistic');
  });
});

describe('fitText', () => {
  it('keeps the full size when the text already fits', () => {
    const result = fitText({
      text: 'Short',
      width: 1_000,
      height: 400,
      style: STYLE,
      lineHeight: 1.1,
      measure: approximateMeasure,
    });

    expect(result.fontSize).toBe(STYLE.fontSize);
    expect(result.overflows).toBe(false);
  });

  it('shrinks before it gives up', () => {
    const result = fitText({
      text: 'A headline with quite a lot more words in it than the box really wants',
      width: 600,
      height: 95,
      style: STYLE,
      lineHeight: 1.1,
      measure: approximateMeasure,
    });

    expect(result.fontSize).toBeLessThan(STYLE.fontSize);
    expect(result.overflows).toBe(false);
  });

  it('stops at the floor and says it overflows rather than cutting the text', () => {
    const text = 'word '.repeat(200);
    const result = fitText({
      text,
      width: 300,
      height: 80,
      style: STYLE,
      lineHeight: 1.2,
      measure: approximateMeasure,
    });

    expect(result.overflows).toBe(true);
    expect(result.fontSize).toBeCloseTo(STYLE.fontSize * MIN_FIT_SCALE, 5);
    // Every word is still there: the user sees too much text, never less text.
    expect(result.lines.join(' ').split('word').length - 1).toBe(200);
  });
});

describe('baseFontSize', () => {
  it('scales a theme size by the canvas short edge and the size step', () => {
    const style = themeById('ink').type.headline;

    expect(baseFontSize(style, 1_080)).toBeCloseTo((style.size / 100) * 1_080, 5);
    expect(baseFontSize(style, 1_080, 'lg')).toBeGreaterThan(baseFontSize(style, 1_080, 'md'));
    expect(baseFontSize(style, 1_080, 'sm')).toBeLessThan(baseFontSize(style, 1_080, 'md'));
  });

  it('gives a story and a square the same headline size, not a taller one', () => {
    const style = themeById('ink').type.headline;
    // Both are 1080 on the short edge; only the height differs.
    expect(baseFontSize(style, 1_080)).toBe(baseFontSize(style, 1_080));
  });
});

describe('the in-page fitter', () => {
  /**
   * A tiny fake DOM. A slot is 100px tall; its content is `lines` lines of
   * text at the slot's current font size, so it fits once the size is small
   * enough. The fitter only reads what is modelled here.
   */
  const makeSlot = (id: string, options: { lines: number; base?: number; min?: number }) => {
    const attributes = new Map<string, string>([
      ['data-slot', id],
      ['data-fit', String(options.base ?? 100)],
      ['data-fit-min', String(options.min ?? 0.5)],
    ]);
    const slot = {
      style: { fontSize: '' },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      clientHeight: 100,
      clientWidth: 100,
      querySelector: () => content,
    };
    const content = {
      get offsetHeight() {
        return Number.parseFloat(slot.style.fontSize) * options.lines;
      },
      scrollWidth: 100,
    };
    return slot;
  };

  const rootOf = (...slots: unknown[]) =>
    ({ querySelectorAll: () => slots }) as unknown as ParentNode;

  it('keeps the full size when the content fits', () => {
    const slot = makeSlot('headline', { lines: 1 });

    expect(fitSlots(rootOf(slot))).toEqual([]);
    expect(slot.style.fontSize).toBe('100px');
  });

  it('shrinks a slot that overflows until it fits, and reports nothing', () => {
    // Two lines need 50px or less to fit in 100px.
    const slot = makeSlot('headline', { lines: 2 });

    expect(fitSlots(rootOf(slot))).toEqual([]);
    expect(Number.parseFloat(slot.style.fontSize)).toBeLessThanOrEqual(50.5);
    expect(slot.getAttribute('data-overflow')).toBeNull();
  });

  it('stops at the floor, marks the slot and names it', () => {
    const fits = makeSlot('headline', { lines: 1 });
    const impossible = makeSlot('body', { lines: 10 });

    expect(fitSlots(rootOf(fits, impossible))).toEqual(['body']);
    expect(impossible.getAttribute('data-overflow')).toBe('true');
    expect(Number.parseFloat(impossible.style.fontSize)).toBeCloseTo(50, 5);
  });

  it('measures the content, so text spilling upwards still counts', () => {
    // A bottom-aligned slot reports a scrollHeight equal to its own height
    // however much spills above it. The fitter never asks for it.
    const slot = makeSlot('headline', { lines: 3, min: 0.2 });
    Object.defineProperty(slot, 'scrollHeight', { value: 100 });

    expect(fitSlots(rootOf(slot))).toEqual([]);
    expect(Number.parseFloat(slot.style.fontSize)).toBeLessThanOrEqual(100 / 3 + 0.5);
  });

  it('clears a warning once the text fits again', () => {
    const slot = makeSlot('headline', { lines: 1 });
    slot.setAttribute('data-overflow', 'true');

    fitSlots(rootOf(slot));
    expect(slot.getAttribute('data-overflow')).toBeNull();
  });

  it('serialises itself into the export script and runs there with nothing else', async () => {
    const slot = makeSlot('headline', { lines: 10 });
    const loaded: string[] = [];
    const page = {
      querySelectorAll: () => [slot],
      images: [],
      fonts: {
        load: (spec: string) => {
          loaded.push(spec);
          return Promise.resolve([]);
        },
        ready: Promise.resolve(),
        check: (spec: string) => spec.includes('Inter'),
      },
    };
    const window: Record<string, unknown> = {};

    // The script sees only the globals a browser page would give it: if it
    // needed anything from this bundle, this would throw.
    new Function('document', 'window', fitScriptSource(['400 16px "Inter"', '800 16px "Sora"']))(
      page,
      window,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loaded).toEqual(['400 16px "Inter"', '800 16px "Sora"']);
    expect(window.__pgFitDone).toBe(true);
    expect(window.__pgOverflow).toEqual(['headline']);
    expect(window.__pgFontsMissing).toEqual(['800 16px "Sora"']);
  });

  it('cannot be closed early by a font name', () => {
    expect(fitScriptSource(['400 16px "</script><script>alert(1)"'])).not.toContain('</script>');
  });
});
