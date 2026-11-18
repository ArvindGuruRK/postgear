import {
  type ClipDocument,
  CANVASES,
  createClipDocument,
  HISTORY_LIMIT,
  splitAt,
} from '@postgear/video-engine';
import {
  chooseShape,
  cleanClipName,
  createEditorState,
  documentProblem,
  EDITOR_TABS,
  type EditorAction,
  type EditorState,
  editorCanRedo,
  editorCanUndo,
  editorDocument,
  editorDuration,
  editorReducer,
  editorTitle,
  MAX_CLIP_NAME,
  needsShape,
  selectionExists,
  stepTab,
} from './editor-state';

const VIDEO_SIZE = { width: 1280, height: 720 };

function makeDoc(): ClipDocument {
  return createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '9:16',
    sourceAspect: 16 / 9,
  });
}

function start(doc = makeDoc()): EditorState {
  return createEditorState({ document: doc, title: 'First Clip' });
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

/** A change that moves the first part's start, as a trim drag would. */
function moveStart(by: number) {
  return (doc: ClipDocument): ClipDocument => ({
    ...doc,
    segments: doc.segments.map((segment, i) =>
      i === 0 ? { ...segment, sourceIn: segment.sourceIn + by } : segment,
    ),
  });
}

describe('editor store', () => {
  it('applies a change and makes it one undo step', () => {
    const state = run(start(), { type: 'apply', change: moveStart(1000), now: 1 });
    expect(editorDocument(state).segments[0].sourceIn).toBe(11_000);
    expect(editorCanUndo(state)).toBe(true);

    const undone = run(state, { type: 'undo' });
    expect(editorDocument(undone).segments[0].sourceIn).toBe(10_000);
    expect(editorCanRedo(undone)).toBe(true);
    expect(editorDocument(run(undone, { type: 'redo' })).segments[0].sourceIn).toBe(11_000);
  });

  it('drops a change that would make an invalid document, and says why', () => {
    const before = start();
    // A 30 second clip cut to 2 seconds is under the 3 second minimum.
    const state = run(before, { type: 'apply', change: moveStart(28_000), now: 1 });
    expect(editorDocument(state)).toBe(editorDocument(before));
    expect(editorCanUndo(state)).toBe(false);
    expect(state.rejected).toMatch(/3 seconds/);
  });

  it('drops a change that throws, and keeps the document', () => {
    const before = start();
    const state = run(before, {
      type: 'apply',
      change: () => {
        throw new Error('boom');
      },
      now: 1,
    });
    expect(editorDocument(state)).toBe(editorDocument(before));
    expect(state.rejected).toBe('boom');
  });

  it('is not a step when the change changed nothing', () => {
    const before = start();
    const state = run(before, { type: 'apply', change: (doc) => doc, now: 1 });
    expect(state).toBe(before);
  });

  it('turns a drag (one key, quick moves) into one step', () => {
    const state = run(
      start(),
      { type: 'apply', change: moveStart(100), coalesceKey: 'trim:a', now: 1_000 },
      { type: 'apply', change: moveStart(100), coalesceKey: 'trim:a', now: 1_016 },
      { type: 'apply', change: moveStart(100), coalesceKey: 'trim:a', now: 1_032 },
    );
    expect(editorDocument(state).segments[0].sourceIn).toBe(10_300);
    const undone = run(state, { type: 'undo' });
    expect(editorDocument(undone).segments[0].sourceIn).toBe(10_000);
    expect(editorCanUndo(undone)).toBe(false);
  });

  it('keeps the selection and the tab out of history', () => {
    const doc = makeDoc();
    const segmentId = doc.segments[0].id;
    let state = run(
      start(doc),
      { type: 'apply', change: moveStart(1000), now: 1 },
      { type: 'select', selection: { kind: 'segment', id: segmentId } },
      { type: 'tab', tab: 'text' },
    );
    state = run(state, { type: 'undo' });
    expect(state.selection).toEqual({ kind: 'segment', id: segmentId });
    expect(state.tab).toBe('text');
  });

  it('clears a selection an undo took away', () => {
    const split = splitAt(makeDoc(), 15_000);
    if (!split.ok) throw new Error('split refused');
    const added = split.doc.segments[1].id;
    let state = run(start(), {
      type: 'apply',
      change: () => split.doc,
      select: { kind: 'segment', id: added },
      now: 1,
    });
    expect(state.selection).toEqual({ kind: 'segment', id: added });
    state = run(state, { type: 'undo' });
    expect(state.selection).toBeNull();
  });

  it('refuses to select something that is not there', () => {
    const before = start();
    const state = run(before, { type: 'select', selection: { kind: 'item', id: 'nope' } });
    expect(state).toBe(before);
  });

  it('renames as an undo step, and an empty name keeps the old one', () => {
    let state = run(start(), { type: 'rename', title: '  Best   Moment ', now: 1 });
    expect(editorTitle(state)).toBe('Best Moment');
    expect(editorTitle(run(state, { type: 'undo' }))).toBe('First Clip');
    const same = run(state, { type: 'rename', title: '   ', now: 2 });
    expect(same).toBe(state);
    state = run(state, { type: 'apply', change: moveStart(1000), now: 3 });
    // An edit after a rename keeps the new name.
    expect(editorTitle(state)).toBe('Best Moment');
  });

  it('resets to a new starting point with no history', () => {
    const state = run(
      start(),
      { type: 'apply', change: moveStart(1000), now: 1 },
      { type: 'reset', version: { document: makeDoc(), title: 'From The Server' } },
    );
    expect(editorCanUndo(state)).toBe(false);
    expect(editorTitle(state)).toBe('From The Server');
  });

  it('reports the length in output time', () => {
    expect(editorDuration(start())).toBe(30_000);
  });

  it('keeps more than fifty undo steps', () => {
    let state = start();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      state = run(state, { type: 'rename', title: `Name ${i}`, now: i * 1000 });
    }
    let back = state;
    for (let i = 0; i < 50; i += 1) back = run(back, { type: 'undo' });
    expect(editorCanUndo(back)).toBe(true);
  });
});

describe('the shape question', () => {
  it('is asked until it is answered', () => {
    const doc = makeDoc();
    expect(needsShape(doc)).toBe(true);
    expect(needsShape(chooseShape(doc, '9:16', VIDEO_SIZE))).toBe(false);
  });

  it.each([
    ['9:16', CANVASES['9:16']],
    ['16:9', CANVASES['16:9']],
    ['1:1', CANVASES['1:1']],
  ] as const)('%s sets the canvas, keeps a valid document and is one undo step', (ratio, size) => {
    const before = start();
    const state = run(before, {
      type: 'apply',
      change: (doc) => chooseShape(doc, ratio, VIDEO_SIZE),
      now: 1,
    });
    const doc = editorDocument(state);
    expect(doc.canvas).toMatchObject({ ratio, width: size.width, height: size.height });
    expect(documentProblem(doc)).toBeNull();
    expect(needsShape(doc)).toBe(false);

    const undone = run(state, { type: 'undo' });
    expect(editorDocument(undone).canvas.ratio).toBe('9:16');
    expect(editorCanUndo(undone)).toBe(false);
  });

  it('keeps the answer through an undo, so the question is never asked twice', () => {
    const state = run(
      start(),
      { type: 'apply', change: (doc) => chooseShape(doc, '16:9', VIDEO_SIZE), now: 1 },
      { type: 'undo' },
    );
    expect(needsShape(editorDocument(state))).toBe(false);
    // Redo lands on the chosen shape with the answer still kept.
    const redone = run(state, { type: 'redo' });
    expect(editorDocument(redone).canvas.ratio).toBe('16:9');
    expect(needsShape(editorDocument(redone))).toBe(false);
  });
});

describe('helpers', () => {
  it('walks the tabs with Back and Next, stopping at the ends', () => {
    expect(stepTab('layouts', -1)).toBeNull();
    expect(stepTab('layouts', 1)).toBe('elements');
    expect(stepTab('audio', 1)).toBe('export');
    expect(stepTab('export', 1)).toBeNull();
    expect(EDITOR_TABS).toHaveLength(6);
  });

  it('cleans a name and keeps it under the limit', () => {
    expect(cleanClipName('', 'Old')).toBe('Old');
    expect(cleanClipName(' a\n b ', 'Old')).toBe('a b');
    expect(cleanClipName('x'.repeat(MAX_CLIP_NAME + 20), 'Old')).toHaveLength(MAX_CLIP_NAME);
  });

  it('knows whether a selection is still there', () => {
    const doc = makeDoc();
    expect(selectionExists(doc, null)).toBe(true);
    expect(selectionExists(doc, { kind: 'segment', id: doc.segments[0].id })).toBe(true);
    expect(selectionExists(doc, { kind: 'area', id: doc.layout.areas[0].id })).toBe(true);
    expect(selectionExists(doc, { kind: 'zoom', id: 'z' })).toBe(false);
  });
});
