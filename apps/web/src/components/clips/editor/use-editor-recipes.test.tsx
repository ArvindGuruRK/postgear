import {
  type ClipDocument,
  createClipDocument,
  type RecipeView,
  STARTER_RECIPES,
} from '@postgear/video-engine';
import { act, renderHook } from '@testing-library/react';
import { useReducer, useRef } from 'react';
import { ApiError } from '@/lib/api';
import type { ClipJobView, TranscriptView } from '@/types/clips';
import type { ApplyRecipeAnswer } from '@/types/clips-recipes';
import { createEditorState, editorCanUndo, editorDocument, editorReducer } from './editor-state';
import { LISTEN_FOR_RECIPE } from './recipe-model';
import { type EditorRecipesDeps, useEditorRecipes } from './use-editor-recipes';

const mockJob: { current: ClipJobView | null } = { current: null };
jest.mock('../use-clip-job', () => ({
  useClipJob: (jobId: string | null) => ({
    job: jobId && mockJob.current?.id === jobId ? mockJob.current : null,
    error: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('../timeline/timeline-media', () => ({ usePeaks: () => null }));

const VIDEO_ID = '3f2a9c1e-0000-4000-8000-000000000001';

function makeDoc(): ClipDocument {
  const doc = createClipDocument({
    videoId: VIDEO_ID,
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '16:9',
  });
  return { ...doc, meta: { shapeChosen: true } };
}

function viewOf(id: string): RecipeView {
  const starter = STARTER_RECIPES.find((recipe) => recipe.id === id);
  if (!starter) throw new Error(id);
  return {
    id: starter.id,
    name: starter.name,
    description: starter.help,
    settings: starter.settings,
    builtIn: true,
    brandKitId: null,
    createdById: null,
    createdByName: null,
    createdAt: null,
    updatedAt: null,
  };
}

function answer(
  recipe: RecipeView,
  needs: Partial<ApplyRecipeAnswer['needs']> = {},
  missing: ApplyRecipeAnswer['missing'] = [],
): ApplyRecipeAnswer {
  return {
    recipe,
    brandKit: null,
    needs: { transcript: 'none', listenPrice: 0, faces: 'none', ...needs },
    missing,
  };
}

function transcriptOf(doc: ClipDocument): TranscriptView {
  const sourceIn = doc.segments[0]?.sourceIn ?? 0;
  return {
    id: '9c1e3f2a-0000-4000-8000-000000000001',
    language: 'en',
    model: 'test',
    source: 'listened',
    words: [
      { i: 0, text: 'Hello', start: sourceIn + 500, end: sourceIn + 900, sure: 1 },
      { i: 1, text: 'there', start: sourceIn + 1_000, end: sourceIn + 1_400, sure: 1 },
    ],
    covered: [{ fromMs: 0, toMs: 120_000 }],
    fixes: 0,
    fileName: null,
  } as TranscriptView;
}

function fakeDeps(over: Partial<EditorRecipesDeps> = {}): jest.Mocked<EditorRecipesDeps> {
  return {
    applyToClip: jest.fn(),
    words: jest.fn(async () => null),
    styles: jest.fn(async () => []),
    layouts: jest.fn(async () => []),
    wordList: jest.fn(async () => []),
    hookTitles: jest.fn(async () => ['A title']),
    listen: jest.fn(),
    notify: jest.fn(),
    ...over,
  } as jest.Mocked<EditorRecipesDeps>;
}

function setup(deps: EditorRecipesDeps, onFollow = jest.fn()) {
  const doc = makeDoc();
  const hook = renderHook(() => {
    const [state, dispatch] = useReducer(editorReducer, undefined, () =>
      createEditorState({ document: doc, title: 'Clip' }),
    );
    const latest = useRef(state);
    latest.current = state;
    const recipes = useEditorRecipes({
      clipId: 'clip-1',
      videoId: 'video-1',
      videoDurationMs: 120_000,
      videoSize: { width: 1920, height: 1080 },
      waveform: null,
      styles: [],
      latestDocument: () => editorDocument(latest.current),
      commit: (start, next) =>
        dispatch({ type: 'apply', change: (d) => (d === start ? next : d), now: Date.now() }),
      onUndo: () => dispatch({ type: 'undo' }),
      onFollow,
      deps,
    });
    return { state, dispatch, recipes };
  });
  return { hook, doc, onFollow };
}

beforeEach(() => {
  mockJob.current = null;
});

describe('Apply A Recipe in the editor', () => {
  it('is one undo step, says it applied, then runs Follow The Speaker', async () => {
    const reframe = viewOf('starter-reframe');
    const deps = fakeDeps();
    deps.applyToClip.mockResolvedValue(answer(reframe, { faces: 'started' }));
    const { hook, doc, onFollow } = setup(deps);

    let result: string | null = 'unset';
    await act(async () => {
      result = await hook.result.current.recipes.apply(reframe);
    });
    expect(result).toBeNull();
    const applied = editorDocument(hook.result.current.state);
    expect(applied.canvas.ratio).toBe('9:16');
    expect(applied.recipeId).toBe('starter-reframe');
    expect(onFollow).toHaveBeenCalledWith('speaker');
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Reframe applied.', action: expect.anything() }),
    );

    act(() => hook.result.current.dispatch({ type: 'undo' }));
    expect(editorDocument(hook.result.current.state)).toEqual(doc);
    expect(editorCanUndo(hook.result.current.state)).toBe(false);
  });

  it('says what was used for a part that is gone', async () => {
    const captions = viewOf('starter-captions-only');
    const deps = fakeDeps();
    deps.applyToClip.mockResolvedValue(
      answer(captions, { transcript: 'covered' }, [
        { part: 'captionStyle', id: 'gone-style', usedInstead: 'clean' },
      ]),
    );
    const { hook, doc } = setup(deps);
    deps.words.mockResolvedValue(transcriptOf(doc));
    await act(async () => {
      await hook.result.current.recipes.apply(captions);
    });
    expect(deps.notify).toHaveBeenCalledWith({
      title: "This recipe's caption style was deleted. We used Clean instead.",
      variant: 'warning',
    });
  });

  it('offers listening with its price, then applies the word parts as a second step', async () => {
    const captions = viewOf('starter-captions-only');
    const deps = fakeDeps();
    deps.applyToClip.mockResolvedValue(answer(captions, { transcript: 'missing', listenPrice: 2 }));
    const { hook, doc } = setup(deps);
    await act(async () => {
      await hook.result.current.recipes.apply(captions);
    });
    // The words were not fetched: nothing was listened to.
    expect(deps.words).not.toHaveBeenCalled();
    const listenToast = deps.notify.mock.calls
      .map(([input]) => input)
      .find((input) => input.title === LISTEN_FOR_RECIPE);
    expect(listenToast?.action?.label).toBe('Listen To This Clip (2 AI Minutes)');
    // The skipped word parts are said by the listen toast, not a second one.
    expect(deps.notify.mock.calls.some(([input]) => input.title.includes('was skipped'))).toBe(
      false,
    );
    const firstStep = editorDocument(hook.result.current.state);
    expect(firstStep.recipeId).toBe('starter-captions-only');

    deps.listen.mockResolvedValue({
      covered: false,
      job: { id: 'job-listen', status: 'RUNNING' } as ClipJobView,
      price: 2,
    } as never);
    deps.words.mockResolvedValue(transcriptOf(doc));
    await act(async () => {
      listenToast?.action?.onClick();
    });
    expect(deps.listen).toHaveBeenCalledWith('video-1', expect.objectContaining({ fromMs: 0 }));
    expect(hook.result.current.recipes.listening).toBe(true);

    mockJob.current = { id: 'job-listen', status: 'DONE' } as ClipJobView;
    await act(async () => {
      hook.rerender();
    });
    await act(async () => undefined);
    const secondStep = editorDocument(hook.result.current.state);
    expect(secondStep.tracks.some((track) => track.kind === 'captions')).toBe(true);
    // Two steps: Undo takes the captions back and leaves the recipe's first step.
    act(() => hook.result.current.dispatch({ type: 'undo' }));
    expect(editorDocument(hook.result.current.state)).toEqual(firstStep);
  });

  it('answers the refusal sentence and changes nothing', async () => {
    const deps = fakeDeps();
    deps.applyToClip.mockRejectedValue(
      new ApiError('This recipe is not here any more.', 404, 'recipe_not_found'),
    );
    const { hook, doc } = setup(deps);
    let result: string | null = null;
    await act(async () => {
      result = await hook.result.current.recipes.apply(viewOf('starter-reframe'));
    });
    expect(result).toBe('This recipe is not here any more.');
    expect(editorDocument(hook.result.current.state)).toEqual(doc);
  });
});
