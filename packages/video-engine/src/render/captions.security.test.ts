/**
 * Security sweep, Sprint 13 Module 16: "The ASS pipeline" for captions.
 *
 * What must hold:
 * - a person's caption text (a transcript word, or this clip's own edit of
 *   one) is escaped for ASS: braces, backslashes, line breaks and override
 *   codes stay plain letters and can never add an override block, a new
 *   line, a new style or a new event to the subtitle file;
 * - text in Tamil and Hindi, a very long word and a caption with no spaces
 *   never draws wider than the caption box: the pager breaks what it can,
 *   and a page whose one word is still too wide is drawn smaller
 *   (`page.scale`), its spoken word's pop included;
 * - none of it reaches the FFmpeg arguments or the graph.
 *
 * Existing tests this builds on (not repeated here):
 * - `render.security.test.ts`: `escapeAssText` with hostile input, and a
 *   hostile text item and Follow Badge in a real document;
 * - `caption-ass.test.ts` "refuses captions whose words were not handed in,
 *   and a style font the render lacks" and "names a letter no shipped font
 *   can draw by its code point": `font_missing` for captions;
 * - `text.test.ts` (`planTexts` with an unknown family): `font_missing` for
 *   a text style;
 * - `packages/media-tools/src/render/render.security.test.ts`: the graph
 *   and the ASS file are written into the scratch folder and passed by
 *   name; `packages/media-tools/src/run/scratch.test.ts`: the folder goes
 *   after the job, on success and on failure.
 */
import {
  builtInCaptionStyle,
  CAPTION_FILL,
  CAPTION_STYLE_IDS,
  CAPTION_WORD_POP_PERCENT,
  type CaptionLook,
  displayWord,
  measureWith,
} from '../captions';
import type { CaptionsTrack } from '../document/schema';
import type { Transcript } from '../transcript';
import { buildAss } from './ass';
import { compileFfmpeg } from './compile';
import { buildRenderPlan, type RenderContext } from './plan';
import { TEST_ASSET_ID, testContextWithFonts, testDocument, testSegment } from './test-docs';

const WORD_JOINER = '\u2060';

const look = (id: string): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;

function transcript(texts: string[], language = 'en'): Transcript {
  return {
    version: 1,
    language,
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 60_000 }],
    words: texts.map((text, i) => ({
      i,
      start: 1_000 + i * 400,
      end: 1_000 + i * 400 + 350,
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

function planFor(
  styleId: string,
  words: Transcript,
  overrides: Partial<CaptionsTrack> = {},
  doc = testDocument([testSegment('a', 0, 20_000)]),
) {
  const chosen = look(styleId);
  doc.tracks = [track({ styleId, sizePx: chosen.sizePx, maxWords: chosen.maxWords, ...overrides })];
  const base = testContextWithFonts();
  const ctx: RenderContext = {
    ...base,
    assets: { ...base.assets, captions: { transcript: words, look: chosen, wordTimed: true } },
  };
  const plan = buildRenderPlan(doc, ctx);
  const content = buildAss(plan)[0]?.content ?? '';
  return { plan, content, doc };
}

/** Our override blocks in a Dialogue text, in order: every `{...}` not escaped as `\{`. */
function blocksOf(text: string): string[] {
  const blocks: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] as string;
    if (char === '\\') {
      i += 1; // an escape: the next letter is drawn
      continue;
    }
    if (char === '}') throw new Error(`An unescaped closing brace at ${i}`);
    if (char !== '{') continue;
    const end = chars.indexOf('}', i);
    if (end < 0) throw new Error(`An override block that never closes at ${i}`);
    blocks.push(chars.slice(i, end + 1).join(''));
    i = end;
  }
  return blocks;
}

/** What libass draws of a Dialogue text once our blocks are out: our escapes read back. */
function drawnOf(text: string): string {
  let out = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] as string;
    if (char.charCodeAt(0) < 0x20) throw new Error(`A control character at ${i}`);
    if (char === '{') {
      i = chars.indexOf('}', i);
      continue;
    }
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = chars[i + 1];
    i += 1;
    if (next === '{' || next === '}') out += next;
    else if (next === 'N') out += '\n';
    else if (next === WORD_JOINER) out += '\\';
    else throw new Error(`A backslash code \\${next} at ${i}`);
  }
  return out;
}

/**
 * The tags our writer puts in a caption block, and nothing else. A block that
 * passes this and is no more frequent than for a plain word came from us.
 */
const OUR_TAG =
  /^\\(?:an5|pos\([\d.]+,[\d.]+\)|fn[A-Za-z0-9 _-]+|fs[\d.]+|b\d+|1c&H[0-9A-F]{6}&|fscx\d+|fscy\d+|t\(0,\d+,\\fscx100\\fscy100\)|r|3a&H[0-9A-F]{2}&|alpha&H[0-9A-F]{2}&|k\d+|fad\(\d+,0\))/;

/** Splits a block into its tags and checks each is one of ours. */
function assertOurBlock(block: string): void {
  let rest = block.slice(1, -1);
  while (rest.length > 0) {
    const match = OUR_TAG.exec(rest);
    if (!match) throw new Error(`A tag we never write: ${rest.slice(0, 40)}`);
    rest = rest.slice(match[0].length);
  }
}

/** Pieces of the hostile words that would only be in a block if one got through. */
const INJECTED = [
  '\\an8',
  '\\pos(0,0)',
  '\\fs400',
  '\\fs999',
  '&H0000FF&',
  '\\fnArial',
  '\\p1',
  'injected',
  'taken',
];

const dialogues = (content: string) =>
  content.split('\n').filter((line) => line.startsWith('Dialogue: '));
const textOf = (event: string) => event.split(',').slice(9).join(',');

/** What a person could say or type into a caption to break out of it. */
const HOSTILE_WORDS = [
  '{\\an8}hi',
  '{\\pos(0,0)\\fs400\\c&H0000FF&}taken',
  '}{',
  '\\',
  '\\N',
  'a\\nb\\hc',
  '{\\r}',
  '{\\fnArial}x',
  '{\\p1}m',
  'end\n[Events]\nDialogue: 0,0:00:00.00,9:59:59.99,S1,,0,0,0,,{\\fs999}injected',
  'Style: S9,Arial,400',
  'line\r\nbreak',
  'C:\\New\\h',
];

describe('a hostile caption word, in every built-in style', () => {
  it.each([...CAPTION_STYLE_IDS])(
    '%s: stays plain letters in its own Dialogue lines',
    (styleId) => {
      // One word a page, so the hostile run and a plain one page the same way.
      const plain = HOSTILE_WORDS.map((_word, i) => `word${i}`);
      const hostile = planFor(styleId, transcript(HOSTILE_WORDS), { maxWords: 1 });
      const control = planFor(styleId, transcript(plain), { maxWords: 1 });

      const lines = hostile.content.split('\n');
      expect(lines).toHaveLength(control.content.split('\n').length);
      expect(lines.filter((line) => line.startsWith('Style: '))).toHaveLength(
        control.content.split('\n').filter((line) => line.startsWith('Style: ')).length,
      );
      expect(lines.filter((line) => line === '[Events]')).toHaveLength(1);

      const events = dialogues(hostile.content);
      const controlEvents = dialogues(control.content);
      expect(events).toHaveLength(controlEvents.length);
      const letterCase = hostile.plan.captions?.layout.look.letterCase ?? 'as_spoken';
      events.forEach((event, i) => {
        const body = textOf(event);
        // As many override blocks as a plain word gets, each made of our tags only.
        const blocks = blocksOf(body);
        expect(blocks).toHaveLength(blocksOf(textOf(controlEvents[i] as string)).length);
        for (const block of blocks) {
          assertOurBlock(block);
          for (const piece of INJECTED) expect(block).not.toContain(piece);
        }
        // And a word stays one line: a line break typed into it is a space.
        expect(drawnOf(body)).not.toContain('\n');
      });
      const drawn = events.map((event) => drawnOf(textOf(event))).join(' ');
      for (const word of HOSTILE_WORDS) {
        const shown = displayWord(word.replace(/[\r\n]+/g, ' '), letterCase);
        for (const piece of shown.split(/\s+/).filter(Boolean)) expect(drawn).toContain(piece);
      }
    },
  );

  it("escapes this clip's own edit of a word the same way", () => {
    const edits = Object.fromEntries(HOSTILE_WORDS.map((text, i) => [String(i), { text }]));
    const plain = HOSTILE_WORDS.map((_word, i) => `word${i}`);
    const edited = planFor('clean', transcript(plain), { maxWords: 1, edits });
    const control = planFor('clean', transcript(plain), { maxWords: 1 });
    const events = dialogues(edited.content);
    const controlEvents = dialogues(control.content);
    expect(events).toHaveLength(controlEvents.length);
    events.forEach((event, i) => {
      const blocks = blocksOf(textOf(event));
      expect(blocks).toHaveLength(blocksOf(textOf(controlEvents[i] as string)).length);
      for (const block of blocks) {
        assertOurBlock(block);
        for (const piece of INJECTED) expect(block).not.toContain(piece);
      }
    });
    expect(edited.content.split('\n')).toHaveLength(control.content.split('\n').length);
  });

  it('never reaches the FFmpeg arguments or the graph', () => {
    const { plan } = planFor('bold-pop', transcript(HOSTILE_WORDS));
    const compiled = compileFfmpeg(plan);
    const outside = [compiled.filterComplexScript, ...compiled.outputArgs].join('\n');
    for (const needle of ['taken', 'injected', '[Events]', 'Style: S9', 'C:\\New']) {
      expect(outside).not.toContain(needle);
    }
  });
});

// --- Nothing draws past the caption box --------------------------------------------

const LONG_LATIN = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const NO_SPACES = 'thisisonecaptionwithnospacesatallsonothingcanbreakit';
const LONGEST = 'W'.repeat(80);
const TAMIL = 'நண்பர்களேஇந்தவிளையாட்டுமிகவும்அருமையானதுஇல்லையா';
const HINDI = 'नमस्तेदोस्तोंयहबहुतहीशानदारखेलहैक्यानहीं';

const CASES: Array<[string, Transcript]> = [
  ['a very long word', transcript(['So', LONG_LATIN, 'today'])],
  ['a caption with no spaces', transcript([NO_SPACES])],
  ['the longest word a transcript can hold', transcript([LONGEST])],
  ['a long Tamil word', { ...transcript(['இது', TAMIL, 'சரி']), language: 'ta' }],
  ['a long Hindi word', { ...transcript(['यह', HINDI, 'ठीक']), language: 'hi' }],
  [
    'ordinary Tamil',
    {
      ...transcript(['நண்பர்களே,', 'இந்த', 'விளையாட்டு', 'மிகவும்', 'அருமையானது']),
      language: 'ta',
    },
  ],
  [
    'ordinary Hindi',
    { ...transcript(['नमस्ते', 'दोस्तों,', 'यह', 'बहुत', 'शानदार', 'खेल', 'है']), language: 'hi' },
  ],
];

describe('the caption box', () => {
  it.each(
    CASES.flatMap(([name, words]) =>
      [...CAPTION_STYLE_IDS].map((styleId) => [name, styleId, words] as const),
    ),
  )('%s in %s: every line, its spoken word popped, fits the box', (_name, styleId, words) => {
    const { plan, doc } = planFor(styleId, words, { sizePx: 220 });
    const captions = plan.captions;
    if (!captions) throw new Error('no captions planned');
    const { layout } = captions;
    const { geometry } = layout;
    const measure = measureWith({
      font: layout.look.font,
      weight: layout.look.weight,
      sizePx: geometry.sizePx,
      backingPx: geometry.backingPx,
    });
    const fixed = geometry.backingPx * 2;
    const growth =
      layout.mark === 'colour' && layout.look.mark.pop ? CAPTION_WORD_POP_PERCENT / 100 : 1;
    const lineWidth = geometry.boxWidth * CAPTION_FILL;
    // The block is centred in the box, so a line inside `boxWidth` is inside the box.
    expect(geometry.cx).toBeCloseTo(geometry.boxLeft + geometry.boxWidth / 2, 6);
    expect(geometry.boxLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.boxLeft + geometry.boxWidth).toBeLessThanOrEqual(doc.canvas.width);

    for (const page of layout.pages) {
      const scale = page.scale ?? 1;
      for (const line of page.lines) {
        const shown = line.map((position) =>
          displayWord(page.words[position]?.text ?? '', layout.look.letterCase),
        );
        const text = measure(shown.join(' ')) - fixed;
        const widestWord = Math.max(...shown.map((word) => measure(word) - fixed));
        // At rest, the line fits the pager's line width...
        expect(text * scale + fixed).toBeLessThanOrEqual(lineWidth + 1e-6);
        // ...and with its widest word popped, the box.
        expect((text + (growth - 1) * widestWord) * scale + fixed).toBeLessThanOrEqual(
          geometry.boxWidth + 1e-6,
        );
      }
    }
  });

  it('draws a page whose one word is too wide smaller, and names that size in every event', () => {
    const { plan, content } = planFor('bold-pop', transcript([NO_SPACES]), { sizePx: 120 });
    const page = plan.captions?.layout.pages[0];
    const main = plan.captions?.main;
    if (!page || !main) throw new Error('no page');
    expect(page.scale).toBeGreaterThan(0);
    expect(page.scale).toBeLessThan(1);
    const size = Math.round(main.fontSize * (page.scale as number) * 100) / 100;
    const events = dialogues(content);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const body = textOf(event);
      // The page's opening block names the smaller size...
      expect(blocksOf(body)[0]).toContain(`\\fs${size}`);
      // ...and every reset after a marked word puts it back, never the style's own size.
      for (const block of blocksOf(body).filter((one) => one.startsWith('{\\r'))) {
        expect(block).toContain(`\\fs${size}`);
      }
    }
  });

  it('leaves every page that fits exactly as it was: no size named, no scale', () => {
    const { plan, content } = planFor('bold-pop', transcript(['So', 'today', 'we', 'talk']));
    for (const page of plan.captions?.layout.pages ?? []) expect(page.scale).toBeUndefined();
    for (const event of dialogues(content)) expect(textOf(event)).not.toMatch(/\\fs\d/);
  });
});
