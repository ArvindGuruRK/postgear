'use client';

/**
 * The step card (blueprint 4.1 and 4.2): PostGear's card language on n8n's
 * compact layout. 240 px wide, the family stripe on the left, a 44 px icon
 * tile, the name and a one-line summary from the catalog.
 *
 * - Triggers carry a "When" tab and a rounder left edge, and no input.
 * - Turned off: faded, the name struck through, an Off sticker.
 * - Issues: a corner triangle with a "!" (never colour alone) and the
 *   first issue as its tooltip.
 * - Pinned test data: a pin sticker on the top edge (n8n); a double-click
 *   opens the Expanded view.
 * - Outputs: labelled ports carry a sticker (On Error in red); an output
 *   with no line shows a short stem with a "+" that opens the picker.
 * - While a line is being drawn, inputs that fit glow and the rest fade.
 * - Zoomed out, detail drops: no summary below 60%, name and icon only
 *   below 40% (read from React Flow's store, not a timer).
 */
import { CopyPlusIcon } from '@animateicons/react/lucide/copy-plus-icon';
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { PowerIcon } from '@animateicons/react/lucide/power-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { canConnect, type PortId } from '@postgear/automation';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  TooltipHint,
} from '@postgear/ui';
import {
  Handle,
  type NodeProps,
  NodeToolbar,
  Position,
  type ReactFlowState,
  useConnection,
  useStore,
} from '@xyflow/react';
import { Pin, TriangleAlert, Zap } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../app-icon';
import { useBuilder } from '../builder/builder-context';
import { cardHeight, FAMILY_STRIPE, type StepFlowNode } from './flow-model';

export type ZoomDetail = 'full' | 'compact' | 'icon';

export const zoomDetail = (state: ReactFlowState): ZoomDetail => {
  const zoom = state.transform[2];
  return zoom < 0.4 ? 'icon' : zoom < 0.6 ? 'compact' : 'full';
};

const HOVER_GRACE_MS = 150;

function portTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

const HANDLE =
  'pg-handle h-3.5! w-3.5! rounded-full! border-2! border-outline! bg-secondary! transition-transform';

export const StepCard = memo(function StepCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const builder = useBuilder();
  const detail = useStore(zoomDetail);
  const connection = useConnection();
  const [hover, setHover] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { node, def, issues, ports, usedPorts, isTrigger } = data;
  const family = def?.family ?? 'ink';
  const height = cardHeight(ports.length);
  const firstIssue = issues[0];
  const canDisable = def?.canDisable ?? true;
  const pinned = builder.pinned.has(id);

  useEffect(
    () => () => {
      if (leave.current) clearTimeout(leave.current);
    },
    [],
  );

  // A line being drawn from an output: may it end on this card's input?
  let fits: boolean | null = null;
  if (connection.inProgress && connection.fromHandle?.type === 'source') {
    const source = connection.fromNode.id;
    fits =
      source !== id &&
      !isTrigger &&
      canConnect(builder.graphRef.current, {
        source,
        sourcePort: (connection.fromHandle.id ?? 'out') as PortId,
        target: id,
      }).ok;
  }
  const isSource = connection.inProgress && connection.fromNode?.id === id;

  function enter() {
    if (leave.current) clearTimeout(leave.current);
    setHover(true);
  }
  function exit() {
    if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => setHover(false), HOVER_GRACE_MS);
  }

  const toolbar = (
    <NodeToolbar
      isVisible={hover && !connection.inProgress && detail !== 'icon'}
      position={Position.Top}
      offset={isTrigger ? 30 : 8}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover keeps the toolbar open, keyboard users use the menu */}
      <div
        className="flex items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm"
        onMouseEnter={enter}
        onMouseLeave={exit}
      >
        {canDisable ? (
          <TooltipHint label={node.disabled ? 'Turn On' : 'Turn Off'} shortcut="D">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2"
              aria-label={node.disabled ? `Turn on ${node.name}` : `Turn off ${node.name}`}
              onClick={() => builder.dispatch({ type: 'toggleDisabled', keys: [id] })}
            >
              <MotionIcon icon={PowerIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {isTrigger ? null : (
          <TooltipHint label="Duplicate">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2"
              aria-label={`Duplicate ${node.name}`}
              onClick={() => builder.duplicate([id])}
            >
              <MotionIcon icon={CopyPlusIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        )}
        <TooltipHint label="Delete">
          <Button
            variant="danger"
            size="sm"
            className="h-8 px-2"
            aria-label={`Delete ${node.name}`}
            onClick={() => builder.remove({ nodes: [id] })}
          >
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2"
              aria-label={`More actions for ${node.name}`}
            >
              <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => builder.open(id)}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => builder.rename(id)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => builder.copy([id])}>Copy</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </NodeToolbar>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover shows the toolbar; React Flow makes the node focusable
    <div
      className={cn('relative', fits === false && !isSource ? 'opacity-30' : '')}
      style={{ width: 240, height }}
      onMouseEnter={enter}
      onMouseLeave={exit}
      onContextMenu={(event) => {
        event.preventDefault();
        builder.contextMenu({ kind: 'step', key: id }, { x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={() => builder.expand(id)}
    >
      {toolbar}

      {isTrigger ? (
        <span className="absolute -top-6 left-3 flex items-center gap-1 rounded-t-md border-2 border-b-0 border-outline bg-actionSecondary px-2 py-0.5 font-sans text-[11px] font-bold text-onActionLight">
          <Zap aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
          When
        </span>
      ) : null}

      <div
        className={cn(
          'pg-step-card relative flex h-full w-full items-center gap-3 overflow-hidden border-2 border-outline bg-secondary pe-3 shadow-brutalMd transition-shadow',
          isTrigger ? 'rounded-l-3xl rounded-r-card' : 'rounded-card',
          selected
            ? 'shadow-brutalLg outline-solid outline-[3px] outline-offset-2 outline-focusRing'
            : '',
          node.disabled ? 'opacity-50' : '',
        )}
      >
        <span aria-hidden="true" className={cn('h-full w-1.5 shrink-0', FAMILY_STRIPE[family])} />
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <AppIcon icon={def?.icon ?? 'manual'} className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn('type-ui truncate text-sm text-ink', node.disabled ? 'line-through' : '')}
          >
            {node.name}
          </span>
          {detail === 'full' ? (
            <span className="type-label truncate text-xs text-ink type-muted">{data.summary}</span>
          ) : null}
        </span>
      </div>

      {node.disabled && detail !== 'icon' ? (
        <span className="absolute -top-3 right-3 rounded-md border-2 border-outline bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none text-ink">
          Off
        </span>
      ) : null}

      {pinned && detail !== 'icon' ? (
        <TooltipHint label="Pinned Data">
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the sticker's meaning is reachable by keyboard
            tabIndex={0}
            data-testid="pin-sticker"
            className="nodrag absolute -top-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-1 rounded-md border-2 border-outline bg-actionPrimary px-1.5 text-onActionPrimary"
          >
            <Pin aria-hidden="true" className="h-3 w-3" strokeWidth={2.75} />
            <span className="sr-only">This step has pinned test data.</span>
          </span>
        </TooltipHint>
      ) : null}

      {firstIssue ? (
        <TooltipHint label={firstIssue.message}>
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the issue's sentence is reachable by keyboard
            tabIndex={0}
            className={cn(
              'nodrag absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-md border-2 border-outline',
              firstIssue.severity === 'error'
                ? 'bg-actionDanger text-onActionLight'
                : 'bg-actionSecondary text-onActionLight',
            )}
          >
            <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.75} />
            <span className="sr-only">{firstIssue.message}</span>
          </span>
        </TooltipHint>
      ) : null}

      {isTrigger ? null : (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className={cn(HANDLE, 'bg-ink!', fits ? 'pg-handle-fits' : '')}
        />
      )}

      {ports.map((port, index) => {
        const top = portTop(index, ports.length);
        const labelled = port.id !== 'out';
        const open = !usedPorts.includes(port.id);
        return (
          <div key={port.id}>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{ top }}
              className={cn(HANDLE, port.id === 'error' ? 'bg-actionDanger!' : '')}
            />
            {labelled && detail !== 'icon' ? (
              <span
                className={cn(
                  'pointer-events-none absolute left-full ms-2 -translate-y-1/2 rounded-md border-2 border-outline px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none',
                  port.id === 'error'
                    ? 'bg-actionDanger text-onActionLight'
                    : 'bg-secondary text-ink',
                )}
                style={{ top }}
              >
                {port.label}
              </span>
            ) : null}
            {open && !connection.inProgress && detail !== 'icon' && !builder.locked ? (
              <span
                className="absolute left-full flex -translate-y-1/2 items-center"
                style={{ top, marginLeft: labelled ? 8 + port.label.length * 6 + 16 : 6 }}
              >
                <span aria-hidden="true" className="h-0.5 w-5 bg-outline" />
                <button
                  type="button"
                  className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm hover:bg-actionSecondary hover:text-onActionLight"
                  aria-label={`Add a step after ${node.name}${labelled ? `, ${port.label}` : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    builder.pickFrom(
                      { source: id, sourcePort: port.id },
                      { x: rect.right, y: rect.top + rect.height / 2 },
                    );
                  }}
                >
                  <MotionIcon icon={PlusIcon} className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
