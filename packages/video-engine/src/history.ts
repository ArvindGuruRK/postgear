/**
 * Undo and redo for the clip editor (Module 08).
 *
 * Copied in shape from Studio's `design-engine/src/history.ts`, not shared
 * with it: the two editors' histories can change apart, and this package must
 * not import another workspace (`purity.test.ts`). The names carry the word
 * "history" because this package's index exports everything flat.
 *
 * A plain stack of whole entries, not a diff log. A clip document is a few
 * kilobytes of JSON and eighty of them is nothing next to one video frame, so
 * the simplest correct thing wins: every entry is complete, undo is an index
 * move, and no replayed patch can leave the editor in a state the schema
 * would refuse.
 *
 * - **A drag is one step, not one per frame.** `pushHistory` with the same
 *   `coalesceKey` inside `COALESCE_MS` replaces the top entry instead of
 *   stacking, so Undo after dragging a trim handle puts the handle back where
 *   the drag started.
 * - **A new change after an undo drops the redo tail**, as every editor does.
 * - **An edit that changed nothing is not a step**: the engine's edits hand
 *   back the same object when nothing changed, and that is caught here.
 */
export interface HistoryState<T> {
  entries: T[];
  index: number;
  /** What produced the top entry, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

/** CL-5.4 asks for at least 50 steps. */
export const HISTORY_LIMIT = 80;

/** Edits of the same kind closer together than this become one step. */
export const COALESCE_MS = 700;

export interface HistoryPushOptions {
  /**
   * Edits sharing a key and arriving within `COALESCE_MS` collapse into one
   * step: a trim drag passes `trim:<segmentId>`, a slider its own name. A
   * one-off change (a split, a shape) passes nothing and always stacks.
   */
  coalesceKey?: string;
  now?: number;
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { entries: [initial], index: 0, lastKey: null, lastAt: 0 };
}

export function currentEntry<T>(history: HistoryState<T>): T {
  return history.entries[history.index] as T;
}

export function pushHistory<T>(
  history: HistoryState<T>,
  next: T,
  options: HistoryPushOptions = {},
): HistoryState<T> {
  if (next === currentEntry(history)) return history;

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

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canUndo(history)) return history;
  // The key is cleared so the next edit cannot coalesce onto an entry the
  // user has just stepped back through.
  return { ...history, index: history.index - 1, lastKey: null };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canRedo(history)) return history;
  return { ...history, index: history.index + 1, lastKey: null };
}

/**
 * Swaps the entry the history stands on for `next`, without a step: for a
 * fact that belongs to every version alike (the editor's `meta`), carried
 * onto the entry an undo or redo lands on.
 */
export function replaceCurrentEntry<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  if (next === currentEntry(history)) return history;
  const entries = history.entries.slice();
  entries[history.index] = next;
  return { ...history, entries };
}
