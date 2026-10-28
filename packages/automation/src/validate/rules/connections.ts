import { connectionKindInfo } from '../../catalog/platforms';
import { asRecord } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Steps that need an app connection have one, of the right app, that
 * works. Only the id is in the graph; names and status come from the
 * context. Turned-off steps never run, so they are not checked.
 */
export const connectionsReady: ValidationRule = (graph, index, ctx) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    const def = index.definitions.get(node.key);
    if (!def?.connection || node.disabled) continue;

    const { kind, field, optional } = def.connection;
    const app = connectionKindInfo(kind).title;
    const value = asRecord(node.config)[field];
    const id = typeof value === 'string' ? value.trim() : '';
    const issue = (code: ValidationIssue['code'], message: string): ValidationIssue => ({
      severity: 'error',
      code,
      message,
      nodeKey: node.key,
      field,
    });

    if (!id) {
      if (optional) continue;
      const hasAny = ctx.connections.some((connection) => connection.kind === kind);
      issues.push(
        issue(
          'node.connection_missing',
          hasAny ? `Choose a ${app} connection.` : `Connect a ${app} account to use this step.`,
        ),
      );
      continue;
    }

    const connection = ctx.connections.find((c) => c.id === id && c.kind === kind);
    if (!connection) {
      issues.push(
        issue('node.connection_missing', `This ${app} connection was removed. Choose another one.`),
      );
    } else if (connection.status !== 'CONNECTED') {
      issues.push(issue('node.connection_broken', `${connection.name} needs to be reconnected.`));
    }
  }
  return issues;
};
