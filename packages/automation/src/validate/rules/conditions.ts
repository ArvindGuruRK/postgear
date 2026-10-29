import type { FieldType } from '../../catalog/types';
import { OPERATORS, operatorFamily } from '../../conditions/operators';
import { type ConditionGroup, conditionGroupSchema } from '../../conditions/schema';
import type { GraphNode } from '../../graph/schema';
import type { GraphIndex } from '../../plan/build-index';
import { parseIsoDate } from '../../time/calendar';
import { lookupField, sourceFields } from '../../tokens/available';
import { parseTemplate, singleToken, tokenSource, tokensIn } from '../../tokens/parse';
import { toNumber } from '../../tokens/values';
import { asRecord } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

const NUMBER_WITH_TEXT = 'This compares a number with text.';
const DOES_NOT_FIT = 'This check does not fit this kind of data.';

/** The conditions inside a step's config, with the field each lives in. */
function conditionsOf(node: GraphNode): { field: string; group: ConditionGroup }[] {
  const config = asRecord(node.config);
  const found: { field: string; group: unknown }[] = [];
  if (node.type === 'logic.ifElse' || node.type === 'logic.filter') {
    found.push({ field: 'condition', group: config.condition });
  }
  if (node.type === 'logic.switch' && Array.isArray(config.cases)) {
    config.cases.forEach((entry, i) => {
      found.push({ field: `cases.${i}.condition`, group: asRecord(entry).condition });
    });
  }
  return found.flatMap(({ field, group }) => {
    const parsed = conditionGroupSchema.safeParse(group);
    return parsed.success ? [{ field, group: parsed.data }] : [];
  });
}

/** The declared type of a left side that is one data chip, when known. */
function leftType(index: GraphIndex, left: string): FieldType | undefined {
  const token = singleToken(parseTemplate(left));
  if (!token) return undefined;
  const source = tokenSource(token.path);
  const fields = sourceFields(index, source);
  return fields ? lookupField(fields, source.field).type : undefined;
}

/** Typed text with no data chips in it. */
function isLiteral(text: string): boolean {
  return tokensIn(text).length === 0;
}

/**
 * Conditions must be complete (a rule, the data to check, a value when
 * the check needs one) and should compare like with like.
 */
export const conditionsComplete: ValidationRule = (graph, index) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (node.disabled) continue;
    for (const { field, group } of conditionsOf(node)) {
      if (group.rules.length === 0) {
        issues.push({
          severity: 'error',
          code: 'condition.empty',
          message: 'Add at least one rule.',
          nodeKey: node.key,
          field,
        });
        continue;
      }
      group.rules.forEach((rule, i) => {
        const base = `${field}.rules.${i}`;
        const push = (
          severity: ValidationIssue['severity'],
          code: ValidationIssue['code'],
          message: string,
          part: string,
        ) => issues.push({ severity, code, message, nodeKey: node.key, field: `${base}.${part}` });

        if (rule.left.trim() === '') {
          push('error', 'condition.missing_value', 'Choose the data to check.', 'left');
          return;
        }
        const info = OPERATORS[rule.operator];
        const right = rule.right?.trim() ?? '';
        if (info.takesValue && right === '') {
          push('error', 'condition.missing_value', 'Enter a value to compare with.', 'right');
          return;
        }
        if (info.valueIsCount && isLiteral(right)) {
          const n = toNumber(right);
          if (!Number.isInteger(n) || n < 0) {
            push('error', 'condition.missing_value', 'Enter a whole number.', 'right');
            return;
          }
        }

        const family = operatorFamily(rule.operator);
        const type = leftType(index, rule.left);
        if (family === 'number') {
          if (isLiteral(right) && Number.isNaN(toNumber(right))) {
            push('warning', 'condition.type_mismatch', NUMBER_WITH_TEXT, 'right');
          } else if (type === 'text') {
            push('warning', 'condition.type_mismatch', NUMBER_WITH_TEXT, 'operator');
          } else if (type && type !== 'number') {
            push('warning', 'condition.type_mismatch', DOES_NOT_FIT, 'operator');
          }
        } else if (family === 'date') {
          if ((rule.operator === 'before' || rule.operator === 'after') && isLiteral(right)) {
            if (parseIsoDate(right) === undefined) {
              push('warning', 'condition.type_mismatch', 'Enter a date like 2026-11-03.', 'right');
              return;
            }
          }
          if (type === 'number' || type === 'boolean' || type === 'list') {
            push('warning', 'condition.type_mismatch', DOES_NOT_FIT, 'operator');
          }
        } else if (family === 'boolean') {
          if (type === 'number' || type === 'date' || type === 'list') {
            push('warning', 'condition.type_mismatch', DOES_NOT_FIT, 'operator');
          }
        } else if (family === 'list') {
          if (type && type !== 'list') {
            push('warning', 'condition.type_mismatch', DOES_NOT_FIT, 'operator');
          }
        } else if (family === 'text') {
          if (type === 'number')
            push('warning', 'condition.type_mismatch', NUMBER_WITH_TEXT, 'operator');
          else if (type === 'list')
            push('warning', 'condition.type_mismatch', DOES_NOT_FIT, 'operator');
        }
      });
    }
  }
  return issues;
};
