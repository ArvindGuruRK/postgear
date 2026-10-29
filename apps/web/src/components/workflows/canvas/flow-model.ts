/**
 * The graph as React Flow draws it (Module 05). React Flow never owns the
 * workflow: these nodes and edges are derived from the reducer's graph on
 * every change, with a drag's live positions laid over them until the drag
 * ends (blueprint 4; builder-state.ts explains why).
 *
 * Also the card colours: each step family's stripe as a design token, so
 * the canvas and the minimap agree and every theme repaints them.
 */
import {
  type AutomationGraph,
  type ColourFamily,
  describeNode,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  isTriggerType,
  type NodeDefinition,
  type NoteColour,
  outputPortsOf,
  type PortSpec,
  type StickyNote,
  type SummaryContext,
  type ValidationIssue,
} from '@postgear/automation';
import type { Edge, Node } from '@xyflow/react';
import type { Position, Selection } from '../builder/builder-state';
import { CARD_HEIGHT, CARD_WIDTH } from '../builder/graph-ops';

/** Stripe colours by family. Social steps show the platform's logo on an ink stripe. */
export const FAMILY_STRIPE: Record<ColourFamily, string> = {
  yellow: 'bg-actionSecondary',
  ink: 'bg-ink',
  platform: 'bg-ink',
  violet: 'bg-actionAi',
  blue: 'bg-actionPrimary',
  green: 'bg-actionSuccess',
  orange: 'bg-actionAccent',
};

/** The same, as CSS colours for the minimap's SVG. */
export const FAMILY_FILL: Record<ColourFamily, string> = {
  yellow: 'var(--color-brutal-secondary)',
  ink: 'var(--color-ink)',
  platform: 'var(--color-ink)',
  violet: 'var(--color-brutal-ai)',
  blue: 'var(--color-forth)',
  green: 'var(--color-brutal-success)',
  orange: 'var(--color-brutal-accent)',
};

export const NOTE_FILL: Record<NoteColour, string> = {
  yellow: 'bg-actionSecondary',
  blue: 'bg-actionPrimary',
  green: 'bg-actionSuccess',
  pink: 'bg-actionDanger',
  violet: 'bg-actionAi',
};

/** Notes on a filled colour need the text that reads on it. */
export const NOTE_TEXT: Record<NoteColour, string> = {
  yellow: 'text-onActionLight',
  blue: 'text-onActionPrimary',
  green: 'text-onActionLight',
  pink: 'text-onActionLight',
  violet: 'text-onActionAi',
};

export const NOTE_COLOUR_NAMES: Record<NoteColour, string> = {
  yellow: 'Yellow',
  blue: 'Blue',
  green: 'Green',
  pink: 'Pink',
  violet: 'Violet',
};

/** Note ids get a prefix in React Flow, so a note can never share an id with a step. */
/** What a step dragged from the Steps panel carries: its picker item id. */
export const STEP_DRAG_TYPE = 'application/x-postgear-step';

export const NOTE_PREFIX = 'note:';

export interface StepNodeData extends Record<string, unknown> {
  node: GraphNode;
  def: NodeDefinition | undefined;
  summary: string;
  issues: ValidationIssue[];
  ports: PortSpec[];
  /** Output ports with at least one line, so the others show their "+". */
  usedPorts: string[];
  isTrigger: boolean;
}

export interface NoteNodeData extends Record<string, unknown> {
  note: StickyNote;
}

export interface FlowEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
  isError: boolean;
}

export type StepFlowNode = Node<StepNodeData, 'step'>;
export type NoteFlowNode = Node<NoteNodeData, 'note'>;
export type CanvasNode = StepFlowNode | NoteFlowNode;
export type FlowEdge = Edge<FlowEdgeData, 'flow'>;

/** A card grows when it has more outputs than fit its height (Paths). */
export function cardHeight(ports: number): number {
  return Math.max(CARD_HEIGHT, ports * 24 + 28);
}

export function issuesByStep(issues: readonly ValidationIssue[]): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (!issue.nodeKey) continue;
    const list = map.get(issue.nodeKey) ?? [];
    list.push(issue);
    map.set(issue.nodeKey, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  }
  return map;
}

export function toFlowNodes(
  graph: AutomationGraph,
  options: {
    selection: Selection;
    issues: Map<string, ValidationIssue[]>;
    summary: SummaryContext;
    drag: Record<string, Position> | null;
  },
): CanvasNode[] {
  const used = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const set = used.get(edge.source) ?? new Set<string>();
    set.add(edge.sourcePort);
    used.set(edge.source, set);
  }
  const selectedNodes = new Set(options.selection.nodes);
  const selectedNotes = new Set(options.selection.notes);

  const notes: NoteFlowNode[] = graph.notes.map((note) => {
    const id = `${NOTE_PREFIX}${note.id}`;
    return {
      id,
      type: 'note',
      position: options.drag?.[id] ?? note.position,
      data: { note },
      width: note.size.w,
      height: note.size.h,
      selected: selectedNotes.has(note.id),
      // Notes sit under the steps.
      zIndex: -1,
      dragHandle: '.pg-note-handle',
    };
  });

  const steps: StepFlowNode[] = graph.nodes.map((node) => {
    const ports = outputPortsOf(node);
    const data: StepNodeData = {
      node,
      def: getDefinition(node.type, node.typeVersion),
      summary: describeNode(node, options.summary),
      issues: options.issues.get(node.key) ?? [],
      ports,
      usedPorts: [...(used.get(node.key) ?? [])],
      isTrigger: isTriggerType(node.type),
    };
    return {
      id: node.key,
      type: 'step',
      position: options.drag?.[node.key] ?? node.position,
      data,
      // On React Flow's own wrapper (a focusable group), so it is what a screen reader hears.
      ariaLabel: stepAriaLabel(data),
      width: CARD_WIDTH,
      height: cardHeight(ports.length),
      selected: selectedNodes.has(node.key),
    };
  });

  return [...notes, ...steps];
}

export function toFlowEdges(graph: AutomationGraph, selection: Selection): FlowEdge[] {
  const selected = new Set(selection.edges);
  return graph.edges.map((edge) => ({
    id: edge.id,
    type: 'flow',
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
    selected: selected.has(edge.id),
    data: { edge, isError: edge.sourcePort === 'error' },
  }));
}

/** The plain-words label a screen reader hears for a card. */
export function stepAriaLabel(data: Pick<StepNodeData, 'node' | 'issues' | 'isTrigger'>): string {
  const kind = data.isTrigger ? 'trigger' : 'step';
  const off = data.node.disabled ? ', turned off' : '';
  const first = data.issues[0];
  const problem = first
    ? `, ${first.severity === 'error' ? 'needs attention' : 'warning'}: ${first.message}`
    : '';
  return `${data.node.name} ${kind}${off}${problem}`;
}
