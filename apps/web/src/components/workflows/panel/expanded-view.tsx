'use client';

/**
 * The Expanded view (blueprint 5.2, n8n's node detail view): a near
 * full-screen dialog with three resizable columns, **Input** (the data
 * this step can use), **Settings** (the same tabs as the docked panel) and
 * **Output** (its result; pinned data until Module 08 runs steps).
 *
 * Opens from Expand in the panel header, a double-click on a card, or
 * Enter on a card whose panel is open. The header's arrows walk to the
 * previous and next step in run order without closing.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  type AutomationGraph,
  type GraphNode,
  getDefinition,
  type ValidationIssue,
} from '@postgear/automation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  MotionIcon,
  TooltipHint,
} from '@postgear/ui';
import { type CSSProperties, type Dispatch, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../app-icon';
import type { BuilderAction } from '../builder/builder-state';
import type { FieldContext } from '../fields/contract';
import { InputPane } from './input-pane';
import { OutputPane, type PinControls } from './output-pane';
import { keepKeysInPanel } from './panel-keys';
import { neighbours } from './panel-view-model';
import { ResizeHandle } from './resize-handle';
import { StepNameField } from './step-panel';
import { StepTabs } from './step-tabs';

/** Column widths in percent: Input, Settings, Output. */
const DEFAULT_COLUMNS: [number, number, number] = [30, 40, 30];
const SIDE_MIN = 20;
const MIDDLE_MIN = 25;

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.offsetWidth || 1200);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 1200));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, width];
}

export interface ExpandedViewProps {
  node: GraphNode | undefined;
  graph: AutomationGraph;
  issues: readonly ValidationIssue[];
  context: FieldContext;
  dispatch: Dispatch<BuilderAction>;
  pin: PinControls;
  onClose: () => void;
  /** Walks to another step (the arrows). */
  onNavigate: (key: string) => void;
}

export function ExpandedView({
  node,
  graph,
  issues,
  context,
  dispatch,
  pin,
  onClose,
  onNavigate,
}: ExpandedViewProps) {
  return (
    <Dialog open={node !== undefined} onOpenChange={(open) => !open && onClose()}>
      {node ? (
        <ExpandedBody
          node={node}
          graph={graph}
          issues={issues}
          context={context}
          dispatch={dispatch}
          pin={pin}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      ) : null}
    </Dialog>
  );
}

function ExpandedBody({
  node,
  graph,
  issues,
  context,
  dispatch,
  pin,
  onClose,
  onNavigate,
}: Omit<ExpandedViewProps, 'node'> & { node: GraphNode }) {
  const def = getDefinition(node.type, node.typeVersion);
  const { previous, next } = neighbours(graph, node.key);
  const previousName = previous ? graph.nodes.find((n) => n.key === previous)?.name : undefined;
  const nextName = next ? graph.nodes.find((n) => n.key === next)?.name : undefined;
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [box, width] = useWidth();
  const percentPerPixel = 100 / Math.max(width, 1);
  const [left, , right] = columns;
  const column = (value: number) => ({ '--col': `${value}%` }) as CSSProperties;

  return (
    <DialogContent
      hideClose
      onKeyDown={keepKeysInPanel}
      // Radix would focus and select the step name, where one stray key renames
      // the step; start on the settings tabs instead.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.target as HTMLElement | null)
          ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
          ?.focus();
      }}
      data-testid="expanded-view"
      className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
    >
      <div className="flex items-center gap-3 border-b-2 border-outline p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <AppIcon icon={def?.icon ?? 'manual'} className="h-5 w-5" />
        </span>
        <DialogTitle className="sr-only">{node.name}</DialogTitle>
        <DialogDescription className="sr-only">
          The data this step gets, its settings, and its result.
        </DialogDescription>
        <StepNameField
          key={node.key}
          node={node}
          dispatch={dispatch}
          className="w-full max-w-xs min-w-0"
        />
        <div className="ms-auto flex items-center gap-2">
          <TooltipHint
            label={previousName ? `Previous Step: ${previousName}` : 'Previous Step'}
            disabled={!previous}
          >
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-9 px-0"
              aria-label="Previous step"
              disabled={!previous}
              onClick={() => previous && onNavigate(previous)}
              data-testid="expanded-previous"
            >
              <MotionIcon icon={ChevronLeftIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <TooltipHint label={nextName ? `Next Step: ${nextName}` : 'Next Step'} disabled={!next}>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-9 px-0"
              aria-label="Next step"
              disabled={!next}
              onClick={() => next && onNavigate(next)}
              data-testid="expanded-next"
            >
              <MotionIcon icon={ChevronRightIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 w-9 px-0"
            aria-label="Close expanded view"
            onClick={onClose}
          >
            <MotionIcon icon={XIcon} className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={box}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden"
      >
        <div
          style={column(left)}
          className="flex min-h-80 min-w-0 flex-col border-b-2 border-outline bg-chrome md:min-h-0 md:shrink-0 md:basis-(--col) md:overflow-y-auto md:border-b-0"
        >
          <InputPane
            key={node.key}
            graph={graph}
            node={node}
            scope={context.scope}
            scopeSource={context.scopeSource}
          />
        </div>
        <ResizeHandle
          label="Resize Input"
          value={left}
          min={SIDE_MIN}
          max={100 - right - MIDDLE_MIN}
          step={2}
          scale={percentPerPixel}
          grows="right"
          valueText={`Input ${left} percent wide`}
          onChange={(value) => setColumns([value, 100 - value - right, right])}
          className="hidden border-x-2 border-outline md:block"
        />
        <div className="flex min-w-0 flex-col md:min-h-0 md:flex-1 md:overflow-y-auto">
          <section aria-label="Settings" className="p-4">
            <StepTabs
              key={node.key}
              node={node}
              graph={graph}
              issues={issues}
              context={context}
              dispatch={dispatch}
              pin={pin}
            />
          </section>
        </div>
        <ResizeHandle
          label="Resize Output"
          value={right}
          min={SIDE_MIN}
          max={100 - left - MIDDLE_MIN}
          step={2}
          scale={percentPerPixel}
          grows="left"
          valueText={`Output ${right} percent wide`}
          onChange={(value) => setColumns([left, 100 - left - value, value])}
          className="hidden border-x-2 border-outline md:block"
        />
        <div
          style={column(right)}
          className="flex min-h-80 min-w-0 flex-col border-t-2 border-outline bg-chrome md:min-h-0 md:shrink-0 md:basis-(--col) md:overflow-y-auto md:border-t-0"
        >
          <OutputPane key={node.key} node={node} scope={context.scope} pin={pin} />
        </div>
      </div>
    </DialogContent>
  );
}
