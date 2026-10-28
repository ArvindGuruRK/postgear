/**
 * Test helpers: build graphs in a line or two. Not exported from the
 * package; tests import them directly.
 */
import { getDefinition } from '../catalog';
import type { NodeType } from '../catalog/types';
import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type PortId,
} from '../graph/schema';
import type { ValidationContext } from '../validate/types';

type NodeOverrides = Partial<Omit<GraphNode, 'key' | 'type' | 'config'>> & {
  config?: Record<string, unknown>;
};

/** A step with its type's default config, named after its key unless told otherwise. */
export function step(key: string, type: NodeType, overrides: NodeOverrides = {}): GraphNode {
  const def = getDefinition(type);
  if (!def) throw new Error(`No definition for ${type}`);
  const defaults = JSON.parse(JSON.stringify(def.defaultConfig)) as Record<string, unknown>;
  const { config, ...rest } = overrides;
  return {
    key,
    type,
    typeVersion: def.typeVersion,
    name: key,
    position: { x: 0, y: 0 },
    config: { ...defaults, ...config },
    ...rest,
  };
}

export function line(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

export function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

/** A workspace with one working Slack connection and two healthy channels. */
export const READY_CONTEXT: ValidationContext = {
  connections: [{ id: 'conn_slack', kind: 'slack', name: 'Marketing Slack', status: 'CONNECTED' }],
  channels: [
    { id: 'ch_ig', provider: 'instagram', name: 'Bloom Bakery', status: 'active' },
    { id: 'ch_li', provider: 'linkedin-page', name: 'Bloom Ltd', status: 'active' },
  ],
};

/** A Slack step that is ready to run in `READY_CONTEXT`. */
export function readySlack(key: string, overrides: NodeOverrides = {}): GraphNode {
  return step(key, 'notify.slack', {
    ...overrides,
    config: { connectionId: 'conn_slack', message: 'Hello', ...overrides.config },
  });
}
