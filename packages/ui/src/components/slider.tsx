'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

type ThumbName = Pick<
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>,
  'aria-label' | 'aria-labelledby' | 'aria-valuetext'
>;

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /**
   * What a screen reader calls each thumb, in order, and how it reads the
   * value ("60%" rather than "60"). Radix puts `role="slider"` on the thumbs,
   * not the root, so a visible label is tied to them here by its id.
   */
  thumbs?: readonly ThumbName[];
}

/**
 * Handles both a single-value slider and a range slider: thumb count is
 * derived from `value`/`defaultValue` array length (1 thumb = slider, 2 = range).
 */
export const Slider = forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, value, defaultValue, thumbs, ...props }, ref) => {
    const thumbCount = (value ?? defaultValue ?? [0]).length;
    return (
      <SliderPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full border-2 border-outline bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-actionPrimary" />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }).map((_, index) => (
          <SliderPrimitive.Thumb
            // biome-ignore lint/suspicious/noArrayIndexKey: thumb count is fixed per slider instance
            key={index}
            {...thumbs?.[index]}
            className={cn(
              'block h-5 w-5 rounded-full border-2 border-outline bg-secondary shadow-surfaceSm',
              'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          />
        ))}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;
