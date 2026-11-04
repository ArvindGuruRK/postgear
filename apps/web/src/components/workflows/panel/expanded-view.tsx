'use client';

/**
 * The step editor (blueprint 5.2, n8n's node detail view; 2026-11-03: the one
 * place a step is edited): a near full-window dialog with three resizable
 * columns, **Input** (the data this step can use), **Settings** (the tabs and
 * Test Step) and **Output** (its latest test result, else its pinned data).
 *
 * Opens from a double-click on a card, Enter on a selected one, an issue or a
 * deep link. From a step's result badge on the painted canvas (Module 08) it
 * opens on that run: Input shows what the step got (This Run) and Output what
 * it gave. Named buttons in the Input and Output headers walk to the steps
 * joined to this one without closing.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Text,
  TooltipHint,
} from '@postgear/ui';
import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { StepGlyph } from '../list/step-glyph';
import type { BuilderAction } from '../builder/builder-state';
import type { FieldContext } from '../fields/contract';
import { InputPane } from './input-pane';
import { OutputPane, type PinControls } from './output-pane';
import { keepKeysInPanel } from './panel-keys';
import { connectedSteps, type StepRunResult } from './panel-view-model';
import { ResizeHandle } from './resize-handle';
import { StepNameField } from './step-name-field';
import { type FocusRequest, StepTabs } from './step-tabs';
import type { StepTestControls } from './step-test';

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
  /** Walks to another step (the named buttons). */
  onNavigate: (key: string) => void;
  /** Land on a field or the name (an issue, a deep link, Rename). */
  focus?: FocusRequest | null;
  /** Autosave's words: its alerts sit behind this dialog, so it says so itself. */
  saveState?: ReactNode;
  /** Module 08: Test Step, the result and Send For Real In Tests. */
  test?: StepTestControls;
  /** Opened from a result badge: the step's row in that run. */
  runResult?: StepRunResult | null;
}

export function ExpandedView({ node, ...props }: ExpandedViewProps) {
  return (
    <Dialog open={node !== undefined} onOpenChange={(open) => !open && props.onClose()}>
      {node ? <ExpandedBody node={node} {...props} /> : null}
    </Dialog>
  );
}

/** The way to the steps joined to this one: a named button, or a menu when there are several. */
function ConnectedSteps({
  steps,
  side,
  onNavigate,
}: {
  steps: readonly GraphNode[];
  side: 'previous' | 'next';
  onNavigate: (key: string) => void;
}) {
  const previous = side === 'previous';
  const testIds = {
    box: previous ? 'connected-previous' : 'connected-next',
    button: previous ? 'expanded-previous' : 'expanded-next',
  };
  const arrow = previous ? ArrowLeftIcon : ArrowRightIcon;
  const glyph = (node: GraphNode, className: string) => (
    <StepGlyph
      icon={getDefinition(node.type, node.typeVersion)?.icon ?? 'manual'}
      className={className}
    />
  );
  if (steps.length === 0) return null;
  if (steps.length === 1) {
    const [step] = steps;
    const words = `${previous ? 'Previous Step' : 'Next Step'}: ${step.name}`;
    return (
      <div className="min-w-0" data-testid={testIds.box}>
        <TooltipHint label={words}>
          <Button
            variant="secondary"
            size="sm"
            className="max-w-64"
            aria-label={words}
            data-testid={testIds.button}
            onClick={() => onNavigate(step.key)}
          >
            {previous ? <MotionIcon icon={arrow} className="h-4 w-4 shrink-0" /> : null}
            {glyph(step, 'h-4 w-4 shrink-0')}
            <span className="truncate">{step.name}</span>
            {previous ? null : <MotionIcon icon={arrow} className="h-4 w-4 shrink-0" />}
          </Button>
        </TooltipHint>
      </div>
    );
  }
  return (
    <div className="shrink-0" data-testid={testIds.box}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" data-testid={testIds.button}>
            {previous ? <MotionIcon icon={arrow} className="h-4 w-4 shrink-0" /> : null}
            {steps.length} {previous ? 'Previous Steps' : 'Next Steps'}
            {previous ? null : <MotionIcon icon={arrow} className="h-4 w-4 shrink-0" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {steps.map((step) => (
            <DropdownMenuItem key={step.key} onSelect={() => onNavigate(step.key)}>
              {glyph(step, 'h-4 w-4 shrink-0')}
              {step.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  focus = null,
  saveState,
  test,
  runResult = null,
}: Omit<ExpandedViewProps, 'node'> & { node: GraphNode }) {
  const def = getDefinition(node.type, node.typeVersion);
  const connected = connectedSteps(graph, node.key);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [box, width] = useWidth();
  const percentPerPixel = 100 / Math.max(width, 1);
  const [left, , right] = columns;
  const column = (value: number) => ({ '--col': `${value}%` }) as CSSProperties;
  const nameField = useRef<HTMLInputElement>(null);
  const focusName = useCallback(() => {
    nameField.current?.focus();
    nameField.current?.select();
  }, []);

  return (
    <DialogContent
      hideClose
      onKeyDown={keepKeysInPanel}
      // Radix would focus and select the step name, where one stray key renames
      // the step; start on the settings tabs instead, unless a field asked for it.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (focus) return;
        (event.target as HTMLElement | null)
          ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
          ?.focus();
      }}
      // React Flow blurs a card on Escape: hand the keyboard back to the step's card.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        document
          .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.key)}"]`)
          ?.focus();
      }}
      data-testid="expanded-view"
      className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 p-0"
    >
      <DialogTitle className="sr-only">{node.name}</DialogTitle>
      <DialogDescription className="sr-only">
        The data this step gets, its settings, and its result.
      </DialogDescription>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-outline px-3">
          <StepGlyph icon={def?.icon ?? 'manual'} className="h-7 w-7 shrink-0" />
          <StepNameField
            key={node.key}
            node={node}
            dispatch={dispatch}
            inputRef={nameField}
            className="min-w-0 shrink-0"
          />
          {def ? (
            <Text size="sm" muted className="min-w-0 flex-1 truncate" title={def.description}>
              {def.description}
            </Text>
          ) : (
            <span className="flex-1" />
          )}
          {saveState}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 px-0"
            aria-label="Close step"
            onClick={onClose}
          >
            <MotionIcon icon={XIcon} className="h-4 w-4" />
          </Button>
        </header>

        <div ref={box} className="flex min-h-0 flex-1 overflow-hidden">
          <div
            style={column(left)}
            className="flex min-h-0 min-w-0 shrink-0 basis-(--col) flex-col overflow-hidden bg-inset"
          >
            <InputPane
              key={`${node.key}:${runResult?.runId ?? ''}`}
              graph={graph}
              node={node}
              scope={context.scope}
              scopeSource={context.scopeSource}
              runInput={runResult}
              connected={
                <ConnectedSteps
                  steps={connected.previous}
                  side="previous"
                  onNavigate={onNavigate}
                />
              }
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
            className="w-0.5 bg-outline before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']"
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <section aria-label="Settings" className="px-4 pb-4">
              <StepTabs
                key={node.key}
                node={node}
                graph={graph}
                issues={issues}
                context={context}
                dispatch={dispatch}
                pin={pin}
                focus={focus}
                onFocusName={focusName}
                test={test}
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
            className="w-0.5 bg-outline before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']"
          />
          <div
            style={column(right)}
            className="flex min-h-0 min-w-0 shrink-0 basis-(--col) flex-col overflow-hidden bg-inset"
          >
            <OutputPane
              key={node.key}
              node={node}
              scope={context.scope}
              pin={pin}
              result={runResult ?? test?.result ?? null}
              workflowName={test?.workflowName}
              test={test}
              connected={
                <ConnectedSteps steps={connected.next} side="next" onNavigate={onNavigate} />
              }
            />
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
