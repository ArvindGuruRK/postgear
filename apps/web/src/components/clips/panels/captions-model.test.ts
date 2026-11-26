import {
  builtInCaptionStyle,
  type CaptionLook,
  captionLayout,
  captionLookSchema,
  createCaptionsTrack,
  createClipDocument,
  MAX_CAPTION_EDITS,
  withCaptionsTrack,
} from '@postgear/video-engine';
import type { CaptionStyleView, TranscriptView } from '@/types/clips';
import {
  captionBars,
  editLook,
  lookFromTrack,
  lookOf,
  lookProblem,
  placeOf,
  pricedLabel,
  styleIsGone,
  withBacking,
  withCase,
  withMarkColour,
  withMaxWords,
  withPlace,
  withSize,
  withStyle,
  withWordEdit,
  wordGroups,
} from './captions-model';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const TRANSCRIPT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const look = (id: string) => builtInCaptionStyle(id)?.look as CaptionLook;
const style = (id: string, name: string, own = false): CaptionStyleView => ({
  id,
  name,
  hint: '',
  builtIn: !own,
  look: look(own ? 'clean' : id),
});

const track = () =>
  createCaptionsTrack({
    transcriptAssetId: TRANSCRIPT,
    language: 'en',
    styleId: 'bold-pop',
    look: look('bold-pop'),
  });

function transcript(texts: string[], sure = 0.9): TranscriptView {
  return {
    id: TRANSCRIPT,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 10_000 }],
    fixes: 0,
    fileName: null,
    words: texts.map((text, i) => ({
      i,
      start: 1_000 + i * 400,
      end: 1_000 + i * 400 + 320,
      text,
      sure: i === 1 ? 0.2 : sure,
    })),
  };
}

function laidOut(current = track(), words = ['So', 'today', 'we', 'cleared', 'the', 'gap']) {
  const doc = withCaptionsTrack(
    createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    current,
  );
  const heard = transcript(words);
  const layout = captionLayout({
    doc,
    track: current,
    look: look('bold-pop'),
    transcript: heard,
    wordTimed: true,
  });
  return { layout, heard };
}

describe('the price on a button', () => {
  it('says the AI minutes, in Title Case, and nothing when it is free', () => {
    expect(pricedLabel('Add Captions', 0)).toBe('Add Captions');
    expect(pricedLabel('Add Captions', 1)).toBe('Add Captions (1 AI Minute)');
    expect(pricedLabel('Add Captions', 12)).toBe('Add Captions (12 AI Minutes)');
  });
});

describe('styles', () => {
  const own = style('44444444-5555-4666-8777-888888888888', 'Mine', true);

  it('finds the look of a listed style, and the default for one that was deleted', () => {
    expect(lookOf('karaoke', [])).toEqual(look('karaoke'));
    expect(lookOf(own.id, [own])).toEqual(own.look);
    expect(lookOf(own.id, [])).toEqual(look('bold-pop'));
    expect(styleIsGone(own.id, [])).toBe(true);
    expect(styleIsGone(own.id, [own])).toBe(false);
    expect(styleIsGone('marker', [])).toBe(false);
  });

  it("takes a style's size and words at once and drops the clip's own overrides", () => {
    const changed = {
      ...track(),
      letterCase: 'lower' as const,
      markColour: '#00FF00',
      edits: { 3: { hidden: true } },
    };
    const next = withStyle(changed, style('clean', 'Clean'));
    expect(next).toMatchObject({
      styleId: 'clean',
      sizePx: 62,
      maxWords: 6,
      edits: { 3: { hidden: true } },
    });
    expect(next).not.toHaveProperty('letterCase');
    expect(next).not.toHaveProperty('markColour');
    expect(next.position).toEqual(changed.position);
  });
});

describe('the controls', () => {
  it('holds size, words at once and place inside their ranges', () => {
    expect(withSize(track(), 500).sizePx).toBe(160);
    expect(withSize(track(), 1).sizePx).toBe(32);
    expect(withMaxWords(track(), 99).maxWords).toBe(8);
    expect(withMaxWords(track(), 0).maxWords).toBe(1);
    expect(withPlace(track(), 2).position.y).toBe(0.92);
    expect(withPlace(track(), -1).position.y).toBe(0.08);
    expect(withPlace(track(), 0.5).position).toEqual({ x: 0.5, y: 0.5 });
  });

  it('names the place the block is at', () => {
    expect(placeOf(track())).toBe('bottom');
    expect(placeOf(withPlace(track(), 0.2))).toBe('top');
    expect(placeOf(withPlace(track(), 0.61))).toBe('');
  });

  it("stores a case or highlight colour only when it differs from the style's own", () => {
    const base = look('bold-pop');
    expect(withCase(track(), 'lower', base).letterCase).toBe('lower');
    expect(withCase({ ...track(), letterCase: 'lower' }, 'upper', base)).not.toHaveProperty(
      'letterCase',
    );
    expect(withMarkColour(track(), '#00ff00', base).markColour).toBe('#00FF00');
    expect(
      withMarkColour({ ...track(), markColour: '#00FF00' }, '#ffe600', base),
    ).not.toHaveProperty('markColour');
  });
});

describe("this clip's own word changes", () => {
  const word = { i: 4, text: 'gap,' };

  it('keeps other text or hidden, and removes the change when the word is as heard again', () => {
    const fixed = withWordEdit(track(), word, { text: '  Gap!  ' });
    expect(fixed?.edits).toEqual({ 4: { text: 'Gap!' } });
    const hidden = withWordEdit(fixed as never, word, { hidden: true });
    expect(hidden?.edits).toEqual({ 4: { text: 'Gap!', hidden: true } });
    const shown = withWordEdit(hidden as never, word, { hidden: false });
    expect(shown?.edits).toEqual({ 4: { text: 'Gap!' } });
    expect(withWordEdit(shown as never, word, { text: 'gap,' })?.edits).toEqual({});
    // Emptying the field is not a change: hiding is its own button.
    expect(withWordEdit(track(), word, { text: '   ' })?.edits).toEqual({});
  });

  it('refuses one more change than a clip keeps, but still lets one be removed', () => {
    const edits = Object.fromEntries(
      Array.from({ length: MAX_CAPTION_EDITS }, (_, index) => [
        String(index + 10),
        { hidden: true },
      ]),
    );
    const full = { ...track(), edits };
    expect(withWordEdit(full, word, { hidden: true })).toBeNull();
    const freed = withWordEdit(full, { i: 10, text: 'x' }, { hidden: false });
    expect(Object.keys(freed?.edits ?? {})).toHaveLength(MAX_CAPTION_EDITS - 1);
  });
});

describe('the words list', () => {
  it('groups words as the captions page them, in the look letter case, unsure ones marked', () => {
    const { layout, heard } = laidOut();
    const groups = wordGroups(layout, track(), heard);
    expect(groups.map((group) => group.words.map((chip) => chip.shown))).toEqual([
      ['SO', 'TODAY', 'WE'],
      ['CLEARED', 'THE', 'GAP'],
    ]);
    expect(groups[0]?.startMs).toBe(1_000);
    expect(groups[0]?.words.map((chip) => chip.unsure)).toEqual([false, true, false]);
    expect(groups[0]?.words[1]).toMatchObject({
      index: 1,
      heard: 'today',
      changed: false,
      hidden: false,
    });
  });

  it('puts a hidden word back where it was, struck out, and a changed word is no longer unsure', () => {
    const edited = { ...track(), edits: { 1: { text: 'tonight' }, 3: { hidden: true } } };
    const { layout, heard } = laidOut(edited);
    const groups = wordGroups(layout, edited, heard);
    const all = groups.flatMap((group) => group.words);
    expect(all.map((chip) => [chip.index, chip.hidden])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [4, false],
      [5, false],
    ]);
    expect(all[1]).toMatchObject({
      shown: 'TONIGHT',
      heard: 'today',
      changed: true,
      unsure: false,
    });
  });
});

describe('Create A Style keeps a look drawable', () => {
  it('drops the outline and the page box for a box behind the spoken word', () => {
    const next = editLook(look('bold-pop'), {
      mark: { kind: 'box', colour: '#2563EB', pop: true },
    });
    expect(next).toMatchObject({ outline: null, box: null, mark: { kind: 'box', pop: false } });
    expect(lookProblem(next)).toBeNull();
  });

  it('swaps outline and box, never both, and every result passes the schema', () => {
    const boxed = withBacking(look('bold-pop'), 'box');
    expect(boxed.outline).toBeNull();
    expect(boxed.box).toEqual({ colour: '#111111', pad: 18 });
    const outlined = withBacking(boxed, 'outline');
    expect(outlined.box).toBeNull();
    expect(outlined.outline).toEqual({ colour: '#000000', width: 7 });
    const bare = withBacking(outlined, 'none');
    for (const made of [boxed, outlined, bare]) {
      expect(captionLookSchema.safeParse(made).success).toBe(true);
    }
  });

  it("starts from the clip's captions as they are", () => {
    const changed = {
      ...track(),
      sizePx: 100,
      maxWords: 2,
      letterCase: 'lower' as const,
      markColour: '#00FF00',
    };
    expect(lookFromTrack(changed, look('bold-pop'))).toMatchObject({
      sizePx: 100,
      maxWords: 2,
      letterCase: 'lower',
      mark: { kind: 'colour', colour: '#00FF00', pop: true },
    });
  });
});

describe('the timeline row', () => {
  it('is one bar a page, with the words as drawn', () => {
    const { layout } = laidOut();
    expect(captionBars(layout)).toEqual([
      { key: 'caption-0', startMs: 1_000, endMs: layout.pages[0]?.end, text: 'SO TODAY WE' },
      {
        key: 'caption-1',
        startMs: layout.pages[1]?.start,
        endMs: layout.pages[1]?.end,
        text: 'CLEARED THE GAP',
      },
    ]);
  });
});
