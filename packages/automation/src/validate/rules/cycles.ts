import type { GraphNode } from '../../graph/schema';
import { compareNodes } from '../../plan/build-index';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * No loops. A depth-first walk from the trigger (then from any other
 * start, in canvas order) reports each line that leads back to a step
 * still being walked: the line that closes the loop, once per loop.
 */
export const noCycles: ValidationRule = (_graph, index) => {
  if (index.cyclic.length === 0) return [];

  const issues: ValidationIssue[] = [];
  const state = new Map<string, 'walking' | 'done'>();
  const byOrder = (a: string, b: string) =>
    compareNodes(index.nodes.get(a) as GraphNode, index.nodes.get(b) as GraphNode);

  const walk = (key: string) => {
    state.set(key, 'walking');
    const lines = [...(index.outgoing.get(key) ?? [])].sort((a, b) => byOrder(a.target, b.target));
    for (const line of lines) {
      const seen = state.get(line.target);
      if (seen === 'walking') {
        issues.push({
          severity: 'error',
          code: 'graph.cycle',
          message: 'Workflows cannot loop back to an earlier step.',
          nodeKey: line.source,
          edgeId: line.id,
        });
      } else if (seen === undefined) {
        walk(line.target);
      }
    }
    state.set(key, 'done');
  };

  const starts = [
    ...index.triggers.map((node) => node.key),
    ...[...index.nodes.keys()].sort(byOrder),
  ];
  for (const key of starts) if (!state.has(key)) walk(key);
  return issues;
};
