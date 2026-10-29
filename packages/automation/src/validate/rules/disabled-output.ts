import { outputFieldsOf } from '../../catalog';
import { tokenSource, tokensIn } from '../../tokens/parse';
import { stringsIn } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * A turned-off step passes its input through but makes no output of its
 * own, so data chips that point at its output will be empty. Warn on each
 * step that uses one ("Slack is turned off, so 'Message Id' will be empty.").
 */
export const disabledOutputUsed: ValidationRule = (graph, index) => {
  const off = graph.nodes.filter((node) => node.disabled && index.definitions.get(node.key));
  if (off.length === 0) return [];

  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    for (const text of stringsIn(node.config)) {
      for (const token of tokensIn(text.value)) {
        const source = tokenSource(token.path);
        if (source.root !== 'nodes' || !source.wellFormed) continue;
        const from = off.find((candidate) => candidate.key === source.nodeKey);
        if (!from || from.key === node.key) continue;
        const label = source.field
          ? outputFieldsOf(from).find((field) => field.path === source.field)?.label
          : undefined;
        issues.push({
          severity: 'warning',
          code: 'node.disabled_output_used',
          message: `${from.name} is turned off, so ${label ? `'${label}'` : 'its data'} will be empty.`,
          nodeKey: node.key,
          field: text.path,
          token: token.raw,
        });
      }
    }
  }
  return issues;
};
