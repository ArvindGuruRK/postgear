'use client';

import { forwardRef, type HTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '../lib/utils';

export interface SummaryBoxRow {
  id: string;
  /** The first column, as wide as its longest entry. */
  lead: ReactNode;
  /** The second column, taking what is left. */
  main: ReactNode;
  /** The last column, flush with the box's right edge. */
  end: ReactNode;
}

export interface SummaryBoxProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The sentence the box reads back; announced again when it changes. */
  title?: ReactNode;
  /** Quiet lines under the sentence. */
  notes?: readonly string[];
  /** Names the rows. */
  rowsLabel?: string;
  rows?: readonly SummaryBoxRow[];
}

/**
 * What a form's choices come to, read back (2026-11-04): a sentence, then rows
 * whose columns line up down the box, such as the next runs of a schedule. Only
 * read, so it is the inset shade with no shadow. Everything starts on one left
 * edge, the same one as the text in a dropdown above it.
 */
export const SummaryBox = forwardRef<HTMLDivElement, SummaryBoxProps>(
  ({ title, notes = [], rowsLabel, rows = [], className, ...props }, ref) => {
    const labelId = useId();

    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col divide-y-2 divide-outline rounded-md border-2 border-outline bg-inset',
          className,
        )}
        {...props}
      >
        {title ? (
          <div className="flex flex-col gap-1 px-4 py-3">
            <p aria-live="polite" className="m-0 type-ui text-sm text-ink">
              {title}
            </p>
            {notes.map((note) => (
              <p key={note} className="m-0 font-sans text-xs text-ink muted-tone">
                {note}
              </p>
            ))}
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div className="flex flex-col gap-2 px-4 py-3">
            {rowsLabel ? (
              <p id={labelId} className="m-0 type-label text-xs text-ink">
                {rowsLabel}
              </p>
            ) : null}
            {/* One grid across the rows, so a long entry moves its whole column. */}
            <ul
              aria-labelledby={rowsLabel ? labelId : undefined}
              className="m-0 grid list-none grid-cols-[max-content_minmax(0,1fr)_max-content] gap-x-4 gap-y-1.5 p-0 font-sans text-sm text-ink tabular-nums"
            >
              {rows.map((row) => (
                <li key={row.id} className="col-span-full grid grid-cols-subgrid">
                  <span>{row.lead}</span>
                  <span className="truncate">{row.main}</span>
                  <span className="text-end">{row.end}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  },
);
SummaryBox.displayName = 'SummaryBox';
