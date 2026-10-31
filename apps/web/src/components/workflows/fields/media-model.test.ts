import {
  addLibraryPicks,
  libraryIds,
  MAX_LIBRARY_MEDIA,
  removeLibraryPick,
  slotsLeft,
  storedPicks,
} from './media-model';

describe('libraryIds', () => {
  it('keeps text ids once each, in order, and drops anything else', () => {
    expect(libraryIds(['m1', 'm2', 'm1', '', 7, null, 'm3'])).toEqual(['m1', 'm2', 'm3']);
  });

  it('reads nothing from a missing or wrong value', () => {
    expect(libraryIds(undefined)).toEqual([]);
    expect(libraryIds('m1')).toEqual([]);
  });
});

describe('Pick From Media', () => {
  it('adds new picks after the ones already there, never twice', () => {
    expect(addLibraryPicks(['m1'], ['m2', 'm1', 'm3'])).toEqual(['m1', 'm2', 'm3']);
  });

  it('stops at 10 items', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `m${i}`);
    expect(slotsLeft(nine)).toBe(1);
    const next = addLibraryPicks(nine, ['a', 'b', 'c']);
    expect(next).toHaveLength(MAX_LIBRARY_MEDIA);
    expect(next[9]).toBe('a');
    expect(slotsLeft(next)).toBe(0);
    expect(addLibraryPicks(next, ['z'])).toEqual(next);
  });

  it('removes one pick and stores nothing once the last is gone', () => {
    expect(removeLibraryPick(['m1', 'm2'], 'm1')).toEqual(['m2']);
    expect(storedPicks(removeLibraryPick(['m1'], 'm1'))).toBeUndefined();
    expect(storedPicks(['m2'])).toEqual(['m2']);
  });
});
