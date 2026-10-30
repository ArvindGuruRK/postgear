'use client';

/**
 * The docked step panel (blueprint 5.1): the header with the step's icon,
 * its name (rename here, or F2), its one-line description, Expand (the
 * near full-screen view, blueprint 5.2) and Close; then the tabs and
 * Settings (`step-tabs.tsx`, shared with the Expanded view).
 *
 * Keys pressed inside stay inside (`panel-keys.ts`), so Backspace in a
 * field never deletes the step on the canvas. The builder sizes the panel
 * (360 to 560 px, `use-panel-width.ts`) and sends focus requests from the
 * issues list, Finish Setup and `?step=&field=` deep links.
 */
import { ExpandIcon } from '@animateicons/react/lucide/expand-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  type AutomationGraph,
  type GraphNode,
  getDefinition,
  type ValidationIssue,
} from '@postgear/automation';
import { Button, Input, Label, MotionIcon, Text, TooltipHint } from '@postgear/ui';
import { Pin } from 'lucide-react';
import {
  type Dispatch,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { AppIcon } from '../app-icon';
import type { BuilderAction } from '../builder/builder-state';
import { FIELD_PATH_ATTRIBUTE, type FieldContext } from '../fields/contract';
import type { PinControls } from './output-pane';
import { keepKeysInPanel } from './panel-keys';
import { type FocusRequest, StepTabs } from './step-tabs';
import type { StepTestControls } from './test-tab';

export { ON_ERROR_OPTIONS } from './step-tabs';

/** The step's name, committed on Enter or blur; Esc puts it back. */
export function StepNameField({
  node,
  dispatch,
  inputRef,
  className,
}: {
  node: GraphNode;
  dispatch: Dispatch<BuilderAction>;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const id = useId();
  const [name, setName] = useState(node.name);

  useEffect(() => {
    setName(node.name);
  }, [node.name]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(node.name);
      return;
    }
    if (trimmed !== node.name)
      dispatch({ type: 'renameStep', key: node.key, name: trimmed, now: Date.now() });
  }

  return (
    <div {...{ [FIELD_PATH_ATTRIBUTE]: 'name' }} className={className}>
      <Label htmlFor={`${id}-name`} className="sr-only">
        Step name
      </Label>
      <Input
        id={`${id}-name`}
        ref={inputRef}
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setName(node.name);
            event.currentTarget.blur();
          }
        }}
        placeholder="Enter your step name"
        className="h-9 type-ui"
      />
    </div>
  );
}

export interface StepPanelProps {
  node: GraphNode;
  graph: AutomationGraph;
  issues: ValidationIssue[];
  context: FieldContext;
  dispatch: Dispatch<BuilderAction>;
  pin: PinControls;
  onClose: () => void;
  /** Opens the Expanded view on this step. */
  onExpand?: () => void;
  /** Bumped by F2 and Rename: focuses the name field. */
  renameSignal: number;
  /** Land on a field (the issues list, Finish Setup, a deep link). */
  focus?: FocusRequest | null;
  /** Module 08: Test Step, its result and Send For Real In Tests. */
  test?: StepTestControls;
  /** Bumped to show the Test tab. */
  showTest?: number;
}

export function StepPanel({
  node,
  graph,
  issues,
  context,
  dispatch,
  pin,
  onClose,
  onExpand,
  renameSignal,
  focus = null,
  test,
  showTest,
}: StepPanelProps) {
  const def = getDefinition(node.type, node.typeVersion);
  const nameField = useRef<HTMLInputElement>(null);

  const focusName = useCallback(() => {
    nameField.current?.focus();
    nameField.current?.select();
  }, []);

  useEffect(() => {
    if (renameSignal > 0) focusName();
  }, [renameSignal, focusName]);

  return (
    <aside
      aria-label={`${node.name} step`}
      className="flex h-full min-h-0 flex-col bg-secondary"
      data-testid="step-panel"
      onKeyDown={keepKeysInPanel}
    >
      <div className="flex items-start gap-3 border-b-2 border-outline p-4">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <AppIcon icon={def?.icon ?? 'manual'} className="h-5 w-5" />
          {pin.pinned ? (
            <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-md border-2 border-outline bg-actionPrimary text-onActionPrimary">
              <Pin aria-hidden="true" className="h-3 w-3" strokeWidth={2.75} />
              <span className="sr-only">Pinned data</span>
            </span>
          ) : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <StepNameField node={node} dispatch={dispatch} inputRef={nameField} />
          {def ? (
            <Text size="sm" muted>
              {def.description}
            </Text>
          ) : null}
        </div>
        {onExpand ? (
          <TooltipHint label="Expand">
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-9 px-0"
              aria-label="Expand step"
              onClick={onExpand}
              data-testid="expand-step"
            >
              <MotionIcon icon={ExpandIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="h-9 w-9 px-0"
          aria-label="Close step panel"
          onClick={onClose}
        >
          <MotionIcon icon={XIcon} className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <StepTabs
          node={node}
          graph={graph}
          issues={issues}
          context={context}
          dispatch={dispatch}
          pin={pin}
          focus={focus}
          onFocusName={focusName}
          test={test}
          showTest={showTest}
        />
      </div>
    </aside>
  );
}
