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
import type { Position } from './builder-state';

/** The step card's size on the canvas: one size for every step, the trigger included. */
export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 120;
/**
 * How far right a step is placed after the one it follows: the card plus a
 * 160px run for the line, its arrowhead, a port sticker and the "+" stem
 * (the same gap Tidy Up leaves, `TIDY_RANKSEP`; 480 sits on the 12px grid).
 */
export const STEP_GAP_X = CARD_WIDTH + 160;
/** One row down: a card's height plus Tidy Up's 72px between rows (`TIDY_NODESEP`; 192 is on the grid). */
export const STEP_GAP_Y = CARD_HEIGHT + 72;
/** How far apart a card's outputs sit, so their stickers never touch. */
export const PORT_PITCH = 40;
/** The canvas grid; positions snap to it. */
export const GRID = 12;

/** Two outputs fit the one card size; a card grows only for three or more (Paths). */
/**
 * How far a named port's line runs straight before it may bend, so it leaves from behind its
 * sticker level and never slants out of it. Stem 12 + dot 8, the sticker (at most 96, and
 * never measured short: bold text-xs is under 7 px a letter) and 8 clear of it.
 */
export function portLead(label: string): number {
  return 20 + Math.min(96, 20 + label.length * 7) + 8;
}

export function cardHeight(ports: number): number {
  return Math.max(CARD_HEIGHT, ports * PORT_PITCH + PORT_PITCH);
}

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
 * Where a new note goes: centred on the view, or if steps or notes are there,
 * moved up in its own height until it is clear. A note behind a card is hard to
 * read and hard to grab.
 */
export function placeNote(
  graph: AutomationGraph,
  centre: Position,
  size: { w: number; h: number },
): Position {
  const x = Math.round(centre.x - size.w / 2);
  let y = Math.round(centre.y - size.h / 2);
  const hits = (top: number) =>
    graph.nodes.some(
      (node) =>
        node.position.x < x + size.w &&
        node.position.x + CARD_WIDTH > x &&
        // 32 for the tab above the card.
        node.position.y - 32 < top + size.h &&
        node.position.y + CARD_HEIGHT > top,
    ) ||
    graph.notes.some(
      (note) =>
        note.position.x < x + size.w &&
        note.position.x + note.size.w > x &&
        note.position.y < top + size.h &&
        note.position.y + note.size.h > top,
    );
  for (let tries = 0; tries < 50 && hits(y); tries += 1) y -= size.h + 24;
  return { x, y };
}

/**
 * Where a step added after `afterKey` goes: one column to the right, moved
 * down a row at a time until it overlaps nothing. With no `afterKey`, after
 * the last leaf, or the middle of an empty canvas.
 *
 * A step with several outputs (Approved and Rejected, True and False, a
 * Paths case list, On Error) fans its branches out around its own row in the
 * order of its ports: the first output lands highest, the last lowest, so the
 * line from each port runs to its own row and never crosses another's.
 */
export function placeAfter(
  graph: AutomationGraph,
  afterKey?: string,
  afterPort?: string,
): { x: number; y: number } {
  const anchor =
    (afterKey && graph.nodes.find((node) => node.key === afterKey)) ||
    leaves(graph).at(-1) ||
    graph.nodes.at(-1);
  if (!anchor) return { x: 0, y: 0 };
  const x = snap(anchor.position.x + STEP_GAP_X);
  let branch = 0;
  if (afterKey && afterPort && anchor.key === afterKey) {
    const ports = outputPortsOf(anchor);
    const index = ports.findIndex((port) => port.id === afterPort);
    if (ports.length > 1 && index !== -1) branch = (index - (ports.length - 1) / 2) * STEP_GAP_Y;
  }
  let y = snap(anchor.position.y + branch);
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
