/**
 * Captions in the preview (Sprint 13, Module 03): the page of each moment is
 * the engine's own, the spoken word is marked as the export marks it, and
 * the block sits where the export puts it.
 */
import {
  builtInCaptionStyle,
  type CaptionLayout,
  type CaptionLook,
  captionAt,
  captionLayout,
  createCaptionsTrack,
  createClipDocument,
  FONT_MANIFEST,
  findBleepWords,
  frameState,
  setBleeps,
  type Transcript,
  withCaptionsTrack,
} from '@postgear/video-engine';
import { captionCss, captionEntrance, captionWordPaints } from './captions-node';
import { DomOverlayLayer } from './dom-overlay-layer';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const TRANSCRIPT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UPDATE = { reason: 'seek' as const, playing: false, scrubbing: false };
const family = (name: string) => `"${name}"`;
const look = (id: string): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;

function spoken(texts: string[], language = 'en'): Transcript {
  return {
    version: 1,
    language,
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 10_000 }],
    words: texts.map((text, i) => ({
      i,
      start: 1_000 + i * 400,
      end: 1_000 + i * 400 + 320,
      text,
      sure: 1,
    })),
    nextIndex: texts.length,
  };
}

function laidOut(
  styleId: string,
  texts: string[],
  options: { wordTimed?: boolean; language?: string; bleep?: boolean } = {},
) {
  const chosen = look(styleId);
  const track = createCaptionsTrack({
    transcriptAssetId: TRANSCRIPT_ID,
    language: options.language ?? 'en',
    styleId,
    look: chosen,
  });
  const transcript = spoken(texts, options.language);
  let doc = withCaptionsTrack(
    createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    track,
  );
  if (options.bleep) {
    const found = findBleepWords(
      transcript.words.map((w) => ({ index: w.i, text: w.text, start: w.start, end: w.end })),
      { language: options.language ?? 'en', workspace: [] },
    );
    doc = setBleeps(doc, found, 'bleep', doc.sources[0]?.id as string);
  }
  const layout = captionLayout({
    doc,
    track,
    look: chosen,
    transcript,
    wordTimed: options.wordTimed ?? true,
  });
  return { doc, layout };
}

function mounted() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const layer = new DomOverlayLayer({ fontFamily: family });
  layer.mount(host);
  const block = () => host.querySelector<HTMLElement>('[data-preview-layer="captions"]');
  const words = () => [...host.querySelectorAll<HTMLElement>('[data-caption-word]')];
  return { host, layer, block, words };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('captionCss', () => {
  it('places the block where the export does, in canvas pixels, with the font the export draws', () => {
    const { layout } = laidOut('bold-pop', ['So', 'today', 'we']);
    const css = captionCss(layout, FONT_MANIFEST, family);
    // 86 % of 1080 wide, centred; the centre line at 72 % of 1920.
    expect(css.block).toMatchObject({
      left: '75.5px',
      width: '929px',
      top: '1382.4px',
      'font-family': '"Montserrat"',
      'font-size': '86px',
      'font-weight': '800',
      color: '#FFFFFF',
    });
    // An ASS outline grows outward: twice the width as a CSS stroke, under the fill.
    expect(css.run).toMatchObject({
      '-webkit-text-stroke': '18px #000000',
      'paint-order': 'stroke fill',
    });
  });

  it('draws a page box solid, and keeps a Marker box behind a page whose words cannot be marked', () => {
    const boxed = captionCss(laidOut('boxed', ['So', 'today']).layout, FONT_MANIFEST, family);
    expect(boxed.run).toMatchObject({ background: '#111111', padding: '18px' });

    const latin = captionCss(laidOut('marker', ['So', 'today']).layout, FONT_MANIFEST, family);
    expect(latin.run.background).toBeUndefined();
    const tamil = captionCss(
      laidOut('marker', ['நண்பர்களே,', 'இந்த'], { language: 'ta' }).layout,
      FONT_MANIFEST,
      family,
    );
    expect(tamil.run).toMatchObject({ background: '#2563EB', padding: '10px' });
  });

  it('gives Clean its soft shadow, sized from the text as the export sizes it', () => {
    const css = captionCss(laidOut('clean', ['So']).layout, FONT_MANIFEST, family);
    expect(css.run['text-shadow']).toBe('2.79px 2.79px 0 rgba(0, 0, 0, 0.6)');
  });
});

describe('captionWordPaints', () => {
  const at = (layout: CaptionLayout, ms: number) => {
    const moment = captionAt(layout.pages, ms);
    if (!moment) throw new Error('no page');
    return captionWordPaints(layout, moment, ms);
  };

  it('colours only the spoken word, popped at first and settled 90 ms later', () => {
    const { layout } = laidOut('bold-pop', ['So', 'today', 'we']);
    const start = at(layout, 1_400);
    expect(start.map((paint) => paint.color)).toEqual(['', '#FFE600', '']);
    // A font size, like libass's \fscx\fscy: the word's box grows, so its neighbours move aside.
    expect(start[1]?.fontSize).toBe('1.160em');
    expect(at(layout, 1_445)[1]?.fontSize).toBe('1.080em');
    expect(at(layout, 1_490)[1]?.fontSize).toBe('');
    expect(start.map((paint) => paint.fontSize)).toEqual(['', '1.160em', '']);
    // The mark stays on the last word until the page leaves.
    expect(at(layout, 2_150).map((paint) => paint.color)).toEqual(['', '', '#FFE600']);
  });

  it('boxes the spoken word without moving its neighbours', () => {
    const { layout } = laidOut('marker', ['So', 'today', 'we']);
    const paints = at(layout, 1_000);
    expect(paints[0]).toMatchObject({ background: '#2563EB', boxShadow: '0 0 0 10px #2563EB' });
    expect(paints[1]).toMatchObject({ background: '', boxShadow: '' });
  });

  it('fills the words said so far, and reveals them one by one', () => {
    const karaoke = laidOut('karaoke', ['So', 'today', 'we']).layout;
    expect(at(karaoke, 1_450).map((paint) => paint.color)).toEqual(['#34D399', '#34D399', '']);
    const typewriter = laidOut('typewriter', ['So', 'today', 'we']).layout;
    expect(at(typewriter, 1_450).map((paint) => paint.visibility)).toEqual(['', '', 'hidden']);
  });

  it('marks nothing when the page is the unit: Tamil, or times that are not real', () => {
    const tamil = laidOut('bold-pop', ['நண்பர்களே,', 'இந்த'], { language: 'ta' }).layout;
    expect(at(tamil, 1_450).every((paint) => paint.color === '' && paint.fontSize === '')).toBe(
      true,
    );
    const supplied = laidOut('karaoke', ['So', 'today'], { wordTimed: false }).layout;
    expect(at(supplied, 1_450).every((paint) => paint.color === '')).toBe(true);
  });
});

describe('captionEntrance', () => {
  it('fades Clean in over 120 ms and pops Karaoke from 82 % in 110 ms', () => {
    expect(captionEntrance({ entrance: 'fade' }, { start: 1_000 }, 1_060)).toEqual({
      opacity: 0.5,
      scale: 1,
    });
    expect(captionEntrance({ entrance: 'fade' }, { start: 1_000 }, 1_200)).toEqual({
      opacity: 1,
      scale: 1,
    });
    expect(captionEntrance({ entrance: 'pop' }, { start: 1_000 }, 1_000)).toEqual({
      opacity: 1,
      scale: 0.82,
    });
    expect(captionEntrance({ entrance: 'pop' }, { start: 1_000 }, 1_110).scale).toBe(1);
    expect(captionEntrance({ entrance: 'none' }, { start: 1_000 }, 1_000)).toEqual({
      opacity: 1,
      scale: 1,
    });
  });
});

describe('captions in the overlay layer', () => {
  it('shows the page of the moment with the pager line breaks, and nothing between pages', () => {
    const { layer, block, words } = mounted();
    const { doc, layout } = laidOut('bold-pop', ['So', 'today', 'we', 'cleared', 'the', 'gap']);
    layer.setCaptions(layout);

    layer.update(frameState(doc, 500), UPDATE);
    expect(block()?.style.visibility).toBe('hidden');

    layer.update(frameState(doc, 1_450), UPDATE);
    expect(block()?.style.visibility).toBe('visible');
    expect(words().map((word) => word.textContent)).toEqual(['SO', 'TODAY', 'WE']);
    expect(words()[1]?.style.color).toBe('rgb(255, 230, 0)');
    expect(words()[0]?.style.color).toBe('');
    expect(block()?.querySelectorAll(':scope > div')).toHaveLength(
      layout.pages[0]?.lines.length ?? 0,
    );

    // The next page replaces it.
    layer.update(frameState(doc, 2_300), UPDATE);
    expect(words().map((word) => word.textContent)).toEqual(['CLEARED', 'THE', 'GAP']);

    layer.update(frameState(doc, 9_000), UPDATE);
    expect(block()?.style.visibility).toBe('hidden');
  });

  it('keeps the same nodes while only the spoken word moves', () => {
    const { layer, words } = mounted();
    const { doc, layout } = laidOut('bold-pop', ['So', 'today', 'we']);
    layer.setCaptions(layout);
    layer.update(frameState(doc, 1_050), UPDATE);
    const first = words();
    layer.update(frameState(doc, 1_850), UPDATE);
    expect(words()).toEqual(first);
    expect(words().map((word) => word.style.color)).toEqual(['', '', 'rgb(255, 230, 0)']);
  });

  it('keeps the spaces round a bleeped word paused on its start, where its pop is largest', () => {
    const { layer, block, words } = mounted();
    const { doc, layout } = laidOut('bold-pop', ['A', 'bullshit', 'idea.'], { bleep: true });
    layer.setCaptions(layout);
    // Paused exactly on the masked word's start (the Bleep Words list seeks there).
    layer.update(frameState(doc, 1_400), UPDATE);
    expect(words().map((word) => word.textContent)).toEqual(['A', 'B*******', 'IDEA.']);
    const popped = words()[1] as HTMLElement;
    expect(popped.style.color).toBe('rgb(255, 230, 0)');
    // The pop grows the word's own box (so the line widens, as in libass), never a
    // transform that would draw it over the spaces either side.
    expect(popped.style.fontSize).toBe('1.160em');
    expect(words().every((word) => word.style.transform === '')).toBe(true);
    // One plain space between each pair of words, and nothing else.
    const run = block()?.querySelector(':scope > div > span');
    expect(run?.textContent).toBe('A B******* IDEA.');
    // Settled 90 ms later.
    layer.update(frameState(doc, 1_490), UPDATE);
    expect(popped.style.fontSize).toBe('');
  });

  it('draws a page with one too-wide word at the export page scale, and a page that fits as it is', () => {
    const { layer, block } = mounted();
    const long = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(2);
    const { doc, layout } = laidOut('bold-pop', [long, 'and', 'so']);
    const scale = layout.pages[0]?.scale;
    expect(scale).toBeDefined();
    expect(scale as number).toBeLessThan(1);
    layer.setCaptions(layout);
    layer.update(frameState(doc, 1_050), UPDATE);
    const rows = [...(block()?.querySelectorAll<HTMLElement>(':scope > div') ?? [])];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.style.fontSize === `${scale}em`)).toBe(true);

    const fits = mounted();
    const plain = laidOut('bold-pop', ['So', 'today', 'we']);
    expect(plain.layout.pages[0]?.scale).toBeUndefined();
    fits.layer.setCaptions(plain.layout);
    fits.layer.update(frameState(plain.doc, 1_050), UPDATE);
    const plainRows = [...(fits.block()?.querySelectorAll<HTMLElement>(':scope > div') ?? [])];
    expect(plainRows.every((row) => row.style.fontSize === '')).toBe(true);
  });

  it('sits under every text and takes its block away when the clip loses its captions', () => {
    const { layer, block } = mounted();
    const { doc, layout } = laidOut('clean', ['So', 'today']);
    layer.setCaptions(layout);
    layer.update(frameState(doc, 1_100), UPDATE);
    expect(block()?.style.zIndex).toBe('0');
    // First in the canvas box: a text at the same level, made later, is drawn over it.
    expect(block()?.parentElement?.firstElementChild).toBe(block());
    layer.setCaptions(null);
    expect(block()).toBeNull();
  });
});
