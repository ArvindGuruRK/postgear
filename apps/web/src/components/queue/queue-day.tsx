'use client';

/**
 * The queue's timeline pieces (2026-10-23): a day (its date tile beside one
 * card of rows) and the skeleton that holds its shape.
 *
 * The date tile is a calendar page: the day's number large, its name above,
 * the month below. From `md` it sits in its own column and stays in view
 * while the day's rows scroll past; on a phone it lies flat above the card.
 * Today's tile is violet, the calendar's colour for the present, and days
 * already behind us carry the calendar's "date passed" hatching.
 */
import { cn, Skeleton } from '@postgear/ui';
import type { ReactNode } from 'react';
import type { TimelineDay } from './queue-timeline';

/** The tile column and the content column, shared by a day and its skeleton. */
const COLUMNS = 'flex flex-col gap-2 md:grid md:grid-cols-[6rem_minmax(0,1fr)] md:gap-5';

export function QueueDay({ day, children }: { day: TimelineDay; children: ReactNode }) {
  return (
    <section aria-label={day.label} className={COLUMNS}>
      <div className="md:sticky md:top-3 md:self-start">
        <div
          className={cn(
            'inline-flex items-baseline gap-2 rounded-lg border-2 border-outline px-3 py-1.5 shadow-surfaceSm',
            'md:flex md:w-full md:flex-col md:items-center md:gap-0.5 md:px-2 md:py-3',
            day.today
              ? 'bg-actionAi text-onActionAi'
              : cn('bg-secondary text-ink', day.past && 'bg-hatch'),
          )}
        >
          <span className="type-ui text-xs">{day.name}</span>
          <span className="type-heading text-xl leading-none tabular-nums md:text-4xl">
            {day.dayNumber}
          </span>
          <span
            className={cn(
              'font-sans text-xs',
              // Muted only on the card colour: on violet it would drop below contrast.
              !day.today && 'type-muted',
            )}
          >
            {day.month}
          </span>
        </div>
      </div>

      <ul className="m-0 flex min-w-0 list-none flex-col divide-y-2 divide-outline overflow-hidden rounded-lg border-2 border-outline bg-secondary p-0 shadow-surfaceMd">
        {children}
      </ul>
    </section>
  );
}

/** Two days' worth of placeholder, in the same footprint as the real thing. */
export function QueueSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6" aria-busy="true" aria-label="Loading queue">
      {[3, 2].map((rows) => (
        <div key={rows} className={COLUMNS}>
          <Skeleton className="h-9 w-32 md:h-24 md:w-full" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: rows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders, never reordered
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
