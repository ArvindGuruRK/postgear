'use client';

/**
 * A line between two steps (blueprint 4.2): a 2.5 px ink bezier with an
 * arrowhead, 3.5 px when selected, red from an On Error output. A line
 * that has to run backwards goes round with square corners instead of curling
 * over the cards (n8n's). Hovering or selecting it shows a midpoint "+" (a new
 * step goes in between and the line splits) and a delete button. A 24 px
 * invisible path makes it easy to hit. Branch lines carry no label of their
 * own: the name at the port says which it is.
 *
 * A painted run (Module 08, blueprint 7.2) restyles it: the line into a
 * running step flows (React Flow's `animated` class, our 1 s dash keyframe in
 * workflow-canvas.css), a taken line turns solid success green, and a line
 * on the branch not taken goes dashed and faint. Reduced motion stops the
 * flow; the dashes stay.
 *
 * Outside the builder, or on a read-only canvas, a line has no buttons and
 * no menu.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { cn, MotionIcon } from '@postgear/ui';
import {
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  Position,
} from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useOptionalBuilder } from '../builder/builder-context';
import { useCanvasMode } from './canvas-mode';
import type { EdgeRunState, FlowEdge } from './flow-model';

const GRACE_MS = 150;

/** A button of the line's control: a centred 36px square, muted until the pointer is on it. */
const EDGE_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-md text-ink/60 transition-colors outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing';

/**
 * The arrowhead's length in px, whatever the line's width (the marker uses user units), and the
 * bigger one a hovered or selected line swells to along with its line.
 */
const ARROW = 16;
const ARROW_BIG = 20;

/** A line whose target is not this far right of its source would curl: it goes round instead. */
const BACKWARDS_BELOW = 48;

/** The visible path's classes and its arrowhead, from what the run did with the line. */
export function edgeLook(options: {
  run: EdgeRunState | undefined;
  isError: boolean;
  selected: boolean;
  /** The pointer is on the line: it swells like a selected one. */
  hover?: boolean;
  markerId: string;
}): { path: string; group: string; marker: string } {
  const { run, isError, selected, hover = false, markerId } = options;
  const active = selected || hover;
  const width = active ? 'stroke-[3.5px]' : 'stroke-[2.5px]';
  // The bigger head is a marker of its own: CSS cannot resize a marker from its line.
  const big = active ? '-big' : '';
  if (run === 'taken') {
    return {
      path: cn('pg-edge-path pg-edge-taken stroke-successInk', width),
      group: '',
      marker: `url(#${markerId}-taken${big})`,
    };
  }
  const colour = isError ? 'stroke-actionDanger' : 'stroke-ink';
  const marker = isError ? `url(#${markerId}-error${big})` : `url(#${markerId}${big})`;
  if (run === 'skipped') {
    return { path: cn('pg-edge-path pg-edge-skipped', colour, width), group: 'opacity-35', marker };
  }
  if (run === 'active') {
    return { path: cn('pg-edge-path pg-edge-active', colour, width), group: '', marker };
  }
  return { path: cn('pg-edge-path', colour, width), group: '', marker };
}

export const StepEdge = memo(function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<FlowEdge>) {
  const builder = useOptionalBuilder();
  const mode = useCanvasMode();
  const editor = mode.readOnly ? null : builder;
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrow = hover || selected ? ARROW_BIG : ARROW;
  const ends = {
    sourceX,
    sourceY,
    sourcePosition,
    // React Flow ends a line on the outer edge of the port dot. The arrowhead's tip belongs
    // there (1px under the dot so anti-aliasing leaves no hairline gap), so the line itself
    // stops one arrowhead short, at the head's base. A line run on to the tip would poke
    // out of it as a small stub, the tip being narrower than the stroke.
    targetX: targetPosition === Position.Left ? targetX + 1 - arrow : targetX,
    targetY,
    targetPosition,
  };
  const backwards = targetX < sourceX + BACKWARDS_BELOW;
  // A named port's line runs level past its sticker before it bends, as far as there is room.
  const lead = Math.max(0, Math.min(data?.lead ?? 0, targetX - sourceX - 24));
  const from = sourceX + lead;
  // What room the sticker leaves can be too little to curve in: a bezier there falls almost straight
  // down and meets the arrowhead sideways, so that line turns square corners instead.
  const tight = lead > 0 && ends.targetX - from < Math.abs(targetY - sourceY) * 0.6;
  const [curve, labelX, labelY] =
    backwards || tight
      ? getSmoothStepPath({
          ...ends,
          sourceX: backwards ? sourceX : from,
          borderRadius: 12,
          offset: backwards ? Math.max(24, data?.lead ?? 0) : 0,
        })
      : getBezierPath({ ...ends, sourceX: from });
  const path =
    !backwards && lead > 0
      ? `M${sourceX},${sourceY} L${from},${sourceY} ${curve.replace(/^M[^A-Z]*/, '')}`
      : curve;
  const look = edgeLook({
    run: data?.run,
    isError: data?.isError ?? false,
    selected: selected ?? false,
    hover,
    markerId: mode.markerId,
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function enter() {
    // The line swells under the pointer on a read-only canvas too; only the buttons need an editor.
    if (timer.current) clearTimeout(timer.current);
    setHover(true);
  }
  function exit() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), GRACE_MS);
  }

  const showButtons = editor !== null && (hover || selected) && !editor.locked;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover reveals the line's buttons; the line is selectable through React Flow */}
      <g
        className={look.group || undefined}
        data-run={data?.run}
        onMouseEnter={enter}
        onMouseLeave={exit}
        onContextMenu={(event) => {
          if (!editor) return;
          event.preventDefault();
          editor.contextMenu({ kind: 'edge', id }, { x: event.clientX, y: event.clientY });
        }}
      >
        <path d={path} fill="none" className={look.path} markerEnd={look.marker} />
        <path
          d={path}
          fill="none"
          strokeOpacity={0}
          strokeWidth={24}
          className="react-flow__edge-interaction"
        />
      </g>
      {showButtons ? (
        <EdgeLabelRenderer>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps the buttons open while the pointer moves onto them */}
          <div
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-lg border-2 border-outline bg-secondary p-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={enter}
            onMouseLeave={exit}
          >
            {/* One quiet pair: the icons rest in muted ink and take their colour on hover, blue to
                add and red to delete (after TriForms' line control). */}
            <button
              type="button"
              aria-label="Add a step here"
              className={cn(EDGE_BUTTON, 'hover:bg-actionPrimary/15 hover:text-actionPrimary')}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                editor.pickOnEdge(id, { x: rect.right, y: rect.top + rect.height / 2 });
              }}
            >
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Delete this line"
              className={cn(EDGE_BUTTON, 'hover:bg-actionDanger/15 hover:text-dangerInk')}
              onClick={() => editor.dispatch({ type: 'disconnect', edgeIds: [id] })}
            >
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

function Arrow({ id, fill, size = ARROW }: { id: string; fill: string; size?: number }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      // The head's base (x = 0) sits on the end of the line and its tip reaches ARROW px on,
      // to the port dot. Fixed user units, so a selected (thicker) line keeps the same head.
      refX="0"
      refY="5"
      markerUnits="userSpaceOnUse"
      markerWidth={size}
      markerHeight={size}
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" className={fill} />
    </marker>
  );
}

/** The arrowheads, defined once inside each canvas: ink, On Error red and taken green. */
export function EdgeMarkers({ id = 'pg-arrow' }: { id?: string }) {
  return (
    <svg aria-hidden="true" className="absolute h-0 w-0">
      <defs>
        <Arrow id={id} fill="fill-ink" />
        <Arrow id={`${id}-error`} fill="fill-actionDanger" />
        <Arrow id={`${id}-taken`} fill="fill-successInk" />
        <Arrow id={`${id}-big`} fill="fill-ink" size={ARROW_BIG} />
        <Arrow id={`${id}-error-big`} fill="fill-actionDanger" size={ARROW_BIG} />
        <Arrow id={`${id}-taken-big`} fill="fill-successInk" size={ARROW_BIG} />
      </defs>
    </svg>
  );
}
