import { testDocument, testSegment, testText } from '../render/test-docs';
import { createClipDocument } from './create';
import { hasEmoji, stripEmoji } from './emoji';
import { MAX_TRACKS, TEXT_FADE_MAX_MS, TEXT_WIDTH_MAX, TEXT_WIDTH_MIN } from './limits';
import { clipDocumentSchema, type TextItem } from './schema';
import {
  applyTextStyle,
  copyTextStyle,
  DEFAULT_TEXT,
  DEFAULT_TEXT_MS,
  defaultTextItem,
  displayText,
  matchingTextStyle,
  TEXT_STYLE_IDS,
  TEXT_STYLES,
  textBoxPad,
  textStylePreset,
} from './text';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';

/** A 10 s clip holding one text, validated by the real schema. */
function parseWith(text: TextItem) {
  const doc = testDocument([testSegment('a', 0, 10_000)]);
  return clipDocumentSchema.safeParse({
    ...doc,
    tracks: [{ id: 'ov', kind: 'overlay', items: [text] }],
  });
}

describe('emoji in text', () => {
  it('finds emoji, flags, keycaps and skin tones', () => {
    expect(hasEmoji('Hello 😀')).toBe(true);
    expect(hasEmoji('Go 👍🏽')).toBe(true);
    expect(hasEmoji('Family 👨‍👩‍👧')).toBe(true);
    expect(hasEmoji('Flag 🇮🇳')).toBe(true);
    expect(hasEmoji('Press 1️⃣')).toBe(true);
    expect(hasEmoji('Heart ❤️')).toBe(true);
  });

  it('leaves plain letters, digits, symbols and other scripts alone', () => {
    expect(hasEmoji('Hello there 123 #1 *')).toBe(false);
    expect(hasEmoji('Price ₹99, © 2026 ™ ®')).toBe(false);
    expect(hasEmoji('வணக்கம் नमस्ते')).toBe(false);
  });

  it('strips emoji and keeps everything else', () => {
    expect(stripEmoji('Hi 😀 there 👍🏽!')).toBe('Hi  there !');
    expect(stripEmoji('👨‍👩‍👧 family')).toBe(' family');
    expect(stripEmoji('₹99 ©')).toBe('₹99 ©');
    // Joiners inside a script stay: they shape the letters.
    expect(stripEmoji('क्‍ष')).toBe('क्‍ष');
  });
});

describe('the text item schema', () => {
  it('accepts a ready-styled text', () => {
    for (const id of TEXT_STYLE_IDS) {
      const result = parseWith(testText('t', { style: copyTextStyle(textStylePreset(id).style) }));
      expect(result.success).toBe(true);
    }
  });

  it('refuses emoji, empty text and an outline with a box', () => {
    expect(parseWith(testText('t', { text: 'Hi 😀' })).success).toBe(false);
    expect(parseWith(testText('t', { text: '   ' })).success).toBe(false);
    const both = testText('t');
    both.style.background = { colour: '#FFFFFF', opacity: 1, radius: 0, pad: 18 };
    expect(parseWith(both).success).toBe(false);
  });

  it('keeps the box width and the fades inside their limits', () => {
    expect(parseWith(testText('t', { widthPx: TEXT_WIDTH_MIN })).success).toBe(true);
    expect(parseWith(testText('t', { widthPx: TEXT_WIDTH_MIN - 1 })).success).toBe(false);
    expect(parseWith(testText('t', { widthPx: TEXT_WIDTH_MAX + 1 })).success).toBe(false);
    expect(parseWith(testText('t', { fadeInMs: TEXT_FADE_MAX_MS })).success).toBe(true);
    expect(parseWith(testText('t', { fadeOutMs: TEXT_FADE_MAX_MS + 1 })).success).toBe(false);
    expect(parseWith(testText('t', { fadeInMs: -1 })).success).toBe(false);
  });

  it(`allows at most ${MAX_TRACKS} tracks`, () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    const tracks = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => ({
      id: `trk_${i}`,
      kind: 'overlay' as const,
      items: [],
    }));
    expect(
      clipDocumentSchema.safeParse({ ...doc, tracks: tracks.slice(0, MAX_TRACKS) }).success,
    ).toBe(true);
    expect(clipDocumentSchema.safeParse({ ...doc, tracks }).success).toBe(false);
  });
});

describe('ready text styles', () => {
  it('has three named styles and three hook looks, each a valid text', () => {
    expect(TEXT_STYLES.map((preset) => preset.name)).toEqual([
      'Bold Outline',
      'On A Box',
      'Plain',
      'Hook Bold',
      'Hook Box',
      'Hook Pop',
    ]);
    expect(TEXT_STYLES.filter((preset) => preset.hook).map((preset) => preset.id)).toEqual([
      'hook-bold',
      'hook-box',
      'hook-pop',
    ]);
    expect(textStylePreset('on-a-box').style.background).not.toBeNull();
    expect(textStylePreset('bold-outline').style.outline).not.toBeNull();
    expect(textStylePreset('plain').style.shadow).toBe(true);
  });

  it('makes a new text in the upper third, on its moment, for three seconds', () => {
    const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
    const item = defaultTextItem(doc, 4_000);
    expect(item).toMatchObject({
      type: 'text',
      text: DEFAULT_TEXT,
      start: 4_000,
      duration: DEFAULT_TEXT_MS,
      anchor: 'moment',
      transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0, opacity: 1 },
      widthPx: 864,
      fadeInMs: 0,
      fadeOutMs: 0,
    });
    // Near the end it moves back so it still fits; a short clip makes it shorter.
    expect(defaultTextItem(doc, 29_000).start).toBe(27_000);
    const short = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 3_000, ratio: '1:1' });
    expect(defaultTextItem(short, 2_000)).toMatchObject({ start: 0, duration: 3_000 });
    expect(defaultTextItem(short, 0).widthPx).toBe(Math.round(short.canvas.width * 0.8));
  });

  it('restyles a text but keeps its alignment, and never changes the ready style', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    const item = {
      ...defaultTextItem(doc, 0),
      style: { ...defaultTextItem(doc, 0).style, align: 'left' as const },
    };
    const boxed = applyTextStyle(item, 'on-a-box');
    expect(boxed.style.align).toBe('left');
    expect(boxed.style.background).toEqual({ colour: '#FFFFFF', opacity: 1, radius: 0, pad: 18 });
    (boxed.style.background as { colour: string }).colour = '#FF0000';
    expect(textStylePreset('on-a-box').style.background?.colour).toBe('#FFFFFF');
  });

  it('knows which ready style a text still matches', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    const item = defaultTextItem(doc, 0, 'plain');
    expect(matchingTextStyle(item.style)).toBe('plain');
    expect(matchingTextStyle({ ...item.style, align: 'right' })).toBe('plain');
    expect(matchingTextStyle({ ...item.style, size: 99 })).toBeNull();
  });

  it('draws upper case from the data, and pads a box', () => {
    expect(
      displayText({ text: 'Big news', style: { ...testText('t').style, uppercase: true } }),
    ).toBe('BIG NEWS');
    expect(displayText(testText('t'))).toBe('Hello there');
    expect(textBoxPad(textStylePreset('on-a-box').style)).toBe(18);
    expect(
      textBoxPad({
        ...textStylePreset('on-a-box').style,
        background: { colour: '#000000', opacity: 1, radius: 0 },
      }),
    ).toBe(18);
    expect(textBoxPad(textStylePreset('plain').style)).toBe(0);
  });
});
