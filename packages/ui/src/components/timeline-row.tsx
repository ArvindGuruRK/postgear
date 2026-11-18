import type { HTMLAttributes, PointerEventHandler, ReactNode } from 'react';
import { cn } from '../lib/utils';

/** The label column's width when a row is not told otherwise, in px. Line the ruler up with it. */
export const TIMELINE_LABEL_WIDTH_PX = 88;

export interface TimelineRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The row's name, e.g. "Video", "Overlay", "Sound". */
  label: string;
  /** A short row: nothing is on it yet, but its name still shows where things go. */
  slim?: boolean;
  /** A taller row, for the video's pictures. Ignored when `slim`. */
  tall?: boolean;
  /** The label column's width in px; 0 hides the column (the name stays for screen readers). */
  labelWidthPx?: number;
  /** The track's width in px (the timeline's full length at this zoom). Fills the row when left out. */
  widthPx?: number;
  /** A press on the track itself, not on a bar: e.g. to clear the selection or jump there. */
  onTrackPointerDown?: PointerEventHandler<HTMLDivElement>;
  /** Bars and marks, each placed absolutely in px from the track's left edge. */
  children?: ReactNode;
}

/**
 * One row of a timeline (Sprint 12, Clips): its name in a fixed column on the
 * left, then an inset track that holds the bars. Presentational: children are
 * placed by the parent in px. The name column sticks to the left edge, so it
 * stays in view while the track scrolls sideways under it; give the row the
 * dock's background (e.g. `className="bg-chrome"`) so bars pass under the name
 * rather than over it.
 */
export function TimelineRow({
  label,
  slim = false,
  tall = false,
  labelWidthPx = TIMELINE_LABEL_WIDTH_PX,
  widthPx,
  onTrackPointerDown,
  className,
  children,
  ...props
}: TimelineRowProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form fields; this names a row of bars.
    <div role="group" aria-label={label} className={cn('flex items-stretch', className)} {...props}>
      {labelWidthPx > 0 ? (
        <div
          aria-hidden
          className="sticky left-0 z-10 flex shrink-0 items-center bg-inherit pr-2"
          style={{ width: labelWidthPx }}
        >
          <span className="truncate type-label text-xs text-ink">{label}</span>
        </div>
      ) : null}
      <div
        onPointerDown={onTrackPointerDown}
        className={cn(
          'relative shrink-0 rounded-md border-2 border-outline bg-inset',
          slim ? 'h-7' : tall ? 'h-14' : 'h-10',
          widthPx === undefined && 'flex-1',
        )}
        style={widthPx === undefined ? undefined : { width: widthPx }}
      >
        {/* Over the border too, so px 0 here is px 0 on the ruler (which has no side border). */}
        <div className="pointer-events-none absolute -inset-0.5 *:pointer-events-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
