import {
  type ClipDocument,
  createClipDocument,
  type RecipeSettings,
  STARTER_RECIPES,
} from '@postgear/video-engine';
import type { CaptionStyleView, SavedLayoutView, TranscriptView } from '@/types/clips';
import { createEditorState, editorCanUndo, editorDocument, editorReducer } from './editor-state';
import {
  listenActionLabel,
  mergeMissing,
  missingSentence,
  needsWords,
  recipeChange,
  recipeContext,
  recipePartLines,
  skippedLine,
  skipSentence,
  wordParts,
} from './recipe-model';

function makeDoc(): ClipDocument {
  const doc = createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '16:9',
  });
  return { ...doc, meta: { shapeChosen: true } };
}

const VIDEO = { width: 1920, height: 1080 };
const starter = (id: string) => {
  const found = STARTER_RECIPES.find((recipe) => recipe.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('reading a recipe back', () => {
  it('lists each part in plain words', () => {
    const settings: RecipeSettings = {
      version: 1,
      ratio: '9:16',
      layout: { kind: 'blurred' },
      follow: { on: true, mode: 'speaker' },
      captions: { on: true, styleId: 'bold-pop' },
      silences: { on: true, minMs: 800 },
      fillers: { on: true },
      bleep: { on: true, mode: 'mute' },
      hookTitle: { on: true, look: 'hook-bold' },
      exportQuality: '1080p',
    };
    expect(recipePartLines(settings)).toEqual([
      'Shape: Vertical',
      'Layout: Blurred',
      'Follow the speaker',
      'Captions: Bold Pop',
      'Remove silences of 0.8 seconds or more',
      'Remove filler words',
      'Mute bad words',
      'Hook title',
      'Export at 1080p',
    ]);
  });

  it("names the workspace's own caption style and a saved layout", () => {
    const styles = [{ id: 'mine-1', name: 'Client A' }];
    expect(
      recipePartLines(
        {
          version: 1,
          captions: { on: true, styleId: 'mine-1' },
          layout: { kind: 'split', presetId: '7b2a9c1e-0000-4000-8000-000000000001' },
        },
        styles,
      ),
    ).toEqual(['Layout: your saved Split layout', 'Captions: Client A']);
  });

  it('says what was used for a part that is gone', () => {
    expect(missingSentence({ part: 'captionStyle', id: 'gone', usedInstead: 'clean' })).toBe(
      "This recipe's caption style was deleted. We used Clean instead.",
    );
    expect(missingSentence({ part: 'layoutPreset', id: 'gone', usedInstead: 'split' })).toBe(
      "This recipe's saved layout was deleted. We used Split instead.",
    );
    expect(missingSentence({ part: 'layoutPreset', id: 'gone', usedInstead: null })).toBe(
      "This recipe's saved layout was deleted. We kept the clip's own layout.",
    );
  });

  it('says each skipped part once, in sentences', () => {
    expect(skipSentence({ part: 'follow', reason: 'no_faces' })).toBe(
      'Follow The Speaker was skipped: we could not find anyone to follow.',
    );
    expect(
      skippedLine([
        { part: 'captions', reason: 'no_speech' },
        { part: 'captions', reason: 'no_speech' },
        { part: 'silences', reason: 'nothing_found' },
      ]),
    ).toBe(
      'Captions was skipped: we could not hear anyone. Remove Silences was skipped: there was nothing to change.',
    );
    expect(skippedLine([])).toBeNull();
  });

  it('merges the missing parts of the server and the engine', () => {
    const one = { part: 'captionStyle' as const, id: 'a', usedInstead: 'clean' };
    expect(mergeMissing([one], [one, { ...one, id: 'b' }])).toHaveLength(2);
  });

  it('labels the listen button with its price', () => {
    expect(listenActionLabel(12)).toBe('Listen To This Clip (12 AI Minutes)');
    expect(listenActionLabel(1)).toBe('Listen To This Clip (1 AI Minute)');
    expect(listenActionLabel(0)).toBe('Listen To This Clip');
  });
});

describe('the parts that need words', () => {
  it('keeps only the word parts for the second step', () => {
    const social = starter('starter-social-edit').settings;
    const words = wordParts(social);
    expect(words.ratio).toBeUndefined();
    expect(words.follow).toBeUndefined();
    expect(words.captions).toEqual(social.captions);
    expect(words.hookTitle).toEqual(social.hookTitle);
    expect(needsWords(social)).toBe(true);
    expect(needsWords(starter('starter-reframe').settings)).toBe(false);
  });
});

describe('the context the engine reads', () => {
  const transcript: TranscriptView = {
    id: '9c1e3f2a-0000-4000-8000-000000000001',
    language: 'en',
    model: 'test',
    source: 'listened',
    words: [{ i: 0, text: 'hello', start: 11_000, end: 11_400, sure: 1 }],
    covered: [{ fromMs: 0, toMs: 60_000 }],
    fixes: 0,
    fileName: null,
  } as TranscriptView;

  it('knows built-in and own caption looks, and a saved layout only for its shape', () => {
    const own = { id: 'mine', name: 'Mine', hint: '', builtIn: false, look: { sizePx: 40 } };
    const layout = {
      id: 'lay-1',
      name: 'Two',
      ratio: '9:16',
      layout: { kind: 'split', areas: [] },
      createdAt: '',
      updatedAt: '',
    } as unknown as SavedLayoutView;
    const ctx = recipeContext({
      videoSize: VIDEO,
      transcript,
      styles: [own as unknown as CaptionStyleView],
      layouts: [layout],
      ratio: '9:16',
      workspaceWords: ['darn'],
    });
    expect(ctx.captionLook('mine')).toEqual({ sizePx: 40 });
    expect(ctx.captionLook('bold-pop')).not.toBeNull();
    expect(ctx.captionLook('deleted-style')).toBeNull();
    expect(ctx.layoutPreset('lay-1')).toEqual({ kind: 'split', areas: [] });
    expect(ctx.transcript?.assetId).toBe(transcript.id);
    expect(ctx.bleepLists).toEqual({ language: 'en', workspace: ['darn'] });
    const wide = recipeContext({
      videoSize: VIDEO,
      transcript: null,
      styles: [],
      layouts: [layout],
      ratio: '16:9',
    });
    expect(wide.layoutPreset('lay-1')).toBeNull();
    expect(wide.transcript).toBeNull();
  });
});

describe('applying a recipe', () => {
  const ctx = recipeContext({
    videoSize: VIDEO,
    transcript: null,
    styles: [],
    layouts: [],
    ratio: '9:16',
  });

  it('is one undo step: shape and recipe id together, Undo gives the clip back', () => {
    const doc = makeDoc();
    const reframe = starter('starter-reframe');
    const outcome = recipeChange(doc, reframe.settings, ctx, {
      recipeId: reframe.id,
      brandKit: null,
    });
    expect(outcome.doc.canvas.ratio).toBe('9:16');
    expect(outcome.doc.recipeId).toBe('starter-reframe');
    expect(outcome.follow).toEqual({ mode: 'speaker' });

    let state = createEditorState({ document: doc, title: 'Clip' });
    state = editorReducer(state, { type: 'apply', change: () => outcome.doc, now: 1 });
    expect(editorDocument(state).recipeId).toBe('starter-reframe');
    state = editorReducer(state, { type: 'undo' });
    expect(editorDocument(state).canvas.ratio).toBe('16:9');
    expect(editorDocument(state).recipeId).toBeUndefined();
    expect(editorCanUndo(state)).toBe(false);
  });

  it('skips the word parts when nothing was listened to, and says so in needs', () => {
    const doc = makeDoc();
    const captions = starter('starter-captions-only');
    const outcome = recipeChange(doc, captions.settings, ctx, {
      recipeId: captions.id,
      brandKit: null,
    });
    expect(outcome.needs).toContain('transcript');
    expect(outcome.skipped).toContainEqual({ part: 'captions', reason: 'no_transcript' });
  });
});

describe('undo and the cleanup note', () => {
  it('takes a cleanup note away with its step, and keeps the shape answer', () => {
    const doc = makeDoc();
    let state = createEditorState({ document: doc, title: 'Clip' });
    state = editorReducer(state, {
      type: 'apply',
      change: (current) => ({
        ...current,
        meta: { ...current.meta, cleanup: { silencesMinMs: 800 } },
      }),
      now: 1,
    });
    expect(editorDocument(state).meta?.cleanup).toEqual({ silencesMinMs: 800 });
    state = editorReducer(state, { type: 'undo' });
    expect(editorDocument(state).meta).toEqual({ shapeChosen: true });
    state = editorReducer(state, { type: 'redo' });
    expect(editorDocument(state).meta?.cleanup).toEqual({ silencesMinMs: 800 });
    expect(editorDocument(state).meta?.shapeChosen).toBe(true);
  });
});
