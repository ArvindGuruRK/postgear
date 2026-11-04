'use client';

/**
 * A splitter (the WAI-ARIA window splitter): drag it, or focus it and use the
 * arrow keys (Home and End jump to the ends). Used between the step editor's
 * columns, and above the Logs dock and a run's step list.
 *
 * `grows` says which way dragging makes the value bigger: Logs sits at the
 * bottom, so dragging its top edge up makes it taller. Up or down makes the
 * splitter a horizontal line.
 */
import { cn } from '@postgear/ui';
import { type KeyboardEvent, type PointerEvent, useRef } from 'react';

export interface ResizeHandleProps {
  /** What it resizes, in Title Case ("Resize Step Panel"). */
  label: string;
  value: number;
  min: number;
  max: number;
  /** How much one arrow press moves it. */
  step: number;
  /** Pixels of pointer movement to value units (1 for pixels; 100 / width for percent). */
  scale?: number;
  grows: 'left' | 'right' | 'up' | 'down';
  onChange: (value: number) => void;
  /** Words for the value a screen reader hears ("420 pixels"). */
  valueText?: string;
  className?: string;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  step,
  scale = 1,
  grows,
  onChange,
  valueText,
  className,
}: ResizeHandleProps) {
  const drag = useRef<{ at: number; value: number } | null>(null);
  const sign = grows === 'right' || grows === 'down' ? 1 : -1;
  const horizontal = grows === 'up' || grows === 'down';

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { at: horizontal ? event.clientY : event.clientX, value };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const moved = ((horizontal ? event.clientY : event.clientX) - drag.current.at) * scale * sign;
    onChange(clamp(Math.round(drag.current.value + moved), min, max));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft')) next = value - step * sign;
    else if (event.key === (horizontal ? 'ArrowDown' : 'ArrowRight')) next = value + step * sign;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    // The canvas's arrow keys walk the steps; this one is busy resizing.
    event.stopPropagation();
    onChange(clamp(next, min, max));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter has no native element; <hr> cannot take focus or a value
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 shrink-0 touch-none outline-none',
        horizontal ? 'h-2 cursor-row-resize' : 'w-2 cursor-col-resize',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute bg-transparent transition-colors group-hover:bg-actionPrimary group-focus-visible:bg-actionPrimary',
          horizontal
            ? 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2'
            : 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
        )}
      />
    </div>
  );
}
