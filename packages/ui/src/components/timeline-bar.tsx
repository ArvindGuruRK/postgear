'use client';

import type { HTMLAttributes, PointerEvent, ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * A row's colour, by token: the bar's fill and its selected ring. `warning` is
 * the yellow (`actionSecondary`), so it reads apart from `accent`'s orange.
 */
export type TimelineTone = 'primary' | 'accent' | 'success' | 'warning' | 'ai' | 'danger';

const TONE: Record<TimelineTone, { fill: string; on: string; ring: string }> = {
  primary: { fill: 'bg-actionPrimary', on: 'text-onActionPrimary', ring: 'ring-actionPrimary' },
  accent: { fill: 'bg-actionAccent', on: 'text-onActionLight', ring: 'ring-actionAccent' },
  success: { fill: 'bg-actionSuccess', on: 'text-onActionLight', ring: 'ring-actionSuccess' },
  warning: { fill: 'bg-actionSecondary', on: 'text-onActionLight', ring: 'ring-actionSecondary' },
  ai: { fill: 'bg-actionAi', on: 'text-onActionAi', ring: 'ring-actionAi' },
  danger: { fill: 'bg-actionDanger', on: 'text-onActionLight', ring: 'ring-actionDanger' },
};

type PointerHandler = (event: PointerEvent<HTMLDivElement>) => void;

export interface TimelineBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onPointerDown' | 'aria-label'> {
  /** Where the bar starts and how long it is, in px from the track's left edge. */
  leftPx: number;
  widthPx: number;
  /** What a screen reader hears, e.g. "Part 2, from 12 seconds, 8 seconds long". */
  'aria-label': string;
  /** The row's colour: the bar's fill and, when selected, its ring. */
  tone?: TimelineTone;
  /** The one selected thing on the timeline: a 2 px ring in the row's colour. */
  selected?: boolean;
  /** The body can be dragged along the row (an item), not only pressed (a video part). */
  movable?: boolean;
  /** Show the two edge grips (trim a part, resize an item). */
  resizable?: boolean;
  /** Pressed on the body: select it, and for a movable bar start a move. */
  onBodyPointerDown?: PointerHandler;
  /** Pressed on an edge grip. The pointer is captured on the grip until it is let go. */
  onStartGripPointerDown?: PointerHandler;
  onEndGripPointerDown?: PointerHandler;
  /**
   * From here to the bar's right end, in px from the bar's own left edge, the
   * bar is hatched: video we do not hold in full quality yet. Left out, none.
   */
  hatchFromPx?: number;
  /**
   * From the bar's left edge to here, in px, the bar is hatched: video brought
   * back before what we hold. Left out, none.
   */
  hatchUntilPx?: number;
  disabled?: boolean;
  /** The filmstrip canvas, a name, a "2x" chip (`TimelineBarChip`). */
  children?: ReactNode;
}

/**
 * One bar on a timeline row (Sprint 12, Clips): a part of the video, a text,
 * a sticker, a zoom, a sound. Presentational: the parent places it in px and
 * hears every press, with the event, to work out a drag itself (move events
 * and the release reach the parent through `onPointerMove` and `onPointerUp`,
 * which pass straight through).
 *
 * Bordered with no shadow: bars are dragged, not pressed. Focusable, so the
 * keyboard can reach every bar (the parent's `onKeyDown` moves it).
 */
export function TimelineBar({
  leftPx,
  widthPx,
  tone = 'primary',
  selected = false,
  movable = false,
  resizable = true,
  onBodyPointerDown,
  onStartGripPointerDown,
  onEndGripPointerDown,
  hatchFromPx,
  hatchUntilPx,
  disabled = false,
  className,
  style,
  children,
  ...props
}: TimelineBarProps) {
  const colours = TONE[tone];
  const hatchLeft =
    hatchFromPx === undefined ? undefined : Math.max(0, Math.min(widthPx, hatchFromPx));
  const hatchRight =
    hatchUntilPx === undefined ? undefined : Math.max(0, Math.min(widthPx, hatchUntilPx));

  const grip = (handler: PointerHandler | undefined) => (event: PointerEvent<HTMLDivElement>) => {
    // The grip's press is not also the body's.
    event.stopPropagation();
    if (disabled) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    handler?.(event);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a button cannot hold the grips (interactive children) or the filmstrip canvas; this is a draggable bar.
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      data-selected={selected ? '' : undefined}
      onPointerDown={(event) => {
        if (!disabled) {
          onBodyPointerDown?.(event);
        }
      }}
      className={cn(
        'group/bar absolute inset-y-1.5 flex touch-none select-none items-center overflow-hidden rounded-md border-2 border-outline',
        colours.fill,
        colours.on,
        'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-actionPrimary',
        selected ? cn('ring-2', colours.ring) : 'hover:ring-2 hover:ring-ink/25',
        disabled ? 'cursor-not-allowed opacity-50' : movable ? 'cursor-grab' : 'cursor-pointer',
        className,
      )}
      style={{ ...style, left: leftPx, width: widthPx }}
      {...props}
    >
      <div className="relative flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5">
        {children}
      </div>
      {hatchRight !== undefined && hatchRight > 0 ? (
        <span
          aria-hidden
          data-hatch="start"
          className="pointer-events-none absolute inset-y-0 left-0 border-r-2 border-dashed border-outline bg-stripes"
          style={{ width: hatchRight }}
        />
      ) : null}
      {hatchLeft !== undefined && hatchLeft < widthPx ? (
        <span
          aria-hidden
          data-hatch="end"
          className="pointer-events-none absolute inset-y-0 right-0 border-l-2 border-dashed border-outline bg-stripes"
          style={{ left: hatchLeft }}
        />
      ) : null}
      {resizable ? (
        <>
          <Grip side="start" onPointerDown={grip(onStartGripPointerDown)} disabled={disabled} />
          <Grip side="end" onPointerDown={grip(onEndGripPointerDown)} disabled={disabled} />
        </>
      ) : null}
    </div>
  );
}

function Grip({
  side,
  onPointerDown,
  disabled,
}: {
  side: 'start' | 'end';
  onPointerDown: PointerHandler;
  disabled: boolean;
}) {
  return (
    <div
      aria-hidden
      data-grip={side}
      onPointerDown={onPointerDown}
      className={cn(
        'absolute inset-y-0 z-20 flex w-2 touch-none items-center justify-center',
        side === 'start' ? 'left-0 cursor-col-resize' : 'right-0 cursor-col-resize',
        disabled && 'cursor-not-allowed',
      )}
    >
      <span className="h-1/2 w-0.5 rounded-full bg-outline opacity-0 transition-opacity group-hover/bar:opacity-100 group-data-selected/bar:opacity-100" />
    </div>
  );
}

/**
 * A small tag inside a bar, such as the speed ("2x") on a video part. Squared
 * like a `Badge`, on the card colour so it reads on any row colour.
 */
export function TimelineBarChip({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'relative z-10 inline-flex h-5 shrink-0 items-center rounded-md border-2 border-outline bg-secondary px-1 font-sans text-[11px] font-bold leading-none tabular-nums text-ink',
        className,
      )}
      {...props}
    />
  );
}
