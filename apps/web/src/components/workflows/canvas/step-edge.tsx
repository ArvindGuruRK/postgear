'use client';

/**
 * A line between two steps (blueprint 4.2): a 2 px ink bezier with an
 * arrowhead, 3 px when selected, red from an On Error output. Hovering or
 * selecting it shows a midpoint "+" (a new step goes in between and the
 * line splits) and a delete button. A 24 px invisible path makes it easy to
 * hit. Branch lines carry no label of their own: the port sticker names it.
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
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { cn, MotionIcon } from '@postgear/ui';
import { EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useOptionalBuilder } from '../builder/builder-context';
import { useCanvasMode } from './canvas-mode';
import type { EdgeRunState, FlowEdge } from './flow-model';

const GRACE_MS = 150;

/** The visible path's classes and its arrowhead, from what the run did with the line. */
export function edgeLook(options: {
  run: EdgeRunState | undefined;
  isError: boolean;
  selected: boolean;
  markerId: string;
}): { path: string; group: string; marker: string } {
  const { run, isError, selected, markerId } = options;
  const width = selected ? 'stroke-[3px]' : 'stroke-2';
  if (run === 'taken') {
    return {
      path: cn('pg-edge-path pg-edge-taken stroke-successInk', width),
      group: '',
      marker: `url(#${markerId}-taken)`,
    };
  }
  const colour = isError ? 'stroke-actionDanger' : 'stroke-ink';
  const marker = isError ? `url(#${markerId}-error)` : `url(#${markerId})`;
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
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const look = edgeLook({
    run: data?.run,
    isError: data?.isError ?? false,
    selected: selected ?? false,
    markerId: mode.markerId,
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function enter() {
    if (!editor) return;
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
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={enter}
            onMouseLeave={exit}
          >
            <button
              type="button"
              aria-label="Add a step here"
              className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-primary"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                editor.pickOnEdge(id, { x: rect.right, y: rect.top + rect.height / 2 });
              }}
            >
              <MotionIcon icon={PlusIcon} className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete this line"
              className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-actionDanger text-onActionLight"
              onClick={() => editor.dispatch({ type: 'disconnect', edgeIds: [id] })}
            >
              <MotionIcon icon={XIcon} className="h-3.5 w-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

function Arrow({ id, fill }: { id: string; fill: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      // The tip stops short of the port dot it points at, so the two never overlap.
      refX="15"
      refY="5"
      markerWidth="7"
      markerHeight="7"
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
      </defs>
    </svg>
  );
}
