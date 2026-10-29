/**
 * Step keys made on the server, for templates and Duplicate.
 *
 * A key is a step's stable id: data chips (`{{ nodes.k3f9a1b2c0.output }}`)
 * and lines point at it, so it never changes and is never reused inside a
 * workflow. `@postgear/automation` has no randomness (it runs in Temporal's
 * sandbox), which is why the key maker is passed in from here.
 */
import { randomInt } from 'node:crypto';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET = `${LETTERS}0123456789`;

/** Ten characters, a letter first: `k3f9a1b2c0`. 36^9 per letter, so clashes are not a concern. */
export const NODE_KEY_LENGTH = 10;

export function newNodeKey(): string {
  let key = LETTERS[randomInt(LETTERS.length)];
  while (key.length < NODE_KEY_LENGTH) key += ALPHABET[randomInt(ALPHABET.length)];
  return key;
}

/** A `makeKey` for `rekeyGraph` and `instantiateTemplate` that never repeats itself. */
export function freshKeyMaker(): (oldKey: string) => string {
  const used = new Set<string>();
  return () => {
    let key = newNodeKey();
    while (used.has(key)) key = newNodeKey();
    used.add(key);
    return key;
  };
}
