'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export interface TimeRulerTick {
  /** Distance from the ruler's left edge, in px. */
  px: number;
  /** Shown beside a major tick, e.g. "0:30". */
  label?: string;
  /** A tall tick with its label; a minor tick is short and bare. */
  major: boolean;
}

export interface TimeRulerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The ticks in view, already placed (the engine's `rulerTicks`). Only these are drawn. */
  ticks: readonly TimeRulerTick[];
  /** The whole strip's width in px (the timeline's full length at this zoom). */
  widthPx: number;
  /** What a screen reader calls the strip. */
  label?: string;
}

/**
 * The time ruler above a timeline (Sprint 12, Clips): ticks and their labels,
 * drawn where the parent says, in px. It does no maths about time; the parent
 * works out the ticks (one fixed ladder, labels at least 64 px apart) and turns
 * a pointer's px back into a time. Pass `onPointerDown` and `onPointerMove` to
 * jump and scrub; the strip then shows a pointer cursor.
 *
 * The ticks are hidden from screen readers (they are only marks); the
 * playhead, a real slider, is how the keyboard moves through time.
 */
export function TimeRuler({
  ticks,
  widthPx,
  label = 'Time Ruler',
  className,
  style,
  onPointerDown,
  ...props
}: TimeRulerProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form fields; this names a strip of time marks.
    <div
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      className={cn(
        'relative h-7 shrink-0 touch-none select-none overflow-hidden border-b-2 border-outline',
        onPointerDown && 'cursor-pointer',
        className,
      )}
      style={{ ...style, width: widthPx }}
      {...props}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {ticks.map((tick) => (
          <div key={tick.px} className="absolute bottom-0" style={{ left: tick.px }}>
            <span
              className={cn(
                'absolute bottom-0 left-0 w-px bg-ink',
                tick.major ? 'h-2.5' : 'h-1.5 opacity-40',
              )}
            />
            {tick.major && tick.label ? (
              <span className="absolute bottom-2.5 left-1 whitespace-nowrap font-sans text-[11px] font-bold leading-none tabular-nums text-ink">
                {tick.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
