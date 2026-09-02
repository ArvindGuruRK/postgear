'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const TONE = {
  primary: { fill: 'bg-actionPrimary', on: 'text-onActionPrimary' },
  danger: { fill: 'bg-actionDanger', on: 'text-onActionLight' },
  success: { fill: 'bg-actionSuccess', on: 'text-onActionLight' },
  accent: { fill: 'bg-actionAccent', on: 'text-onActionLight' },
  ai: { fill: 'bg-actionAi', on: 'text-onActionAi' },
} as const;

const SIZE = {
  sm: { track: 'h-3', label: 'text-[10px]' },
  md: { track: 'h-5', label: 'text-xs' },
  lg: { track: 'h-8', label: 'text-sm' },
} as const;

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  /** Diagonal barber-pole banding on the fill. */
  striped?: boolean;
  /** Crawl the stripes. Ignored unless `striped`; always off under reduced motion. */
  animated?: boolean;
  /**
   * Text laid over the bar (e.g. "77% SOLD!"). Centred inside the fill when
   * there is room, otherwise centred on the whole track in ink so a nearly
   * empty bar doesn't clip its own label.
   */
  label?: React.ReactNode;
}

/** Below this much fill, a label inside the bar has nowhere to sit legibly. */
const LABEL_INSIDE_THRESHOLD = 30;

export const Progress = forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  (
    {
      className,
      value,
      tone = 'primary',
      size = 'md',
      striped = true,
      animated = true,
      label,
      ...props
    },
    ref,
  ) => {
    const percent = Math.min(100, Math.max(0, value ?? 0));
    const labelInside = percent >= LABEL_INSIDE_THRESHOLD;

    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={percent}
        className={cn(
          'relative w-full overflow-hidden rounded-full border-2 border-outline bg-secondary shadow-brutalSm',
          // Halftone dots show through wherever the fill hasn't reached,
          // reusing the texture already established in the system.
          'bg-halftone',
          SIZE[size].track,
          className,
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full w-full',
            // Transform rather than width: the stripe geometry stays locked to
            // the fill instead of being stretched as the bar grows.
            'transition-transform duration-500 ease-out motion-reduce:transition-none',
            TONE[tone].fill,
            striped && 'bg-stripes',
            striped && animated && 'animate-progressStripes motion-reduce:animate-none',
            // Hard edge where the fill stops, so a partial bar reads as a
            // solid block butting into the empty track.
            percent > 0 && percent < 100 && 'border-outline border-r-2',
          )}
          style={{ transform: `translateX(-${100 - percent}%)` }}
        />

        {label != null && (
          // Overlaid rather than nested in the indicator: the indicator is
          // translated, so a child would slide out of view with it. This box
          // spans the filled width and centres the label within it.
          <span
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center',
              'font-display uppercase tracking-wide',
              'transition-[width] duration-500 ease-out motion-reduce:transition-none',
              SIZE[size].label,
              labelInside ? TONE[tone].on : 'text-ink',
            )}
            style={{ width: labelInside ? `${percent}%` : '100%' }}
          >
            <span className="truncate px-2">{label}</span>
          </span>
        )}
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = ProgressPrimitive.Root.displayName;
