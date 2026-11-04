/**
 * Tidy Up (Module 05): lays the steps out left to right with dagre, the
 * way n8n's Tidy Up does.
 *
 * - `rankdir LR`, every card its real size.
 * - **The trigger stays put**: the whole layout is shifted so the trigger
 *   lands where it was, so the view does not jump.
 * - **Branches keep their order**: the children of a step are added in the
 *   order of its outputs (True before False, Paths cases in their order,
 *   On Error last) and told to dagre as order constraints, so True sits
 *   above False. An output with nothing after it keeps its row (a stand-in
 *   node, never returned), so Approved stays above Rejected's empty row.
 * - Sticky notes are not moved. Positions snap to the grid.
 *
 * Pure and deterministic: the same graph always gives the same positions.
 */

import { graphlib, layout, type OrderConstraint } from '@dagrejs/dagre';
import { type AutomationGraph, isTriggerType, outputPortsOf } from '@postgear/automation';
import type { Position } from '../builder/builder-state';
import { CARD_HEIGHT, CARD_WIDTH, cardHeight, snap } from '../builder/graph-ops';

export const TIDY_NODESEP = 72;
export const TIDY_RANKSEP = 160;

/** New top-left positions for every step, keyed by step key. */
export function tidyPositions(graph: AutomationGraph): Record<string, Position> {
  if (graph.nodes.length === 0) return {};

  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const portOrder = (key: string, port: string): number => {
    const node = byKey.get(key);
    const index = node ? outputPortsOf(node).findIndex((spec) => spec.id === port) : -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const edges = graph.edges
    .filter((edge) => byKey.has(edge.source) && byKey.has(edge.target))
    .slice()
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        portOrder(a.source, a.sourcePort) - portOrder(b.source, b.sourcePort) ||
        (byKey.get(a.target)?.position.y ?? 0) - (byKey.get(b.target)?.position.y ?? 0) ||
        a.target.localeCompare(b.target),
    );

  const g = new graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: TIDY_NODESEP, ranksep: TIDY_RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  // The trigger first, then the rest in their saved order, so ties break the same way every time.
  const ordered = [
    ...graph.nodes.filter((node) => isTriggerType(node.type)),
    ...graph.nodes.filter((node) => !isTriggerType(node.type)),
  ];
  const heightOf = (key: string): number => {
    const node = byKey.get(key);
    return node ? cardHeight(outputPortsOf(node).length) : CARD_HEIGHT;
  };
  for (const node of ordered) g.setNode(node.key, { width: CARD_WIDTH, height: heightOf(node.key) });
  for (const edge of edges) g.setEdge(edge.source, edge.target, {}, edge.id);

  // Children of one step, in output order, stacked top to bottom.
  const constraints: OrderConstraint[] = [];
  const children = new Map<string, string[]>();
  for (const node of ordered) {
    const ports = outputPortsOf(node);
    const list: string[] = [];
    for (const port of ports) {
      const targets = edges
        .filter((edge) => edge.source === node.key && edge.sourcePort === port.id)
        .map((edge) => edge.target);
      for (const target of targets) if (!list.includes(target)) list.push(target);
      // An empty branch (Rejected with nothing after it) still holds its row, through a
      // stand-in that dagre lays out and we never return. So Approved stays up where it was
      // placed instead of sliding down beside its parent. On Error is not held: most steps
      // have it off the path, and it should not push the main flow up.
      if (targets.length === 0 && ports.length > 1 && port.id !== 'error') {
        const slot = `slot:${node.key}:${port.id}`;
        g.setNode(slot, { width: CARD_WIDTH, height: CARD_HEIGHT });
        g.setEdge(node.key, slot, {}, slot);
        list.push(slot);
      }
    }
    if (list.length > 0) children.set(node.key, list);
  }
  const placed = new Set<string>();
  for (const list of children.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const pair = `${list[i - 1]}>${list[i]}`;
      if (placed.has(pair)) continue;
      placed.add(pair);
      constraints.push({ left: list[i - 1], right: list[i] });
    }
  }

  layout(g, { constraints });

  const raw = new Map<string, Position>();
  for (const node of ordered) {
    const label = g.node(node.key);
    raw.set(node.key, {
      x: (label?.x ?? 0) - CARD_WIDTH / 2,
      y: (label?.y ?? 0) - heightOf(node.key) / 2,
    });
  }

  const anchor = ordered[0];
  const from = raw.get(anchor.key) ?? { x: 0, y: 0 };
  const dx = anchor.position.x - from.x;
  const dy = anchor.position.y - from.y;

  const positions: Record<string, Position> = {};
  for (const [key, position] of raw) {
    positions[key] = { x: snap(position.x + dx), y: snap(position.y + dy) };
  }
  return positions;
}
