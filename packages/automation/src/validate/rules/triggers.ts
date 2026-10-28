import type { ValidationRule } from '../types';

/** Exactly one trigger. Every trigger after the first (in run order) gets the issue. */
export const exactlyOneTrigger: ValidationRule = (_graph, index) => {
  if (index.triggers.length === 0) {
    return [
      {
        severity: 'error',
        code: 'graph.no_trigger',
        message: 'Add a trigger to choose what starts this workflow.',
      },
    ];
  }
  return index.triggers.slice(1).map((node) => ({
    severity: 'error' as const,
    code: 'graph.many_triggers' as const,
    message: 'A workflow can have only one trigger.',
    nodeKey: node.key,
  }));
};
