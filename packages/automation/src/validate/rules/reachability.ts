import { isTriggerType } from '../../catalog';
import type { ValidationRule } from '../types';

/** Every step can be reached from the trigger. Without a trigger, `graph.no_trigger` says it all. */
export const reachableFromTrigger: ValidationRule = (_graph, index) => {
  if (index.triggers.length === 0) return [];

  const reached = new Set<string>();
  const stack = index.triggers.map((node) => node.key);
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (reached.has(key)) continue;
    reached.add(key);
    for (const edge of index.outgoing.get(key) ?? []) stack.push(edge.target);
  }

  return [...index.order, ...index.cyclic]
    .filter((key) => !reached.has(key) && !isTriggerType(index.nodes.get(key)?.type ?? ''))
    .map((key) => ({
      severity: 'error' as const,
      code: 'graph.unreachable' as const,
      message: 'This step is not connected to the trigger.',
      nodeKey: key,
    }));
};
