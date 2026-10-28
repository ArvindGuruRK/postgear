import { outputFieldsOf } from '../../catalog';
import { stringsIn } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * A turned-off step passes its input through but makes no output of its
 * own, so data chips that point at its output will be empty. Warn on each
 * step that uses one ("Slack is turned off, so 'Message Id' will be empty.").
 *
 * This reads tokens with a narrow pattern of its own; Module 02's
 * `parseTemplate` should replace it once it exists.
 */
const NODE_TOKEN = /\{\{\s*nodes\.([A-Za-z0-9_-]+)\.output(?:\.([A-Za-z0-9_.]+))?/g;

export const disabledOutputUsed: ValidationRule = (graph, index) => {
  const off = graph.nodes.filter((node) => node.disabled && index.definitions.get(node.key));
  if (off.length === 0) return [];

  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    for (const text of stringsIn(node.config)) {
      for (const match of text.value.matchAll(NODE_TOKEN)) {
        const source = off.find((candidate) => candidate.key === match[1]);
        if (!source || source.key === node.key) continue;
        const path = match[2];
        const label = path
          ? outputFieldsOf(source).find((field) => field.path === path)?.label
          : undefined;
        issues.push({
          severity: 'warning',
          code: 'node.disabled_output_used',
          message: `${source.name} is turned off, so ${label ? `'${label}'` : 'its data'} will be empty.`,
          nodeKey: node.key,
          field: text.path,
        });
      }
    }
  }
  return issues;
};
