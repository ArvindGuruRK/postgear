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
 *
 * Module 08 (blueprint 7.1 and 7.2):
 * - A painted run dresses the card by state (`step-paint.ts`) and hangs a
 *   result badge on its bottom-right edge: an icon, the state in words and
 *   the duration. Clicking it opens the step on that run.
 * - Running steps get marching dashes round the icon tile and a pulsing
 *   stripe; a step waiting for review pulses amber. Reduced motion keeps
 *   the looks and drops the motion (workflow-canvas.css).
 * - Steps this builder's tests send for real wear a red Live In Tests
 *   sticker, and the hover toolbar offers Test Step.
 * - Outside the builder (a run or a version preview) or on a read-only
 *   canvas, the card edits nothing: no toolbar, no menu, no "+", no
 *   double-click.
 */
import { CopyPlusIcon } from '@animateicons/react/lucide/copy-plus-icon';
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { PowerIcon } from '@animateicons/react/lucide/power-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { canConnect, type PortId } from '@postgear/automation';
import {
  Badge,
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
import {
  Check,
  CircleAlert,
  CircleStop,
  Clock,
  LoaderCircle,
  type LucideIcon,
  Pause,
  Pin,
  SkipForward,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../app-icon';
import { useOptionalBuilder } from '../builder/builder-context';
import { useCanvasMode } from './canvas-mode';
import { cardHeight, FAMILY_STRIPE, type StepFlowNode } from './flow-model';
import { type BadgeIcon, type BadgeTone, badgeLabel, paintLook } from './step-paint';

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
  'pg-handle h-3! w-3! rounded-full! border-2! border-outline! bg-secondary! transition-transform';

/** The small stickers on a card's edges. */
const STICKER =
  'rounded-md border-2 border-outline px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none';

const BADGE_ICONS: Record<BadgeIcon, LucideIcon> = {
  check: Check,
  cross: X,
  pause: Pause,
  alert: CircleAlert,
  clock: Clock,
  spinner: LoaderCircle,
  skip: SkipForward,
  stop: CircleStop,
};

const BADGE_VARIANT: Record<BadgeTone, 'success' | 'danger' | 'accent' | 'primary' | 'outline'> = {
  success: 'success',
  danger: 'danger',
  accent: 'accent',
  primary: 'primary',
  neutral: 'outline',
};

export const StepCard = memo(function StepCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const builder = useOptionalBuilder();
  const mode = useCanvasMode();
  // The builder's editing hands: none on a read-only canvas.
  const editor = mode.readOnly ? null : builder;
  const detail = useStore(zoomDetail);
  const connection = useConnection();
  const [hover, setHover] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { node, def, issues, ports, usedPorts, isTrigger, paint } = data;
  const family = def?.family ?? 'ink';
  const height = cardHeight(ports.length);
  const firstIssue = issues[0];
  const canDisable = def?.canDisable ?? true;
  const pinned = editor?.pinned.has(id) ?? false;
  const liveInTests = editor?.liveInTests?.has(id) ?? false;
  const look = paint ? paintLook(paint) : null;

  useEffect(
    () => () => {
      if (leave.current) clearTimeout(leave.current);
    },
    [],
  );

  // A line being drawn from an output: may it end on this card's input?
  let fits: boolean | null = null;
  if (editor && connection.inProgress && connection.fromHandle?.type === 'source') {
    const source = connection.fromNode.id;
    fits =
      source !== id &&
      !isTrigger &&
      canConnect(editor.graphRef.current, {
        source,
        sourcePort: (connection.fromHandle.id ?? 'out') as PortId,
        target: id,
      }).ok;
  }
  const isSource = connection.inProgress && connection.fromNode?.id === id;

  function enter() {
    if (!editor) return;
    if (leave.current) clearTimeout(leave.current);
    setHover(true);
  }
  function exit() {
    if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => setHover(false), HOVER_GRACE_MS);
  }

  const toolbar = editor ? (
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
        {editor.testStep ? (
          <TooltipHint label="Test Step">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Test ${node.name}`}
              onClick={() => editor.testStep?.(id)}
            >
              <MotionIcon icon={PlayIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {canDisable ? (
          <TooltipHint label={node.disabled ? 'Turn On' : 'Turn Off'} shortcut="D">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={node.disabled ? `Turn on ${node.name}` : `Turn off ${node.name}`}
              onClick={() => editor.dispatch({ type: 'toggleDisabled', keys: [id] })}
            >
              <MotionIcon icon={PowerIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {isTrigger ? null : (
          <TooltipHint label="Duplicate">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Duplicate ${node.name}`}
              onClick={() => editor.duplicate([id])}
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
            onClick={() => editor.remove({ nodes: [id] })}
          >
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`More actions for ${node.name}`}
            >
              <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => editor.open(id)}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.rename(id)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.copy([id])}>Copy</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </NodeToolbar>
  ) : null;

  const pinSticker =
    pinned && detail !== 'icon' ? (
      <TooltipHint label="Pinned Data">
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the sticker's meaning is reachable by keyboard
          tabIndex={0}
          data-testid="pin-sticker"
          className="nodrag flex h-6 items-center gap-1 rounded-md border-2 border-outline bg-actionPrimary px-1.5 text-onActionPrimary"
        >
          <Pin aria-hidden="true" className="h-3 w-3" strokeWidth={2.75} />
          <span className="sr-only">This step has pinned test data.</span>
        </span>
      </TooltipHint>
    ) : null;

  const BadgeGlyph = look ? BADGE_ICONS[look.icon] : null;
  const badge =
    look && BadgeGlyph ? (
      <Badge
        variant={BADGE_VARIANT[look.tone]}
        data-testid="run-badge"
        data-state={look.state}
        className={cn(
          'gap-1 whitespace-nowrap px-1.5 text-[10px] leading-none',
          look.tone === 'neutral' ? 'bg-secondary' : '',
        )}
      >
        <BadgeGlyph
          aria-hidden="true"
          className={cn(
            'h-3 w-3 shrink-0',
            look.icon === 'spinner' ? 'animate-spin motion-reduce:animate-none' : '',
          )}
          strokeWidth={3}
        />
        {detail === 'icon' ? null : (
          <span>
            {look.words}
            {look.duration ? `, ${look.duration}` : ''}
          </span>
        )}
      </Badge>
    ) : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover shows the toolbar; React Flow makes the node focusable
    <div
      className={cn('relative', fits === false && !isSource ? 'opacity-30' : '')}
      style={{ width: 240, height }}
      data-run-state={look?.state}
      onMouseEnter={enter}
      onMouseLeave={exit}
      onContextMenu={(event) => {
        if (!editor) return;
        event.preventDefault();
        editor.contextMenu({ kind: 'step', key: id }, { x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={() => editor?.expand(id)}
    >
      {toolbar}

      {isTrigger ? (
        <span className="absolute -top-6 left-3 flex items-center gap-1 rounded-t-md border-2 border-b-0 border-outline bg-actionSecondary px-2 py-0.5 font-sans text-[11px] font-bold text-onActionLight">
          <Zap aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
          When
        </span>
      ) : null}

      {look?.waiting && !selected ? (
        <span
          aria-hidden="true"
          className={cn(
            'pg-run-waiting pointer-events-none absolute -inset-1.5',
            isTrigger ? 'rounded-l-3xl rounded-r-card' : 'rounded-card',
          )}
        />
      ) : null}

      <div
        className={cn(
          'pg-step-card relative flex h-full w-full items-center gap-3 overflow-hidden border-2 border-outline bg-secondary pe-3 shadow-surfaceSm transition-shadow',
          isTrigger ? 'rounded-l-3xl rounded-r-card' : 'rounded-card',
          selected
            ? 'shadow-surfaceMd outline-solid outline-[3px] outline-offset-2 outline-focusRing'
            : '',
          node.disabled ? 'opacity-50' : '',
          look?.card,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'h-full w-1.5 shrink-0',
            FAMILY_STRIPE[family],
            look?.running ? 'pg-run-pulse' : '',
          )}
        />
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <AppIcon icon={def?.icon ?? 'manual'} className="h-5 w-5" />
          {look?.running ? (
            <span
              aria-hidden="true"
              data-testid="run-ring"
              className="pointer-events-none absolute -inset-1.5"
            >
              <svg aria-hidden="true" className="h-full w-full overflow-visible">
                <rect
                  width="100%"
                  height="100%"
                  rx="8"
                  fill="none"
                  strokeWidth={2.5}
                  className="pg-run-ants stroke-actionPrimary"
                />
              </svg>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn('type-ui truncate text-sm text-ink', node.disabled ? 'line-through' : '')}
          >
            {node.name}
          </span>
          {detail === 'full' ? (
            paint?.state === 'failed' && paint.error ? (
              <span className="type-label truncate text-xs text-dangerInk" title={paint.error}>
                {paint.error}
              </span>
            ) : (
              <span className="type-label truncate text-xs text-ink type-muted">
                {data.summary}
              </span>
            )
          ) : null}
        </span>
      </div>

      {node.disabled && detail !== 'icon' ? (
        <span className={cn(STICKER, 'absolute -top-3 right-3 bg-secondary text-ink')}>Off</span>
      ) : null}

      {liveInTests && detail !== 'icon' ? (
        // The pin joins the row so the two never overlap.
        <span
          className={cn(
            'absolute -top-3 flex items-center gap-1',
            isTrigger ? 'left-20' : 'left-3',
          )}
        >
          <Badge
            variant="danger"
            data-testid="live-in-tests"
            className="h-6 px-1.5 text-[10px] leading-none"
          >
            Live In Tests
          </Badge>
          {pinSticker}
        </span>
      ) : pinSticker ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2">{pinSticker}</span>
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

      {look && badge ? (
        mode.onRunBadgeClick ? (
          <button
            type="button"
            className="nodrag nopan absolute -bottom-2.5 right-3 rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
            aria-label={badgeLabel(look, node.name)}
            onClick={(event) => {
              event.stopPropagation();
              mode.onRunBadgeClick?.(id);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {badge}
          </button>
        ) : (
          <span className="absolute -bottom-2.5 right-3">{badge}</span>
        )
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
                  STICKER,
                  'pointer-events-none absolute left-full ms-2 -translate-y-1/2',
                  port.id === 'error'
                    ? 'bg-actionDanger text-onActionLight'
                    : 'bg-secondary text-ink',
                )}
                style={{ top }}
              >
                {port.label}
              </span>
            ) : null}
            {editor && open && !connection.inProgress && detail !== 'icon' && !editor.locked ? (
              <span
                className="absolute left-full flex -translate-y-1/2 items-center"
                style={{ top, marginLeft: labelled ? 8 + port.label.length * 6 + 16 : 6 }}
              >
                <span aria-hidden="true" className="h-0.5 w-5 bg-outline" />
                <button
                  type="button"
                  className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-primary"
                  aria-label={`Add a step after ${node.name}${labelled ? `, ${port.label}` : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    editor.pickFrom(
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
