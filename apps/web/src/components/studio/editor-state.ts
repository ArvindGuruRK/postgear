/**
 * The editor's state (Sprint 9, DS-4 and DS-5): the design with its undo
 * history, the slide on the canvas, the element selected on it and the one
 * being typed into.
 *
 * A reducer, so every edit, from a keystroke on the canvas to Reset Design,
 * goes through one door and lands in the history the same way; and pure, so
 * it is tested without a browser. The edits themselves are the design
 * engine's document operations, passed in as functions of the current
 * document, so a burst of keystrokes can never apply one to a stale copy.
 *
 * Two behaviours worth knowing:
 *
 * - **A change that changes nothing is not a step.** The engine's element
 *   operations always hand back a new slide, even when the patch matches what
 *   is there (committing a headline nobody edited). Such a change is dropped
 *   here, so it neither fills the history nor triggers a save, which would
 *   mark the design's export as out of date for nothing.
 * - **Undo shows where it happened.** Undoing an edit on slide 3 while slide
 *   1 is on the canvas brings slide 3 back into view, the way Canva and Figma
 *   do, rather than changing something the person cannot see.
 */
import {
  type ClampReport,
  canRedo,
  canUndo,
  clampWithReport,
  createHistory,
  current,
  type DesignDocument,
  type DesignIssue,
  type DesignSlide,
  findDesignIssues,
  findLayout,
  findSlot,
  type HistoryState,
  issueMessage,
  isTypeable,
  MAX_SLIDES,
  NO_OFFSET,
  type Offset,
  push,
  redo,
  type SlotId,
  setBrandName,
  setHandle,
  slotPlacement,
  undo,
  updateElement,
} from '@postgear/design-engine';

export interface EditorState {
  history: HistoryState<DesignDocument>;
  /** The slide on the canvas, by id, so reordering slides keeps it in view. */
  slideId: string;
  /** The element selected on that slide. */
  selected: SlotId | null;
  /** The element being typed into on the canvas; always the selected one. */
  editing: SlotId | null;
}

export interface ChangeOptions {
  /** Edits sharing a key a moment apart are one undo step: typing, nudging. */
  coalesceKey?: string;
  /** The slide to show afterwards, such as one just added. */
  showSlide?: string;
  /** The element to select afterwards; null clears the selection. */
  select?: SlotId | null;
}

/** How the canvas, the rail and the panel hand an edit to the editor. */
export type ApplyChange = (
  change: (document: DesignDocument) => DesignDocument,
  options?: ChangeOptions,
) => void;

export type EditorAction =
  | ({ type: 'change'; change: (document: DesignDocument) => DesignDocument } & ChangeOptions)
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'showSlide'; slideId: string }
  | { type: 'select'; slot: SlotId | null }
  | { type: 'edit'; slot: SlotId | null }
  /** A fresh start from the server: a reload after a conflict. Not undoable. */
  | { type: 'load'; document: DesignDocument };

export function createEditorState(document: DesignDocument, slideIndex = 0): EditorState {
  const index = Math.min(Math.max(slideIndex, 0), document.slides.length - 1);

  return {
    history: createHistory(document),
    slideId: document.slides[index]?.id ?? document.slides[0]?.id ?? '',
    selected: null,
    editing: null,
  };
}

export function documentOf(state: EditorState): DesignDocument {
  return current(state.history);
}

/** The zero-based position of the slide on the canvas. */
export function slideIndexOf(state: EditorState): number {
  return Math.max(
    0,
    documentOf(state).slides.findIndex((slide) => slide.id === state.slideId),
  );
}

export function canUndoEdit(state: EditorState): boolean {
  return canUndo(state.history);
}

export function canRedoEdit(state: EditorState): boolean {
  return canRedo(state.history);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'change': {
      const before = documentOf(state);
      const after = action.change(before);
      if (sameDocument(before, after)) return state;

      const history = push(state.history, after, { coalesceKey: action.coalesceKey });
      const slideId =
        action.showSlide && hasSlide(after, action.showSlide)
          ? action.showSlide
          : followSlide(before, after, state.slideId);
      const moved = slideId !== state.slideId;

      return tidy(after, {
        history,
        slideId,
        selected: action.select !== undefined ? action.select : moved ? null : state.selected,
        editing: moved || action.select !== undefined ? null : state.editing,
      });
    }

    case 'undo':
    case 'redo': {
      const history = action.type === 'undo' ? undo(state.history) : redo(state.history);
      if (history === state.history) return state;

      const before = documentOf(state);
      const after = current(history);
      const slideId = changedSlide(before, after, state.slideId);

      return tidy(after, {
        history,
        slideId,
        selected: slideId === state.slideId ? state.selected : null,
        editing: null,
      });
    }

    case 'showSlide': {
      if (action.slideId === state.slideId || !hasSlide(documentOf(state), action.slideId)) {
        return state;
      }
      return { ...state, slideId: action.slideId, selected: null, editing: null };
    }

    case 'select': {
      return tidy(documentOf(state), {
        ...state,
        selected: action.slot,
        editing: state.editing === action.slot ? state.editing : null,
      });
    }

    case 'edit': {
      return tidy(documentOf(state), {
        ...state,
        selected: action.slot ?? state.selected,
        editing: action.slot,
      });
    }

    case 'load': {
      const slideId = hasSlide(action.document, state.slideId)
        ? state.slideId
        : (action.document.slides[0]?.id ?? '');
      return { history: createHistory(action.document), slideId, selected: null, editing: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Edits the canvas and the panel share
// ---------------------------------------------------------------------------

/**
 * Typing into a text slot, on the canvas or in the panel. A brand name or a
 * handle is the design's, the same on every slide; a slide number is
 * counted, never typed.
 */
export function withText(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  text: string,
): DesignDocument {
  const found = slotOf(document, slideId, slotId);
  if (!found) return document;

  const { slide, slot } = found;
  if (slot.bind === 'brandName') return setBrandName(document, text);
  if (slot.bind === 'handle') return setHandle(document, text);
  if (!isTypeable(slot) || slot.bind) return document;
  if ((slide.elements[slotId]?.text ?? '') === text) return document;

  return updateElement(document, slideId, slotId, { text });
}

/**
 * Puts a deleted slide back where it was: the Undo on the "Slide deleted"
 * toast. Unlike the editor's Undo it restores that slide only, whatever was
 * changed since; it does nothing if the slide is already back or the design
 * has filled up to its limit meanwhile.
 */
export function restoreSlide(
  document: DesignDocument,
  slide: DesignSlide,
  index: number,
): DesignDocument {
  if (document.slides.length >= MAX_SLIDES) return document;
  if (document.slides.some((entry) => entry.id === slide.id)) return document;

  const slides = [...document.slides];
  slides.splice(Math.min(Math.max(index, 0), slides.length), 0, slide);
  return { ...document, slides };
}

/** What a nudge did: the design after it, and the edge it stopped at, if any. */
export interface NudgeResult {
  document: DesignDocument;
  edge: ClampReport['edge'];
}

/**
 * Moves an element inside its area by a step of its area's size (DS-4.3):
 * arrow keys move 1%, Shift with them 5%. It stops at the area's edge, and
 * says which edge, so the canvas can flash it.
 */
export function nudge(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  delta: Offset,
): NudgeResult {
  const found = slotOf(document, slideId, slotId);
  if (!found) return { document, edge: { x: null, y: null } };

  const { slide, slot } = found;
  const state = slide.elements[slotId];
  const start = state?.offset ?? NO_OFFSET;
  const report = clampWithReport(slotPlacement(slot, state).box, {
    x: start.x + delta.x,
    y: start.y + delta.y,
  });

  return {
    document: withOffset(document, slideId, slotId, report.offset),
    edge: report.edge,
  };
}

/**
 * Stores a position. No nudge at all is stored as none, so a slot dragged
 * back to where it started reads as untouched, and Reset Position has
 * nothing to offer.
 */
export function withOffset(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  offset: Offset,
): DesignDocument {
  const found = slotOf(document, slideId, slotId);
  if (!found) return document;

  const previous = found.slide.elements[slotId]?.offset ?? NO_OFFSET;
  const zero = Math.abs(offset.x) < 0.01 && Math.abs(offset.y) < 0.01;
  if (zero && previous === NO_OFFSET) return document;
  if (!zero && near(previous.x, offset.x) && near(previous.y, offset.y)) return document;

  return updateElement(document, slideId, slotId, {
    offset: zero ? undefined : { x: round(offset.x), y: round(offset.y) },
  });
}

/**
 * Every problem worth a mark on the slide rail, keyed by slide id, in the
 * sentences the export dialog uses. Text that is too long can only be seen
 * by drawing it, so each slide's drawing reports its own (`overflow`).
 */
export function issuesBySlide(
  document: DesignDocument,
  mediaExists: (mediaId: string) => boolean,
  overflow: Readonly<Record<string, readonly SlotId[]>>,
): Map<string, string[]> {
  const issues: DesignIssue[] = findDesignIssues(document, mediaExists);

  document.slides.forEach((slide, slideIndex) => {
    for (const slot of overflow[slide.id] ?? []) {
      issues.push({ kind: 'overflow', slideIndex, slot });
    }
  });

  const bySlide = new Map<string, string[]>();
  for (const issue of issues) {
    const id = document.slides[issue.slideIndex]?.id;
    if (!id) continue;
    bySlide.set(id, [...(bySlide.get(id) ?? []), issueMessage(document, issue)]);
  }

  return bySlide;
}

/**
 * The slide an undo or redo should bring into view: a slide that came back
 * or appeared; the neighbour of one that went away; the slide on the canvas
 * when it changed too, or for a reorder or a change to the whole design;
 * otherwise the first slide that changed.
 */
export function changedSlide(
  before: DesignDocument,
  after: DesignDocument,
  active: string,
): string {
  const known = new Set(before.slides.map((slide) => slide.id));
  const appeared = after.slides.find((slide) => !known.has(slide.id));
  if (appeared) return appeared.id;

  if (!hasSlide(after, active)) return followSlide(before, after, active);

  const sameOrder =
    before.slides.length === after.slides.length &&
    before.slides.every((slide, index) => slide.id === after.slides[index]?.id);
  if (!sameOrder) return active;

  const changed = after.slides.filter((slide, index) => slideChanged(before.slides[index], slide));
  if (changed.length === 0 || changed.some((slide) => slide.id === active)) return active;

  return changed[0]?.id ?? active;
}

/**
 * The element that takes focus after Delete hides `hidden` on the canvas:
 * the next one still `shown`, in the layout's order, or the one before it
 * when none comes after; null when no other element is shown.
 */
export function slotAfterHiding(
  slots: readonly SlotId[],
  shown: (slot: SlotId) => boolean,
  hidden: SlotId,
): SlotId | null {
  const index = slots.indexOf(hidden);
  if (index === -1) return slots.find(shown) ?? null;

  const after = slots.slice(index + 1).find(shown);
  if (after !== undefined) return after;
  return slots.slice(0, index).reverse().find(shown) ?? null;
}

// ---------------------------------------------------------------------------

function hasSlide(document: DesignDocument, id: string): boolean {
  return document.slides.some((slide) => slide.id === id);
}

/** After a change, the slide on the canvas stays; a deleted one hands over to its neighbour. */
function followSlide(before: DesignDocument, after: DesignDocument, active: string): string {
  if (hasSlide(after, active)) return active;

  const index = before.slides.findIndex((slide) => slide.id === active);
  const next = after.slides[Math.min(Math.max(index, 0), after.slides.length - 1)];
  return next?.id ?? after.slides[0]?.id ?? '';
}

function slotOf(document: DesignDocument, slideId: string, slotId: SlotId) {
  const slide = document.slides.find((entry) => entry.id === slideId);
  const layout = slide ? findLayout(slide.layoutId) : null;
  const slot = layout ? findSlot(layout, slotId) : null;
  return slide && slot ? { slide, slot } : null;
}

/**
 * Keeps the selection honest: an element that is not on the slide (another
 * layout, or hidden) cannot stay selected, and only a typeable one that is
 * selected can be typed into.
 */
function tidy(document: DesignDocument, state: EditorState): EditorState {
  const slide = document.slides.find((entry) => entry.id === state.slideId);
  const layout = slide ? findLayout(slide.layoutId) : null;

  const shown = (slotId: SlotId | null) => {
    if (!slotId || !slide || !layout) return null;
    const slot = findSlot(layout, slotId);
    return slot && !slide.elements[slotId]?.hidden ? slot : null;
  };

  const selectedSlot = shown(state.selected);
  const selected = selectedSlot?.id ?? null;
  const editing =
    state.editing !== null && state.editing === selected && selectedSlot && isTypeable(selectedSlot)
      ? selected
      : null;

  return selected === state.selected && editing === state.editing
    ? state
    : { ...state, selected, editing };
}

/**
 * Whether two versions of a design say the same thing, however they were
 * built. Slides the change did not touch are the same objects, so only the
 * ones it did are compared in full.
 */
export function sameDocument(a: DesignDocument, b: DesignDocument): boolean {
  if (a === b) return true;
  if (a.slides.length !== b.slides.length) return false;

  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (key === 'slides' || left[key] === right[key]) continue;
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  }

  return a.slides.every((slide, index) => !slideChanged(slide, b.slides[index]));
}

function slideChanged(a: DesignSlide | undefined, b: DesignSlide | undefined): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

/** Two decimals of a percent is finer than a pixel at any export size. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
