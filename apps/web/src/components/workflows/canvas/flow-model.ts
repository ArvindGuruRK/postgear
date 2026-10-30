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
import type { RunModel, StepPaint } from '../runs/run-model';
import { stepBadgeText } from '../runs/run-words';

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
  /** Module 08: the step's state in the painted run (absent: not started, or no run). */
  paint?: StepPaint;
}

export interface NoteNodeData extends Record<string, unknown> {
  note: StickyNote;
}

/** How a painted run drew a line (blueprint 7.2). */
export type EdgeRunState = 'active' | 'taken' | 'skipped';

export interface FlowEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
  isError: boolean;
  /** Module 08: absent when no run is painted, or the run has not reached the line. */
  run?: EdgeRunState;
}

/** The line sets of a run model, all a canvas needs to draw its lines. */
export type EdgeRunSets = Pick<RunModel, 'edgesTaken' | 'edgesSkipped' | 'edgesActive'>;

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
    /** Module 08: the painted run's step states, by step key. */
    paint?: Record<string, StepPaint> | null;
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
    const paint = options.paint?.[node.key];
    if (paint) data.paint = paint;
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

/**
 * A line's state in a painted run. A line into a running step is also
 * taken (the run model puts it in both sets); it flows until that step ends.
 */
export function edgeRunState(
  run: EdgeRunSets | null | undefined,
  id: string,
): EdgeRunState | undefined {
  if (!run) return undefined;
  if (run.edgesActive.has(id)) return 'active';
  if (run.edgesTaken.has(id)) return 'taken';
  if (run.edgesSkipped.has(id)) return 'skipped';
  return undefined;
}

export function toFlowEdges(
  graph: AutomationGraph,
  selection: Selection,
  run?: EdgeRunSets | null,
): FlowEdge[] {
  const selected = new Set(selection.edges);
  return graph.edges.map((edge) => {
    const state = edgeRunState(run, edge.id);
    const data: FlowEdgeData = { edge, isError: edge.sourcePort === 'error' };
    if (state) data.run = state;
    return {
      id: edge.id,
      type: 'flow',
      source: edge.source,
      sourceHandle: edge.sourcePort,
      target: edge.target,
      targetHandle: edge.targetPort,
      selected: selected.has(edge.id),
      // React Flow's own `animated` class: the dashes that flow into a running step.
      animated: state === 'active',
      data,
    };
  });
}

/**
 * The plain-words label a screen reader hears for a card (blueprint 13):
 * "Slack step, Failed: the link was not accepted".
 */
export function stepAriaLabel(
  data: Pick<StepNodeData, 'node' | 'issues' | 'isTrigger' | 'paint'>,
): string {
  const kind = data.isTrigger ? 'trigger' : 'step';
  const off = data.node.disabled ? ', turned off' : '';
  if (data.paint) {
    const error = data.paint.error ? `: ${data.paint.error}` : '';
    return `${data.node.name} ${kind}${off}, ${stepBadgeText(data.paint)}${error}`;
  }
  const first = data.issues[0];
  const problem = first
    ? `, ${first.severity === 'error' ? 'needs attention' : 'warning'}: ${first.message}`
    : '';
  return `${data.node.name} ${kind}${off}${problem}`;
}
