import {
  COALESCE_MS,
  canRedo,
  canUndo,
  createHistory,
  currentEntry,
  HISTORY_LIMIT,
  pushHistory,
  redoHistory,
  replaceCurrentEntry,
  undoHistory,
} from './history';

describe('history', () => {
  it('starts with one entry and nothing to undo', () => {
    const history = createHistory('a');
    expect(currentEntry(history)).toBe('a');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('walks back and forward', () => {
    let history = pushHistory(pushHistory(createHistory('a'), 'b'), 'c');
    history = undoHistory(history);
    expect(currentEntry(history)).toBe('b');
    history = undoHistory(history);
    expect(currentEntry(history)).toBe('a');
    expect(canUndo(history)).toBe(false);
    history = redoHistory(history);
    expect(currentEntry(history)).toBe('b');
  });

  it('collapses a drag into one step', () => {
    let history = createHistory(0);
    history = pushHistory(history, 10, { coalesceKey: 'trim:s1', now: 1_000 });
    history = pushHistory(history, 20, { coalesceKey: 'trim:s1', now: 1_016 });
    history = pushHistory(history, 30, { coalesceKey: 'trim:s1', now: 1_032 });
    expect(currentEntry(history)).toBe(30);
    expect(currentEntry(undoHistory(history))).toBe(0);
  });

  it('starts a new step after a pause', () => {
    let history = createHistory(0);
    history = pushHistory(history, 1, { coalesceKey: 'k', now: 1_000 });
    history = pushHistory(history, 2, { coalesceKey: 'k', now: 1_000 + COALESCE_MS + 1 });
    expect(currentEntry(undoHistory(history))).toBe(1);
  });

  it('never collapses two different keys', () => {
    let history = createHistory(0);
    history = pushHistory(history, 1, { coalesceKey: 'a', now: 1_000 });
    history = pushHistory(history, 2, { coalesceKey: 'b', now: 1_010 });
    expect(currentEntry(undoHistory(history))).toBe(1);
  });

  it('drops the redo tail once a different change is made', () => {
    let history = pushHistory(pushHistory(createHistory('a'), 'b'), 'c');
    history = pushHistory(undoHistory(history), 'd');
    expect(canRedo(history)).toBe(false);
    expect(currentEntry(history)).toBe('d');
  });

  it('never coalesces onto an entry stepped back through', () => {
    let history = createHistory(0);
    history = pushHistory(history, 1, { coalesceKey: 'k', now: 1_000 });
    history = pushHistory(history, 2, { coalesceKey: 'k', now: 1_010 });
    history = undoHistory(history);
    history = pushHistory(history, 3, { coalesceKey: 'k', now: 1_020 });
    expect(currentEntry(undoHistory(history))).toBe(0);
  });

  it('keeps more than fifty steps and trims above its limit', () => {
    let history = createHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 20; step++) history = pushHistory(history, step);
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(currentEntry(history)).toBe(HISTORY_LIMIT + 20);
    let back = history;
    for (let step = 0; step < 50; step++) back = undoHistory(back);
    expect(canUndo(back)).toBe(true);
  });

  it('does not stack a change that changed nothing', () => {
    const value = { a: 1 };
    const history = pushHistory(createHistory(value), value);
    expect(history.entries).toHaveLength(1);
  });

  it('does nothing at either end', () => {
    const history = createHistory('a');
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
  });

  it('replaces the entry it stands on without a step', () => {
    const history = undoHistory(pushHistory(createHistory('a'), 'b'));
    const replaced = replaceCurrentEntry(history, 'A');
    expect(currentEntry(replaced)).toBe('A');
    expect(replaced.entries).toEqual(['A', 'b']);
    expect(replaced.index).toBe(0);
    expect(replaceCurrentEntry(replaced, 'A')).toBe(replaced);
  });
});
