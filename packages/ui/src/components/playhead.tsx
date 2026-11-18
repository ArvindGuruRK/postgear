'use client';

import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { cn } from '../lib/utils';

export interface PlayheadProps {
  /** Where the line stands, in px from the left of the layer it sits in. */
  px: number;
  /** What a screen reader calls it. */
  label?: string;
  /** The time it stands at, the start and the end, in ms (the slider's value). */
  valueMs: number;
  minMs?: number;
  maxMs: number;
  /** The time in words for a screen reader, e.g. "12 seconds of 42 seconds". */
  valueText: string;
  /** The grip was pressed. The pointer is captured until it is let go. */
  onDragStart?: (event: PointerEvent<HTMLDivElement>) => void;
  /** Where the grip is being dragged to, in the same px as `px`. The parent turns it into a time. */
  onDrag?: (px: number) => void;
  onDragEnd?: () => void;
  /** Left or right on the focused grip; `large` when Shift is held (a second, not a frame). */
  onStep?: (direction: -1 | 1, large: boolean) => void;
  /** Home or End on the focused grip. */
  onJump?: (to: 'start' | 'end') => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The playhead (Sprint 12, Clips): a 2 px line across the ruler and the rows,
 * with a small grip on the ruler. Presentational: the parent places it in px
 * and hears where it is dragged, also in px. The line lets the pointer through
 * to the rows; only the grip takes it, captured so a fast drag never drops.
 *
 * The grip is the keyboard's way through time: a slider whose value is the
 * time in ms, stepped with the arrows (a frame, Shift a second) and Home and
 * End, which the parent applies. Put it in a layer that is `relative` and
 * spans the ruler and every row.
 */
export function Playhead({
  px,
  label = 'Playhead',
  valueMs,
  minMs = 0,
  maxMs,
  valueText,
  onDragStart,
  onDrag,
  onDragEnd,
  onStep,
  onJump,
  disabled = false,
  className,
}: PlayheadProps) {
  // Where the drag began: the pointer's x on screen and the line's px then.
  // Working from the start keeps a long drag exact, and it needs no knowledge
  // of the layer's place on screen or its scroll.
  const drag = useRef<{ pointerId: number; clientX: number; px: number } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Taking focus lets the arrows carry on where the drag stopped.
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, px };
    onDragStart?.(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    onDrag?.(start.px + (event.clientX - start.clientX));
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDragEnd?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 } as const;
    if (event.key in step) {
      event.preventDefault();
      onStep?.(step[event.key as keyof typeof step], event.shiftKey);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onJump?.(event.key === 'Home' ? 'start' : 'end');
    }
  };

  return (
    <div
      className={cn('pointer-events-none absolute inset-y-0 z-20 w-0', className)}
      style={{ left: px }}
    >
      <span aria-hidden className="absolute inset-y-0 -left-px w-0.5 bg-actionAccent" />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={valueMs}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        className={cn(
          'pointer-events-auto absolute top-0 -left-1.5 h-3.5 w-3 touch-none rounded-b-sm border-2 border-outline bg-actionAccent',
          'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-actionPrimary',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize',
        )}
      />
    </div>
  );
}
