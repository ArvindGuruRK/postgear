/**
 * New step and note keys: 10 characters, a letter first, then lowercase
 * letters and digits, the same shape the API makes (`newNodeKey`). Made once
 * and never reused (the TriForms lesson): data chips point at keys.
 *
 * `crypto.getRandomValues` rather than a dependency: ten characters do not
 * need one, and it keeps the test environment free of ESM-only packages.
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET = `${LETTERS}0123456789`;
export const STEP_KEY_LENGTH = 10;

export function newStepKey(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const bytes = new Uint8Array(STEP_KEY_LENGTH);
    crypto.getRandomValues(bytes);
    let key = LETTERS[bytes[0] % LETTERS.length];
    for (let i = 1; i < STEP_KEY_LENGTH; i += 1) key += ALPHABET[bytes[i] % ALPHABET.length];
    if (!taken.has(key)) return key;
  }
}

/** A key maker that never repeats a key already in `taken` or one it gave before. */
export function keyMaker(taken: Iterable<string>): () => string {
  const used = new Set(taken);
  return () => {
    const key = newStepKey(used);
    used.add(key);
    return key;
  };
}
