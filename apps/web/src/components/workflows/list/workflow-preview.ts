/**
 * The steps a workflow's card and a template's preview show (Workflows
 * revamp, 2026-10-31). Pure, so it is unit tested; `workflow-flow.tsx` draws
 * what these return.
 *
 * The cards used to draw the canvas in miniature, a tile with an icon for each
 * step at its canvas position. Icons alone said little, so the cards now list
 * the steps by name in the order a person reads the canvas, one under the
 * other.
 */
import type { AutomationGraph } from '@postgear/automation';
import { getDefinition } from '@postgear/automation';
import type { AutomationPreview } from '@/types/workflows';

type PreviewStep = AutomationPreview['nodes'][number];

/** Steps the list's preview holds; a longer flow is cut here and the card says how many there are. */
const MAX_STEPS = 40;

/** A draft graph's preview, for the rows the page builds itself (templates, duplicate, activate, pause). */
export function previewFromGraph(graph: AutomationGraph): AutomationPreview {
  const nodes = graph.nodes.slice(0, MAX_STEPS).map((node) => ({
    key: node.key,
    type: node.type,
    name: node.name,
    x: node.position.x,
    y: node.position.y,
    ...(node.disabled ? { disabled: true } : {}),
  }));
  const shown = new Set(nodes.map((node) => node.key));
  return {
    nodes,
    edges: graph.edges
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target })),
    stepCount: graph.nodes.length,
  };
}

/** Left to right, then top to bottom: the order the canvas is read in. */
export function orderSteps(nodes: readonly PreviewStep[]): PreviewStep[] {
  return [...nodes].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** What a step is called on a card: its own name, else its kind's title. */
export function stepLabel(step: Pick<PreviewStep, 'name' | 'type'>): string {
  return step.name.trim() || getDefinition(step.type)?.title || step.type;
}
