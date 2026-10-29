/**
 * Which earlier steps have certainly run whenever a step runs, so Insert
 * Data can tag the rest "May be empty".
 *
 * A step certainly ran when the trigger leads to it along lines that must
 * have carried data: a line from a step with one output always does once
 * that step ran; a line from one side of a branch does when this step's
 * branch conditions (`branchConditions`) fix that side; and lines from
 * every side of a branch together always do (a rejoin). After True to A
 * and False to B rejoin at C, neither A nor B is certain at C.
 *
 * This errs towards "may be empty": a warning too many, never a promise
 * the run cannot keep.
 */
import { outputPortsOf } from '../catalog';
import { type GraphInput, toIndex } from './build-index';
import { branchConditions } from './exclusive';

export function certainBefore(input: GraphInput, key: string): Set<string> {
  const index = toIndex(input);
  const conditions = branchConditions(index).get(key) ?? new Map();
  const trigger = index.triggers[0]?.key;
  const memo = new Map<string, boolean>();

  const certain = (step: string): boolean => {
    const known = memo.get(step);
    if (known !== undefined) return known;
    // Guards against loops; validation reports those separately.
    memo.set(step, false);
    let result = step === trigger;
    if (!result) {
      const bySource = new Map<string, Set<string>>();
      for (const edge of index.incoming.get(step) ?? []) {
        const ports = bySource.get(edge.source) ?? new Set<string>();
        ports.add(edge.sourcePort);
        bySource.set(edge.source, ports);
      }
      for (const [source, ports] of bySource) {
        const node = index.nodes.get(source);
        if (!node || !certain(source)) continue;
        const outputs = outputPortsOf(node).map((port) => port.id);
        const fixed = conditions.get(source);
        if (
          outputs.length <= 1 ||
          (fixed !== undefined && ports.has(fixed)) ||
          outputs.every((port) => ports.has(port))
        ) {
          result = true;
          break;
        }
      }
    }
    memo.set(step, result);
    return result;
  };

  const result = new Set<string>();
  for (const step of index.order) {
    if (step !== key && certain(step)) result.add(step);
  }
  return result;
}
