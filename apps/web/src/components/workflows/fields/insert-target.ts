/**
 * Click to map (blueprint 5.2): a chip input that accepts data registers
 * itself here when it takes focus, and an Input pane row calls
 * `insertDataAtLastField` to put a chip at that field's caret. One target
 * at a time, the last one focused; it is forgotten when its field unmounts.
 */
import type { InsertDataAtLastField } from './contract';

export interface DataInsertTarget {
  /** Inserts a chip for the token path at the field's last caret. */
  insertData: (tokenPath: string) => void;
}

let last: DataInsertTarget | null = null;

/** Makes `target` the field that click to map writes into. */
export function registerInsertTarget(target: DataInsertTarget): void {
  last = target;
}

/** Forgets `target` if it is still the last one (its field unmounted). */
export function forgetInsertTarget(target: DataInsertTarget): void {
  if (last === target) last = null;
}

export const insertDataAtLastField: InsertDataAtLastField = (tokenPath) => {
  if (!last || !tokenPath) return false;
  last.insertData(tokenPath);
  return true;
};
