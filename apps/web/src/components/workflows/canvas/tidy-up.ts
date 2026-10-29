/**
 * Tidy Up (Module 05): lays the steps out left to right with dagre, the
 * way n8n's Tidy Up does.
 *
 * - `rankdir LR`, `nodesep 40`, `ranksep 80`, every card its real size.
 * - **The trigger stays put**: the whole layout is shifted so the trigger
 *   lands where it was, so the view does not jump.
 * - **Branches keep their order**: the children of a step are added in the
 *   order of its outputs (True before False, Paths cases in their order,
 *   On Error last) and told to dagre as order constraints, so True sits
 *   above False.
 * - Sticky notes are not moved. Positions snap to the grid.
 *
 * Pure and deterministic: the same graph always gives the same positions.
 */

import { graphlib, layout, type OrderConstraint } from '@dagrejs/dagre';
import { type AutomationGraph, isTriggerType, outputPortsOf } from '@postgear/automation';
import type { Position } from '../builder/builder-state';
import { CARD_HEIGHT, CARD_WIDTH, snap } from '../builder/graph-ops';

export const TIDY_NODESEP = 40;
export const TIDY_RANKSEP = 80;

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
  for (const node of ordered) g.setNode(node.key, { width: CARD_WIDTH, height: CARD_HEIGHT });
  for (const edge of edges) g.setEdge(edge.source, edge.target, {}, edge.id);

  // Children of one step, in output order, stacked top to bottom.
  const constraints: OrderConstraint[] = [];
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const list = children.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    children.set(edge.source, list);
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
      y: (label?.y ?? 0) - CARD_HEIGHT / 2,
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
