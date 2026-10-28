/**
 * `validateGraph`: every problem with a workflow, in plain words, each
 * pointing at the step, line or field to fix. The web app runs it live as
 * people draw, the API before tests and activation, the worker on the
 * pinned version. Errors block tests and activation; warnings do not;
 * saving is never blocked by an issue.
 */
import type { AutomationGraph } from '../graph/schema';
import { buildIndex } from '../plan/build-index';
import { VALIDATION_RULES } from './rules';
import type { ValidationContext, ValidationIssue, ValidationRule } from './types';

const EMPTY_CONTEXT: ValidationContext = { connections: [], channels: [] };

/** Never throws: a rule that breaks becomes one `graph.check_failed` issue. */
export function validateGraph(
  graph: AutomationGraph,
  ctx: Partial<ValidationContext> = {},
  rules: readonly ValidationRule[] = VALIDATION_RULES,
): ValidationIssue[] {
  const context: ValidationContext = { ...EMPTY_CONTEXT, ...ctx };
  const index = buildIndex(graph);
  const issues: ValidationIssue[] = [];
  let broken = false;
  for (const rule of rules) {
    try {
      issues.push(...rule(graph, index, context));
    } catch {
      broken = true;
    }
  }
  if (broken) {
    issues.push({
      severity: 'error',
      code: 'graph.check_failed',
      message: 'PostGear could not check part of this workflow. Reload the page and try again.',
    });
  }
  return issues;
}

/** True when an error blocks a test run or activation. */
export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
