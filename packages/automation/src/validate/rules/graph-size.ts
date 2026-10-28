import { LIMITS } from '../../limits';
import type { ValidationRule } from '../types';

/** Up to 50 steps and 120 lines. The schema allows more so an over-full paste still saves. */
export const graphSize: ValidationRule = (graph) => {
  const issues: ReturnType<ValidationRule> = [];
  if (graph.nodes.length > LIMITS.maxNodes) {
    issues.push({
      severity: 'error',
      code: 'graph.too_many_nodes',
      message: `Workflows can have up to ${LIMITS.maxNodes} steps.`,
    });
  }
  if (graph.edges.length > LIMITS.maxEdges) {
    issues.push({
      severity: 'error',
      code: 'graph.too_many_edges',
      message: `Workflows can have up to ${LIMITS.maxEdges} lines between steps.`,
    });
  }
  return issues;
};
