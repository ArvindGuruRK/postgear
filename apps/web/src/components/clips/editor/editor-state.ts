/**
 * The clip editor's store (Module 08 section 2): one reducer over the
 * document, its name, the undo history, the selection and the open tab.
 *
 * Copied in shape from Studio's reducer, not shared with it.
 *
 * - **Every edit goes through `apply`** with a pure `(doc) => doc`. The
 *   result is checked against the engine's schema before it is kept: a change
 *   that would make a document the API refuses is dropped (the reason sits on
 *   `rejected` for the editor to log), so nothing invalid is ever saved.
 * - **History holds the document and the name together** (`EditorVersion`),
 *   so Undo brings an old name back as it brings back an old trim. Drags and
 *   sliders pass a `coalesceKey` and become one step.
 * - **The selection and the open tab are not in history**: Undo never moves
 *   the panel, and a selection that pointed at something an undo took away is
 *   cleared.
 * - **`meta` belongs to every version alike.** It holds editor facts (the
 *   shape question was answered) that must survive an undo, so an undo or
 *   redo carries the current `meta` onto the version it lands on.
 *
 * Pure: no React, no clock (the action carries `now`), so it is tested as
 * plain functions.
 */
import {
  type CanvasSize,
  type ClipDocument,
  type ClipDocumentMeta,
  canRedo,
  canUndo,
  clipDocumentSchema,
  createHistory,
  currentEntry,
  describeIssues,
  type HistoryState,
  outputDuration,
  pushHistory,
  type Ratio,
  redoHistory,
  replaceCurrentEntry,
  setCanvasRatio,
  undoHistory,
} from '@postgear/video-engine';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const EDITOR_TABS = ['layouts', 'elements', 'text', 'effects', 'audio', 'export'] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

export const EDITOR_TAB_NAMES: Readonly<Record<EditorTab, string>> = Object.freeze({
  layouts: 'Layouts',
  elements: 'Elements',
  text: 'Text',
  effects: 'Effects',
  audio: 'Audio',
  export: 'Export',
});

/** One sentence under each panel's name: what the tab is for (2026-11-19). */
export const EDITOR_TAB_LINES: Readonly<Record<EditorTab, string>> = Object.freeze({
  layouts: "Pick the clip's shape and how the video fills it.",
  elements: 'Add stickers, GIFs and a follow badge on top of the clip.',
  text: 'Put words on the clip in one of three styles.',
  effects: 'Zoom in, change the speed, the colour and the fades.',
  audio: "Set the video's volume and add music or sound effects.",
  export: 'Choose the quality, then make the video file.',
});

export const DEFAULT_EDITOR_TAB: EditorTab = 'layouts';

/** The tab before or after `tab` (Back and Next at the panel's foot), or null at either end. */
export function stepTab(tab: EditorTab, by: -1 | 1): EditorTab | null {
  const at = EDITOR_TABS.indexOf(tab) + by;
  return at >= 0 && at < EDITOR_TABS.length ? EDITOR_TABS[at] : null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** What the editor can hold selected. One thing at a time in Sprint 12. */
export type EditorSelection = {
  kind: 'segment' | 'item' | 'zoom' | 'area';
  id: string;
} | null;

/** One step of history: the document and the clip's name. */
export interface EditorVersion {
  document: ClipDocument;
  title: string;
}

export interface EditorState {
  history: HistoryState<EditorVersion>;
  selection: EditorSelection;
  tab: EditorTab;
  /** Why the last change was dropped (the schema's words), for the editor to log; null otherwise. */
  rejected: string | null;
}

export type EditorAction =
  | {
      type: 'apply';
      change: (doc: ClipDocument) => ClipDocument;
      coalesceKey?: string;
      /** Selects this after the change (undefined keeps the selection). */
      select?: EditorSelection;
      now: number;
    }
  | { type: 'rename'; title: string; now: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; selection: EditorSelection }
  | { type: 'tab'; tab: EditorTab }
  /** A new starting point (a conflict's Reload): the history starts again from it. */
  | { type: 'reset'; version: EditorVersion };

export function createEditorState(
  version: EditorVersion,
  tab: EditorTab = DEFAULT_EDITOR_TAB,
): EditorState {
  return { history: createHistory(version), selection: null, tab, rejected: null };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function editorVersion(state: EditorState): EditorVersion {
  return currentEntry(state.history);
}

export function editorDocument(state: EditorState): ClipDocument {
  return currentEntry(state.history).document;
}

export function editorTitle(state: EditorState): string {
  return currentEntry(state.history).title;
}

export function editorCanUndo(state: EditorState): boolean {
  return canUndo(state.history);
}

export function editorCanRedo(state: EditorState): boolean {
  return canRedo(state.history);
}

/** The clip's length in ms (output time). */
export function editorDuration(state: EditorState): number {
  return outputDuration(editorDocument(state));
}

/** Whether what `selection` names is still in `doc`. */
export function selectionExists(doc: ClipDocument, selection: EditorSelection): boolean {
  if (!selection) return true;
  switch (selection.kind) {
    case 'segment':
      return doc.segments.some((segment) => segment.id === selection.id);
    case 'zoom':
      return doc.zooms.some((zoom) => zoom.id === selection.id);
    case 'area':
      return doc.layout.areas.some((area) => area.id === selection.id);
    case 'item':
      return doc.tracks.some(
        (track) =>
          track.kind !== 'captions' && track.items.some((item) => item.id === selection.id),
      );
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** The schema's verdict on a document: null when it is valid, else the reason in words. */
export function documentProblem(doc: ClipDocument): string | null {
  const parsed = clipDocumentSchema.safeParse(doc);
  return parsed.success ? null : describeIssues(parsed.error).join('; ');
}

/** Max length of a clip's name (the API's limit). */
export const MAX_CLIP_NAME = 200;

/**
 * A name as typed, made ready to keep: spaces trimmed and runs of white space
 * made one, cut to the limit; an empty name keeps the previous one.
 */
export function cleanClipName(draft: string, previous: string): string {
  const cleaned = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_CLIP_NAME).trim();
  return cleaned === '' ? previous : cleaned;
}

// ---------------------------------------------------------------------------
// The shape question (section 7)
// ---------------------------------------------------------------------------

/** The shapes the first-open dialog offers; 4:5 joins them in Layouts (Module 10). */
export const FIRST_SHAPES = ['9:16', '16:9', '1:1'] as const satisfies readonly Ratio[];
export type FirstShape = (typeof FIRST_SHAPES)[number];

/** Whether the first-open "What Do You Want To Make?" question is still to be asked. */
export function needsShape(doc: ClipDocument): boolean {
  return doc.meta?.shapeChosen !== true;
}

function withMeta(doc: ClipDocument, meta: ClipDocumentMeta | undefined): ClipDocument {
  if (doc.meta === meta) return doc;
  if (meta === undefined) {
    const { meta: _dropped, ...rest } = doc;
    return rest;
  }
  return { ...doc, meta };
}

/**
 * The answer to the shape question: the canvas takes the shape and the layout
 * is re-fitted to it (`setCanvasRatio`), and the question is marked answered,
 * even when the answer kept the shape. One change, so one undo step.
 */
export function chooseShape(doc: ClipDocument, ratio: Ratio, videoSize: CanvasSize): ClipDocument {
  const reshaped = setCanvasRatio(doc, ratio, videoSize);
  return withMeta(reshaped, { ...reshaped.meta, shapeChosen: true });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Lands an undo or redo: the current `meta` comes along, and a vanished selection is cleared. */
function land(state: EditorState, history: HistoryState<EditorVersion>): EditorState {
  if (history === state.history) return state;

  const meta = editorDocument(state).meta;
  const target = currentEntry(history);
  const carried = withMeta(target.document, meta);
  const landed =
    carried === target.document
      ? history
      : replaceCurrentEntry(history, { ...target, document: carried });

  const selection = selectionExists(carried, state.selection) ? state.selection : null;
  return { ...state, history: landed, selection, rejected: null };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'apply': {
      const version = editorVersion(state);
      let next: ClipDocument;
      try {
        next = action.change(version.document);
      } catch (cause) {
        return {
          ...state,
          rejected: cause instanceof Error ? cause.message : 'The change could not be made',
        };
      }
      if (next === version.document) {
        // Nothing changed; a selection the change asked for still applies.
        if (action.select === undefined || action.select === state.selection) return state;
        return { ...state, selection: action.select };
      }

      const problem = documentProblem(next);
      if (problem) return { ...state, rejected: problem };

      const history = pushHistory(
        state.history,
        { document: next, title: version.title },
        { coalesceKey: action.coalesceKey, now: action.now },
      );
      const wanted = action.select === undefined ? state.selection : action.select;
      const selection = selectionExists(next, wanted) ? wanted : null;
      return { ...state, history, selection, rejected: null };
    }

    case 'rename': {
      const version = editorVersion(state);
      const title = cleanClipName(action.title, version.title);
      if (title === version.title) return state;
      const history = pushHistory(
        state.history,
        { document: version.document, title },
        { now: action.now },
      );
      return { ...state, history, rejected: null };
    }

    case 'undo':
      return land(state, undoHistory(state.history));

    case 'redo':
      return land(state, redoHistory(state.history));

    case 'select':
      if (action.selection === state.selection) return state;
      if (!selectionExists(editorDocument(state), action.selection)) return state;
      return { ...state, selection: action.selection };

    case 'tab':
      return action.tab === state.tab ? state : { ...state, tab: action.tab };

    case 'reset':
      return { ...state, history: createHistory(action.version), selection: null, rejected: null };
  }
}
