'use client';

/**
 * One drop target: a day (month view), an hour of a day (week view), or an
 * exact posting time (day view).
 *
 * The cell treatment follows the reference calendar (UI revamp, 2026-10-18):
 * a future slot is a softly outlined cell whose empty space becomes a "+" on
 * hover, which opens the composer at that time; a slot already behind us is
 * hatched, accepts no drops and no new posts, and says "Date passed" on hover
 * when nothing is in it. The drop highlight is the primary action color at
 * low opacity with a dashed edge: the system's "this is where it goes"
 * treatment, not a new color.
 */
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@postgear/ui';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SlotTime } from './calendar-math';

export type SlotTarget = SlotTime;

export function slotId(target: SlotTarget): string {
  const base = `slot:${target.day.getTime()}:${target.hour ?? 'day'}`;
  return target.hour !== undefined && target.minute !== undefined
    ? `${base}:${target.minute}`
    : base;
}

export function CalendarSlot({
  target,
  past,
  empty,
  label,
  onCreate,
  heading,
  addContent,
  className,
  children,
}: {
  target: SlotTarget;
  past: boolean;
  /** No posts in it: a past slot then says "Date passed" on hover. */
  empty: boolean;
  /** For the create button's accessible name, e.g. "Tue 13 Oct at 14:00". */
  label: string;
  onCreate: (target: SlotTarget) => void;
  /** Shown at the top whatever the slot holds: the month view's day number. */
  heading?: ReactNode;
  /** What the create area shows instead of the hover "+" (the day view's channels). */
  addContent?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: slotId(target),
    data: target,
    disabled: past,
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="calendar-slot"
      data-slot={slotId(target)}
      data-past={past || undefined}
      className={cn(
        'group/slot relative flex min-h-0 flex-col rounded-lg',
        past ? 'cursor-not-allowed bg-hatch' : 'border-2 border-ink/10',
        isOver && !past && 'border-dashed border-actionPrimary bg-actionPrimary/10',
        className,
      )}
    >
      {heading}
      {empty ? null : <div className="flex min-w-0 flex-col gap-1 p-1">{children}</div>}

      {!past ? (
        <button
          type="button"
          onClick={() => onCreate(target)}
          aria-label={`New post ${label}`}
          // Out of the tab order: a week has 168 of these, and a keyboard user
          // reaches the composer through "Create Post" and the Reschedule dialog.
          tabIndex={-1}
          className={cn(
            'flex min-h-10 w-full flex-1 items-center justify-center rounded-md p-1 outline-none',
            'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            // Out of the way while a drag is in progress so the drop target reads clean.
            active && 'pointer-events-none opacity-0',
          )}
        >
          {addContent ?? (
            <span
              aria-hidden="true"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md border-2 border-outline',
                'bg-actionPrimary text-onActionPrimary shadow-brutalSm',
                'opacity-0 transition-opacity group-hover/slot:opacity-100',
              )}
            >
              <Plus className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
        </button>
      ) : empty ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-center type-ui text-xs text-ink opacity-0 transition-opacity group-hover/slot:opacity-40"
        >
          Date passed
        </span>
      ) : null}
    </div>
  );
}
