import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * The comic speech bubble the Sprint 0 doc names as a sanctioned accent
 * ("rounded rectangle + a small triangular tail"), built here for the Sprint 6
 * copilot chat, and, per design-system-rules.md §16b, for chat only. Fills
 * follow the Badge/Alert pairing: `primary` is the user's own message,
 * `ai` marks what the model produced, `default` is a plain surface.
 *
 * The tail is a rotated bordered square rather than a CSS-triangle hack:
 * `border-t-0 border-l-0` on a 45°-rotated square leaves only the two edges
 * that point downward, so the ink outline runs continuously from the bubble
 * into the tail, and the square's borderless top half paints over the
 * bubble's own bottom border in the variant's fill. It is clipped by nothing,
 * so the bubble must not get `overflow-hidden`. The bubble's shadow is not
 * repeated on the tail: a rotated box-shadow would point the wrong way.
 */
const bubbleVariants = cva(
  'relative rounded-lg border-2 border-outline p-4 font-sans text-sm shadow-surfaceSm',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-ink',
        primary: 'bg-actionPrimary text-onActionPrimary',
        ai: 'bg-actionAi text-onActionAi',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/**
 * The tail's fill has to match the bubble's, and it can't inherit it:
 * `background-color` doesn't cascade, so the pair is spelled out per variant.
 */
const TAIL_FILL = {
  default: 'bg-secondary',
  primary: 'bg-actionPrimary',
  ai: 'bg-actionAi',
} as const;

export interface SpeechBubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleVariants> {
  /** Which bottom corner the tail hangs from; `none` is a plain rounded box. */
  tail?: 'left' | 'right' | 'none';
}

export const SpeechBubble = forwardRef<HTMLDivElement, SpeechBubbleProps>(
  ({ className, variant, tail = 'none', children, ...props }, ref) => (
    <div ref={ref} className={cn(bubbleVariants({ variant }), className)} {...props}>
      {children}
      {tail !== 'none' && (
        <span
          aria-hidden="true"
          className={cn(
            // Centred on the bubble's padding edge: half the square sits inside
            // (covering the border in the fill colour), half pokes out as the tail.
            'pointer-events-none absolute -bottom-2 h-4 w-4 rotate-45 border-2 border-outline border-t-0 border-l-0',
            TAIL_FILL[variant ?? 'default'],
            tail === 'left' ? 'left-4' : 'right-4',
          )}
        />
      )}
    </div>
  ),
);
SpeechBubble.displayName = 'SpeechBubble';
