'use client';

/**
 * One drop target: a day (month view) or an hour of a day (week and day views).
 *
 * A slot that is already behind us is drawn with the halftone texture and
 * accepts no drops and no new posts; a slot in the future shows a "+" on hover
 * and focus that opens the composer at that time. The drop highlight is the
 * primary action color at low opacity with a dashed border — the system's
 * "this is where it goes" treatment, not a new color.
 */
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@postgear/ui';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SlotTarget {
  day: Date;
  hour?: number;
}

export function slotId(target: SlotTarget): string {
  return `slot:${target.day.getTime()}:${target.hour ?? 'day'}`;
}

export function CalendarSlot({
  target,
  past,
  label,
  onCreate,
  className,
  children,
}: {
  target: SlotTarget;
  past: boolean;
  /** For the create button's accessible name, e.g. "Tue 13 Oct at 14:00". */
  label: string;
  onCreate: (target: SlotTarget) => void;
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
        'group/slot relative flex min-h-0 flex-col gap-1 p-1',
        past && 'bg-halftone',
        active && !past && 'transition-colors',
        isOver &&
          !past &&
          'bg-actionPrimary/15 outline-dashed outline-2 -outline-offset-2 outline-actionPrimary',
        className,
      )}
    >
      {children}

      {!past ? (
        <button
          type="button"
          onClick={() => onCreate(target)}
          aria-label={`New post ${label}`}
          // Out of the tab order: a week has 168 of these, and a keyboard user
          // reaches the composer through "New post" and the Reschedule dialog.
          tabIndex={-1}
          className={cn(
            'absolute end-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm',
            'opacity-0 outline-none transition-opacity',
            'group-hover/slot:opacity-100 focus-visible:opacity-100',
            'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
            'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            // Hidden while a drag is in progress so the drop target reads clean.
            active && 'pointer-events-none !opacity-0',
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
      ) : null}
    </div>
  );
}
