/**
 * Undo and redo for the editor.
 *
 * A plain stack of whole documents, not a diff log. A design document is a few
 * kilobytes of JSON and fifty of them is a rounding error next to one slide's
 * picture, so the simplest correct thing wins: every entry is a complete
 * document, undo is an index move, and there is no way for a replayed patch to
 * leave the editor in a state the schema would refuse.
 *
 * Two behaviours matter and both are here rather than in the component:
 *
 * - **Typing is one step, not one per keystroke.** `push` with the same
 *   `coalesceKey` inside `COALESCE_MS` replaces the top entry instead of
 *   stacking, so Undo after typing a headline removes the headline, not its
 *   last letter.
 * - **A new change after an undo drops the redo tail**, which is what every
 *   editor does and what a user expects: the future they undid away is gone
 *   once they take a different path.
 */
export interface HistoryState<T> {
  entries: T[];
  index: number;
  /** What produced the top entry, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

/** DS-4.8 asks for at least 50 steps. */
export const HISTORY_LIMIT = 80;

/** Edits of the same kind closer together than this become one step. */
export const COALESCE_MS = 700;

export function createHistory<T>(initial: T): HistoryState<T> {
  return { entries: [initial], index: 0, lastKey: null, lastAt: 0 };
}

export interface PushOptions {
  /**
   * Edits sharing a key and arriving within `COALESCE_MS` collapse into one
   * step. Typing into one slot passes `text:slide-3:headline`; a structural
   * change (add a slide, swap the theme) passes nothing and always stacks.
   */
  coalesceKey?: string;
  now?: number;
}

export function push<T>(
  history: HistoryState<T>,
  next: T,
  options: PushOptions = {},
): HistoryState<T> {
  // The document operations hand back the same object when nothing changed
  // (clicking the alignment a slot already has), and that is not a step.
  if (next === current(history)) return history;

  const now = options.now ?? Date.now();
  const key = options.coalesceKey ?? null;

  const coalesces = key !== null && key === history.lastKey && now - history.lastAt < COALESCE_MS;

  // Anything the user undid past is dropped the moment they do something else.
  const kept = history.entries.slice(0, history.index + 1);

  if (coalesces) {
    kept[kept.length - 1] = next;
    return { entries: kept, index: kept.length - 1, lastKey: key, lastAt: now };
  }

  kept.push(next);
  const trimmed = kept.length > HISTORY_LIMIT ? kept.slice(kept.length - HISTORY_LIMIT) : kept;

  return { entries: trimmed, index: trimmed.length - 1, lastKey: key, lastAt: now };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.index > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.index < history.entries.length - 1;
}

export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canUndo(history)) return history;

  // The key is cleared so the next edit cannot coalesce onto an entry the
  // user has just stepped back through.
  return { ...history, index: history.index - 1, lastKey: null };
}

export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canRedo(history)) return history;

  return { ...history, index: history.index + 1, lastKey: null };
}

export function current<T>(history: HistoryState<T>): T {
  return history.entries[history.index];
}

/**
 * Replaces the whole history with one entry.
 *
 * Used when the editor loads a design, and after a conflict reload: the
 * previous document is a different design's worth of state and undoing into
 * it would write a stale document back to the server.
 */
export function reset<T>(initial: T): HistoryState<T> {
  return createHistory(initial);
}
