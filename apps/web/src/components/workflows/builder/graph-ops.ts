/**
 * Pure edits of a workflow graph, shared by the reducer, the clipboard and
 * Tidy Up. Every function returns a new graph and never mutates its input.
 */
import {
  type AutomationGraph,
  canConnect,
  edgeId,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  isTriggerType,
  nodeTitle,
  outputPortsOf,
  type PortId,
  uniqueNodeName,
} from '@postgear/automation';

/** The step card's size on the canvas. */
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 76;
/**
 * How far right a step is placed after the one it follows: the card plus an
 * 80px run for the line, its arrowhead, a port sticker and the "+" stem
 * (2026-10-31, it was 280, a 40px gap that crammed all four together).
 */
export const STEP_GAP_X = 320;
export const STEP_GAP_Y = 160;
/** The canvas grid; positions snap to it. */
export const GRID = 12;

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Equal as JSON: what autosave would send. Key order counts, which is fine for one config. */
export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

const BLOCKED_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A copy of `config` with `value` at the dotted `path` (`cases.0.name`);
 * the config itself is never changed. Numeric parts index lists, missing
 * parts are created (a list when the next part is a number), and
 * `undefined` removes the key, so an optional field cleared is left out.
 * '' replaces the whole config (an object, else an empty one).
 */
export function setConfigPath(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  if (path === '') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
  const parts = path.split('.');
  if (parts.some((part) => part === '' || BLOCKED_PARTS.has(part))) return config;

  const write = (container: unknown, index: number): unknown => {
    const part = parts[index];
    const last = index === parts.length - 1;
    const numeric = /^\d+$/.test(part);
    if (Array.isArray(container) && numeric) {
      const copy = [...container];
      const at = Number(part);
      if (last) {
        if (value === undefined) copy.splice(at, 1);
        else copy[at] = value;
      } else copy[at] = write(copy[at], index + 1);
      return copy;
    }
    const base =
      typeof container === 'object' && container !== null && !Array.isArray(container)
        ? { ...(container as Record<string, unknown>) }
        : {};
    const record = base as Record<string, unknown>;
    if (last) {
      if (value === undefined) delete record[part];
      else record[part] = value;
    } else {
      const next = record[part];
      const fresh = next ?? (/^\d+$/.test(parts[index + 1]) ? [] : {});
      record[part] = write(fresh, index + 1);
    }
    return record;
  };
  return write(config, 0) as Record<string, unknown>;
}

/**
 * The config a step starts with when it is added from the picker: steps
 * whose settings hold an IANA `timeZone` (the Schedule trigger, Add To
 * Queue) take the browser's zone instead of the catalog's UTC, as templates
 * do (`instantiateTemplate`). A zone the picker item already set wins.
 */
export function startingConfig(
  type: string,
  config: Record<string, unknown> | undefined,
  browserZone: string,
): Record<string, unknown> | undefined {
  const def = getDefinition(type);
  const defaults = def?.defaultConfig as Record<string, unknown> | undefined;
  if (!defaults || !Object.hasOwn(defaults, 'timeZone') || !browserZone) return config;
  if (config && Object.hasOwn(config, 'timeZone')) return config;
  return { ...(config ?? {}), timeZone: browserZone };
}

/** A fresh step of `type`, with its default settings and a name not taken yet. */
export function createStep(
  graph: AutomationGraph,
  type: string,
  key: string,
  position: { x: number; y: number },
  config?: Record<string, unknown>,
): GraphNode | null {
  const def = getDefinition(type);
  if (!def) return null;
  const merged = { ...clone(def.defaultConfig as Record<string, unknown>), ...(config ?? {}) };
  return {
    key,
    type: def.type,
    typeVersion: def.typeVersion,
    name: uniqueNodeName(nodeTitle(def.type, merged), graph),
    position: { x: snap(position.x), y: snap(position.y) },
    config: merged,
  };
}

export function triggerOf(graph: AutomationGraph): GraphNode | undefined {
  return graph.nodes.find((node) => isTriggerType(node.type));
}

/** Steps with no line leaving them: where "add after" goes when nothing is selected. */
export function leaves(graph: AutomationGraph): GraphNode[] {
  const sources = new Set(graph.edges.map((edge) => edge.source));
  return graph.nodes.filter((node) => !sources.has(node.key));
}

function overlaps(graph: AutomationGraph, x: number, y: number, except?: string): boolean {
  return graph.nodes.some(
    (node) =>
      node.key !== except &&
      Math.abs(node.position.x - x) < CARD_WIDTH &&
      Math.abs(node.position.y - y) < CARD_HEIGHT + 24,
  );
}

/**
 * Where a step added after `afterKey` goes: one column to the right, moved
 * down a row at a time until it overlaps nothing. With no `afterKey`, after
 * the last leaf, or the middle of an empty canvas.
 */
export function placeAfter(graph: AutomationGraph, afterKey?: string): { x: number; y: number } {
  const anchor =
    (afterKey && graph.nodes.find((node) => node.key === afterKey)) ||
    leaves(graph).at(-1) ||
    graph.nodes.at(-1);
  if (!anchor) return { x: 0, y: 0 };
  const x = snap(anchor.position.x + STEP_GAP_X);
  let y = snap(anchor.position.y);
  for (let tries = 0; tries < 50 && overlaps(graph, x, y); tries += 1) y = snap(y + STEP_GAP_Y);
  return { x, y };
}

export function makeEdge(source: string, sourcePort: PortId, target: string): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

/** Adds a line when `canConnect` allows it; otherwise the graph as it was. */
export function connectSteps(
  graph: AutomationGraph,
  source: string,
  sourcePort: PortId,
  target: string,
): AutomationGraph {
  if (!canConnect(graph, { source, sourcePort, target }).ok) return graph;
  return { ...graph, edges: [...graph.edges, makeEdge(source, sourcePort, target)] };
}

/** The first output a step has (`out` for most), where an inserted step continues the line. */
export function firstOutput(node: GraphNode): PortId | null {
  return outputPortsOf(node)[0]?.id ?? null;
}

/** Removes steps (and every line touching them) and notes. */
export function removeItems(
  graph: AutomationGraph,
  nodeKeys: readonly string[],
  edgeIds: readonly string[],
  noteIds: readonly string[],
): AutomationGraph {
  const nodes = new Set(nodeKeys);
  const edges = new Set(edgeIds);
  const notes = new Set(noteIds);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !nodes.has(node.key)),
    edges: graph.edges.filter(
      (edge) => !edges.has(edge.id) && !nodes.has(edge.source) && !nodes.has(edge.target),
    ),
    notes: graph.notes.filter((note) => !notes.has(note.id)),
  };
}

export function updateNode(
  graph: AutomationGraph,
  key: string,
  change: (node: GraphNode) => GraphNode,
): AutomationGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.key !== key) return node;
    changed = true;
    return change(node);
  });
  return changed ? { ...graph, nodes } : graph;
}

/**
 * Drops lines a step's outputs no longer have (a Paths case removed, On
 * Error switched off the error path), so a settings change never leaves a
 * line hanging from nothing.
 */
export function pruneDanglingEdges(graph: AutomationGraph): AutomationGraph {
  const ports = new Map(
    graph.nodes.map((node) => [node.key, new Set(outputPortsOf(node).map((port) => port.id))]),
  );
  const edges = graph.edges.filter((edge) => ports.get(edge.source)?.has(edge.sourcePort));
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}
