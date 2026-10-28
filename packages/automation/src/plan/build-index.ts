/**
 * One pass over a graph that every rule and planner shares: steps by key,
 * lines in and out of each step, and the run order. Built once per check
 * and passed around, so 20 rules do not each rebuild the same maps.
 */
import { getDefinition, isTriggerType } from '../catalog';
import type { NodeDefinition } from '../catalog/types';
import type { AutomationGraph, GraphEdge, GraphNode, PortId } from '../graph/schema';

export interface GraphIndex {
  readonly graph: AutomationGraph;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** `undefined` for an unknown type or version. */
  readonly definitions: ReadonlyMap<string, NodeDefinition | undefined>;
  readonly edges: ReadonlyMap<string, GraphEdge>;
  /** Lines into each step (by target key). */
  readonly incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Lines out of each step (by source key). */
  readonly outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Trigger steps, in run order. A valid graph has exactly one. */
  readonly triggers: readonly GraphNode[];
  /** Run order: dependencies first, ties broken by canvas y, then x, then key. */
  readonly order: readonly string[];
  /** Steps left out of `order` because they sit in or after a loop. */
  readonly cyclic: readonly string[];
}

/** A graph, or an index already built from one. */
export type GraphInput = AutomationGraph | GraphIndex;

/** Canvas y, then x, then key: the same graph always runs in the same order. */
export function compareNodes(a: GraphNode, b: GraphNode): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  if (a.position.x !== b.position.x) return a.position.x - b.position.x;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

/** Kahn's algorithm; among steps ready at the same time, `compareNodes` picks. */
function kahn(
  nodes: ReadonlyMap<string, GraphNode>,
  incoming: ReadonlyMap<string, readonly GraphEdge[]>,
  outgoing: ReadonlyMap<string, readonly GraphEdge[]>,
): { order: string[]; cyclic: string[] } {
  const waiting = new Map<string, number>();
  const ready: GraphNode[] = [];
  for (const node of nodes.values()) {
    const count = incoming.get(node.key)?.length ?? 0;
    waiting.set(node.key, count);
    if (count === 0) ready.push(node);
  }

  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareNodes);
    const next = ready.shift() as GraphNode;
    order.push(next.key);
    for (const edge of outgoing.get(next.key) ?? []) {
      const left = (waiting.get(edge.target) ?? 0) - 1;
      waiting.set(edge.target, left);
      if (left === 0) ready.push(nodes.get(edge.target) as GraphNode);
    }
  }

  const placed = new Set(order);
  const cyclic = [...nodes.values()]
    .filter((node) => !placed.has(node.key))
    .sort(compareNodes)
    .map((node) => node.key);
  return { order, cyclic };
}

export function buildIndex(graph: AutomationGraph): GraphIndex {
  const nodes = new Map<string, GraphNode>();
  const definitions = new Map<string, NodeDefinition | undefined>();
  for (const node of graph.nodes) {
    nodes.set(node.key, node);
    definitions.set(node.key, getDefinition(node.type, node.typeVersion));
  }

  const edges = new Map<string, GraphEdge>();
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    // The schema refuses dangling lines; an unparsed in-memory graph may still have one.
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || edges.has(edge.id)) continue;
    edges.set(edge.id, edge);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  const { order, cyclic } = kahn(nodes, incoming, outgoing);
  const triggers = [...order, ...cyclic]
    .map((key) => nodes.get(key) as GraphNode)
    .filter((node) => isTriggerType(node.type));

  return { graph, nodes, definitions, edges, incoming, outgoing, triggers, order, cyclic };
}

export function toIndex(input: GraphInput): GraphIndex {
  return 'incoming' in input ? input : buildIndex(input);
}

/** Lines leaving one port of a step. */
export function edgesFrom(index: GraphIndex, key: string, port: PortId): GraphEdge[] {
  return (index.outgoing.get(key) ?? []).filter((edge) => edge.sourcePort === port);
}

/** True when following lines from `from` reaches `to` (or `from` is `to`). */
export function reaches(index: GraphIndex, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (key === to) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of index.outgoing.get(key) ?? []) stack.push(edge.target);
  }
  return false;
}
