import {
  canRedo,
  canUndo,
  COALESCE_MS,
  createHistory,
  current,
  HISTORY_LIMIT,
  push,
  redo,
  undo,
} from './history';

describe('history', () => {
  it('starts with one entry and nothing to undo', () => {
    const history = createHistory('a');

    expect(current(history)).toBe('a');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('walks back and forward', () => {
    let history = push(createHistory('a'), 'b');
    history = push(history, 'c');

    history = undo(history);
    expect(current(history)).toBe('b');

    history = undo(history);
    expect(current(history)).toBe('a');
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(current(history)).toBe('b');
  });

  it('collapses fast edits of the same thing into one step', () => {
    let history = createHistory('');
    history = push(history, 'h', { coalesceKey: 'headline', now: 1_000 });
    history = push(history, 'he', { coalesceKey: 'headline', now: 1_050 });
    history = push(history, 'hel', { coalesceKey: 'headline', now: 1_100 });

    expect(current(history)).toBe('hel');
    // One undo removes the word, not the last letter.
    expect(current(undo(history))).toBe('');
  });

  it('starts a new step once the user pauses', () => {
    let history = createHistory('');
    history = push(history, 'one', { coalesceKey: 'headline', now: 1_000 });
    history = push(history, 'one two', { coalesceKey: 'headline', now: 1_000 + COALESCE_MS + 1 });

    expect(current(undo(history))).toBe('one');
  });

  it('never collapses two different slots', () => {
    let history = createHistory('');
    history = push(history, 'a', { coalesceKey: 'headline', now: 1_000 });
    history = push(history, 'b', { coalesceKey: 'body', now: 1_010 });

    expect(current(undo(history))).toBe('a');
  });

  it('drops the redo tail once a different change is made', () => {
    let history = push(push(createHistory('a'), 'b'), 'c');
    history = undo(history);
    history = push(history, 'd');

    expect(canRedo(history)).toBe(false);
    expect(current(history)).toBe('d');
  });

  it('never coalesces onto an entry the user has stepped back through', () => {
    let history = createHistory('');
    history = push(history, 'a', { coalesceKey: 'headline', now: 1_000 });
    history = push(history, 'b', { coalesceKey: 'headline', now: 1_010 });
    history = undo(history);
    history = push(history, 'c', { coalesceKey: 'headline', now: 1_020 });

    expect(current(undo(history))).toBe('');
  });

  it('keeps well past the fifty steps the stories ask for, and trims above its limit', () => {
    let history = createHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 20; step++) history = push(history, step);

    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(current(history)).toBe(HISTORY_LIMIT + 20);

    let back = history;
    for (let step = 0; step < 50; step++) back = undo(back);
    expect(canUndo(back)).toBe(true);
  });

  it('does not stack a change that changed nothing', () => {
    const value = { headline: 'Same' };
    const history = push(createHistory(value), value);

    expect(history.entries).toHaveLength(1);
    expect(canUndo(history)).toBe(false);
  });

  it('does nothing at either end', () => {
    const history = createHistory('a');
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});
