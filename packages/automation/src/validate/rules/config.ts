import { isBlank } from '../../catalog/fields';
import { asRecord, getAtPath, plainErrorMap } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Each step's config matches its type's schema (one issue per problem,
 * with the field to focus), its On Error and Turn Off settings are allowed
 * for its type, and its required fields are filled. Required fields are
 * checked only once the config parses, and not on turned-off steps, which
 * never run.
 */
export const configIsValid: ValidationRule = (graph, index) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    const def = index.definitions.get(node.key);
    if (!def) continue;

    const parsed = def.configSchema.safeParse(node.config, { errorMap: plainErrorMap });
    if (!parsed.success) {
      for (const problem of parsed.error.issues) {
        issues.push({
          severity: 'error',
          code: 'node.config_invalid',
          message: problem.message,
          nodeKey: node.key,
          ...(problem.path.length ? { field: problem.path.join('.') } : {}),
        });
      }
    }

    if (node.onError && !def.canHandleErrors) {
      issues.push({
        severity: 'error',
        code: 'node.config_invalid',
        message: `${def.title} cannot have an On Error setting.`,
        nodeKey: node.key,
        field: 'onError',
      });
    }
    if (node.disabled && !def.canDisable) {
      issues.push({
        severity: 'error',
        code: 'node.config_invalid',
        message: `${def.title} cannot be turned off.`,
        nodeKey: node.key,
        field: 'disabled',
      });
    }

    if (!parsed.success || node.disabled) continue;
    const config = asRecord(parsed.data);
    for (const required of def.required ?? []) {
      if (required.when && !required.when(parsed.data)) continue;
      if (!isBlank(getAtPath(config, required.path))) continue;
      issues.push({
        severity: 'error',
        code: 'node.required_missing',
        message: required.message,
        nodeKey: node.key,
        field: required.path,
      });
    }
  }
  return issues;
};
