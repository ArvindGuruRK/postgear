'use client';

/**
 * A line between two steps (blueprint 4.2): a 2 px ink bezier with an
 * arrowhead, 3 px when selected, red from an On Error output. Hovering or
 * selecting it shows a midpoint "+" (a new step goes in between and the
 * line splits) and a delete button. A 24 px invisible path makes it easy to
 * hit. Branch lines carry no label of their own: the port sticker names it.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { cn, MotionIcon } from '@postgear/ui';
import { EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useBuilder } from '../builder/builder-context';
import type { FlowEdge } from './flow-model';

const GRACE_MS = 150;

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
  const builder = useBuilder();
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
  const isError = data?.isError ?? false;
  const marker = isError ? 'url(#pg-arrow-error)' : 'url(#pg-arrow)';

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function enter() {
    if (timer.current) clearTimeout(timer.current);
    setHover(true);
  }
  function exit() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), GRACE_MS);
  }

  const showButtons = (hover || selected) && !builder.locked;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover reveals the line's buttons; the line is selectable through React Flow */}
      <g
        onMouseEnter={enter}
        onMouseLeave={exit}
        onContextMenu={(event) => {
          event.preventDefault();
          builder.contextMenu({ kind: 'edge', id }, { x: event.clientX, y: event.clientY });
        }}
      >
        <path
          d={path}
          fill="none"
          className={cn(
            'pg-edge-path',
            isError ? 'stroke-actionDanger' : 'stroke-ink',
            selected ? 'stroke-[3px]' : 'stroke-2',
          )}
          markerEnd={marker}
        />
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
              className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm hover:bg-actionSecondary hover:text-onActionLight"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                builder.pickOnEdge(id, { x: rect.right, y: rect.top + rect.height / 2 });
              }}
            >
              <MotionIcon icon={PlusIcon} className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete this line"
              className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-actionDanger text-onActionLight shadow-brutalSm"
              onClick={() => builder.dispatch({ type: 'disconnect', edgeIds: [id] })}
            >
              <MotionIcon icon={XIcon} className="h-3.5 w-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

/** The arrowheads, defined once inside the canvas's SVG. */
export function EdgeMarkers() {
  return (
    <svg aria-hidden="true" className="absolute h-0 w-0">
      <defs>
        <marker
          id="pg-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink" />
        </marker>
        <marker
          id="pg-arrow-error"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-actionDanger" />
        </marker>
      </defs>
    </svg>
  );
}
