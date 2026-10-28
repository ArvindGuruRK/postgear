import { edgesFrom } from '../../plan/build-index';
import type { ValidationIssue, ValidationRule } from '../types';

/** An If / Else side with nothing after it is allowed, but probably a mistake. */
export const ifElseDeadEnds: ValidationRule = (graph, index) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'logic.ifElse') continue;
    for (const [port, words] of [
      ['true', 'True'],
      ['false', 'False'],
    ] as const) {
      if (edgesFrom(index, node.key, port).length > 0) continue;
      issues.push({
        severity: 'warning',
        code: 'graph.dead_end_output',
        message: `Nothing happens when this is ${words}.`,
        nodeKey: node.key,
      });
    }
  }
  return issues;
};
