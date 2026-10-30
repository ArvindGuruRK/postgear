'use client';

import type { AutomationGraph, SummaryContext, ValidationIssue } from '@postgear/automation';
/**
 * The workflow canvas (Module 05, blueprint 4): React Flow drawing the
 * reducer's graph.
 *
 * - **One source of truth.** Nodes and edges are derived from the graph on
 *   every change. A drag lives here only while it lasts (`drag`), then
 *   reaches the reducer as one `moveNodes`, which snaps it to the 12 px
 *   grid; a note's resize works the same way.
 * - **Connecting** asks `canConnect` from `@postgear/automation` on every
 *   move. A line dropped on a step it may not join says why ("Workflows
 *   cannot loop back to an earlier step."); dropped on empty canvas, it opens
 *   the picker there and the chosen step is joined to it.
 * - Deleting goes through the reducer too (`deleteKeyCode` is off), so
 *   every delete can be undone.
 * - Steps dragged from the picker drop where they land.
 * - Module 08: a run (`run`) paints the cards and lines while a test plays
 *   or after it ends; its result badges call `onRunBadgeClick`.
 */
import { CONNECT_REASONS, canConnect, type PortId } from '@postgear/automation';
import {
  Background,
  BackgroundVariant,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  MiniMap,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  useReactFlow,
} from '@xyflow/react';
import { type DragEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useBuilder } from '../builder/builder-context';
import type { Position, Selection } from '../builder/builder-state';
import type { RunModel } from '../runs/run-model';
import { type CanvasMode, CanvasModeProvider, useMarkerId } from './canvas-mode';
import {
  type CanvasNode,
  FAMILY_FILL,
  type FlowEdge,
  NOTE_PREFIX,
  STEP_DRAG_TYPE,
  toFlowEdges,
  toFlowNodes,
} from './flow-model';
import { StepCard } from './step-card';
import { EdgeMarkers, StepEdge } from './step-edge';
import { StickyNoteCard } from './sticky-note';
import { useBodyAppearance } from './use-body-appearance';
import './workflow-canvas.css';

const NODE_TYPES = { step: StepCard, note: StickyNoteCard };
const EDGE_TYPES = { flow: StepEdge };
const SNAP: [number, number] = [12, 12];
const PAN_BUTTONS = [1, 2];
const MULTI_SELECT = ['Shift', 'Meta', 'Control'];
const FIT = { padding: 0.25, maxZoom: 1 };

function splitIds(ids: string[]): { nodes: string[]; notes: string[] } {
  const nodes: string[] = [];
  const notes: string[] = [];
  for (const id of ids) {
    if (id.startsWith(NOTE_PREFIX)) notes.push(id.slice(NOTE_PREFIX.length));
    else nodes.push(id);
  }
  return { nodes, notes };
}

export interface WorkflowCanvasProps {
  graph: AutomationGraph;
  selection: Selection;
  issues: Map<string, ValidationIssue[]>;
  summary: SummaryContext;
  tidying: boolean;
  onConnectRefused: (reason: string) => void;
  /** A step dragged in from the picker, at its flow position. */
  onDropStep: (itemId: string, at: Position) => void;
  onPaneClick: () => void;
  onInit?: (instance: ReactFlowInstance<CanvasNode, FlowEdge>) => void;
  /** Shown over an empty canvas (Add A Trigger). */
  empty?: ReactNode;
  children?: ReactNode;
  /** Module 08: the test run painted on the cards and lines (null clears the paint). */
  run?: RunModel | null;
  /** Module 08: a step's result badge was clicked (opens the Expanded view on that run). */
  onRunBadgeClick?: (nodeKey: string) => void;
}

export function WorkflowCanvas({
  graph,
  selection,
  issues,
  summary,
  tidying,
  onConnectRefused,
  onDropStep,
  onPaneClick,
  onInit,
  empty,
  children,
  run = null,
  onRunBadgeClick,
}: WorkflowCanvasProps) {
  const builder = useBuilder();
  const markerId = useMarkerId();
  const mode = useMemo<CanvasMode>(
    () => ({ readOnly: false, markerId, onRunBadgeClick }),
    [markerId, onRunBadgeClick],
  );
  const paint = run?.paint ?? null;
  const flow = useReactFlow<CanvasNode, FlowEdge>();
  const appearance = useBodyAppearance();
  const [drag, setDrag] = useState<Record<string, Position> | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }> | null>(null);

  const derived = useMemo(
    () => toFlowNodes(graph, { selection, issues, summary, drag, paint }),
    [graph, selection, issues, summary, drag, paint],
  );
  const nodes = useMemo(
    () =>
      sizes
        ? derived.map((node) =>
            sizes[node.id] ? { ...node, width: sizes[node.id].w, height: sizes[node.id].h } : node,
          )
        : derived,
    [derived, sizes],
  );
  const edges = useMemo(() => toFlowEdges(graph, selection, run), [graph, selection, run]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const select: Record<string, boolean> = {};
      let selects = false;
      let moved: Record<string, Position> | null = null;
      let resized: Record<string, { w: number; h: number }> | null = null;
      let resizeDone = false;
      for (const change of changes) {
        if (change.type === 'select') {
          select[change.id] = change.selected;
          selects = true;
        } else if (change.type === 'position' && change.position && change.dragging) {
          moved = { ...(moved ?? {}), [change.id]: change.position };
        } else if (
          change.type === 'dimensions' &&
          change.dimensions &&
          change.id.startsWith(NOTE_PREFIX)
        ) {
          if (change.resizing) {
            resized = {
              ...(resized ?? {}),
              [change.id]: { w: change.dimensions.width, h: change.dimensions.height },
            };
          } else if (change.resizing === false) {
            resizeDone = true;
          }
        }
      }
      if (selects) {
        const ids = Object.keys(select);
        const { nodes: keys, notes } = splitIds(ids);
        builder.dispatch({
          type: 'selectChanges',
          nodes: Object.fromEntries(keys.map((key) => [key, select[key]])),
          notes: Object.fromEntries(notes.map((id) => [id, select[`${NOTE_PREFIX}${id}`]])),
        });
      }
      if (moved) {
        const next = moved;
        setDrag((current) => ({ ...(current ?? {}), ...next }));
      }
      if (resized) {
        const next = resized;
        setSizes((current) => ({ ...(current ?? {}), ...next }));
      }
      if (resizeDone) {
        setSizes(null);
        setDrag(null);
      }
    },
    [builder.dispatch],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      const select: Record<string, boolean> = {};
      let any = false;
      for (const change of changes) {
        if (change.type === 'select') {
          select[change.id] = change.selected;
          any = true;
        }
      }
      if (any) builder.dispatch({ type: 'selectChanges', edges: select });
    },
    [builder.dispatch],
  );

  const finishDrag = useCallback(
    (_event: unknown, dragged: CanvasNode[]) => {
      const steps: Record<string, Position> = {};
      const notes: Record<string, Position> = {};
      for (const node of dragged) {
        if (node.id.startsWith(NOTE_PREFIX))
          notes[node.id.slice(NOTE_PREFIX.length)] = node.position;
        else steps[node.id] = node.position;
      }
      builder.dispatch({ type: 'moveNodes', nodes: steps, notes });
      setDrag(null);
    },
    [builder.dispatch],
  );

  const isValidConnection = useCallback(
    (connection: Connection | FlowEdge) => {
      if ((connection.targetHandle ?? 'in') !== 'in') return false;
      return canConnect(builder.graphRef.current, {
        source: connection.source,
        sourcePort: (connection.sourceHandle ?? 'out') as PortId,
        target: connection.target,
      }).ok;
    },
    [builder.graphRef],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      builder.dispatch({
        type: 'connect',
        source: connection.source,
        sourcePort: (connection.sourceHandle ?? 'out') as PortId,
        target: connection.target,
      });
    },
    [builder.dispatch],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!state.fromNode || !state.fromHandle || state.fromHandle.type !== 'source') return;
      const sourcePort = (state.fromHandle.id ?? 'out') as PortId;
      if (state.toNode) {
        if (state.isValid) return;
        const check = canConnect(builder.graphRef.current, {
          source: state.fromNode.id,
          sourcePort,
          target: state.toNode.id,
        });
        // Dropping a line back on the step it came from is just letting go.
        if (!check.ok && check.reason !== CONNECT_REASONS.self) onConnectRefused(check.reason);
        return;
      }
      const target = event.target as Element | null;
      if (!target?.classList.contains('react-flow__pane')) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const screen = { x: point.clientX, y: point.clientY };
      builder.pickFrom(
        { source: state.fromNode.id, sourcePort },
        screen,
        flow.screenToFlowPosition(screen),
      );
    },
    [builder, flow, onConnectRefused],
  );

  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer.types.includes(STEP_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent) {
    const itemId = event.dataTransfer.getData(STEP_DRAG_TYPE);
    if (!itemId) return;
    event.preventDefault();
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onDropStep(itemId, { x: at.x - 120, y: at.y - 38 });
  }

  return (
    <CanvasModeProvider value={mode}>
      <div className={`pg-canvas relative h-full w-full bg-primary${tidying ? ' pg-tidying' : ''}`}>
        <EdgeMarkers id={markerId} />
        <ReactFlow<CanvasNode, FlowEdge>
          colorMode={appearance.scheme}
          data-light-theme={appearance.lightTheme}
          data-dark-theme={appearance.darkTheme}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={(event, _node, dragged) => finishDrag(event, dragged)}
          onSelectionDragStop={finishDrag}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onPaneClick={onPaneClick}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            builder.contextMenu(
              {
                kind: 'canvas',
                flowAt: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          onInit={onInit}
          snapToGrid
          snapGrid={SNAP}
          selectionOnDrag
          panOnDrag={PAN_BUTTONS}
          panOnScroll
          zoomOnPinch
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          fitViewOptions={FIT}
          deleteKeyCode={null}
          multiSelectionKeyCode={MULTI_SELECT}
          nodesDraggable={!builder.locked}
          nodesConnectable={!builder.locked}
          attributionPosition="top-right"
          aria-label="Workflow canvas"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="var(--color-outline)"
            className="opacity-40"
          />
          {graph.nodes.length > 0 ? (
            <MiniMap<CanvasNode>
              pannable
              zoomable
              position="bottom-right"
              className="max-md:hidden"
              bgColor="var(--color-secondary)"
              maskColor="color-mix(in srgb, var(--color-ink) 10%, transparent)"
              nodeColor={(node) =>
                node.type === 'step'
                  ? FAMILY_FILL[node.data.def?.family ?? 'ink']
                  : 'var(--color-brutal-secondary)'
              }
              nodeStrokeColor="var(--color-outline)"
              nodeStrokeWidth={2}
              ariaLabel="Minimap"
            />
          ) : null}
          {children}
        </ReactFlow>
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto">{empty}</div>
          </div>
        ) : null}
      </div>
    </CanvasModeProvider>
  );
}
