import type { CaptionsTrack, ClipDocument, Segment } from '../document/schema';
import { emptyTranscript, mergeTranscript, type Transcript } from '../transcript';
import {
  breakLines,
  builtInCaptionStyle,
  CAPTION_STYLE_IDS,
  CAPTION_STYLES,
  type CaptionLook,
  captionAt,
  captionGeometry,
  captionLayout,
  captionLookSchema,
  captionPages,
  captionsTrackOf,
  captionWords,
  cleanCueText,
  clipSourceRanges,
  DEFAULT_CAPTION_STYLE,
  displayWord,
  fontWidthFactor,
  hasLetterCase,
  insideSafeArea,
  marksSingleWords,
  parseSubtitleCues,
  parseSubtitleFile,
  resolveStyle,
  safeAreaGuide,
  scriptOf,
  spreadWords,
  SubtitleFileError,
  textWidth,
  trackLook,
  withoutEmoji,
} from './index';

const seg = (
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'] = 1,
): Segment => ({ id, source: 'src', sourceIn, sourceOut, speed, volume: 1 });

const doc = (segments: Segment[]): Pick<ClipDocument, 'segments' | 'canvas'> => ({
  segments,
  canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
});

const track = (overrides: Partial<CaptionsTrack> = {}): CaptionsTrack => ({
  id: 'cc',
  kind: 'captions',
  transcriptAssetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  language: 'en',
  styleId: 'bold-pop',
  position: { x: 0.5, y: 0.72 },
  sizePx: 86,
  maxWords: 3,
  edits: {},
  ...overrides,
});

/** One word a second from `fromSec`, each 400 ms long, in the video's time. */
function spoken(texts: string[], fromSec: number): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: (fromSec + texts.length) * 1000 }],
    words: texts.map((text, index) => ({
      start: (fromSec + index) * 1000,
      end: (fromSec + index) * 1000 + 400,
      text,
      sure: 0.9,
    })),
  });
}

const TEN = spoken(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'], 10);
const texts = (words: Array<{ text: string }>) => words.map((word) => word.text);
const look = (id = 'bold-pop'): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;

describe('captionWords: the transcript on the clip clock', () => {
  it('maps each word through its part: the clip starts at 0 whatever the video moment', () => {
    const words = captionWords(doc([seg('a', 12_000, 16_000)]), track(), TEN);
    expect(words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['two', 0, 400],
      ['three', 1_000, 1_400],
      ['four', 2_000, 2_400],
      ['five', 3_000, 3_400],
    ]);
    expect(words[0]).toMatchObject({ i: 2, segmentId: 'a', segmentIndex: 0, sourceStart: 12_000 });
  });

  it('stays on its word after a trim, with no stored time to update', () => {
    const before = captionWords(doc([seg('a', 10_000, 20_000)]), track(), TEN);
    const trimmed = captionWords(doc([seg('a', 15_000, 20_000)]), track(), TEN);
    expect(texts(trimmed)).toEqual(['five', 'six', 'seven', 'eight', 'nine']);
    // "five" was at 5 s of the clip; five seconds were trimmed off the start, so it is at 0.
    expect(before.find((w) => w.text === 'five')?.start).toBe(5_000);
    expect(trimmed[0]?.start).toBe(0);
  });

  it('follows a split and a removed middle: the cut words are gone, the rest close up', () => {
    const words = captionWords(doc([seg('a', 10_000, 13_000), seg('b', 16_000, 19_000)]), track(), TEN);
    expect(words.map((w) => [w.text, w.start, w.segmentIndex])).toEqual([
      ['zero', 0, 0],
      ['one', 1_000, 0],
      ['two', 2_000, 0],
      ['six', 3_000, 1],
      ['seven', 4_000, 1],
      ['eight', 5_000, 1],
    ]);
  });

  it('scales with a 2x part: words come twice as fast and half as long', () => {
    const words = captionWords(doc([seg('a', 10_000, 14_000, 2)]), track(), TEN);
    expect(words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['zero', 0, 200],
      ['one', 500, 700],
      ['two', 1_000, 1_200],
      ['three', 1_500, 1_700],
    ]);
  });

  it('shows a stretch that plays twice (a hook clip) twice, because the loop is over parts', () => {
    const words = captionWords(doc([seg('hook', 14_000, 16_000), seg('a', 10_000, 16_000)]), track(), TEN);
    expect(texts(words)).toEqual(['four', 'five', 'zero', 'one', 'two', 'three', 'four', 'five']);
    expect(words.filter((w) => w.text === 'four').map((w) => w.start)).toEqual([0, 6_000]);
  });

  it('keeps a word cut by a part edge only when more than half of it plays', () => {
    // "two" is 12,000 to 12,400: 250 ms inside is more than half, 200 ms is not.
    expect(texts(captionWords(doc([seg('a', 10_000, 12_250)]), track(), TEN))).toContain('two');
    expect(texts(captionWords(doc([seg('a', 10_000, 12_200)]), track(), TEN))).not.toContain('two');
    expect(texts(captionWords(doc([seg('a', 12_150, 16_000)]), track(), TEN))[0]).toBe('two');
    expect(texts(captionWords(doc([seg('a', 12_200, 16_000)]), track(), TEN))[0]).toBe('three');
  });

  it("applies this clip's own edits: a changed word is sure, a hidden one is left out", () => {
    const words = captionWords(
      doc([seg('a', 10_000, 14_000)]),
      track({ edits: { 1: { text: 'ONE!' }, 2: { hidden: true } } }),
      TEN,
    );
    expect(words.map((w) => [w.text, w.sure])).toEqual([
      ['zero', 0.9],
      ['ONE!', 1],
      ['three', 0.9],
    ]);
  });

  it('gives words only to the parts of their own source (a montage)', () => {
    const two = doc([seg('a', 10_000, 12_000), { ...seg('b', 10_000, 12_000), source: 'other' }]);
    expect(texts(captionWords(two, track(), TEN, { sourceId: 'src' }))).toEqual(['zero', 'one']);
    expect(captionWords(two, track(), TEN, { sourceId: 'other' }).map((w) => w.start)).toEqual([
      2_000, 3_000,
    ]);
  });

  it('answers the video stretches a clip plays, merged', () => {
    expect(clipSourceRanges(doc([seg('a', 10_000, 13_000), seg('b', 12_000, 19_000), seg('c', 30_000, 31_000)]))).toEqual([
      { fromMs: 10_000, toMs: 19_000 },
      { fromMs: 30_000, toMs: 31_000 },
    ]);
  });

  it('finds the captions track of a document', () => {
    expect(captionsTrackOf({ tracks: [] })).toBeNull();
    expect(captionsTrackOf({ tracks: [{ id: 'ov', kind: 'overlay', items: [] }, track()] })?.id).toBe('cc');
  });
});

describe('captionPages', () => {
  const measure = (text: string) => text.length * 40;
  const paged = (transcript: Transcript, segments: Segment[], options: Partial<Parameters<typeof captionPages>[1]> = {}) =>
    captionPages(captionWords(doc(segments), track(), transcript), {
      maxWords: 3,
      lineWidth: 900,
      measure,
      clipMs: segments.reduce((sum, s) => sum + (s.sourceOut - s.sourceIn) / s.speed, 0),
      ...options,
    });

  it('breaks at the word limit and every word is on exactly one page', () => {
    const pages = paged(TEN, [seg('a', 10_000, 20_000)], { maxGapMs: 5_000 });
    expect(pages.map((page) => texts(page.words))).toEqual([
      ['zero', 'one', 'two'],
      ['three', 'four', 'five'],
      ['six', 'seven', 'eight'],
      ['nine'],
    ]);
    expect(pages.map((page) => page.index)).toEqual([0, 1, 2, 3]);
  });

  it('breaks after a sentence end and after a long pause', () => {
    const transcript = mergeTranscript(emptyTranscript('en', 'm'), {
      ranges: [{ fromMs: 0, toMs: 20_000 }],
      words: [
        { start: 0, end: 300, text: 'I', sure: 1 },
        { start: 350, end: 700, text: 'quit.', sure: 1 },
        { start: 750, end: 1_000, text: 'Then', sure: 1 },
        { start: 3_000, end: 3_300, text: 'nothing', sure: 1 },
      ],
    });
    const pages = paged(transcript, [seg('a', 0, 20_000)], { maxWords: 6 });
    expect(pages.map((page) => texts(page.words))).toEqual([['I', 'quit.'], ['Then'], ['nothing']]);
  });

  it('always breaks at a part edge, even mid sentence', () => {
    const pages = paged(TEN, [seg('a', 10_000, 12_000), seg('b', 12_000, 14_000)], {
      maxWords: 6,
      maxGapMs: 5_000,
    });
    expect(pages.map((page) => texts(page.words))).toEqual([
      ['zero', 'one'],
      ['two', 'three'],
    ]);
  });

  it('starts a new page when one more word would not fit on two lines', () => {
    const long = spoken(['extraordinary', 'unbelievable', 'magnificent', 'spectacular'], 0);
    const pages = paged(long, [seg('a', 0, 4_000)], { maxWords: 6, lineWidth: 560, maxGapMs: 5_000 });
    expect(pages.map((page) => texts(page.words))).toEqual([
      ['extraordinary', 'unbelievable'],
      ['magnificent', 'spectacular'],
    ]);
    expect(pages[0]?.lines).toEqual([[0], [1]]);
    // A single word wider than a line still gets a page of its own.
    expect(paged(long, [seg('a', 0, 4_000)], { lineWidth: 100 })).toHaveLength(4);
  });

  it('breaks a page into at most two lines, as even as it can', () => {
    expect(breakLines(['one', 'two'], 900, measure)).toEqual([[0, 1]]);
    expect(breakLines(['aaaa', 'bb', 'cc', 'dddd'], 300, measure)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(breakLines(['solo'], 10, measure)).toEqual([[0]]);
  });

  it('keeps a page until the next one when they are close, and lets it go after a pause', () => {
    const pages = paged(TEN, [seg('a', 10_000, 20_000)], { maxGapMs: 500, lingerMs: 260 });
    // 600 ms between words is a pause here: one word a page, each leaving 260 ms after it ends.
    expect(pages[0]).toMatchObject({ start: 0, end: 660 });
    const close = paged(TEN, [seg('a', 10_000, 20_000)], { maxGapMs: 5_000 });
    expect(close[0]).toMatchObject({ start: 0, end: 3_000 });
    expect(close.at(-1)?.end).toBe(9_660);
    // The last page never outlives the clip.
    expect(paged(TEN, [seg('a', 10_000, 19_500)], { maxGapMs: 5_000 }).at(-1)?.end).toBe(9_500);
  });

  it('marks the first word from the page start and each next one from its own start', () => {
    const [page] = paged(TEN, [seg('a', 10_200, 20_000)], { maxGapMs: 5_000 });
    expect(page?.marks).toEqual([800, 1_800, 2_800]);
    const pages = paged(TEN, [seg('a', 10_000, 20_000)], { maxGapMs: 5_000 });
    expect(captionAt(pages, 0)?.active).toBe(0);
    // Between two words of a page the earlier one stays marked: no flicker.
    expect(captionAt(pages, 700)?.active).toBe(0);
    expect(captionAt(pages, 1_000)?.active).toBe(1);
    expect(captionAt(pages, 2_999)).toMatchObject({ active: 2, page: { index: 0 } });
    expect(captionAt(pages, 3_000)?.page.index).toBe(1);
    expect(captionAt(pages, 9_700)).toBeNull();
    expect(captionAt([], 5)).toBeNull();
  });
});

describe('styles', () => {
  it('has six built-in styles, each a look the schema accepts and no two alike', () => {
    expect(CAPTION_STYLES.map((style) => style.id)).toEqual([...CAPTION_STYLE_IDS]);
    expect(CAPTION_STYLES.map((style) => style.name)).toEqual([
      'Bold Pop',
      'Marker',
      'Karaoke',
      'Clean',
      'Boxed',
      'Typewriter',
    ]);
    for (const style of CAPTION_STYLES) {
      expect(captionLookSchema.safeParse(style.look).success).toBe(true);
      expect(style.hint.length).toBeGreaterThan(10);
    }
    expect(new Set(CAPTION_STYLES.map((style) => style.look.mark.kind)).size).toBe(5);
  });

  it('resolves a built-in, a workspace style, and falls back when one is gone', () => {
    expect(resolveStyle('karaoke')).toMatchObject({ fallback: false, style: { id: 'karaoke' } });
    const own = { id: 'own_1', name: 'Mine', look: { ...look('clean'), colour: '#FF00FF' } };
    expect(resolveStyle('own_1', [own])).toMatchObject({
      fallback: false,
      style: { name: 'Mine', builtIn: false, look: { colour: '#FF00FF' } },
    });
    expect(resolveStyle('deleted', [own])).toMatchObject({
      fallback: true,
      style: { id: DEFAULT_CAPTION_STYLE },
    });
    // A stored look that no longer reads never draws half a style.
    expect(resolveStyle('own_1', [{ ...own, look: { font: 'Inter' } }]).fallback).toBe(true);
  });

  it('refuses a look ASS cannot draw', () => {
    const base = look('clean');
    expect(captionLookSchema.safeParse({ ...base, box: { colour: '#000000', opacity: 1, pad: 8 } }).success).toBe(false);
    expect(captionLookSchema.safeParse({ ...look('marker'), outline: { colour: '#000000', width: 4 } }).success).toBe(false);
    expect(captionLookSchema.safeParse({ ...base, mark: { kind: 'fill', colour: '#FF0000', pop: true } }).success).toBe(false);
    expect(captionLookSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("puts the track's own size, case and mark colour over the style", () => {
    const merged = trackLook(track({ sizePx: 120, letterCase: 'lower', markColour: '#00FF00' }), look());
    expect(merged).toMatchObject({ sizePx: 120, letterCase: 'lower', mark: { colour: '#00FF00', kind: 'colour' } });
    expect(trackLook(track(), look())).toMatchObject({ letterCase: 'upper', mark: { colour: '#FFE600' } });
  });
});

describe('scripts, case and emoji', () => {
  it('reads the script most letters are in', () => {
    expect(scriptOf('Hello there, 123!')).toBe('latin');
    expect(scriptOf('நண்பர்களே, இந்த விளையாட்டு')).toBe('tamil');
    expect(scriptOf('नमस्ते दोस्तों')).toBe('devanagari');
    expect(scriptOf('ok நன்றி வணக்கம்')).toBe('tamil');
    expect(scriptOf('123 ...')).toBe('latin');
    expect(scriptOf('こんにちは')).toBe('other');
  });

  it('only Latin has letter case and single-word marks', () => {
    expect(hasLetterCase('latin')).toBe(true);
    expect(hasLetterCase('tamil')).toBe(false);
    expect(marksSingleWords('devanagari')).toBe(false);
    expect(displayWord('Hello', 'upper')).toBe('HELLO');
    expect(displayWord('Hello', 'lower')).toBe('hello');
    expect(displayWord('Hello', 'as_spoken')).toBe('Hello');
    expect(displayWord('நன்றி', 'upper')).toBe('நன்றி');
  });

  it('takes emoji out of caption text (libass would draw them in one flat colour)', () => {
    expect(withoutEmoji('wow 😀🎉 ok')).toBe('wow  ok');
    expect(withoutEmoji('❤️')).toBe('');
    expect(displayWord('fire🔥', 'upper')).toBe('FIRE');
  });
});

describe('the width estimate', () => {
  const style = { font: 'Inter', weight: 600, sizePx: 80, backingPx: 0 };

  it('grows with the text, the size and the outline', () => {
    expect(textWidth('', style)).toBe(0);
    expect(textWidth('hello there', style)).toBeGreaterThan(textWidth('hello', style));
    expect(textWidth('hello', { ...style, sizePx: 160 })).toBeCloseTo(textWidth('hello', style) * 2, 5);
    expect(textWidth('hello', { ...style, backingPx: 9 })).toBe(textWidth('hello', style) + 18);
  });

  it('knows capitals are wider than small letters and narrow letters are narrow', () => {
    expect(textWidth('HELLO', style)).toBeGreaterThan(textWidth('hello', style));
    expect(textWidth('illi', style)).toBeLessThan(textWidth('mwmw', style));
  });

  it('gives a Tamil line more room than a Latin one of the same letters', () => {
    const tamil = textWidth('தமிழ்நாடு', style);
    const latin = textWidth('tamilnadu', style);
    expect(tamil / latin).toBeGreaterThan(1.2);
  });

  it('scales by the family and a little by the weight', () => {
    expect(fontWidthFactor('Anton', 400)).toBeLessThan(fontWidthFactor('Inter', 400));
    expect(fontWidthFactor('JetBrains Mono', 400)).toBeGreaterThan(fontWidthFactor('Inter', 400));
    expect(fontWidthFactor('Inter', 800)).toBeGreaterThan(fontWidthFactor('Inter', 400));
    expect(fontWidthFactor('  inter ', 400)).toBe(fontWidthFactor('Inter', 400));
  });
});

describe('the safe area guide', () => {
  it('exists for a vertical clip only, with a stricter level inside the everyday one', () => {
    expect(safeAreaGuide('16:9')).toBeNull();
    expect(safeAreaGuide('1:1')).toBeNull();
    const everyday = safeAreaGuide('9:16');
    const strict = safeAreaGuide('9:16', 'strict');
    expect(everyday?.covered).toHaveLength(3);
    expect(insideSafeArea(strict?.safe as never, everyday as never)).toBe(true);
    expect(insideSafeArea({ x: 0.1, y: 0.6, w: 0.7, h: 0.1 }, everyday as never)).toBe(true);
    expect(insideSafeArea({ x: 0.1, y: 0.85, w: 0.7, h: 0.1 }, everyday as never)).toBe(false);
  });
});

describe('captionLayout', () => {
  const layout = (overrides: Partial<Parameters<typeof captionLayout>[0]> = {}) =>
    captionLayout({
      doc: doc([seg('a', 10_000, 20_000)]),
      track: track(),
      look: look(),
      transcript: TEN,
      wordTimed: true,
      ...overrides,
    });

  it('centres the block on the track position and keeps it on the canvas', () => {
    expect(layout().geometry).toEqual({
      cx: 540,
      cy: 1382.4,
      boxLeft: 75.5,
      boxWidth: 929,
      sizePx: 86,
      backingPx: 9,
    });
    const dragged = captionGeometry(track({ position: { x: 0.02, y: 0.1 } }), look(), { width: 1080, height: 1920 });
    expect(dragged.boxLeft).toBe(0);
    expect(dragged.cx).toBeCloseTo(464.5);
  });

  it('marks single words for a timed Latin transcript, in the style own way', () => {
    expect(layout().mark).toBe('colour');
    expect(layout({ look: look('karaoke') }).mark).toBe('fill');
  });

  it('marks the whole page for Tamil, and for words with no real times', () => {
    const tamil = spoken(['நண்பர்களே', 'இந்த', 'விளையாட்டு', 'அருமை'], 10);
    const result = layout({ transcript: tamil });
    expect(result.script).toBe('tamil');
    expect(result.mark).toBe('none');
    // A looser width estimate: one word fewer on a page.
    expect(result.pages.every((page) => page.words.length <= 2)).toBe(true);
    expect(layout({ wordTimed: false }).mark).toBe('none');
  });

  it('leaves out a word that is only emoji and pages the rest', () => {
    const result = layout({ transcript: spoken(['wow', '🔥', 'nice'], 10), track: track({ maxWords: 6 }) });
    expect(texts(result.words)).toEqual(['wow', 'nice']);
  });
});

describe('Upload SRT: the captions file reader', () => {
  const SRT = [
    '﻿1',
    '00:00:01,000 --> 00:00:03,000',
    'Hello <i>there</i>, friend.',
    '',
    '2',
    '00:00:03,500 --> 00:00:05,000',
    'Second line',
    'on two rows',
    '',
  ].join('\r\n');

  it('reads SRT cues, tolerating a byte order mark, Windows line ends and tags', () => {
    expect(parseSubtitleCues(SRT)).toEqual({
      format: 'srt',
      cues: [
        { start: 1_000, end: 3_000, text: 'Hello there, friend.' },
        { start: 3_500, end: 5_000, text: 'Second line on two rows' },
      ],
    });
  });

  it('reads WebVTT: no cue numbers, dots, hours left out, settings, notes and styles skipped', () => {
    const vtt = [
      'WEBVTT - made by hand',
      '',
      'NOTE this is a comment',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'intro',
      '00:01.000 --> 00:02.500 align:start position:10%',
      '<v Roger>Hi &amp; welcome',
      '',
      '01:00:00.000 --> 01:00:01.000',
      '{\\an8}Late line',
    ].join('\n');
    expect(parseSubtitleCues(vtt)).toEqual({
      format: 'vtt',
      cues: [
        { start: 1_000, end: 2_500, text: 'Hi & welcome' },
        { start: 3_600_000, end: 3_601_000, text: 'Late line' },
      ],
    });
  });

  it('puts cues in order and never lets one run into the next', () => {
    const out = parseSubtitleCues(
      ['00:00:05,000 --> 00:00:09,000', 'second', '', '00:00:01,000 --> 00:00:07,000', 'first'].join('\n'),
    );
    expect(out.cues).toEqual([
      { start: 1_000, end: 5_000, text: 'first' },
      { start: 5_000, end: 9_000, text: 'second' },
    ]);
  });

  it.each([
    ['an empty file', '   \n', 'empty'],
    ['a file with no cue', 'just some notes\n\nand more', 'no_cues'],
    ['cues with no text or backwards times', '00:00:02,000 --> 00:00:01,000\nbackwards\n\n00:00:03,000 --> 00:00:04,000\n', 'no_cues'],
    ['a file that is too big', 'a'.repeat(2 * 1024 * 1024 + 1), 'too_big'],
  ])('refuses %s without echoing it', (_name, input, reason) => {
    try {
      parseSubtitleCues(input);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SubtitleFileError);
      expect((error as SubtitleFileError).reason).toBe(reason);
      expect((error as Error).message).toBe('The captions file could not be read.');
    }
  });

  it("spreads a line's time over its words by length", () => {
    const words = spreadWords('I am extraordinary', 1_000, 3_000);
    expect(texts(words)).toEqual(['I', 'am', 'extraordinary']);
    expect(words[0]?.start).toBe(1_000);
    expect(words.at(-1)?.end).toBe(3_000);
    expect((words[2]?.end ?? 0) - (words[2]?.start ?? 0)).toBeGreaterThan((words[0]?.end ?? 0) - (words[0]?.start ?? 0));
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]?.start).toBe(words[index - 1]?.end);
    }
    expect(spreadWords('  ', 0, 100)).toEqual([]);
    expect(spreadWords('no stop', 0, 1_000, { closeSentence: true }).at(-1)?.text).toBe('stop.');
  });

  it('becomes a supplied transcript that covers the whole stretch', () => {
    const { transcript, format, cues, skipped } = parseSubtitleFile(SRT, {
      language: 'en',
      window: { fromMs: 0, toMs: 60_000 },
    });
    expect([format, cues, skipped]).toEqual(['srt', 2, 0]);
    expect(transcript).toMatchObject({
      source: 'supplied',
      model: 'supplied',
      language: 'en',
      covered: [{ fromMs: 0, toMs: 60_000 }],
    });
    expect(texts(transcript.words)).toEqual(['Hello', 'there,', 'friend.', 'Second', 'line', 'on', 'two', 'rows']);
    expect(transcript.words.map((word) => word.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(transcript.nextIndex).toBe(8);
    expect(transcript.words.every((word) => word.sure === 1)).toBe(true);
  });

  it("shifts a file made for a clip to the clip's place and skips lines outside it", () => {
    const made = parseSubtitleFile(SRT, {
      language: 'en',
      window: { fromMs: 60_000, toMs: 64_000 },
      offsetMs: 60_000,
    });
    expect(made.skipped).toBe(0);
    expect(made.transcript.words[0]?.start).toBe(61_000);
    // The second cue would end at 65 s: it is held to the clip's end.
    expect(made.transcript.words.at(-1)?.end).toBe(64_000);
    const outside = parseSubtitleFile(SRT, { language: 'en', window: { fromMs: 0, toMs: 3_200 } });
    expect(outside.skipped).toBe(1);
    expect(() =>
      parseSubtitleFile(SRT, { language: 'en', window: { fromMs: 100_000, toMs: 110_000 } }),
    ).toThrow(SubtitleFileError);
  });

  it('strips tags and entities', () => {
    expect(cleanCueText('<c.yellow>Hi</c> &lt;3 &nbsp; you')).toBe('Hi <3 you');
  });
});
