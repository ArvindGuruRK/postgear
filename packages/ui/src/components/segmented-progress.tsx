import type { CSSProperties, HTMLAttributes } from 'react';
import {
  PROGRESS_SIZE,
  PROGRESS_TONE,
  type ProgressSize,
  type ProgressTone,
} from '../lib/progress-styles';
import { cn } from '../lib/utils';

/**
 * A progress bar cut into separate cells with gaps between them (2026-10-22):
 * a goal counted in posts, a streak counted in weeks. Each cell is a small
 * `Progress`: the same outline, hard shadow, rounded ends, tone fills and
 * barber-pole stripes, crawling left to right at the same speed.
 *
 * ## Why not a row of `Progress`
 *
 * Every `Progress` draws its bands from its own corner, so a row of them
 * restarts the pattern in each cell and the diagonal lines jump at every gap,
 * which reads as broken next to an unbroken bar. Here every cell shows its own
 * slice of ONE pattern, placed by how far the cell sits from the row's start
 * (`bg-stripes-flow` in `packages/config/tailwind.css`), so the bands run
 * through the gaps as if the cells were windows onto a single bar.
 *
 * ## How it stays pure CSS
 *
 * The row is a size container (`@container`) so a cell can read the row's
 * width in `cqw`; each cell is handed its index (`--i`) and the cell count
 * (`--n`). No measuring, no state, no effects: it is a Server Component and
 * works the same in a client one, and keeps working when the row resizes.
 *
 * ## Cells
 *
 * `full` is lit, `empty` is the bare track, `open` is a bare track with a
 * dashed outline for a step that is still undecided (this week in a streak).
 * The cells carry no text of their own, since the row is one image to
 * assistive tech; `aria-label` is required and says what it shows.
 */
export type ProgressSegment = 'full' | 'empty' | 'open';

export interface SegmentedProgressProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role' | 'aria-label'> {
  segments: ProgressSegment[];
  tone?: ProgressTone;
  size?: ProgressSize;
  /** Crawl the stripes. Always off under reduced motion. */
  animated?: boolean;
  /** What the row shows ("3 of 7 published"). */
  'aria-label': string;
}

/** `total` cells with the first `filled` lit: the usual "n of m". */
export function fillSegments(filled: number, total: number): ProgressSegment[] {
  const count = Math.max(0, Math.floor(total));
  const lit = Math.min(count, Math.max(0, Math.floor(filled)));

  return Array.from(
    { length: count },
    (_, index): ProgressSegment => (index < lit ? 'full' : 'empty'),
  );
}

export function SegmentedProgress({
  segments,
  tone = 'primary',
  size = 'sm',
  animated = true,
  className,
  ...props
}: SegmentedProgressProps) {
  const count = segments.length;

  return (
    <div
      role="img"
      className={cn(
        // The row: a size container, with the gap and border the cells' stripe
        // offset is worked out from (see bg-stripes-flow).
        '@container flex w-full gap-(--seg-gap) [--seg-border:2px] [--seg-gap:calc(var(--spacing)*1.5)]',
        className,
      )}
      {...props}
    >
      {segments.map((segment, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: cells are positions, nothing else to key on
          key={index}
          aria-hidden="true"
          data-segment={segment}
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden rounded-full border-2 border-outline bg-secondary shadow-surfaceSm',
            PROGRESS_SIZE[size].track,
            segment === 'open' && 'border-dashed',
          )}
          style={{ '--i': index, '--n': count } as CSSProperties}
        >
          {segment === 'full' ? (
            <span
              className={cn(
                'absolute inset-0 bg-stripes-flow',
                PROGRESS_TONE[tone].fill,
                animated && 'animate-segmentStripes motion-reduce:animate-none',
              )}
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}
