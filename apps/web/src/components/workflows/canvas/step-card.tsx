'use client';

/**
 * The step card (blueprint 4.1 and 4.2): 320 by 120 for every step, one 12px
 * corner, no edge stripe and no shadow, the step's coloured icon, its name and
 * a one-line summary from the catalog. A tab behind the top edge names its kind
 * ("When" in yellow on the trigger). A step with three or more outputs grows
 * taller.
 *
 * - A ring touching the card's border, with no gap (the owner's call of 2026-11-04,
 *   workflow-canvas.css): grey under the pointer, the icon's colour when selected.
 * - Status marks are bare icons in the bottom-right corner, inside the card
 *   (the owner's call of 2026-11-03, after n8n): the run's result, Live In
 *   Tests, the pin, turned off, and last, in the very corner, the issue sign.
 *   Each says itself in a tooltip. The issue sign lists what is wrong and lands
 *   on the first problem when clicked.
 * - Turned off: faded, the name struck through.
 * - Outputs: labelled ports carry a sticker (On Error and Rejected in red,
 *   Approved in green); an output with no line shows a short stem with a "+"
 *   that opens the picker.
 * - While a line is being drawn, inputs that fit glow and the rest fade.
 * - Zoomed out, detail drops: no summary below 60%, name and icon only below
 *   40% (read from React Flow's store, not a timer).
 *
 * Module 08 (blueprint 7.1 and 7.2):
 * - A painted run dresses the card by state (`step-paint.ts`). Its result mark
 *   opens the step on that run.
 * - Running steps get marching dashes round the icon, which pulses; the border
 *   of a step waiting for review pulses amber. Reduced motion keeps the looks
 *   and drops the motion (workflow-canvas.css).
 * - Outside the builder (a run or a version preview) or on a read-only
 *   canvas, the card edits nothing: no toolbar, no menu, no "+", no
 *   double-click.
 */
import { CopyPlusIcon } from '@animateicons/react/lucide/copy-plus-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
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
  Position,
  type ReactFlowState,
  useConnection,
  useStore,
} from '@xyflow/react';
import { Pin, PowerOff, Radio, TriangleAlert } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useOptionalBuilder } from '../builder/builder-context';
import { issueLines } from '../builder/builder-view-model';
import { CARD_WIDTH, cardHeight, PORT_PITCH } from '../builder/graph-ops';
import { ShortcutKeys } from '../builder/shortcut-keys';
import { StepGlyph, stepColour } from '../list/step-glyph';
import { useCanvasMode } from './canvas-mode';
import type { StepFlowNode } from './flow-model';
import { RunGlyph } from './run-glyph';
import { badgeLabel, paintLook } from './step-paint';

export type ZoomDetail = 'full' | 'compact' | 'icon';

export const zoomDetail = (state: ReactFlowState): ZoomDetail => {
  const zoom = state.transform[2];
  return zoom < 0.4 ? 'icon' : zoom < 0.6 ? 'compact' : 'full';
};

const HOVER_GRACE_MS = 250;

/** Outputs sit a fixed pitch apart, centred on the card, so two fit the one card size. */
function portTop(index: number, count: number, height: number): string {
  return `${height / 2 + (index - (count - 1) / 2) * PORT_PITCH}px`;
}

/**
 * A port dot: 16px, ink (white in the dark themes) on both sides of a card, centred on its
 * border line and a touch bigger under the pointer (workflow-canvas.css).
 */
const HANDLE = 'pg-handle h-4! w-4! rounded-full! border-2! border-outline! bg-ink!';

/** A button of the hover toolbar: a centred 32px square, muted until the pointer is on it. */
const TOOL = 'h-8 w-8 rounded-md px-0 text-ink/80 transition-colors';

/** Hover for every toolbar button but Delete: the dark page shade and full ink, no colour. */
const TOOL_NEUTRAL = 'hover:bg-primary hover:text-ink';

/** The small stickers on a card's edges. */
const STICKER =
  'flex items-center whitespace-nowrap rounded-md border-2 border-outline px-2 py-1 font-sans text-xs font-bold leading-none';

/** A branch's sticker, coloured where its name is an outcome. */
const PORT_STICKER: Partial<Record<PortId, string>> = {
  error: 'bg-actionDanger text-onActionLight',
  rejected: 'bg-actionDanger text-onActionLight',
  approved: 'bg-actionSuccess text-onActionLight',
};

/** The most issue lines a sign's tooltip lists. */
const ISSUE_LINES = 4;

/**
 * A status mark: a bare icon that says itself in a tooltip, to hover or tab to. Zoomed out it
 * grows in flow px, so it can still be seen.
 */
function Mark({
  label,
  testId,
  state,
  className,
  children,
}: {
  label: string;
  testId?: string;
  state?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TooltipHint label={label}>
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the mark's meaning is reachable by keyboard
        tabIndex={0}
        data-testid={testId}
        data-state={state}
        className={cn(
          'nodrag flex shrink-0 items-center rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing',
          className,
        )}
      >
        {children}
        <span className="sr-only">{label}</span>
      </span>
    </TooltipHint>
  );
}

/**
 * Where the hover toolbar sits above a card, in flow px: the tab's 30px above the border plus
 * an 8px margin. The toolbar is a child of the card, not React Flow's NodeToolbar (TriForms
 * does the same): a NodeToolbar lives in screen pixels, so at 25% zoom it was a 208px bar over
 * an 80px card. Inside the card it is part of the canvas, so it keeps its proportion at every zoom.
 */
const TOOLBAR_RISE = 38;

export const StepCard = memo(function StepCard({ id, data }: NodeProps<StepFlowNode>) {
  const builder = useOptionalBuilder();
  const mode = useCanvasMode();
  // The builder's editing hands: none on a read-only canvas.
  const editor = mode.readOnly ? null : builder;
  const detail = useStore(zoomDetail);
  const connection = useConnection();
  const [hover, setHover] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { node, def, issues, ports, usedPorts, isTrigger, paint } = data;
  const height = cardHeight(ports.length);
  const firstIssue = issues[0];
  const issueNotes = issueLines(def, issues);
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
    hover && !connection.inProgress ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: hover keeps the toolbar open, keyboard users use the menu
      <div
        data-testid="step-toolbar"
        style={{ marginBottom: TOOLBAR_RISE }}
        onMouseEnter={enter}
        onMouseLeave={exit}
        // The pseudo-element is a bridge down to the card, so the pointer never crosses a gap.
        className="nodrag nopan absolute bottom-full left-1/2 z-40 -translate-x-1/2 before:absolute before:inset-x-0 before:top-full before:h-[38px] before:content-['']"
      >
        <div className="flex items-center gap-0.5 rounded-lg border-2 border-outline bg-secondary p-1">
          {/* Compact, like TriForms': muted icons, full ink on hover, and red for Delete alone. */}
          {editor.testStep ? (
            <TooltipHint label="Test Step" compact hidden={detail !== 'full'}>
              <Button
                variant="ghost"
                className={cn(TOOL, TOOL_NEUTRAL)}
                aria-label={`Test ${node.name}`}
                onClick={() => editor.testStep?.(id)}
              >
                <MotionIcon icon={PlayIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
          ) : null}
          {canDisable ? (
            <TooltipHint
              label={node.disabled ? 'Turn On' : 'Turn Off'}
              shortcut={<ShortcutKeys keys={['D']} />}
              compact
              hidden={detail !== 'full'}
            >
              <Button
                variant="ghost"
                className={cn(TOOL, TOOL_NEUTRAL)}
                aria-label={node.disabled ? `Turn on ${node.name}` : `Turn off ${node.name}`}
                onClick={() => editor.dispatch({ type: 'toggleDisabled', keys: [id] })}
              >
                <MotionIcon icon={PowerIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
          ) : null}
          {isTrigger ? null : (
            <TooltipHint
              label="Duplicate"
              shortcut={<ShortcutKeys keys={['Ctrl', 'D']} />}
              compact
              hidden={detail !== 'full'}
            >
              <Button
                variant="ghost"
                className={cn(TOOL, TOOL_NEUTRAL)}
                aria-label={`Duplicate ${node.name}`}
                onClick={() => editor.duplicate([id])}
              >
                <MotionIcon icon={CopyPlusIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
          )}
          <TooltipHint
            label="Delete"
            shortcut={<ShortcutKeys keys={['Del']} />}
            compact
            hidden={detail !== 'full'}
          >
            <Button
              variant="ghost"
              className={cn(TOOL, 'hover:bg-actionDanger/15 hover:text-dangerInk')}
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
                className={cn(TOOL, TOOL_NEUTRAL)}
                aria-label={`More actions for ${node.name}`}
              >
                <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => editor.open(id)}>Open</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.rename(id)}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.copy([id])}>Copy</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    ) : null
  ) : null;

  const markSize = detail === 'full' ? 'h-6 w-6 shrink-0' : 'h-9 w-9 shrink-0';

  const runWords = look ? `${look.words}${look.duration ? `, ${look.duration}` : ''}` : '';
  const runGlyph = look ? <RunGlyph look={look} className={markSize} /> : null;

  // A solid triangle with its "!" cut out in the dark ink, so it reads at any zoom.
  const issueGlyph = firstIssue ? (
    <TriangleAlert
      aria-hidden="true"
      className={cn(
        markSize,
        '[&>path:not(:first-child)]:stroke-onActionLight',
        firstIssue.severity === 'error'
          ? 'fill-actionDanger stroke-actionDanger'
          : 'fill-actionAccent stroke-actionAccent',
      )}
      strokeWidth={2.25}
    />
  ) : null;
  const issueTip = (
    <span className="flex max-w-64 flex-col gap-0.5 whitespace-normal text-left">
      <span className="type-ui">Issues</span>
      {issueNotes.slice(0, ISSUE_LINES).map((line) => (
        <span key={line}>{line}</span>
      ))}
      {issueNotes.length > ISSUE_LINES ? (
        <span>And {issueNotes.length - ISSUE_LINES} more.</span>
      ) : null}
    </span>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover shows the toolbar; React Flow makes the node focusable
    <div
      className={cn('relative', fits === false && !isSource ? 'opacity-30' : '')}
      style={
        {
          width: CARD_WIDTH,
          height,
          '--pg-step-colour': stepColour(def?.icon ?? 'manual'),
        } as CSSProperties
      }
      data-run-state={look?.state}
      onMouseEnter={enter}
      onMouseLeave={exit}
      onContextMenu={(event) => {
        if (!editor) return;
        event.preventDefault();
        editor.contextMenu({ kind: 'step', key: id }, { x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={() => editor?.open(id)}
    >
      {toolbar}

      {data.label && detail === 'full' ? (
        // A tab on the card's top edge (its last 2px run into the card and are clipped), left-aligned
        // and as wide as its words need. "When" for the trigger, in yellow; every other step names its
        // kind, quietly ("AI"), after TriForms' "1. Question" tab.
        <span
          data-testid="step-tab"
          className={cn(
            'pg-step-tab absolute bottom-full left-5 -mb-0.5 flex h-8 items-center whitespace-nowrap rounded-t-md px-3.5 pb-0.5 text-sm',
            isTrigger
              ? 'type-ui bg-actionSecondary text-onActionLight'
              : 'type-label bg-secondary text-ink',
          )}
        >
          {/* On the words, not the tab: it would fade the tab's border along with them. */}
          <span className={isTrigger ? undefined : 'muted-tone'}>{data.label}</span>
        </span>
      ) : null}

      <div
        className={cn(
          'pg-step-card relative flex h-full w-full items-center gap-4 overflow-hidden rounded-card bg-secondary px-6',
          node.disabled ? 'opacity-50' : '',
          look?.card,
        )}
      >
        <span
          className={cn(
            'relative flex h-14 w-14 shrink-0 items-center justify-center',
            look?.running ? 'pg-run-pulse' : '',
          )}
        >
          {/* 48 here is the 40 px on screen the owner likes, at the opening zoom of 0.8. */}
          <StepGlyph icon={def?.icon ?? 'manual'} className="h-12 w-12" />
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
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            title={node.name}
            className={cn('type-ui truncate text-lg text-ink', node.disabled ? 'line-through' : '')}
          >
            {node.name}
          </span>
          {detail === 'full' ? (
            paint?.state === 'failed' && paint.error ? (
              <span className="type-label truncate text-sm text-dangerInk" title={paint.error}>
                {paint.error}
              </span>
            ) : data.summary ? (
              <span
                className="type-label truncate text-sm text-ink type-muted"
                title={data.summary}
              >
                {data.summary}
              </span>
            ) : null
          ) : null}
        </span>
      </div>

      <span
        data-testid="step-marks"
        className="absolute right-2.5 bottom-2 flex items-center gap-2"
      >
        {look && runGlyph ? (
          mode.onRunBadgeClick ? (
            <TooltipHint label={runWords}>
              <button
                type="button"
                data-testid="run-badge"
                data-state={look.state}
                className="nodrag nopan flex shrink-0 items-center rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
                aria-label={badgeLabel(look, node.name)}
                onClick={(event) => {
                  event.stopPropagation();
                  mode.onRunBadgeClick?.(id);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {runGlyph}
                <span className="sr-only">{runWords}</span>
              </button>
            </TooltipHint>
          ) : (
            <Mark label={runWords} testId="run-badge" state={look.state}>
              {runGlyph}
            </Mark>
          )
        ) : null}
        {liveInTests && detail !== 'icon' ? (
          <Mark label="Live In Tests" testId="live-in-tests" className="text-dangerInk">
            <Radio aria-hidden="true" className={markSize} strokeWidth={2.75} />
          </Mark>
        ) : null}
        {pinned && detail !== 'icon' ? (
          <Mark label="Pinned Data" testId="pin-sticker" className="text-ink">
            <Pin aria-hidden="true" className={markSize} strokeWidth={2.75} />
          </Mark>
        ) : null}
        {node.disabled && detail !== 'icon' ? (
          <Mark label="Turned Off" testId="off-mark" className="text-ink">
            <PowerOff aria-hidden="true" className={markSize} strokeWidth={2.75} />
          </Mark>
        ) : null}
        {firstIssue ? (
          <TooltipHint label={issueTip} side="bottom">
            {editor ? (
              <button
                type="button"
                data-testid="step-issue"
                aria-label={`Fix ${node.name}: ${issueNotes.join(' ')}`}
                className="nodrag nopan flex shrink-0 items-center rounded-sm outline-none transition-transform duration-150 hover:scale-110 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing motion-reduce:transition-none"
                onClick={(event) => {
                  event.stopPropagation();
                  if (editor.openIssue) editor.openIssue(firstIssue);
                  else editor.open(id);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {issueGlyph}
              </button>
            ) : (
              <span
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the issue's sentence is reachable by keyboard
                tabIndex={0}
                data-testid="step-issue"
                className="nodrag flex shrink-0 items-center rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
              >
                {issueGlyph}
                <span className="sr-only">{issueNotes.join(' ')}</span>
              </span>
            )}
          </TooltipHint>
        ) : null}
      </span>

      {isTrigger ? null : (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className={cn(HANDLE, fits ? 'pg-handle-fits' : '')}
        />
      )}

      {ports.map((port, index) => {
        const top = portTop(index, ports.length, height);
        const labelled = port.id !== 'out';
        const named = labelled && detail !== 'icon';
        const open =
          editor && !usedPorts.includes(port.id) && !connection.inProgress && detail !== 'icon'
            ? !editor.locked
            : false;
        const stem = port.id === 'error' ? 'bg-actionDanger' : 'bg-ink';
        return (
          <div key={port.id}>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{ top }}
              className={cn(HANDLE, port.id === 'error' ? 'bg-actionDanger!' : '')}
            />
            {named || open ? (
              // One row from the dot outwards, so the stem, the name and the "+" always join,
              // however long the name is.
              <span
                className="pointer-events-none absolute left-full ms-2 flex -translate-y-1/2 items-center"
                style={{ top }}
              >
                {named ? (
                  <>
                    <span aria-hidden="true" className={cn('h-[2.5px] w-3', stem)} />
                    <span
                      title={port.label}
                      className={cn(
                        STICKER,
                        'pointer-events-auto max-w-24',
                        PORT_STICKER[port.id] ?? 'bg-secondary text-ink',
                      )}
                    >
                      <span className="truncate">{port.label}</span>
                    </span>
                  </>
                ) : null}
                {open ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn('h-[2.5px]', named ? 'w-3' : 'w-5', stem)}
                    />
                    <button
                      type="button"
                      // A white tile (ink, with a page-coloured plus) like the line it ends, swelling
                      // under the pointer. It grows from its left edge on the line's own centre, so
                      // nothing around it moves.
                      className={cn(
                        'nodrag nopan pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink bg-ink text-primary',
                        'transition-[width,height] duration-150 ease-out motion-reduce:transition-none',
                        'hover:h-12 hover:w-12 focus-visible:h-12 focus-visible:w-12',
                        'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                      )}
                      aria-label={`Add a step after ${node.name}${labelled ? `, ${port.label}` : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        editor?.pickFrom(
                          { source: id, sourcePort: port.id },
                          { x: rect.right, y: rect.top + rect.height / 2 },
                        );
                      }}
                    >
                      <MotionIcon icon={PlusIcon} className="h-5 w-5" />
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
