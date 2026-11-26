/**
 * Bleep Bad Words (Module 09): finding the words, writing the bleeps, and
 * masking them in the captions (both the ASS writer's words and the
 * preview's layout read `captionWords`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  builtInCaptionStyle,
  CAPTION_STYLE_IDS,
  type CaptionLook,
  captionLayout,
  captionWords,
} from '../captions';
import { MAX_BLEEPS } from '../document/limits';
import { type CaptionsTrack, type ClipDocument, clipDocumentSchema } from '../document/schema';
import { buildAss } from '../render/ass';
import { covers, resolveTextFont } from '../render/fonts';
import { FONT_MANIFEST } from '../render/fonts-manifest';
import { buildRenderPlan, type RenderContext } from '../render/plan';
import {
  TEST_ASSET_ID,
  testContextWithFonts,
  testDocument,
  testSegment,
} from '../render/test-docs';
import type { Transcript } from '../transcript/types';
import {
  BLEEP_PAD_MS,
  type BleepInputWord,
  type BleepWord,
  bleepCoversWord,
  bleepModeOf,
  clearBleeps,
  defaultBleepList,
  findBleepWords,
  maskBleepedWord,
  setBleeps,
} from './bleeps';

/** Words one after another, 400 ms each with 100 ms between, from `fromMs`. */
function said(texts: string[], fromMs = 1_000): BleepInputWord[] {
  return texts.map((text, index) => ({
    index,
    text,
    start: fromMs + index * 500,
    end: fromMs + index * 500 + 400,
  }));
}

const found = (texts: string[], language = 'en', workspace: string[] = []) =>
  findBleepWords(said(texts), { language, workspace }).map((word) => word.text);

describe('findBleepWords', () => {
  it('matches whole words only: "class" never matches "ass"', () => {
    expect(found(['class', 'classes', 'assess', 'bass', 'passing', 'glasses', 'assassin'])).toEqual(
      [],
    );
    expect(found(['ass', 'Asses', 'ASS!', 'jackass'])).toEqual(['ass', 'Asses', 'ASS!', 'jackass']);
  });

  it('ignores case and punctuation, and knows English endings', () => {
    expect(
      found([
        'Shit,',
        '"FUCK!"',
        'fucking',
        'fucked',
        'fucks',
        'bitches',
        'shitting',
        "shit's",
        'pissed',
      ]),
    ).toEqual([
      'Shit,',
      '"FUCK!"',
      'fucking',
      'fucked',
      'fucks',
      'bitches',
      'shitting',
      "shit's",
      'pissed',
    ]);
    expect(found(['hello', 'there', 'shirt', 'shift', 'fun'])).toEqual([]);
  });

  it('leaves mild words to the workspace list, which is matched on top', () => {
    expect(found(['damn', 'hell', 'crap'])).toEqual([]);
    expect(found(['damn', 'it', 'damned', 'crap'], 'en', ['Damn'])).toEqual(['damn', 'damned']);
    // A phrase in My Words matches those words in a row, and only in a row.
    expect(found(['holy', 'cow', 'that', 'cow'], 'en', ['holy cow'])).toEqual(['holy', 'cow']);
  });

  it('reads a region code as its language, and lists each word once, in time order', () => {
    const words = findBleepWords(said(['fine', 'shit', 'okay']), {
      language: 'en-GB',
      workspace: ['shit'],
    });
    expect(words).toEqual([{ wordIndex: 1, from: 1_500, to: 1_900, text: 'shit' }]);
    const shuffled = [...said(['fuck', 'a', 'shit'])].reverse();
    expect(
      findBleepWords(shuffled, { language: 'en', workspace: [] }).map((w) => w.wordIndex),
    ).toEqual([0, 2]);
  });

  it('finds Hindi in Devanagari and in Latin letters, with no English endings', () => {
    expect(found(['यह', 'चूतिया,', 'है।', 'Chutiya', 'chutiyas', 'class'], 'hi')).toEqual([
      'चूतिया,',
      'Chutiya',
    ]);
    // The same letter written precomposed (U+095C) or as a base and a nukta.
    expect(found(['भोसड़ी'], 'hi')).toHaveLength(1);
    expect(found(['भोसड़ी'], 'hi')).toHaveLength(1);
  });

  it('has no Tamil list yet, but a workspace can add Tamil words', () => {
    expect(defaultBleepList('ta')).toEqual([]);
    expect(found(['வணக்கம்', 'நண்பா'], 'ta')).toEqual([]);
    expect(found(['வணக்கம்', 'நண்பா'], 'ta', ['நண்பா'])).toEqual(['நண்பா']);
    expect(found(['shit'], 'xx')).toEqual([]);
  });

  it('finds the two words planted in the talk sample, and nothing else there', () => {
    const file = join(
      __dirname,
      '../../../../apps/media/src/postgear_media/simulation/transcripts/talk.json',
    );
    const talk = JSON.parse(readFileSync(file, 'utf8')) as {
      words: Array<{ start: number; end: number; text: string }>;
    };
    const words = talk.words.map((word, index) => ({ index, ...word }));
    const hits = findBleepWords(words, { language: 'en', workspace: [] });
    expect(hits.map(({ text, from, to }) => ({ text, from, to }))).toEqual([
      { text: 'bullshit', from: 15_511, to: 15_989 },
      { text: 'shitty', from: 100_551, to: 100_920 },
    ]);
    // "damn" (112 s) is a mild word: My Words adds it.
    expect(findBleepWords(words, { language: 'en', workspace: ['damn'] })).toHaveLength(3);
  });
});

const word = (wordIndex: number, from: number, to: number, text = 'x'): BleepWord => ({
  wordIndex,
  from,
  to,
  text,
});

describe('setBleeps and clearBleeps', () => {
  const base = testDocument([testSegment('a', 0, 20_000)]);

  it('pads each word by 40 ms, merges bleeps that touch, sorts them and keeps the schema', () => {
    const doc = setBleeps(
      base,
      [word(2, 5_000, 5_400), word(0, 1_000, 1_300), word(1, 1_350, 1_600)],
      'bleep',
      'src',
    );
    expect(BLEEP_PAD_MS).toBe(40);
    expect(doc.bleeps.map(({ from, to, mode }) => ({ from, to, mode }))).toEqual([
      { from: 960, to: 1_640, mode: 'bleep' },
      { from: 4_960, to: 5_440, mode: 'bleep' },
    ]);
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
    expect(base.bleeps).toEqual([]);
    expect(bleepModeOf(doc)).toBe('bleep');
  });

  it('never starts before the video', () => {
    const doc = setBleeps(base, [word(0, 10, 300)], 'mute', 'src');
    expect(doc.bleeps[0]).toMatchObject({ from: 0, to: 340, mode: 'mute' });
  });

  it('gives the same words the same ids, so undo, redo and re-ticking stay clean', () => {
    const all = [word(0, 1_000, 1_300), word(1, 3_000, 3_300), word(2, 6_000, 6_300)];
    const first = setBleeps(base, all, 'bleep', 'src');
    expect(setBleeps(base, [...all].reverse(), 'bleep', 'src')).toEqual(first);
    // Nothing changed: the same document, so no undo step.
    expect(setBleeps(first, all, 'bleep', 'src')).toBe(first);
    const unticked = setBleeps(first, [all[0] as BleepWord, all[2] as BleepWord], 'bleep', 'src');
    expect(unticked.bleeps.map((b) => b.id)).toEqual([first.bleeps[0]?.id, first.bleeps[2]?.id]);
    expect(setBleeps(unticked, all, 'bleep', 'src')).toEqual(first);
    // Switching to Mute keeps the ids.
    const muted = setBleeps(first, all, 'mute', 'src');
    expect(muted.bleeps.map((b) => b.id)).toEqual(first.bleeps.map((b) => b.id));
    expect(muted.bleeps.every((b) => b.mode === 'mute')).toBe(true);
  });

  it(`keeps at most ${MAX_BLEEPS}, the earliest first`, () => {
    const many = Array.from({ length: MAX_BLEEPS + 20 }, (_, k) => word(k, k * 200, k * 200 + 50));
    const doc = setBleeps(base, many, 'bleep', 'src');
    expect(doc.bleeps).toHaveLength(MAX_BLEEPS);
    expect(doc.bleeps[0]?.from).toBe(0);
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("leaves another video's bleeps alone, and ignores a video the clip does not have", () => {
    const two: ClipDocument = {
      ...base,
      sources: [...base.sources, { id: 'cam', videoId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }],
    };
    const withCam = setBleeps(two, [word(0, 1_000, 1_300)], 'bleep', 'cam');
    const both = setBleeps(withCam, [word(0, 1_000, 1_300)], 'bleep', 'src');
    expect(both.bleeps.map((b) => b.source).sort()).toEqual(['cam', 'src']);
    expect(new Set(both.bleeps.map((b) => b.id)).size).toBe(2);
    expect(clipDocumentSchema.safeParse(both).success).toBe(true);
    expect(setBleeps(both, [], 'bleep', 'src').bleeps.map((b) => b.source)).toEqual(['cam']);
    expect(setBleeps(base, [word(0, 1_000, 1_300)], 'bleep', 'nope')).toBe(base);
  });

  it('clears every bleep, and is no step when there are none', () => {
    const doc = setBleeps(base, [word(0, 1_000, 1_300)], 'bleep', 'src');
    expect(clearBleeps(doc).bleeps).toEqual([]);
    expect(clearBleeps(base)).toBe(base);
    expect(bleepModeOf(base)).toBeNull();
  });
});

describe('caption masking', () => {
  it('shows the first letter and stars, keeping punctuation', () => {
    expect(maskBleepedWord('fuck')).toBe('f***');
    expect(maskBleepedWord('Shit,')).toBe('S***,');
    expect(maskBleepedWord('"bullshit!"')).toBe('"b*******!"');
    // A Devanagari letter keeps its vowel sign; each letter after it is one star.
    expect(maskBleepedWord('चूतिया')).toBe('चू**');
    expect(maskBleepedWord('a')).toBe('a');
    expect(maskBleepedWord('...')).toBe('...');
  });

  it('covers a word only when the bleep holds more than half of it (the padding reaches its neighbours)', () => {
    const bleeps = [{ source: 'src', from: 960, to: 1_440 }];
    expect(bleepCoversWord(bleeps, 'src', { start: 1_000, end: 1_400 })).toBe(true);
    expect(bleepCoversWord(bleeps, 'src', { start: 1_400, end: 1_800 })).toBe(false);
    expect(bleepCoversWord(bleeps, 'cam', { start: 1_000, end: 1_400 })).toBe(false);
  });

  const transcript = (): Transcript => ({
    version: 1,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 60_000 }],
    words: ['This', 'is', 'shit,', 'right', 'fucking', 'now'].map((text, i) => ({
      i,
      start: 1_000 + i * 360,
      end: 1_000 + i * 360 + 300,
      text,
      sure: 0.9,
    })),
    nextIndex: 6,
  });

  const track = (): CaptionsTrack => ({
    id: 'cc',
    kind: 'captions',
    transcriptAssetId: TEST_ASSET_ID,
    language: 'en',
    styleId: 'bold-pop',
    position: { x: 0.5, y: 0.72 },
    sizePx: 86,
    maxWords: 3,
    edits: {},
  });

  function bleeped(): { doc: ClipDocument; words: Transcript } {
    const words = transcript();
    const found = findBleepWords(
      words.words.map((w) => ({ index: w.i, text: w.text, start: w.start, end: w.end })),
      { language: 'en', workspace: [] },
    );
    const doc = setBleeps(testDocument([testSegment('a', 0, 10_000)]), found, 'bleep', 'src');
    doc.tracks = [track()];
    return { doc, words };
  }

  it('masks bleeped words in captionWords and leaves the transcript as it was', () => {
    const { doc, words } = bleeped();
    const before = JSON.stringify(words);
    const shown = captionWords(doc, track(), words);
    expect(shown.map((w) => w.text)).toEqual(['This', 'is', 's***,', 'right', 'f******', 'now']);
    expect(shown.filter((w) => w.bleeped).map((w) => w.i)).toEqual([2, 4]);
    expect(JSON.stringify(words)).toBe(before);
    // Without bleeps nothing changes, and no word carries the mark.
    const plain = captionWords({ ...doc, bleeps: [] }, track(), words);
    expect(plain.map((w) => w.text)).toEqual(['This', 'is', 'shit,', 'right', 'fucking', 'now']);
    expect(plain.some((w) => 'bleeped' in w)).toBe(false);
  });

  it("masks a word this clip's own edit changed too", () => {
    const { doc, words } = bleeped();
    const shown = captionWords(doc, { edits: { '2': { text: 'Shoot' } } }, words);
    expect(shown[2]?.text).toBe('S****');
  });

  const look = (): CaptionLook => (builtInCaptionStyle('bold-pop') as { look: CaptionLook }).look;

  it("masks them in the preview's layout (captionLayout)", () => {
    const { doc, words } = bleeped();
    const layout = captionLayout({
      doc,
      track: track(),
      look: look(),
      transcript: words,
      wordTimed: true,
    });
    const onPages = layout.pages.flatMap((page) => page.words.map((w) => w.text));
    expect(onPages).toContain('s***,');
    expect(onPages).toContain('f******');
    expect(onPages.join(' ')).not.toMatch(/shit|fucking/i);
  });

  it('masks them in the ASS file the export draws, and never writes the words', () => {
    const { doc, words } = bleeped();
    const base = testContextWithFonts();
    const ctx: RenderContext = {
      ...base,
      assets: { ...base.assets, captions: { transcript: words, look: look(), wordTimed: true } },
    };
    const [file] = buildAss(buildRenderPlan(doc, ctx));
    const content = file?.content ?? '';
    expect(content).toMatch(/s\*{3}/i);
    expect(content).toMatch(/f\*{6}/i);
    expect(content).not.toMatch(/shit|fucking/i);
  });

  it('keeps one plain space either side of a masked word in the ASS lines, marked or not', () => {
    const { doc, words } = bleeped();
    const base = testContextWithFonts();
    const ctx: RenderContext = {
      ...base,
      assets: { ...base.assets, captions: { transcript: words, look: look(), wordTimed: true } },
    };
    const [file] = buildAss(buildRenderPlan(doc, ctx));
    const events = (file?.content ?? '')
      .split('\n')
      .filter((line) => line.startsWith('Dialogue: '));
    const pop = '\\fscx116\\fscy116\\t(0,90,\\fscx100\\fscy100)';
    const mark = `{\\1c&H00E6FF&${pop}}`;
    expect(events.map((event) => event.split(',').slice(9).join(','))).toEqual([
      `{\\an5\\pos(540,1382.4)}${mark}THIS{\\r} IS S***,`,
      `{\\an5\\pos(540,1382.4)}THIS ${mark}IS{\\r} S***,`,
      `{\\an5\\pos(540,1382.4)}THIS IS ${mark}S***,{\\r}`,
      `{\\an5\\pos(540,1382.4)}${mark}RIGHT{\\r} F****** NOW`,
      `{\\an5\\pos(540,1382.4)}RIGHT ${mark}F******{\\r} NOW`,
      `{\\an5\\pos(540,1382.4)}RIGHT F****** ${mark}NOW{\\r}`,
    ]);
  });

  it('lays a masked word out as its own word, spaced and measured like any other', () => {
    const { doc, words } = bleeped();
    const layout = captionLayout({
      doc,
      track: track(),
      look: look(),
      transcript: words,
      wordTimed: true,
    });
    const lines = layout.pages.flatMap((page) =>
      page.lines.map((line) => line.map((at) => page.words[at]?.text).join(' ')),
    );
    expect(lines).toEqual(['This is s***,', 'right f****** now']);
  });

  it('masks with a star every shipped caption font draws, so neither the preview nor libass falls back', () => {
    const star = maskBleepedWord('fuck').codePointAt(1) as number;
    expect(String.fromCodePoint(star)).toBe('*');
    for (const id of CAPTION_STYLE_IDS) {
      const chosen = (builtInCaptionStyle(id) as { look: CaptionLook }).look;
      const font = resolveTextFont(FONT_MANIFEST, chosen.font, chosen.weight);
      expect(font).toBeTruthy();
      const coverage = FONT_MANIFEST.coverage[font?.fontId as string];
      expect([id, covers(coverage, star), covers(coverage, 0x20)]).toEqual([id, true, true]);
    }
  });
});
