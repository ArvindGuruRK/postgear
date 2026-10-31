'use client';

/**
 * A read-only canvas (Module 08): a run's graph painted with its run model
 * in the Runs tab, or a version's graph unpainted in the Versions preview.
 * Self-contained (its own React Flow provider, no builder context): nothing
 * on it can be moved, connected, deleted or edited.
 *
 * It draws the editor's own cards, lines and notes from the same
 * `flow-model` conversion, so a run looks exactly like the workflow did.
 * The builder is hidden from it on purpose (a `null` provider): rendered
 * inside the builder page, a card here must never reach the draft.
 *
 * Pan by dragging or scrolling, zoom with a pinch, Ctrl and the wheel, or the
 * controls; it fits the graph on mount and again when the graph changes.
 * Clicking a card (or its result badge) calls `onSelectStep`; `selectedKey`
 * gets the selection ring.
 */
import { ScanIcon } from '@animateicons/react/lucide/scan-icon';
import { ZoomInIcon } from '@animateicons/react/lucide/zoom-in-icon';
import { ZoomOutIcon } from '@animateicons/react/lucide/zoom-out-icon';
import type { AutomationGraph, SummaryContext, ValidationIssue } from '@postgear/automation';
import { Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { type ComponentProps, useEffect, useMemo, useRef } from 'react';
import type { WorkspaceCatalog } from '@/types/workflows';
import { BuilderProvider } from '../builder/builder-context';
import type { Selection } from '../builder/builder-state';
import type { RunModel } from '../runs/run-model';
import { type CanvasMode, CanvasModeProvider, useMarkerId } from './canvas-mode';
import {
  type CanvasNode,
  type FlowEdge,
  RUN_ARIA_LABELS,
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
const FIT = { padding: 0.2, maxZoom: 1 };
const NO_ISSUES = new Map<string, ValidationIssue[]>();
// No connection or channel names here: summaries fall back to their plain words.
const NO_SUMMARY: SummaryContext = {};

export interface RunCanvasProps {
  graph: AutomationGraph;
  /** Paints the run; null shows the graph unpainted (a version preview). */
  run: RunModel | null;
  catalog: WorkspaceCatalog | null;
  selectedKey?: string | null;
  onSelectStep?: (nodeKey: string) => void;
  className?: string;
}

export function RunCanvas(props: RunCanvasProps) {
  return (
    <BuilderProvider value={null}>
      <ReactFlowProvider>
        <ReadOnlyFlow {...props} />
      </ReactFlowProvider>
    </BuilderProvider>
  );
}

type AnimatedIcon = ComponentProps<typeof MotionIcon>['icon'];

function ZoomButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: AnimatedIcon;
  onClick: () => void;
}) {
  return (
    <TooltipHint label={label}>
      <Button
        variant="secondary"
        size="sm"
        className="h-9 w-9 px-0"
        aria-label={label}
        onClick={onClick}
      >
        <MotionIcon icon={icon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

function ReadOnlyFlow({ graph, run, selectedKey, onSelectStep, className }: RunCanvasProps) {
  const flow = useReactFlow<CanvasNode, FlowEdge>();
  const appearance = useBodyAppearance();
  const markerId = useMarkerId();
  const mode = useMemo<CanvasMode>(
    () => ({ readOnly: true, markerId, onRunBadgeClick: onSelectStep }),
    [markerId, onSelectStep],
  );

  const selection = useMemo<Selection>(
    () => ({ nodes: selectedKey ? [selectedKey] : [], edges: [], notes: [] }),
    [selectedKey],
  );
  const paint = run?.paint ?? null;
  const nodes = useMemo(
    () =>
      toFlowNodes(graph, {
        selection,
        issues: NO_ISSUES,
        summary: NO_SUMMARY,
        drag: null,
        paint,
      }),
    [graph, selection, paint],
  );
  const edges = useMemo(() => toFlowEdges(graph, selection, run), [graph, selection, run]);

  // `fitView` on ReactFlow covers the first graph; another run's graph refits.
  const shown = useRef(graph);
  useEffect(() => {
    if (shown.current === graph) return;
    shown.current = graph;
    void flow.fitView(FIT);
  }, [graph, flow]);

  return (
    <CanvasModeProvider value={mode}>
      <div
        data-testid="run-canvas"
        className={cn('pg-canvas relative h-full min-h-64 w-full bg-primary', className)}
      >
        <EdgeMarkers id={markerId} />
        <ReactFlow<CanvasNode, FlowEdge>
          colorMode={appearance.scheme}
          data-light-theme={appearance.lightTheme}
          data-dark-theme={appearance.darkTheme}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={(_event, node) => {
            if (node.type === 'step') onSelectStep?.(node.id);
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          ariaLabelConfig={RUN_ARIA_LABELS}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          panOnDrag
          panOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          fitViewOptions={FIT}
          attributionPosition="top-right"
          aria-label={run ? 'Run canvas' : 'Version canvas'}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="var(--color-outline)"
            className="opacity-40"
          />
          <Panel position="bottom-left" className="m-3!">
            <div
              role="toolbar"
              aria-label="Canvas controls"
              className="flex items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm"
            >
              <ZoomButton
                label="Zoom Out"
                icon={ZoomOutIcon}
                onClick={() => void flow.zoomOut({ duration: 200 })}
              />
              <ZoomButton
                label="Zoom In"
                icon={ZoomInIcon}
                onClick={() => void flow.zoomIn({ duration: 200 })}
              />
              <ZoomButton
                label="Fit To Screen"
                icon={ScanIcon}
                onClick={() => void flow.fitView({ ...FIT, duration: 200 })}
              />
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </CanvasModeProvider>
  );
}
