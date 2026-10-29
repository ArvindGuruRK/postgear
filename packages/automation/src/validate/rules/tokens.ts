import { certainBefore } from '../../plan/guaranteed';
import { upstreamOf } from '../../plan/order';
import { lookupField, sourceFields } from '../../tokens/available';
import { isKnownFilter } from '../../tokens/filters';
import { MAX_TOKENS_PER_FIELD, tokenSource, tokensIn } from '../../tokens/parse';
import { stringsIn } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/** The last readable part of a field path: `post.channel.name` is "name". */
function lastPart(field: string): string {
  return (
    field
      .split('.')
      .filter((part) => !/^\d+$/.test(part))
      .at(-1) ?? field
  );
}

/**
 * Every data chip must point at data that will exist: a step that is
 * still there, runs earlier, and has that field, with a known format.
 * Data from a branch that might not run is a warning ("may be empty").
 * Turned-off steps are not checked; they never run.
 */
export const tokensResolve: ValidationRule = (graph, index) => {
  const issues: ValidationIssue[] = [];
  const trigger = index.triggers[0];

  for (const node of graph.nodes) {
    const def = index.definitions.get(node.key);
    if (!def || node.disabled || def.category === 'trigger') continue;
    let upstream: Set<string> | undefined;
    let certain: Set<string> | undefined;

    for (const text of stringsIn(node.config)) {
      const tokens = tokensIn(text.value);
      if (tokens.length === 0) continue;
      const at = { nodeKey: node.key, field: text.path };
      if (tokens.length > MAX_TOKENS_PER_FIELD) {
        issues.push({
          severity: 'error',
          code: 'token.too_many',
          message: `Use at most ${MAX_TOKENS_PER_FIELD} pieces of data in one field.`,
          ...at,
        });
      }

      for (const token of tokens) {
        const where = { ...at, token: token.raw };
        const issue = (
          severity: ValidationIssue['severity'],
          code: ValidationIssue['code'],
          message: string,
        ) => issues.push({ severity, code, message, ...where });

        if (token.filters.some((filter) => !isKnownFilter(filter))) {
          issue('error', 'token.bad_filter', 'This format option is not recognised.');
        }

        const source = tokenSource(token.path);
        let sourceName: string;
        if (source.root === 'nodes') {
          const from = source.nodeKey ? index.nodes.get(source.nodeKey) : undefined;
          if (!from) {
            issue('error', 'token.unknown_node', 'This data is no longer available.');
            continue;
          }
          upstream ??= new Set(upstreamOf(index, node.key));
          if (!upstream.has(from.key)) {
            issue('error', 'token.not_upstream', 'This data comes from a step that runs later.');
            continue;
          }
          sourceName = from.name;
          if (!source.wellFormed) {
            issue(
              'error',
              'token.unknown_field',
              `${sourceName} has no '${token.path.split('.').slice(2).join('.')}'.`,
            );
            continue;
          }
          certain ??= certainBefore(index, node.key);
          const filled = token.filters.some((filter) => filter.name === 'default');
          if (!from.disabled && !certain.has(from.key) && !filled) {
            issue(
              'warning',
              'token.maybe_empty',
              'This data may be empty when the other branch runs.',
            );
          }
        } else if (source.root === 'trigger') {
          if (!trigger) continue;
          sourceName = trigger.name;
        } else if (source.root === 'run') {
          sourceName = 'This run';
        } else if (source.root === 'workspace') {
          sourceName = 'The workspace';
        } else {
          issue('error', 'token.unknown_node', 'This data is no longer available.');
          continue;
        }

        const fields = sourceFields(index, source);
        if (fields && !lookupField(fields, source.field).known) {
          issue(
            'error',
            'token.unknown_field',
            `${sourceName} has no '${lastPart(source.field)}'.`,
          );
        }
      }
    }
  }
  return issues;
};
