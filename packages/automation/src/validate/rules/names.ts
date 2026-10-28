import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Step names are unique (ignoring case and spaces at the ends), because
 * data chips show them. The first step keeps the name; later ones get the
 * issue.
 */
export const uniqueNames: ValidationRule = (graph) => {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    const name = node.name.trim().toLowerCase();
    if (seen.has(name)) {
      issues.push({
        severity: 'error',
        code: 'node.duplicate_name',
        message: `Another step is already called "${node.name.trim()}". Rename this one.`,
        nodeKey: node.key,
        field: 'name',
      });
    }
    seen.add(name);
  }
  return issues;
};
