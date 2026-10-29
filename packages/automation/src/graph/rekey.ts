import { renameNodesInConfig } from '../tokens/rewrite';
import { type AutomationGraph, edgeId, NODE_KEY_PATTERN } from './schema';

/**
 * A copy of a graph with a fresh key for every step, its lines and data
 * chips moved to the new keys. `makeKey` gets each old key and returns a
 * new one (the API makes them; this package has no randomness). Throws
 * when `makeKey` returns a bad or repeated key, which is a bug.
 */
export function rekeyGraph(
  graph: AutomationGraph,
  makeKey: (oldKey: string) => string,
): AutomationGraph {
  const keys = new Map<string, string>();
  const used = new Set<string>();
  for (const node of graph.nodes) {
    const next = makeKey(node.key);
    if (!NODE_KEY_PATTERN.test(next) || used.has(next)) {
      throw new Error(`rekeyGraph: makeKey gave an unusable key "${next}".`);
    }
    used.add(next);
    keys.set(node.key, next);
  }
  const key = (old: string) => keys.get(old) ?? old;
  return {
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.map((node) => ({
      ...node,
      key: key(node.key),
      position: { ...node.position },
      config: renameNodesInConfig(node.config, keys),
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      id: edgeId(key(edge.source), edge.sourcePort, key(edge.target)),
      source: key(edge.source),
      target: key(edge.target),
    })),
    notes: graph.notes.map((note) => ({
      ...note,
      position: { ...note.position },
      size: { ...note.size },
    })),
  };
}
