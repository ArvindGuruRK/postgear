import { areExclusive } from '../../plan/exclusive';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Two branches that can both run must join at a Merge. Lines that never
 * run together (the two sides of one If / Else, rejoining) may meet at any
 * step. Steps in a loop are left to `graph.cycle`.
 */
export const joinsNeedMerge: ValidationRule = (_graph, index) => {
  const issues: ValidationIssue[] = [];
  for (const key of index.order) {
    const node = index.nodes.get(key);
    const lines = index.incoming.get(key) ?? [];
    if (!node || node.type === 'logic.merge' || lines.length < 2) continue;

    const clash = lines.some((a, i) =>
      lines.slice(i + 1).some((b) => !areExclusive(index, a.id, b.id)),
    );
    if (clash) {
      issues.push({
        severity: 'error',
        code: 'graph.needs_merge',
        message: 'Two branches that both run need a Merge step to join.',
        nodeKey: key,
      });
    }
  }
  return issues;
};
