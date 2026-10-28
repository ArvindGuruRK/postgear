/**
 * Which branches can never run in the same run.
 *
 * Every step leaves through exactly one port per run: If / Else through
 * True or False, Paths through one case or Otherwise, Manual Review through
 * Approved or Rejected, a step with an On Error branch through Out or
 * On Error. So two lines are mutually exclusive when, somewhere upstream,
 * they depend on different ports of the same step. That holds along whole
 * paths, not just the lines next to the branch: True to A to C and False to
 * B to C rejoin at C without a Merge, because A and B never both run.
 *
 * Each step's "branch conditions" are the port choices that must have
 * happened for it to run: the conditions every line into it shares. A
 * rejoin after both sides of an If / Else therefore has none left, and
 * everything after it runs unconditionally again.
 */
import { outputPortsOf } from '../catalog';
import type { PortId } from '../graph/schema';
import { edgesFrom, type GraphIndex, type GraphInput, toIndex } from './build-index';

/** Step key to the port it must have left through. */
export type BranchConditions = ReadonlyMap<string, PortId>;

const CACHE = new WeakMap<GraphIndex, Map<string, BranchConditions>>();

function intersect(a: BranchConditions, b: BranchConditions): Map<string, PortId> {
  const result = new Map<string, PortId>();
  for (const [key, port] of a) if (b.get(key) === port) result.set(key, port);
  return result;
}

function edgeConditions(
  conditions: ReadonlyMap<string, BranchConditions>,
  edge: { source: string; sourcePort: PortId },
): Map<string, PortId> {
  const result = new Map(conditions.get(edge.source) ?? []);
  result.set(edge.source, edge.sourcePort);
  return result;
}

/** For every step, the port choices upstream that must have happened for it to run. */
export function branchConditions(input: GraphInput): ReadonlyMap<string, BranchConditions> {
  const index = toIndex(input);
  const cached = CACHE.get(index);
  if (cached) return cached;

  const conditions = new Map<string, BranchConditions>();
  for (const key of index.order) {
    const lines = index.incoming.get(key) ?? [];
    let shared: Map<string, PortId> | undefined;
    for (const line of lines) {
      const next = edgeConditions(conditions, line);
      shared = shared ? intersect(shared, next) : next;
    }
    conditions.set(key, shared ?? new Map());
  }
  for (const key of index.cyclic) conditions.set(key, new Map());

  CACHE.set(index, conditions);
  return conditions;
}

/** True when the two lines can never both carry data in one run. */
export function areExclusive(input: GraphInput, edgeIdA: string, edgeIdB: string): boolean {
  const index = toIndex(input);
  const a = index.edges.get(edgeIdA);
  const b = index.edges.get(edgeIdB);
  if (!a || !b || a.id === b.id) return false;
  const conditions = branchConditions(index);
  const left = edgeConditions(conditions, a);
  const right = edgeConditions(conditions, b);
  for (const [key, port] of left) {
    const other = right.get(key);
    if (other !== undefined && other !== port) return true;
  }
  return false;
}

export interface ExclusiveGroup {
  /** The step whose ports split the run. */
  nodeKey: string;
  /** One entry per port, with the lines that leave it; only one port runs. */
  branches: { port: PortId; edgeIds: string[] }[];
}

/**
 * Every step with more than one output (If / Else, Paths, Manual Review,
 * any step with an On Error branch), and the lines on each side.
 */
export function exclusiveGroups(input: GraphInput): ExclusiveGroup[] {
  const index = toIndex(input);
  const groups: ExclusiveGroup[] = [];
  for (const key of [...index.order, ...index.cyclic]) {
    const node = index.nodes.get(key);
    if (!node) continue;
    const ports = outputPortsOf(node);
    if (ports.length < 2) continue;
    groups.push({
      nodeKey: key,
      branches: ports.map((port) => ({
        port: port.id,
        edgeIds: edgesFrom(index, key, port.id).map((edge) => edge.id),
      })),
    });
  }
  return groups;
}
