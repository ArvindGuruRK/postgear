/**
 * A step's connection during a run: is it usable, and which of its values
 * must be hidden wherever run data is stored or logged.
 */
import { type ConnectionUse, connectionKindInfo, type GraphNode } from '@postgear/automation';
import { notConnected, type StepFailure } from './failures';
import type { StoredConnection } from './run-store';

/**
 * Every text value inside a connection's credentials (a webhook link, a
 * token, a header value). `redact` hides any stored text that contains one.
 */
export function connectionValues(credentials: unknown): string[] {
  const values: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof value === 'string') {
      if (value.trim() !== '') values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(credentials, 0);
  return values;
}

/** The connection id a step's settings point at, or '' when none was picked. */
export function connectionIdOf(node: GraphNode, use: ConnectionUse): string {
  const id = node.config[use.field];
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * Why the step cannot use its connection, or null when it can. A step whose
 * connection is optional (HTTP Request's secret headers) runs without one.
 */
export function connectionProblem(
  node: GraphNode,
  use: ConnectionUse,
  connection: StoredConnection | null,
): StepFailure | null {
  const app = connectionKindInfo(use.kind).title;
  const picked = connectionIdOf(node, use) !== '';

  if (!picked) {
    return use.optional
      ? null
      : notConnected(`Choose a ${app} connection for ${node.name}.`, 'not_connected');
  }
  if (!connection || connection.kind !== use.kind) {
    return notConnected(
      `The ${app} connection ${node.name} uses was removed. Choose another one.`,
      'connection_missing',
    );
  }
  if (connection.status !== 'CONNECTED') {
    return notConnected(
      `${connection.name} needs reconnecting. Reconnect it on the Connections page.`,
      'needs_reconnect',
    );
  }
  return null;
}
