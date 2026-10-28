import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Every step's type exists, is not Coming Soon, and (when the context says
 * what the worker can run) can run. A turned-off step never runs, so it is
 * not held to the last check.
 */
export const knownRunnableTypes: ValidationRule = (graph, index, ctx) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    const def = index.definitions.get(node.key);
    if (!def) {
      issues.push({
        severity: 'error',
        code: 'node.unknown_type',
        message: 'This step type is not available any more.',
        nodeKey: node.key,
      });
    } else if (def.status === 'comingSoon') {
      issues.push({
        severity: 'error',
        code: 'node.coming_soon',
        message: `${def.title} is coming soon, so it cannot run yet.`,
        nodeKey: node.key,
      });
    } else if (ctx.availableTypes && !ctx.availableTypes.has(def.type) && !node.disabled) {
      issues.push({
        severity: 'error',
        code: 'node.not_runnable',
        message: `${def.title} cannot run yet in this version of PostGear.`,
        nodeKey: node.key,
      });
    }
  }
  return issues;
};
