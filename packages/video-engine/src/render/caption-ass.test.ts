/**
 * The ASS caption writer (Sprint 13, Module 03): the exact lines for each way
 * of marking the spoken word, and the rules research 09 found the hard way.
 */
import { builtInCaptionStyle, type CaptionLook } from '../captions';
import type { CaptionsTrack } from '../document/schema';
import type { Transcript } from '../transcript';
import { buildAss } from './ass';
import { buildRenderPlan, type RenderContext } from './plan';
import { testContextWithFonts, testDocument, testSegment, testText, TEST_ASSET_ID } from './test-docs';

const look = (id: string): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;

function words(texts: string[], startMs = 1_000, stepMs = 360, lengthMs = 300): Transcript {
  return {
    version: 1,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 60_000 }],
    words: texts.map((text, i) => ({
      i,
      start: startMs + i * stepMs,
      end: startMs + i * stepMs + lengthMs,
      text,
      sure: 0.9,
    })),
    nextIndex: texts.length,
  };
}

function track(overrides: Partial<CaptionsTrack> = {}): CaptionsTrack {
  return {
    id: 'cc',
    kind: 'captions',
    transcriptAssetId: TEST_ASSET_ID,
    language: 'en',
    styleId: 'bold-pop',
    position: { x: 0.5, y: 0.72 },
    sizePx: 86,
    maxWords: 3,
    edits: {},
    ...overrides,
  };
}

function render(
  styleId: string,
  transcript: Transcript,
  options: { track?: Partial<CaptionsTrack>; wordTimed?: boolean; look?: CaptionLook } = {},
) {
  const chosen = options.look ?? look(styleId);
  const doc = testDocument([testSegment('a', 0, 10_000)]);
  doc.tracks = [track({ styleId, sizePx: chosen.sizePx, maxWords: chosen.maxWords, ...options.track })];
  const base = testContextWithFonts();
  const ctx: RenderContext = {
    ...base,
    assets: {
      ...base.assets,
      captions: { transcript, look: chosen, wordTimed: options.wordTimed ?? true },
    },
  };
  const plan = buildRenderPlan(doc, ctx);
  const [file] = buildAss(plan);
  const content = file?.content ?? '';
  return {
    plan,
    content,
    style: content.split('\n').find((line) => line.startsWith('Style: ')) ?? '',
    events: content.split('\n').filter((line) => line.startsWith('Dialogue: ')),
  };
}

const text = (event: string) => event.split(',').slice(9).join(',');
const times = (event: string) => event.split(',').slice(1, 3);
const SO_TODAY_WE = words(['So', 'today', 'we']);

describe('one event per word: colour', () => {
  const { events, style, content } = render('bold-pop', SO_TODAY_WE);

  it('writes the whole page in every event and marks only the spoken word, then resets', () => {
    const pop = '\\fscx116\\fscy116\\t(0,90,\\fscx100\\fscy100)';
    expect(events.map(text)).toEqual([
      `{\\an5\\pos(540,1382.4)}{\\1c&H00E6FF&${pop}}SO{\\r} TODAY WE`,
      `{\\an5\\pos(540,1382.4)}SO {\\1c&H00E6FF&${pop}}TODAY{\\r} WE`,
      `{\\an5\\pos(540,1382.4)}SO TODAY {\\1c&H00E6FF&${pop}}WE{\\r}`,
    ]);
  });

  it('times each event from its word start to the next word start: no gap, no overlap', () => {
    expect(events.map(times)).toEqual([
      ['0:00:01.00', '0:00:01.36'],
      ['0:00:01.36', '0:00:01.72'],
      // The last word stays until the page leaves, a moment after it ends.
      ['0:00:01.72', '0:00:02.28'],
    ]);
  });

  it('draws on the lowest layer, inside the block margins, with an outline style', () => {
    for (const event of events) expect(event.startsWith('Dialogue: 0,')).toBe(true);
    expect(events[0]?.split(',').slice(5, 8)).toEqual(['76', '76', '0']);
    // Fontname, size, colours, weight ..., BorderStyle 1, Outline 9, Shadow 0, Alignment 5.
    expect(style).toMatch(/^Style: S1,PGF f04607 800,134\.33,&H00FFFFFF,&H00FFFFFF,&H00000000,/);
    expect(style.split(',').slice(15, 19)).toEqual(['1', '9', '0', '5']);
    expect(content).toContain('PlayResX: 1080');
    expect(content).toContain('WrapStyle: 0');
  });
});

describe('one event per word: box and reveal', () => {
  it('Marker puts a box behind the spoken word and a transparent one behind the rest', () => {
    const { events, style } = render('marker', SO_TODAY_WE);
    expect(events.map(text)).toEqual([
      '{\\an5\\pos(540,1382.4)\\3a&HFF&}{\\3a&H00&}SO{\\3a&HFF&} TODAY WE',
      '{\\an5\\pos(540,1382.4)\\3a&HFF&}SO {\\3a&H00&}TODAY{\\3a&HFF&} WE',
      '{\\an5\\pos(540,1382.4)\\3a&HFF&}SO TODAY {\\3a&H00&}WE{\\3a&HFF&}',
    ]);
    // BorderStyle 3, the box colour as the outline colour, its padding as the outline.
    expect(style.split(',').slice(5, 6)).toEqual(['&H00EB6325']);
    expect(style.split(',').slice(15, 18)).toEqual(['3', '10', '0']);
  });

  it('Typewriter shows the words said so far and keeps the rest in place, invisible', () => {
    const { events } = render('typewriter', SO_TODAY_WE);
    expect(events.map(text)).toEqual([
      '{\\an5\\pos(540,1382.4)}So {\\alpha&HFF&}today we',
      '{\\an5\\pos(540,1382.4)}So today {\\alpha&HFF&}we',
      '{\\an5\\pos(540,1382.4)}So today we',
    ]);
  });
});

describe('one event per page: fill and none', () => {
  it('Karaoke writes \\k lengths as differences of rounded absolute times', () => {
    // Starts at 1004, 1368, 1731 ms: rounded on their own they are 100, 137 and 173 centiseconds.
    const transcript: Transcript = {
      ...SO_TODAY_WE,
      words: [
        { i: 0, start: 1_004, end: 1_300, text: 'So', sure: 1 },
        { i: 1, start: 1_368, end: 1_600, text: 'today', sure: 1 },
        { i: 2, start: 1_731, end: 2_034, text: 'we', sure: 1 },
      ],
    };
    const { events, style } = render('karaoke', transcript);
    expect(events).toHaveLength(1);
    expect(text(events[0] as string)).toBe(
      '{\\an5\\pos(540,1382.4)\\fscx82\\fscy82\\t(0,110,\\fscx100\\fscy100)}{\\k37}So {\\k36}today {\\k56}we',
    );
    expect(times(events[0] as string)).toEqual(['0:00:01.00', '0:00:02.29']);
    // 37 + 36 + 56 is the page's own length in centiseconds: no error built up.
    expect(37 + 36 + 56).toBe(229 - 100);
    // Primary is the colour once said, Secondary the colour before.
    expect(style.split(',').slice(3, 5)).toEqual(['&H0099D334', '&H00FFFFFF']);
  });

  it('Clean writes one event for the page, faded in, with nothing marked', () => {
    const { events } = render('clean', SO_TODAY_WE);
    expect(events.map(text)).toEqual(['{\\an5\\pos(540,1382.4)\\fad(120,0)}So today we']);
  });
});

describe('the rules that keep letters whole', () => {
  it('never writes \\q2, and resets after every marked word', () => {
    for (const id of ['bold-pop', 'marker', 'karaoke', 'clean', 'boxed', 'typewriter']) {
      const { content, events } = render(id, words(['One', 'two', 'three', 'four', 'five', 'six']));
      expect(content).not.toContain('\\q2');
      expect(events.length).toBeGreaterThan(0);
    }
    const { events } = render('boxed', SO_TODAY_WE);
    for (const event of events) expect(text(event)).toMatch(/\{\\1c&H0AD6FF&\}[^{]+\{\\r\}/);
  });

  it('marks a Tamil page as a whole and never changes style inside a word', () => {
    const tamil = { ...words(['நண்பர்களே,', 'இந்த', 'விளையாட்டு']), language: 'ta' };
    const { events, plan } = render('bold-pop', tamil);
    expect(plan.captions?.layout.mark).toBe('none');
    for (const event of events) {
      const body = text(event);
      // One override block, at the very start (place and the page's font), then only text and breaks.
      expect(body.match(/\{/g)).toHaveLength(1);
      expect(body.startsWith('{\\an5\\pos(540,1382.4)\\fn')).toBe(true);
      expect(body).not.toMatch(/\\1c|\\r\}|\\k\d/);
    }
    // The Tamil font is named explicitly, and is one of the fonts the render checks for.
    expect(text(events[0] as string)).toContain('\\fnPGF');
    expect(plan.fonts.files.some((file) => file.includes('tamil'))).toBe(true);
    expect(plan.fonts.psNames.length).toBeGreaterThanOrEqual(2);
  });

  it('joins Hindi the same way, and keeps a Marker box behind the whole page', () => {
    const hindi = { ...words(['नमस्ते', 'दोस्तों,', 'यह']), language: 'hi' };
    const { events, style, plan } = render('marker', hindi);
    expect(plan.captions?.layout.script).toBe('devanagari');
    expect(style.split(',').slice(15, 16)).toEqual(['3']);
    for (const event of events) {
      expect(text(event).match(/\{/g)).toHaveLength(1);
      expect(text(event)).not.toContain('\\3a');
    }
  });

  it('switches font for one word of another script at that word edges, and back', () => {
    const mixed = words(['Hello', 'நன்றி', 'friends']);
    const { events } = render('clean', mixed);
    const body = text(events[0] as string);
    expect(body).toMatch(/Hello \{\\fnPGF [^}]+\}நன்றி\{\\fnPGF [^}]+\} friends$/);
    // Nothing is switched inside the Tamil word.
    expect(body.split('நன்றி')).toHaveLength(2);
  });

  it('marks the page, not the word, when the word times are not real (a supplied file)', () => {
    const { events, plan } = render('bold-pop', SO_TODAY_WE, { wordTimed: false });
    expect(plan.captions?.layout.mark).toBe('none');
    expect(events.map(text)).toEqual(['{\\an5\\pos(540,1382.4)}SO TODAY WE']);
  });

  it('does the letter case itself and escapes what a person typed', () => {
    const tricky = words(['{\\b1}bold', 'back\\slash', 'ok']);
    const { events } = render('clean', tricky, { track: { letterCase: 'upper' } });
    const body = text(events[0] as string);
    expect(body).toContain('\\{\\⁠B1\\}BOLD');
    expect(body).not.toContain('{\\b1}');
    expect(body).toContain('OK');
  });

  it('takes emoji out of the text', () => {
    const { content } = render('clean', words(['wow', '🔥', 'fire🔥']));
    expect(content).not.toContain('🔥');
    expect(content).toContain('wow fire');
  });

  it("uses this clip's own edits and the track's size, case and mark colour", () => {
    const { events, style } = render('bold-pop', SO_TODAY_WE, {
      track: {
        sizePx: 100,
        letterCase: 'as_spoken',
        markColour: '#00FF00',
        edits: { 1: { text: 'tonight' }, 2: { hidden: true } },
      },
    });
    expect(text(events[0] as string)).toContain('{\\1c&H00FF00&');
    expect(text(events.at(-1) as string)).toContain('tonight{\\r}');
    expect(events).toHaveLength(2);
    expect(style.split(',')[2]).toBe('156.2');
  });

  it('breaks a long page into two lines itself, with \\N', () => {
    const long = words(['extraordinary', 'unbelievable', 'magnificent']);
    const { events } = render('clean', long, { track: { sizePx: 110, maxWords: 6 } });
    expect(text(events[0] as string)).toContain('\\N');
    expect(text(events[0] as string).split('\\N')).toHaveLength(2);
  });

  it('leaves out an event shorter than a centisecond', () => {
    const fast: Transcript = {
      ...SO_TODAY_WE,
      words: [
        { i: 0, start: 1_000, end: 1_002, text: 'a', sure: 1 },
        { i: 1, start: 1_003, end: 1_400, text: 'b', sure: 1 },
      ],
    };
    const { events } = render('bold-pop', fast);
    expect(events).toHaveLength(1);
    expect(text(events[0] as string)).toContain('}B{\\r}');
  });
});

describe('captions in the plan', () => {
  it('shares the file with texts, captions first and lowest', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    doc.tracks = [track(), { id: 'ov', kind: 'overlay', items: [testText('t1')] }];
    const base = testContextWithFonts();
    const plan = buildRenderPlan(doc, {
      ...base,
      assets: {
        ...base.assets,
        captions: { transcript: SO_TODAY_WE, look: look('bold-pop'), wordTimed: true },
      },
    });
    const content = buildAss(plan)[0]?.content ?? '';
    const styles = content.split('\n').filter((line) => line.startsWith('Style: '));
    expect(styles).toHaveLength(2);
    const events = content.split('\n').filter((line) => line.startsWith('Dialogue: '));
    expect(events[0]).toContain(',S1,');
    // The person's own text comes after every caption event, so it is drawn over them.
    expect(events.at(-1)).toContain('Hello there');
    expect(events.slice(0, -1).every((event) => event.includes(',S1,'))).toBe(true);
  });

  it('draws nothing, and needs no font, when every word was cut out or hidden', () => {
    const doc = testDocument([testSegment('a', 30_000, 40_000)]);
    doc.tracks = [track()];
    const base = testContextWithFonts();
    const plan = buildRenderPlan(doc, {
      ...base,
      assets: {
        ...base.assets,
        captions: { transcript: SO_TODAY_WE, look: look('bold-pop'), wordTimed: true },
      },
    });
    expect(plan.captions).toBeNull();
    expect(buildAss(plan)).toEqual([]);
  });

  it('refuses captions whose words were not handed in, and a style font the render lacks', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    doc.tracks = [track()];
    expect(() => buildRenderPlan(doc, testContextWithFonts())).toThrow(
      expect.objectContaining({ code: 'captions_missing' }),
    );
    const base = testContextWithFonts();
    const missingFont = { ...look('bold-pop'), font: 'Comic Sans MS' };
    expect(() =>
      buildRenderPlan(doc, {
        ...base,
        assets: {
          ...base.assets,
          captions: { transcript: SO_TODAY_WE, look: missingFont, wordTimed: true },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'font_missing' }));
  });

  it('names a letter no shipped font can draw by its code point, never by the text', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    doc.tracks = [track()];
    const base = testContextWithFonts();
    try {
      buildRenderPlan(doc, {
        ...base,
        assets: {
          ...base.assets,
          captions: { transcript: words(['こんにちは']), look: look('clean'), wordTimed: true },
        },
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'font_missing' });
      expect(String((error as { details: { letters: string } }).details.letters)).toMatch(/^U\+[0-9A-F]+/);
      expect(JSON.stringify((error as { details: unknown }).details)).not.toContain('こ');
    }
  });
});
